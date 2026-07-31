/* Momentjes — audio-opname + live transcriptie.
   Opname werkt altijd en stopt altijd; live meeschrijven is een extraatje
   dat netjes uitvalt als het toestel het niet ondersteunt. */

const Recorder = (() => {

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    const options = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const m of options) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
    }
    return ''; // laat de browser kiezen
  }

  function create() {
    const state = {
      stream: null, recorder: null, chunks: [], mime: '',
      audioCtx: null, analyser: null, levelData: null,
      startedAt: 0, elapsedBefore: 0, paused: false,
      onLevel: null, timerId: null, onTick: null,
      finished: false,
    };

    async function start() {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mime = pickMime();
      state.recorder = new MediaRecorder(state.stream, state.mime ? { mimeType: state.mime } : undefined);
      state.chunks = [];
      state.recorder.ondataavailable = (e) => { if (e.data && e.data.size) state.chunks.push(e.data); };
      state.recorder.start(1000);
      state.startedAt = Date.now();
      state.elapsedBefore = 0;
      state.paused = false;

      // Geluidsniveau voor de golfjes (op iOS moet de context expliciet resumen)
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        state.audioCtx = new AC();
        if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
        const src = state.audioCtx.createMediaStreamSource(state.stream);
        state.analyser = state.audioCtx.createAnalyser();
        state.analyser.fftSize = 256;
        state.levelData = new Uint8Array(state.analyser.frequencyBinCount);
        src.connect(state.analyser);
      } catch (_) { /* golfjes zijn optioneel */ }

      state.timerId = setInterval(() => {
        if (state.onTick) state.onTick(elapsed());
        if (state.onLevel && !state.paused) {
          if (state.analyser) state.analyser.getByteFrequencyData(state.levelData);
          state.onLevel(state.levelData || null);
        }
      }, 90);
    }

    function elapsed() {
      if (!state.startedAt) return state.elapsedBefore;
      return state.paused ? state.elapsedBefore
        : state.elapsedBefore + (Date.now() - state.startedAt);
    }

    function pause() {
      if (!state.recorder || state.paused) return;
      try { state.recorder.pause(); } catch (_) {}
      state.elapsedBefore = elapsed();
      state.paused = true;
    }

    function resume() {
      if (!state.recorder || !state.paused) return;
      try { state.recorder.resume(); } catch (_) {}
      state.startedAt = Date.now();
      state.paused = false;
    }

    function cleanup() {
      clearInterval(state.timerId);
      state.timerId = null;
      if (state.stream) { state.stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} }); state.stream = null; }
      if (state.audioCtx) { try { state.audioCtx.close(); } catch (_) {} state.audioCtx = null; }
    }

    /* Stoppen mag NOOIT blijven hangen: als de browser de onstop-event
       niet levert (gebeurt soms op iOS), ronden we na 1,6 s zelf af met
       de chunks die we al binnen hebben. */
    function stop() {
      return new Promise((resolve) => {
        const finish = () => {
          if (state.finished) return;
          state.finished = true;
          cleanup();
          if (!state.chunks.length) { resolve(null); return; }
          const type = state.mime || state.chunks[0].type || 'audio/mp4';
          resolve({ blob: new Blob(state.chunks, { type }), mime: type, duration: Math.max(1, Math.round(elapsed() / 1000)) });
        };
        const dur = elapsed();
        if (!state.recorder || state.recorder.state === 'inactive') { finish(); return; }
        state.recorder.onstop = finish;
        setTimeout(finish, 1600);
        try { if (state.recorder.state === 'paused') state.recorder.resume(); } catch (_) {}
        try { state.recorder.requestData(); } catch (_) {}
        try { state.recorder.stop(); } catch (_) { finish(); }
        // elapsed loopt na cleanup niet meer; bewaar de duur van vóór het stoppen
        state.elapsedBefore = dur; state.startedAt = 0;
      });
    }

    function cancel() {
      state.finished = true;
      try { if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop(); } catch (_) {}
      cleanup();
    }

    return {
      start, pause, resume, stop, cancel, elapsed,
      set onTick(fn) { state.onTick = fn; },
      set onLevel(fn) { state.onLevel = fn; },
      get paused() { return state.paused; },
    };
  }

  return { create, supported: () => !!(navigator.mediaDevices && typeof MediaRecorder !== 'undefined') };
})();


/* Live transcriptie via de spraakherkenning van het toestel zelf.
   Best effort: als het toestel niet meewerkt, gaat de opname gewoon door. */
const Speech = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function create(lang = 'nl-NL') {
    if (!SR) return null;
    let recog = null;
    let finalText = '';
    let active = false;
    let restarts = 0;
    let lastStart = 0;
    const handlers = { onUpdate: null, onUnavailable: null };

    function fresh() {
      recog = new SR();
      recog.lang = lang;
      recog.continuous = true;
      recog.interimResults = true;
      recog.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript + ' ';
          else interim += r[0].transcript;
        }
        restarts = 0; // er komt echt iets binnen — teller resetten
        if (handlers.onUpdate) handlers.onUpdate(finalText.trim(), interim.trim());
      };
      recog.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          active = false;
          if (handlers.onUnavailable) handlers.onUnavailable();
        }
        // 'no-speech' en 'aborted' zijn normaal
      };
      recog.onend = () => {
        if (!active) return;
        // Safari stopt na stiltes: rustig herstarten, maar nooit eindeloos
        // rondtollen als het toestel steeds direct weer afbreekt.
        if (Date.now() - lastStart < 700) restarts++;
        if (restarts > 6) {
          active = false;
          if (handlers.onUnavailable) handlers.onUnavailable();
          return;
        }
        try { lastStart = Date.now(); recog.start(); } catch (_) {}
      };
    }

    return {
      start() {
        active = true;
        try { fresh(); lastStart = Date.now(); recog.start(); } catch (_) {
          active = false;
          if (handlers.onUnavailable) handlers.onUnavailable();
        }
      },
      stop() { active = false; try { recog && recog.stop(); } catch (_) {} },
      abort() { active = false; try { recog && recog.abort(); } catch (_) {} },
      get text() { return finalText.trim(); },
      set onUpdate(fn) { handlers.onUpdate = fn; },
      set onUnavailable(fn) { handlers.onUnavailable = fn; },
    };
  }

  return { create, supported: () => !!SR };
})();
