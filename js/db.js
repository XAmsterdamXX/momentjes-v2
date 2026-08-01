/* Momentjes V2 — datalaag (IndexedDB)
   Deelt bewust dezelfde lokale database als V1 (zelfde domein):
   open je V2, dan staat het bos er meteen vol — en V1 blijft werken.
   Daarom: GEEN schema-wijzigingen (dat zou V1 breken), alleen extra
   velden op records en een tombstone-lijst in de settings-store. */

const DB = (() => {
  const NAME = 'momentjes';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      // Zonder versienummer: bestaat de database al (V1), dan openen we
      // die precies zoals hij is; bestaat hij nog niet, dan maken we hem.
      const req = indexedDB.open(NAME);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('memories')) {
          const m = db.createObjectStore('memories', { keyPath: 'id' });
          m.createIndex('date', 'date');
          m.createIndex('childId', 'childId');
        }
        if (!db.objectStoreNames.contains('children')) db.createObjectStore('children', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    }));
  }

  function getAll(store) {
    return open().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  function get(store, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }

  const put = (store, value) => {
    if (value && typeof value === 'object' && store !== 'settings' && store !== 'audio') {
      value.updatedAt = new Date().toISOString();
    }
    return tx(store, 'readwrite', s => s.put(value));
  };
  const del = (store, key) => tx(store, 'readwrite', s => s.delete(key));

  const getSetting = (key, fallback = null) =>
    get('settings', key).then(r => (r ? r.value : fallback));
  const setSetting = (key, value) => tx('settings', 'readwrite', s => s.put({ key, value }));

  /* Tombstones: onthouden wát verwijderd is, zodat een oude backup of
     de backup van je partner het niet als zombie terugbrengt. */
  const getTombstones = () => getSetting('tombstones', []);
  async function addTombstone(id) {
    const list = await getTombstones();
    if (!list.some(t => t.id === id)) {
      list.push({ id, at: new Date().toISOString() });
      await setSetting('tombstones', list);
    }
  }

  /* Categoriekleuren zijn tinten die écht aan bladeren voorkomen
     (bloesem, koper, loof, roest) — zodat een boom in categorie-
     kleurmodus geen kerstboom wordt maar een gemengde boom. */
  const DEFAULT_CATEGORIES = [
    { id: 'cat-uitspraak', name: 'Uitspraak', icon: 'quote',    color: '#D9899B', sortOrder: 0, isDefault: true },
    { id: 'cat-vraag',     name: 'Vraag',     icon: 'question', color: '#C0764C', sortOrder: 1, isDefault: true },
    { id: 'cat-ervaring',  name: 'Ervaring',  icon: 'leaf',     color: '#7FA95B', sortOrder: 2, isDefault: true },
    { id: 'cat-mijlpaal',  name: 'Mijlpaal',  icon: 'flag',     color: '#B85C4A', sortOrder: 3, isDefault: true },
  ];

  const CHILD_COLORS = ['#E6667F', '#4D99E6', '#E6992D', '#66BB6A', '#9B7ED9', '#4DB6AC'];

  async function ensureDefaults() {
    const cats = await getAll('categories');
    if (cats.length === 0) {
      for (const c of DEFAULT_CATEGORIES) await tx('categories', 'readwrite', s => s.put(c));
    }
  }

  const uuid = () =>
    (crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      }));

  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (_) {}
    return false;
  }

  async function storageEstimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
    } catch (_) {}
    return null;
  }

  return {
    open, getAll, get, put, del,
    getSetting, setSetting,
    getTombstones, addTombstone,
    ensureDefaults, uuid,
    requestPersistence, storageEstimate,
    DEFAULT_CATEGORIES, CHILD_COLORS,
  };
})();
