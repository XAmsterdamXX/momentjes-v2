/* Momentjes V2 — Het bos: app-logica */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const MONTHS = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  const WEEKDAYS = ['zo','ma','di','wo','do','vr','za'];
  const fmtTime = (secs) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
  const fmtDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const svg = (id, cls = 'icon') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
  const CAT_ICONS = { quote: 'i-quote', question: 'i-question', leaf: 'i-leafcat', flag: 'i-flag' };
  // Merktekens: monochrome lijniconen — kleur is in deze wereld van de
  // seizoenen (en goud van favorieten), categorieën hebben een teken + naam
  const CAT_MERKEN = { quote: 'i-bubbel', question: 'i-question', leaf: 'i-wereld', flag: 'i-flag' };
  const catMerk = (cat) => CAT_MERKEN[cat?.icon] || 'i-wereld';

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._id);
    toast._id = setTimeout(() => { t.hidden = true; }, ms);
  }

  function appConfirm(text, { confirmText = 'OK', danger = false } = {}) {
    return new Promise((resolve) => {
      const bd = $('#dialog-backdrop'), btn = $('#dialog-confirm');
      $('#dialog-text').textContent = text;
      btn.textContent = confirmText;
      btn.classList.toggle('dialog-danger', danger);
      bd.hidden = false;
      const done = (val) => { bd.hidden = true; btn.onclick = null; $('#dialog-cancel').onclick = null; bd.onclick = null; resolve(val); };
      btn.onclick = () => done(true);
      $('#dialog-cancel').onclick = () => done(false);
      bd.onclick = (e) => { if (e.target === bd) done(false); };
    });
  }

  // ============ State ============
  const S = {
    children: [], categories: [], memories: [],
    activeChildId: null,
    level: 'bos',            // bos | boom | blad
    yearMode: 'kalender',    // kalender | leven
    years: [],               // gegroepeerd voor actief kind
    currentYearKey: null,
    currentLeafIdx: -1,
    landingId: null,         // net bewaard momentje → dwarrelt
  };

  const catById = (id) => S.categories.find(c => c.id === id);
  const childById = (id) => S.children.find(c => c.id === id);
  const activeChild = () => childById(S.activeChildId) || S.children[0];

  async function loadAll() {
    [S.children, S.categories, S.memories] = await Promise.all([
      DB.getAll('children'), DB.getAll('categories'), DB.getAll('memories'),
    ]);
    S.categories.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    S.memories.sort((a, b) => new Date(a.date) - new Date(b.date));
    S.yearMode = await DB.getSetting('yearMode', 'kalender');
    if (!S.activeChildId) S.activeChildId = await DB.getSetting('activeChildId');
    if (!childById(S.activeChildId) && S.children[0]) S.activeChildId = S.children[0].id;
  }

  /* ===== Jaren zijn een bril, geen data: hier groeperen we ===== */
  function ageAt(child, date) {
    if (!child || !child.birthdate) return null;
    const b = new Date(child.birthdate), d = new Date(date);
    let age = d.getFullYear() - b.getFullYear();
    if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age--;
    return age;
  }

  function groupYears() {
    const child = activeChild();
    const mems = S.memories.filter(m => m.childId === S.activeChildId);
    const now = new Date();
    const map = new Map();
    const modeLeven = S.yearMode === 'leven' && child && child.birthdate;

    const keyFor = (d) => modeLeven ? 'lj-' + ageAt(child, d) : 'kj-' + new Date(d).getFullYear();
    const addYear = (key, sample) => {
      if (map.has(key)) return map.get(key);
      let label, start;
      if (modeLeven) {
        const age = +key.slice(3);
        label = `${age} jaar`;
        start = new Date(child.birthdate); start.setFullYear(start.getFullYear() + age);
      } else {
        label = key.slice(3);
        start = new Date(+label, 0, 1);
      }
      const entry = { key, label, start, memories: [] };
      map.set(key, entry);
      return entry;
    };

    mems.forEach(m => addYear(keyFor(m.date)).memories.push(m));
    addYear(keyFor(now)); // het lopende jaar bestaat altijd, ook leeg

    const years = [...map.values()].sort((a, b) => a.start - b.start);
    years.forEach(y => {
      y.memories.sort((a, b) => new Date(a.date) - new Date(b.date));
      const isCurrent = keyFor(now) === y.key;
      y.isCurrent = isCurrent;
      // De boom groeit met het jaar mee: maandtwijgen tot "nu"
      if (modeLeven) {
        y.uptoMonth = isCurrent
          ? (12 + now.getMonth() - new Date(child.birthdate).getMonth()) % 12
          : 11;
        y.monthOf = (d) => (12 + new Date(d).getMonth() - new Date(child.birthdate).getMonth()) % 12;
      } else {
        y.uptoMonth = isCurrent ? now.getMonth() : 11;
        y.monthOf = (d) => new Date(d).getMonth();
      }
      const child2 = activeChild();
      const age = child2 && child2.birthdate ? ageAt(child2, y.start) : null;
      y.sub = `${y.memories.length} ${y.memories.length === 1 ? 'blaadje' : 'blaadjes'}` +
              (age !== null && !modeLeven ? ` · ${child2.name} ${y.isCurrent ? 'is' : 'was'} ${Math.max(0, age)}` : '');
    });
    S.years = years;
    return years;
  }

  // ============ Audio ============
  const Player = {
    audio: null, memoryId: null, timer: null,
    async toggle(memoryId, onProgress, onState) {
      if (this.memoryId === memoryId && this.audio) {
        if (this.audio.paused) { this.audio.play(); onState && onState('playing'); }
        else { this.audio.pause(); onState && onState('paused'); }
        return;
      }
      this.stopAll();
      const mem = S.memories.find(m => m.id === memoryId);
      if (!mem || !mem.audioId) return;
      const rec = await DB.get('audio', mem.audioId);
      if (!rec || !rec.blob) { toast('Geen audio bij dit momentje'); return; }
      const url = URL.createObjectURL(rec.blob);
      this.audio = new Audio(url);
      this.memoryId = memoryId;
      this.audio.onended = () => { onState && onState('ended'); this.stopAll(); };
      this.audio.onerror = () => { toast('Audio kan niet worden afgespeeld'); this.stopAll(); };
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        if (this.audio && !this.audio.paused && onProgress) {
          try { onProgress(this.audio.currentTime, this.audio.duration || mem.audioDuration || 0); } catch (_) {}
        }
      }, 250);
      try { await this.audio.play(); onState && onState('playing'); }
      catch (_) { toast('Audio kan niet worden afgespeeld'); this.stopAll(); }
    },
    stopAll() {
      clearInterval(this.timer); this.timer = null;
      if (this.audio) {
        this.audio.pause();
        if (this.audio.src && this.audio.src.startsWith('blob:')) URL.revokeObjectURL(this.audio.src);
      }
      this.audio = null; this.memoryId = null;
    },
  };

  // ============ Navigatie door de wereld ============
  const stage = $('#stage'), bos = $('#view-bos'), boom = $('#view-boom'), blad = $('#view-blad');
  const backBtn = $('#back-btn'), sunBtn = $('#sun-btn'), peek = $('#peek');

  const originAt = (el, cx, cy) => {
    const r = stage.getBoundingClientRect();
    el.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
  };

  function chromeFor(level) {
    S.level = level;
    backBtn.classList.toggle('show', level !== 'bos');
    const chip = $('#child-chip');
    const child = activeChild();
    if (level === 'bos' && child) {
      chip.innerHTML = `<span class="kind-dot" style="background:${child.color}">${esc(child.name[0].toUpperCase())}</span>${S.children.length > 1 ? esc(child.name) : ''}`;
      chip.classList.add('show');
    } else chip.classList.remove('show');
    sunBtn.classList.toggle('weg', level === 'blad');
    $('#corner-search').classList.toggle('weg', level === 'blad');
    $('#corner-settings').classList.toggle('weg', level === 'blad');
    const mems = S.memories.filter(m => m.childId === S.activeChildId);
    sunBtn.classList.toggle('lokkend', mems.length === 0);
    const hint = $('.eerste-hint');
    if (hint) hint.remove();
    if (level === 'bos' && mems.length === 0) {
      const h = document.createElement('p');
      h.className = 'eerste-hint';
      h.textContent = 'tik op de zon voor je eerste momentje';
      stage.appendChild(h);
    }
  }

  function renderBos() {
    groupYears();
    Scene.renderBos($('#bos-svg'), S.years);
    bindBosTrees();
    chromeFor('bos');
  }

  function bindBosTrees() {
    let pressTimer = null;
    $('#bos-svg').querySelectorAll('.tree-hit').forEach(g => {
      const key = g.dataset.year;
      g.addEventListener('pointerdown', (e) => {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          const yr = S.years.find(y => y.key === key);
          // Even vasthouden = een momentje proeven, geen statistiek
          if (yr.memories.length) {
            const top = [...yr.memories].reverse().find(m => m.isFavorite) || yr.memories[yr.memories.length - 1];
            showPeek(e.clientX, e.clientY, `“${top.title}”`,
              yr.memories.length > 1 ? `en ${yr.memories.length - 1} andere momentjes` : yr.label);
          } else {
            showPeek(e.clientX, e.clientY, yr.label, 'nog geen momentjes');
          }
          setTimeout(hidePeek, 1600);
        }, 420);
      });
      g.addEventListener('pointerup', (e) => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; openBoom(key, e.clientX, e.clientY); }
      });
      g.addEventListener('pointerleave', () => { clearTimeout(pressTimer); pressTimer = null; });
    });
  }

  function openBoom(key, cx, cy) {
    const yr = S.years.find(y => y.key === key);
    if (!yr) return;
    S.currentYearKey = key;
    $('#boom-titel').textContent = yr.label;
    $('#boom-sub').textContent = yr.sub;
    const art = $('#boom-art');
    Scene.renderTree(art, yr.memories, { uptoMonth: yr.uptoMonth, interactive: true, seedBase: 17 });
    // Net bewaard? Dan dwarrelt het blaadje op zijn plek
    if (S.landingId) {
      const idx = yr.memories.findIndex(m => m.id === S.landingId);
      const node = art.querySelector(`.leaf[data-idx="${idx}"]`);
      if (node) { node.classList.add('land'); setTimeout(() => node.classList.remove('land'), 1400); }
      S.landingId = null;
    }
    if (cx !== undefined) { originAt(bos, cx, cy); originAt(boom, cx, cy); }
    bos.classList.replace('zoomed-out', 'zoomed-in');
    boom.classList.remove('past');
    boom.classList.replace('small', 'full');
    chromeFor('boom');
  }

  function backToBos() {
    Player.stopAll();
    bos.classList.replace('zoomed-in', 'zoomed-out');
    boom.classList.replace('full', 'small');
    renderBos();
  }

  function currentYear() { return S.years.find(y => y.key === S.currentYearKey); }

  function openBlad(idx, cx, cy) {
    const yr = currentYear();
    const mem = yr && yr.memories[idx];
    if (!mem) return;
    Player.stopAll();
    S.currentLeafIdx = idx;
    const kleur = mem.isFavorite ? Scene.GOUD : Scene.SEASON[Scene.seasonOf(new Date(mem.date).getMonth())][0];
    $('#blad-art').innerHTML =
      `<svg viewBox="0 0 240 180">
         <path d="M120 10 C 120 44 120 106 120 158" stroke="${mem.isFavorite ? '#C9A23E' : '#A8763E'}" stroke-width="3" fill="none"/>
         <ellipse cx="120" cy="80" rx="95" ry="60" fill="${kleur}" opacity="0.96"/>
         <path d="M50 80 Q 120 66 190 80" stroke="rgba(90,70,40,0.14)" stroke-width="2" fill="none"/>
         ${mem.isFavorite ? `
           <path class="spark" style="--sd:0.4s" d="M28,22 l1.2,3 3,1.2 -3,1.2 -1.2,3 -1.2,-3 -3,-1.2 3,-1.2 Z" fill="#FFF3C4"/>
           <path class="spark" style="--sd:2.2s" d="M212,36 l1.2,3 3,1.2 -3,1.2 -1.2,3 -1.2,-3 -3,-1.2 3,-1.2 Z" fill="#FFF3C4"/>
           <path class="spark" style="--sd:3.8s" d="M196,132 l1.2,3 3,1.2 -3,1.2 -1.2,3 -1.2,-3 -3,-1.2 3,-1.2 Z" fill="#FFF3C4"/>` : ''}
       </svg>
       ${mem.audioId ? `<button id="blad-play" class="pulse" aria-label="Afspelen">${svg('i-play')}</button>` : ''}`;
    $('#blad-titel').textContent = mem.title || '';
    const quoteEl = $('#blad-quote');
    quoteEl.textContent = mem.text ? `“${mem.text}”` : '';
    quoteEl.hidden = !mem.text;
    quoteEl.scrollTop = 0;
    // Zachte fade onderaan alléén als er meer tekst is dan past
    requestAnimationFrame(() => quoteEl.classList.toggle('scrollt', quoteEl.scrollHeight > quoteEl.clientHeight + 4));
    const child = activeChild();
    const age = ageAt(child, mem.date);
    const cat = catById(mem.categoryId) || {};
    $('#blad-meta').innerHTML =
      `${svg(catMerk(cat), 'meta-merk')}<span>${esc((cat.name || '').toLowerCase())}</span><span>·</span>` +
      `<span>${new Date(mem.date).getDate()} ${MONTHS[new Date(mem.date).getMonth()]} ${new Date(mem.date).getFullYear()}</span>` +
      (age !== null ? `<span>·</span><span>${esc(child.name)} was ${Math.max(0, age)}</span>` : '');
    $('#blad-audio').hidden = !mem.audioId;
    if (mem.audioId) {
      $('#blad-progress').style.width = '0%';
      $('#blad-time').textContent = mem.audioDuration ? fmtTime(mem.audioDuration) : '';
      $('#blad-play').onclick = () => {
        Player.toggle(mem.id, (t, dur) => {
          $('#blad-progress').style.width = dur ? `${(t / dur) * 100}%` : '0%';
          $('#blad-time').textContent = fmtTime(t);
        }, (st) => {
          const use = $('#blad-play use');
          if (!use) return;
          use.setAttribute('href', st === 'playing' ? '#i-pause' : '#i-play');
          if (st === 'ended') {
            $('#blad-progress').style.width = '0%';
            $('#blad-time').textContent = mem.audioDuration ? fmtTime(mem.audioDuration) : '';
          }
        });
      };
    }
    const favBtn = $('#blad-fav');
    favBtn.classList.toggle('actief', !!mem.isFavorite);
    favBtn.querySelector('use').setAttribute('href', mem.isFavorite ? '#i-heart' : '#i-heart-o');

    if (cx !== undefined) {
      originAt(boom, cx, cy);
      const r = stage.getBoundingClientRect();
      blad.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
    }
    boom.classList.add('past'); boom.classList.remove('full');
    blad.classList.add('open');
    chromeFor('blad');
  }

  function backToBoom() {
    Player.stopAll();
    blad.classList.remove('open');
    boom.classList.remove('past'); boom.classList.add('full');
    chromeFor('boom');
  }

  backBtn.addEventListener('click', () => {
    if (S.level === 'blad') backToBoom();
    else if (S.level === 'boom') backToBos();
  });

  $('#blad-prev').addEventListener('click', () => {
    const n = currentYear().memories.length;
    openBlad((S.currentLeafIdx - 1 + n) % n);
  });
  $('#blad-next').addEventListener('click', () => {
    const n = currentYear().memories.length;
    openBlad((S.currentLeafIdx + 1) % n);
  });

  // ===== Strijken over de boom =====
  function showPeek(x, y, title, sub = '') {
    const r = stage.getBoundingClientRect();
    peek.style.left = (x - r.left) + 'px';
    peek.style.top = (y - r.top) + 'px';
    peek.innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    peek.classList.add('show');
  }
  function hidePeek() { peek.classList.remove('show'); }

  let hotLeaf = null, scrubbing = false;
  function leafAt(x, y) {
    const probe = (px, py) => {
      for (const el of document.elementsFromPoint(px, py)) {
        const g = el.closest && el.closest('.leaf');
        if (g && g.dataset.idx !== undefined) return g;
      }
      return null;
    };
    let hit = probe(x, y);
    if (!hit) for (const dx of [-16, 16]) for (const dy of [-16, 16]) { hit = hit || probe(x + dx, y + dy); }
    return hit;
  }
  function setHot(el, x, y) {
    const yr = currentYear();
    if (hotLeaf === el) { if (el && yr) showPeek(x, y - 22, yr.memories[+el.dataset.idx].title); return; }
    if (hotLeaf) hotLeaf.classList.remove('hot');
    hotLeaf = el;
    if (el && yr) {
      el.classList.add('hot');
      const inner = el.querySelector('.leaf-inner');
      if (inner) { inner.classList.add('gust'); setTimeout(() => inner.classList.remove('gust'), 1150); }
      showPeek(x, y - 22, yr.memories[+el.dataset.idx].title);
      if (navigator.vibrate) navigator.vibrate(6);
    } else hidePeek();
  }
  boom.addEventListener('pointerdown', (e) => { scrubbing = true; setHot(leafAt(e.clientX, e.clientY), e.clientX, e.clientY); });
  boom.addEventListener('pointermove', (e) => { if (scrubbing) setHot(leafAt(e.clientX, e.clientY), e.clientX, e.clientY); });
  boom.addEventListener('pointerup', (e) => {
    scrubbing = false;
    const el = leafAt(e.clientX, e.clientY);
    hidePeek();
    if (hotLeaf) hotLeaf.classList.remove('hot');
    hotLeaf = null;
    if (el) openBlad(+el.dataset.idx, e.clientX, e.clientY);
  });

  setInterval(() => { if (S.level !== 'blad') Scene.breeze(stage); }, 8500);
  setTimeout(() => Scene.breeze(stage), 2500);

  // ============ Opnemen (zon) ============
  let rec = null, speech = null, recStarting = false;
  // Vangnet: wat er live op het scherm stond, voor het geval de
  // spraak-API bij het stoppen tóch niets teruggeeft (iOS-gril)
  let lastLiveText = '';

  async function startRecording() {
    if (rec || recStarting) return;
    if (!Recorder.supported()) { toast('Opnemen wordt niet ondersteund in deze browser'); return; }
    sunBtn.querySelector('.sun-ring').classList.add('ping');
    setTimeout(() => sunBtn.querySelector('.sun-ring').classList.remove('ping'), 1100);
    recStarting = true;
    const r = Recorder.create();
    try { await r.start(); }
    catch (_) {
      recStarting = false;
      toast('Geen toegang tot de microfoon — check Instellingen › Momentjes › Microfoon');
      return;
    }
    rec = r; recStarting = false;

    const overlay = $('#record-overlay');
    overlay.hidden = false;
    $('#record-timer').textContent = '0:00';
    $('#transcript-text').innerHTML = '';
    $('#transcript-placeholder').hidden = false;
    $('#speech-note').hidden = true;
    $('.rec-dot').classList.remove('paused');
    $('#record-pause use').setAttribute('href', '#i-pause');

    const wave = $('#wave');
    if (!wave.children.length) for (let i = 0; i < 28; i++) wave.appendChild(document.createElement('i'));
    const bars = Array.from(wave.children);
    rec.onTick = (ms) => { $('#record-timer').textContent = fmtTime(ms / 1000); };
    rec.onLevel = (data) => {
      let max = 0;
      if (data) { const step = Math.floor(data.length / bars.length); for (let i = 0; i < bars.length; i++) max = Math.max(max, data[i * step]); }
      if (data && max > 6) {
        const step = Math.floor(data.length / bars.length);
        bars.forEach((b, i) => { b.style.height = `${8 + Math.round((data[i * step] / 255) * 56)}px`; });
      } else {
        const t = Date.now() / 320;
        bars.forEach((b, i) => { b.style.height = `${10 + Math.round(7 * (1 + Math.sin(t + i * 0.55)))}px`; });
      }
    };

    lastLiveText = '';
    speech = Speech.create('nl-NL');
    if (speech) {
      speech.onUpdate = (final, interim) => {
        lastLiveText = `${final} ${interim}`.trim();
        $('#transcript-placeholder').hidden = !!(final || interim);
        $('#transcript-text').innerHTML = `${esc(final)} <span class="interim">${esc(interim)}</span>`;
        const box = $('#live-transcript');
        box.scrollTop = box.scrollHeight;
      };
      speech.onUnavailable = () => { if (rec === r) $('#speech-note').hidden = false; };
      const sp = speech;
      setTimeout(() => { if (rec === r && speech === sp) sp.start(); }, 350);
    } else $('#speech-note').hidden = false;
  }

  async function stopRecording(save) {
    if (!rec) return;
    const theRec = rec; rec = null;
    const sp = speech; speech = null;
    if (sp) { if (save) sp.stop(); else sp.abort(); }
    const transcript = (sp && sp.text) || lastLiveText;
    $('#record-overlay').hidden = true;
    if (!save) { theRec.cancel(); return; }
    const result = await theRec.stop();
    if (!result) { toast('Er is niets opgenomen'); return; }
    openSaveSheet({ blob: result.blob, mime: result.mime, duration: result.duration, transcript });
  }

  sunBtn.addEventListener('click', startRecording);
  $('#record-stop').addEventListener('click', () => stopRecording(true));
  $('#record-cancel').addEventListener('click', async () => {
    if (!rec) return;
    if (await appConfirm('Deze opname weggooien?', { confirmText: 'Weggooien', danger: true })) stopRecording(false);
  });
  $('#record-pause').addEventListener('click', () => {
    if (!rec) return;
    const use = $('#record-pause use'), dot = $('.rec-dot');
    if (rec.paused) {
      rec.resume(); if (speech) speech.start();
      use.setAttribute('href', '#i-pause'); dot.classList.remove('paused');
    } else {
      rec.pause(); if (speech) speech.stop();
      use.setAttribute('href', '#i-play'); dot.classList.add('paused');
    }
  });

  // ============ Tekstpoets & titels (uit V1, bewezen) ============
  function polishTranscript(t) {
    if (!t) return '';
    let s = t.trim().replace(/\s+/g, ' ');
    s = s[0].toUpperCase() + s.slice(1);
    if (!/[.!?…]$/.test(s)) s += '.';
    return s;
  }
  const TITLE_STOPWORDS = new Set(('de het een en of maar want dus dat die dit deze ik je jij hij zij ze we wij me mij hem haar ons jullie u ' +
    'is was zijn waren ben bent wordt worden werd heb hebt heeft hebben had hadden doe doet doen deed ' +
    'ga gaat gaan ging gingen gegaan geweest kom komt komen kwam gekomen wil wilt willen wilde kan kunt kunnen kon ' +
    'moet moeten moest mag mogen mocht zal zult zullen zou zouden niet wel ook nog al toch heel erg zo zon ' +
    'naar van voor met bij op in uit aan af om over onder tussen tegen door per te ter dan toen nu hier daar er ' +
    'waar wat wie hoe waarom omdat terwijl als zei zegt zeggen gezegd vroeg vraagt vragen vertelde vertelt vertellen ' +
    'vandaag vanochtend vanmiddag vanavond vanmorgen gisteren eergisteren net zonet zojuist even gewoon eerst weer steeds ' +
    'nou dus oké oke eh uh ehm uhm ja nee hoi hallo mijn jouw zijn haar hun ie t m dr zn ze').split(' '));
  function autoTitle(text) {
    if (!text) return '';
    const words = text.replace(/[.!?…,;:'"„”]+/g, ' ').split(/\s+/).filter(Boolean);
    const childNames = new Set(S.children.map(c => c.name.toLowerCase()));
    const content = words.filter(w => {
      const lw = w.toLowerCase();
      return !TITLE_STOPWORDS.has(lw) && !childNames.has(lw);
    });
    let picked = content.slice(0, 3);
    if (picked.length < 2) picked = words.slice(0, 6);
    let t = picked.join(' ');
    if (!t) return '';
    t = t[0].toUpperCase() + t.slice(1);
    return t.length > 42 ? t.slice(0, 42) + '…' : t;
  }

  // ============ Sheets ============
  let sheetCleanup = null, sheetLocked = false;
  function openSheet(html, { locked = false } = {}) {
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    sheetLocked = locked;
    $('#sheet-content').innerHTML = html;
    $('#sheet').hidden = false;
    $('#sheet-backdrop').hidden = false;
    $('#sheet').classList.remove('closing');
    $('#sheet-backdrop').classList.remove('closing');
  }
  function closeSheet() {
    const sheet = $('#sheet'), bd = $('#sheet-backdrop');
    if (sheet.hidden) return;
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    sheetLocked = false;
    sheet.classList.add('closing'); bd.classList.add('closing');
    setTimeout(() => { sheet.hidden = true; bd.hidden = true; }, 290);
  }
  $('#sheet-backdrop').addEventListener('click', () => { if (!sheetLocked) closeSheet(); });

  /* Categorie kiezen: merkteken + naam, rustig in de inkt van de wereld */
  function catSelectHTML(selectedId) {
    return `<div class="cat-wrap" id="cat-select">
      ${S.categories.map(c => `
        <button type="button" class="cat-chip ${c.id === selectedId ? 'active' : ''}" data-cat="${c.id}">
          ${svg(catMerk(c))}${esc(c.name)}
        </button>`).join('')}
    </div>`;
  }
  function bindCatSelect() {
    $('#cat-select').querySelectorAll('.cat-chip').forEach(b => b.addEventListener('click', () => {
      $('#cat-select').querySelectorAll('.cat-chip').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
  }
  const selectedCat = () => $('#cat-select .cat-chip.active')?.dataset.cat || S.categories[0]?.id;

  function childSelectHTML(selectedId) {
    if (S.children.length < 2) return '';
    return `<div class="chip-row" id="child-select" style="justify-content:center;margin:14px 0 0">
      ${S.children.map(c => `
        <button type="button" class="filter-chip ${c.id === selectedId ? 'active' : ''}" data-child="${c.id}" style="--accent:${c.color}">${esc(c.name)}</button>`).join('')}
    </div>`;
  }
  function bindChildSelect() {
    const box = $('#child-select');
    if (!box) return;
    box.querySelectorAll('[data-child]').forEach(b => b.addEventListener('click', () => {
      box.querySelectorAll('[data-child]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
  }
  const selectedChild = () => $('#child-select .filter-chip.active')?.dataset.child || S.activeChildId;

  function dateInputValues(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      time: `${p(d.getHours())}:${p(d.getMinutes())}`,
    };
  }

  function bindPreviewPlayer(rootSel, blob, duration) {
    const chip = $(`${rootSel} .play-chip`);
    const bar = $(`${rootSel} .audio-progress i`);
    const time = $(`${rootSel} .audio-time`);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const setIcon = (playing) => {
      chip.classList.toggle('playing', playing);
      chip.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
    };
    const timer = setInterval(() => {
      if (audio.paused) return;
      const dur = audio.duration && isFinite(audio.duration) ? audio.duration : duration;
      if (dur) bar.style.width = `${(audio.currentTime / dur) * 100}%`;
      time.textContent = fmtTime(audio.currentTime);
    }, 250);
    audio.onended = () => { setIcon(false); bar.style.width = '0%'; time.textContent = fmtTime(duration || 0); };
    chip.addEventListener('click', () => {
      if (audio.paused) { audio.play().then(() => setIcon(true)).catch(() => toast('Audio kan niet worden afgespeeld')); }
      else { audio.pause(); setIcon(false); }
    });
    return () => { try { audio.pause(); } catch (_) {} clearInterval(timer); URL.revokeObjectURL(url); };
  }

  function openSaveSheet(recording) {
    recording.transcript = polishTranscript(recording.transcript);
    const now = new Date();
    const { date, time } = dateInputValues(now);
    const fallbackTitle = `Momentje van ${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()].slice(0, 3)}`;
    const title = autoTitle(recording.transcript) || fallbackTitle;
    openSheet(`
      <h2 class="sheet-title">Momentje bewaren</h2>
      <div class="audio-player" id="save-player">
        <span class="play-chip">${svg('i-play')}</span>
        <div class="audio-progress"><i></i></div>
        <span class="audio-time">${fmtTime(recording.duration || 0)}</span>
      </div>
      <input type="text" class="veld-titel" id="save-title" value="${esc(title)}" placeholder="Titel">
      <textarea class="veld-tekst" id="save-text" placeholder="Wat werd er gezegd of gedaan?">${esc(recording.transcript)}</textarea>
      ${childSelectHTML(S.activeChildId)}
      ${catSelectHTML(S.categories[0]?.id)}
      <div class="datum-rij"><input type="date" id="save-date" class="datum-chip" value="${date}"></div>
      <div class="btn-stack">
        <button class="btn" id="save-confirm">${svg('i-check')}Bewaren</button>
        <button class="btn btn-danger" id="save-discard">Opname weggooien</button>
      </div>
    `, { locked: true });
    bindCatSelect();
    bindChildSelect();
    sheetCleanup = bindPreviewPlayer('#save-player', recording.blob, recording.duration);

    $('#save-discard').addEventListener('click', async () => {
      if (await appConfirm('Weet je zeker dat je deze opname wilt weggooien?', { confirmText: 'Weggooien', danger: true })) closeSheet();
    });
    $('#save-confirm').addEventListener('click', async () => {
      const id = DB.uuid();
      const audioId = 'audio-' + id;
      await DB.put('audio', { id: audioId, blob: recording.blob, mime: recording.mime });
      // Tijdstip is geen invulveld: vandaag = nu, een eerdere datum = midden op de dag
      const picked = $('#save-date').value;
      const when = picked === date ? new Date() : new Date(`${picked}T12:00`);
      const memory = {
        id,
        childId: selectedChild(),
        categoryId: selectedCat(),
        title: $('#save-title').value.trim() || autoTitle($('#save-text').value) || fallbackTitle,
        text: $('#save-text').value.trim(),
        date: (isNaN(when) ? new Date() : when).toISOString(),
        createdAt: new Date().toISOString(),
        audioId,
        audioDuration: recording.duration,
        isFavorite: false,
      };
      await DB.put('memories', memory);
      DB.requestPersistence();
      await loadAll();
      closeSheet();
      // Het nieuwe blaadje dwarrelt op zijn plek in de juiste boom
      S.activeChildId = memory.childId;
      renderBos();
      S.landingId = id;
      const yr = S.years.find(y => y.memories.some(m => m.id === id));
      if (yr) setTimeout(() => openBoom(yr.key, innerWidth * 0.6, innerHeight * 0.5), 60);
      renderBackupNudgeCheck();
    });
  }

  // ============ Blad-acties ============
  $('#blad-fav').addEventListener('click', async () => {
    const mem = currentYear()?.memories[S.currentLeafIdx];
    if (!mem) return;
    mem.isFavorite = !mem.isFavorite;
    await DB.put('memories', mem);
    await loadAll(); groupYears();
    openBlad(S.currentLeafIdx);
  });

  $('#blad-edit').addEventListener('click', () => {
    const mem = currentYear()?.memories[S.currentLeafIdx];
    if (mem) openEdit(mem.id);
  });

  $('#blad-del').addEventListener('click', async () => {
    const mem = currentYear()?.memories[S.currentLeafIdx];
    if (!mem) return;
    if (!(await appConfirm(`"${mem.title}" verwijderen? Dit kan niet ongedaan worden gemaakt.`, { confirmText: 'Verwijderen', danger: true }))) return;
    if (mem.audioId) await DB.del('audio', mem.audioId);
    await DB.del('memories', mem.id);
    await DB.addTombstone(mem.id);
    await loadAll();
    blad.classList.remove('open');
    backToBos();
    toast('Momentje verwijderd');
  });

  function openEdit(id) {
    const m = S.memories.find(x => x.id === id);
    if (!m) return;
    const { date, time } = dateInputValues(new Date(m.date));
    openSheet(`
      <h2 class="sheet-title">Momentje bewerken</h2>
      <input type="text" class="veld-titel" id="edit-title" value="${esc(m.title)}" placeholder="Titel">
      <textarea class="veld-tekst" id="edit-text" placeholder="Wat werd er gezegd of gedaan?">${esc(m.text || '')}</textarea>
      ${childSelectHTML(m.childId)}
      ${catSelectHTML(m.categoryId)}
      <div class="datum-rij"><input type="date" id="edit-date" class="datum-chip" value="${date}"></div>
      <div class="btn-stack">
        <button class="btn" id="edit-save">${svg('i-check')}Opslaan</button>
        <button class="btn btn-secondary" id="edit-cancel">Annuleren</button>
      </div>
    `);
    bindCatSelect(); bindChildSelect();
    $('#edit-cancel').addEventListener('click', closeSheet);
    $('#edit-save').addEventListener('click', async () => {
      m.title = $('#edit-title').value.trim() || m.title;
      m.text = $('#edit-text').value.trim();
      m.categoryId = selectedCat();
      m.childId = selectedChild() || m.childId;
      // Datum aanpasbaar, het oorspronkelijke tijdstip reist stilletjes mee
      const when = new Date(`${$('#edit-date').value}T${time}`);
      if (!isNaN(when)) m.date = when.toISOString();
      await DB.put('memories', m);
      await loadAll();
      closeSheet();
      // Terug naar het (mogelijk verplaatste) blaadje
      renderBos();
      const yr = S.years.find(y => y.memories.some(x => x.id === m.id));
      if (yr) {
        openBoom(yr.key);
        openBlad(yr.memories.findIndex(x => x.id === m.id));
      } else backToBos();
      toast('Opgeslagen ✓');
    });
  }

  // ============ Kind wisselen ============
  $('#child-chip').addEventListener('click', () => {
    openSheet(`
      <h2 class="sheet-title">Wiens bos?</h2>
      <div class="settings-card">
        ${S.children.map(c => `
          <button class="settings-row" data-kies-kind="${c.id}">
            <span class="kind-dot" style="background:${c.color}">${esc(c.name[0].toUpperCase())}</span>
            <span class="grow">${esc(c.name)}<span class="sub">${S.memories.filter(m => m.childId === c.id).length} momentjes</span></span>
            ${c.id === S.activeChildId ? svg('i-check') : ''}
          </button>`).join('')}
      </div>
      <div class="btn-stack"><button class="btn btn-secondary" id="kind-add">${svg('i-plus')}Kind toevoegen</button></div>
    `);
    $$('#sheet [data-kies-kind]').forEach(b => b.addEventListener('click', async () => {
      S.activeChildId = b.dataset.kiesKind;
      await DB.setSetting('activeChildId', S.activeChildId);
      closeSheet();
      renderBos();
    }));
    $('#kind-add').addEventListener('click', () => openChildForm());
  });

  function openChildForm(child = null) {
    const usedColors = S.children.map(c => c.color);
    const defaultColor = child ? child.color :
      (DB.CHILD_COLORS.find(c => !usedColors.includes(c)) || DB.CHILD_COLORS[S.children.length % DB.CHILD_COLORS.length]);
    openSheet(`
      <h2 class="sheet-title">${child ? 'Kind bewerken' : 'Kind toevoegen'}</h2>
      <div class="field"><label>Naam</label><input type="text" id="kind-naam" value="${esc(child ? child.name : '')}" placeholder="Bijv. Sam" autocomplete="off"></div>
      <div class="field"><label>Geboortedatum <span style="text-transform:none;font-weight:400">(voor “was 6” bij elke boom)</span></label>
        <input type="date" id="kind-geboren" value="${child && child.birthdate ? child.birthdate.slice(0, 10) : ''}"></div>
      <div class="field"><label>Kleur</label>
        <div class="color-row">
          ${DB.CHILD_COLORS.map(c => `<button type="button" class="color-swatch ${c === defaultColor ? 'active' : ''}" data-color="${c}" style="background:${c}" aria-label="Kleur"></button>`).join('')}
        </div>
      </div>
      <div class="btn-stack">
        <button class="btn" id="kind-save">${svg('i-check')}Bewaren</button>
        ${child && S.children.length > 1 ? `<button class="btn btn-danger" id="kind-delete">Verwijderen</button>` : ''}
      </div>
    `);
    $$('#sheet .color-swatch').forEach(b => b.addEventListener('click', () => {
      $$('#sheet .color-swatch').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
    $('#kind-save').addEventListener('click', async () => {
      const name = $('#kind-naam').value.trim();
      if (!name) { toast('Vul een naam in'); return; }
      const color = $('#sheet .color-swatch.active')?.dataset.color || defaultColor;
      const birthdate = $('#kind-geboren').value || null;
      if (child) { child.name = name; child.color = color; child.birthdate = birthdate; await DB.put('children', child); }
      else {
        const c = { id: DB.uuid(), name, color, birthdate, createdAt: new Date().toISOString() };
        await DB.put('children', c);
        S.activeChildId = c.id;
        await DB.setSetting('activeChildId', c.id);
      }
      await loadAll();
      closeSheet();
      renderBos();
    });
    const delBtn = $('#kind-delete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const count = S.memories.filter(m => m.childId === child.id).length;
      const ok = await appConfirm(
        `${child.name} verwijderen?${count ? ` De ${count} bijbehorende momentjes worden ook verwijderd.` : ''} Dit kan niet ongedaan worden gemaakt.`,
        { confirmText: 'Verwijderen', danger: true });
      if (!ok) return;
      for (const m of S.memories.filter(m => m.childId === child.id)) {
        if (m.audioId) await DB.del('audio', m.audioId);
        await DB.del('memories', m.id);
        await DB.addTombstone(m.id);
      }
      await DB.del('children', child.id);
      S.activeChildId = null;
      await loadAll();
      closeSheet();
      renderBos();
    });
  }

  // ============ Zoeken ============
  $('#corner-search').addEventListener('click', () => {
    openSheet(`
      <h2 class="sheet-title">Zoeken</h2>
      <div class="field"><input type="text" id="zoek-input" placeholder="Zoek in momentjes…" autocomplete="off"></div>
      <div class="cat-wrap" id="zoek-chips" style="justify-content:flex-start;margin:0 0 14px">
        ${S.categories.map(c => `<button class="cat-chip" data-cat="${c.id}">${svg(catMerk(c))}${esc(c.name)}</button>`).join('')}
        <button class="filter-chip" data-fav style="--accent:#D9AF3B">Goud</button>
      </div>
      <div id="zoek-uit"></div>
    `);
    let q = '', cat = null, fav = false;
    const run = () => {
      let res = S.memories.filter(m => m.childId === S.activeChildId);
      if (cat) res = res.filter(m => m.categoryId === cat);
      if (fav) res = res.filter(m => m.isFavorite);
      const ql = q.trim().toLowerCase();
      if (ql) res = res.filter(m => (m.title || '').toLowerCase().includes(ql) || (m.text || '').toLowerCase().includes(ql));
      res = res.slice().reverse();
      $('#zoek-uit').innerHTML = res.length ? res.map(m => {
        const kleur = m.isFavorite ? Scene.GOUD : Scene.SEASON[Scene.seasonOf(new Date(m.date).getMonth())][0];
        return `
        <button class="zoek-rij" data-open="${m.id}">
          <svg class="zoek-blad" viewBox="0 0 26 18"><ellipse cx="13" cy="9" rx="11" ry="7" fill="${kleur}" transform="rotate(-12 13 9)"/></svg>
          <span class="grow"><span class="zoek-titel">${esc(m.title)}</span><span class="zoek-sub">${fmtDate(m.date)}</span></span>
        </button>`;
      }).join('') : `<p class="leeg-melding">${ql || cat || fav ? 'Niets gevonden.' : 'Typ een woord of kies een filter.'}</p>`;
      $$('#zoek-uit [data-open]').forEach(b => b.addEventListener('click', () => {
        closeSheet();
        openBladById(b.dataset.open);
      }));
    };
    $('#zoek-input').addEventListener('input', (e) => { q = e.target.value; run(); });
    $$('#zoek-chips [data-cat]').forEach(b => b.addEventListener('click', () => {
      cat = cat === b.dataset.cat ? null : b.dataset.cat;
      $$('#zoek-chips [data-cat]').forEach(x => x.classList.toggle('active', x.dataset.cat === cat));
      run();
    }));
    $('#zoek-chips [data-fav]').addEventListener('click', (e) => {
      fav = !fav; e.currentTarget.classList.toggle('active', fav); run();
    });
    run();
    setTimeout(() => $('#zoek-input').focus(), 350);
  });

  function openBladById(id) {
    groupYears();
    const yr = S.years.find(y => y.memories.some(m => m.id === id));
    if (!yr) return;
    openBoom(yr.key);
    setTimeout(() => openBlad(yr.memories.findIndex(m => m.id === id)), 250);
  }

  // ============ Instellingen ============
  $('#corner-settings').addEventListener('click', renderSettings);

  async function renderSettings() {
    const last = await DB.getSetting('lastBackupAt');
    const reminderDays = await DB.getSetting('backupReminderDays', 21);
    const est = await DB.storageEstimate();
    const usedMB = est && est.usage ? (est.usage / 1048576).toFixed(1) : null;
    const anyBirthdate = S.children.some(c => c.birthdate);

    openSheet(`
      <h2 class="sheet-title">Instellingen</h2>

      <div class="settings-group">
        <p class="settings-label">Kinderen</p>
        <div class="settings-card">
          ${S.children.map(c => `
            <button class="settings-row" data-edit-kind="${c.id}">
              <span class="kind-dot" style="background:${c.color}">${esc(c.name[0].toUpperCase())}</span>
              <span class="grow">${esc(c.name)}<span class="sub">${S.memories.filter(m => m.childId === c.id).length} momentjes${c.birthdate ? '' : ' · geboortedatum ontbreekt'}</span></span>
            </button>`).join('')}
          <button class="settings-row" id="settings-add-kind">${svg('i-plus')}<span class="grow">Kind toevoegen</span></button>
        </div>
      </div>

      <div class="settings-group">
        <p class="settings-label">Het bos</p>
        <div class="settings-card">
          <div class="settings-row" style="cursor:default">
            ${svg('i-leafcat')}
            <span class="grow">Bomen per<span class="sub">${anyBirthdate ? 'Levensjaar = van verjaardag tot verjaardag' : 'Vul een geboortedatum in voor levensjaren'}</span></span>
            <select id="year-mode" class="settings-select" ${anyBirthdate ? '' : 'disabled'}>
              <option value="kalender" ${S.yearMode === 'kalender' ? 'selected' : ''}>Kalenderjaar</option>
              <option value="leven" ${S.yearMode === 'leven' ? 'selected' : ''}>Levensjaar</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <p class="settings-label">Backup — raak nooit iets kwijt</p>
        <div class="settings-card">
          <button class="settings-row" id="settings-export">
            ${svg('i-share')}<span class="grow">Backup maken<span class="sub">${last ? 'Laatste backup: ' + fmtDate(last) : 'Nog geen backup gemaakt'}</span></span>
          </button>
          <button class="settings-row" id="settings-import">
            ${svg('i-import')}<span class="grow">Backup terugzetten<span class="sub">Ook van V1 of van een ander toestel</span></span>
          </button>
          <div class="settings-row" style="cursor:default">
            ${svg('i-share')}<span class="grow">Herinner mij</span>
            <select id="backup-interval" class="settings-select">
              <option value="7" ${reminderDays === 7 ? 'selected' : ''}>Wekelijks</option>
              <option value="21" ${reminderDays === 21 ? 'selected' : ''}>Elke 3 weken</option>
              <option value="0" ${!reminderDays ? 'selected' : ''}>Nooit</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <p class="settings-label">Privacy</p>
        <div class="settings-card">
          <div class="privacy-note">
            ${svg('i-lock')}
            <span>Alles staat <strong>alleen op dit toestel</strong> — geen account, geen server, geen tracking.${usedMB ? ` Opslag: ${usedMB} MB.` : ''}</span>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <p class="settings-label">Over</p>
        <div class="settings-card">
          <div class="settings-row" style="cursor:default">
            ${svg('i-leafcat')}<span class="grow">Momentjes — Het bos<span class="sub">Versie 2.2 · elk blaadje één herinnering</span></span>
          </div>
        </div>
      </div>
    `);

    $$('#sheet [data-edit-kind]').forEach(b => b.addEventListener('click', () => openChildForm(childById(b.dataset.editKind))));
    $('#settings-add-kind').addEventListener('click', () => openChildForm());
    $('#settings-export').addEventListener('click', doExport);
    $('#settings-import').addEventListener('click', () => $('#import-file').click());
    $('#backup-interval').addEventListener('change', async (e) => {
      await DB.setSetting('backupReminderDays', parseInt(e.target.value, 10));
    });
    const ym = $('#year-mode');
    if (ym) ym.addEventListener('change', async (e) => {
      S.yearMode = e.target.value;
      await DB.setSetting('yearMode', S.yearMode);
      closeSheet();
      renderBos();
    });
  }

  async function doExport() {
    toast('Backup wordt gemaakt…');
    try {
      const res = await Backup.exportBackup();
      if (res.ok) toast(res.via === 'share' ? 'Backup gedeeld ✓' : 'Backup gedownload ✓');
    } catch (err) { console.error(err); toast('Backup maken is niet gelukt'); }
  }

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    toast('Backup wordt ingelezen…');
    try {
      const buf = await file.arrayBuffer();
      const res = await Backup.importBackup(buf);
      DB.requestPersistence();
      await loadAll();
      closeSheet();
      renderBos();
      toast(res.added > 0
        ? `${res.added} momentje${res.added === 1 ? '' : 's'} toegevoegd ✓`
        : 'Alles uit deze backup stond er al');
    } catch (err) { console.error(err); toast('Dit bestand kon niet worden gelezen als Momentjes-backup'); }
  });

  async function renderBackupNudgeCheck() {
    const intervalDays = await DB.getSetting('backupReminderDays', 21);
    if (!intervalDays) return;
    const count = S.memories.filter(m => m.childId === S.activeChildId).length;
    if (count < 3) return;
    const last = await DB.getSetting('lastBackupAt');
    const nudged = await DB.getSetting('lastNudgeAt');
    if (nudged && Date.now() - new Date(nudged) < 3 * 864e5) return;
    const days = last ? Math.floor((Date.now() - new Date(last)) / 864e5) : Infinity;
    if (days >= intervalDays) {
      await DB.setSetting('lastNudgeAt', new Date().toISOString());
      toast(last ? `Je laatste backup was ${days} dagen geleden — Instellingen › Backup` : 'Tip: maak af en toe een backup — Instellingen › Backup', 4200);
    }
  }

  // ============ Onboarding ============
  function showOnboarding() {
    const ob = $('#onboarding');
    ob.hidden = false;
    $('#onboarding-inner').innerHTML = `
      <div class="ob-zon">${svg('i-mic')}</div>
      <h1 class="ob-title">Momentjes</h1>
      <p class="ob-lead">De grappige uitspraken en kleine wonderen van je kind — als blaadjes aan een boom die met ze meegroeit. Alles blijft privé op jouw telefoon.</p>
      <div class="field"><label>Naam van je kind</label><input type="text" id="ob-naam" placeholder="Bijv. Sam" autocomplete="off"></div>
      <div class="field"><label>Geboortedatum <span style="text-transform:none;font-weight:400">(mag leeg)</span></label><input type="date" id="ob-geboren"></div>
      <div class="field"><label>Kleur</label><div class="color-row">
        ${DB.CHILD_COLORS.map((c, i) => `<button type="button" class="color-swatch ${i === 0 ? 'active' : ''}" data-color="${c}" style="background:${c}" aria-label="Kleur"></button>`).join('')}
      </div></div>
      <div class="btn-stack"><button class="btn" id="ob-klaar">Het bos in</button></div>
    `;
    $$('#onboarding .color-swatch').forEach(b => b.addEventListener('click', () => {
      $$('#onboarding .color-swatch').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
    $('#ob-klaar').addEventListener('click', async () => {
      const name = $('#ob-naam').value.trim();
      if (!name) { $('#ob-naam').style.borderColor = '#C75450'; $('#ob-naam').focus(); return; }
      const child = {
        id: DB.uuid(), name,
        color: $('#onboarding .color-swatch.active')?.dataset.color || DB.CHILD_COLORS[0],
        birthdate: $('#ob-geboren').value || null,
        createdAt: new Date().toISOString(),
      };
      await DB.put('children', child);
      S.activeChildId = child.id;
      await DB.setSetting('activeChildId', child.id);
      await DB.setSetting('onboarded', true);
      DB.requestPersistence();
      await loadAll();
      ob.hidden = true;
      renderBos();
    });
  }

  // ============ Start ============
  async function init() {
    await DB.ensureDefaults();
    await loadAll();
    if (S.children.length === 0) showOnboarding();
    else renderBos();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  init();

  if (location.hostname === 'localhost') window.__test = { openSaveSheet, openBoom, openBlad, renderBos };
})();
