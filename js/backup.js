/* Momentjes V2 — backup export & import.
   Zelfde open zip-formaat als V1 (manifest.json + audio/), plus:
   tombstones reizen mee, en geïmporteerde momentjes die hier bewust
   verwijderd zijn komen niet als zombie terug. */

const Backup = (() => {

  const FORMAT_VERSION = 2;

  function extForMime(mime) {
    if (!mime) return 'm4a';
    if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('wav')) return 'wav';
    return 'm4a';
  }

  function mimeForName(name) {
    const ext = name.split('.').pop().toLowerCase();
    return { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg',
             mp3: 'audio/mpeg', wav: 'audio/wav' }[ext] || 'audio/mp4';
  }

  async function buildExport() {
    const [memories, children, categories, tombstones] = await Promise.all([
      DB.getAll('memories'), DB.getAll('children'), DB.getAll('categories'), DB.getTombstones(),
    ]);

    const entries = [];
    const manifest = {
      app: 'Momentjes',
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      children, categories, tombstones,
      memories: [],
    };

    for (const m of memories) {
      const mem = { ...m };
      if (m.audioId) {
        const audio = await DB.get('audio', m.audioId);
        if (audio && audio.blob) {
          const ext = extForMime(audio.mime || audio.blob.type);
          const path = `audio/${m.audioId}.${ext}`;
          mem.audioFile = path;
          mem.audioMime = audio.mime || audio.blob.type || 'audio/mp4';
          entries.push({ name: path, data: new Uint8Array(await audio.blob.arrayBuffer()) });
        }
      }
      manifest.memories.push(mem);
    }

    entries.unshift({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
    return MiniZip.write(entries);
  }

  function fileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `momentjes-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
  }

  async function exportBackup() {
    const blob = await buildExport();
    const name = fileName();
    const file = new File([blob], name, { type: 'application/zip' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Momentjes backup' });
        await DB.setSetting('lastBackupAt', new Date().toISOString());
        return { ok: true, via: 'share' };
      } catch (err) {
        if (err && err.name === 'AbortError') return { ok: false, cancelled: true };
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    await DB.setSetting('lastBackupAt', new Date().toISOString());
    return { ok: true, via: 'download' };
  }

  /* Importeren = samenvoegen: bestaande id's blijven, verwijderde id's
     (tombstones) blijven verwijderd, nieuwe komen erbij. */
  async function importBackup(arrayBuffer) {
    const files = await MiniZip.read(arrayBuffer);
    const manifestBytes = files['manifest.json'];
    if (!manifestBytes) throw new Error('Dit is geen Momentjes-backup (manifest.json ontbreekt)');
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    if (manifest.app !== 'Momentjes') throw new Error('Dit is geen Momentjes-backup');

    const existingMemories = new Set((await DB.getAll('memories')).map(m => m.id));
    const existingChildren = new Set((await DB.getAll('children')).map(c => c.id));
    const existingCats = new Set((await DB.getAll('categories')).map(c => c.id));
    const deleted = new Set((await DB.getTombstones()).map(t => t.id));

    const childByName = {};
    for (const c of await DB.getAll('children')) childByName[c.name.toLowerCase()] = c.id;
    const catByName = {};
    for (const c of await DB.getAll('categories')) catByName[c.name.toLowerCase()] = c.id;

    const childMap = {};
    for (const c of manifest.children || []) {
      const match = childByName[(c.name || '').toLowerCase()];
      if (match) { childMap[c.id] = match; continue; }
      if (!existingChildren.has(c.id)) await DB.put('children', c);
      childMap[c.id] = c.id;
    }

    const catMap = {};
    for (const c of manifest.categories || []) {
      const match = catByName[(c.name || '').toLowerCase()];
      if (match) { catMap[c.id] = match; continue; }
      if (!existingCats.has(c.id)) await DB.put('categories', c);
      catMap[c.id] = c.id;
    }

    // Tombstones uit de backup ook hier respecteren
    for (const t of manifest.tombstones || []) await DB.addTombstone(t.id);
    const importedTombs = new Set((manifest.tombstones || []).map(t => t.id));

    let added = 0, skipped = 0;
    for (const m of manifest.memories || []) {
      if (existingMemories.has(m.id) || deleted.has(m.id) || importedTombs.has(m.id)) { skipped++; continue; }
      const mem = { ...m };
      delete mem.audioFile; delete mem.audioMime;
      mem.childId = childMap[m.childId] || m.childId;
      mem.categoryId = catMap[m.categoryId] || m.categoryId;

      if (m.audioFile && files[m.audioFile]) {
        const mime = m.audioMime || mimeForName(m.audioFile);
        const audioId = m.audioId || ('audio-' + m.id);
        const bytes = new Uint8Array(files[m.audioFile]);
        await DB.put('audio', { id: audioId, blob: new Blob([bytes], { type: mime }), mime });
        mem.audioId = audioId;
      }
      await DB.put('memories', mem);
      added++;
    }

    return { added, skipped, total: (manifest.memories || []).length };
  }

  return { exportBackup, importBackup, buildExport, fileName };
})();
