/* ============================================================
   db.js — IndexedDB wrapper for Scrap Ledger
   Store: "income" { id, date (YYYY-MM-DD), category, amount, notes, createdAt }
   Falls back to localStorage automatically if IndexedDB is unavailable.
   ============================================================ */
const ScrapDB = (() => {
  const DB_NAME = "ScrapLedgerDB";
  const DB_VERSION = 1;
  const STORE = "income";
  const LS_KEY = "scrapLedgerFallback";
  const CATEGORY_MIGRATIONS = Object.freeze({ pithalai: "metal", chembu: "metal", aluminium: "metal" });

  let db = null;
  let useFallback = false;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        useFallback = true;
        return resolve(null);
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("date", "date", { unique: false });
          store.createIndex("category", "category", { unique: false });
        }
      };

      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };

      req.onerror = () => {
        useFallback = true;
        resolve(null);
      };
    });
  }

  // ---------- localStorage fallback helpers ----------
  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
  }
  function lsWrite(rows) { localStorage.setItem(LS_KEY, JSON.stringify(rows)); }

  function migratedRows(rows) {
    return rows.map(row => CATEGORY_MIGRATIONS[row.category]
      ? { ...row, category: CATEGORY_MIGRATIONS[row.category] }
      : row);
  }

  function persistIndexedMigrations(rows) {
    const changed = rows.filter(row => CATEGORY_MIGRATIONS[row.category]);
    if (!changed.length) return Promise.resolve(rows);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      changed.forEach(row => store.put({ ...row, category: CATEGORY_MIGRATIONS[row.category] }));
      transaction.oncomplete = () => resolve(migratedRows(rows));
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Category migration was aborted."));
    });
  }

  async function init() {
    await openDB();
    return { usingFallback: useFallback };
  }

  function tx(mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function add(record) {
    return new Promise((resolve, reject) => {
      if (useFallback) {
        const rows = lsRead();
        const id = rows.length ? Math.max(...rows.map(r => r.id)) + 1 : 1;
        const row = { ...record, id };
        rows.push(row);
        lsWrite(rows);
        return resolve(row);
      }
      const store = tx("readwrite");
      const req = store.add(record);
      req.onsuccess = () => resolve({ ...record, id: req.result });
      req.onerror = () => reject(req.error);
    });
  }

  function update(record) {
    return new Promise((resolve, reject) => {
      if (useFallback) {
        const rows = lsRead();
        const idx = rows.findIndex(r => r.id === record.id);
        if (idx > -1) rows[idx] = record;
        lsWrite(rows);
        return resolve(record);
      }
      const store = tx("readwrite");
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  function remove(id) {
    return new Promise((resolve, reject) => {
      if (useFallback) {
        const rows = lsRead().filter(r => r.id !== id);
        lsWrite(rows);
        return resolve(true);
      }
      const store = tx("readwrite");
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  function getAll() {
    return new Promise((resolve, reject) => {
      if (useFallback) {
        const rows = lsRead();
        const migrated = migratedRows(rows);
        if (migrated.some((row, index) => row !== rows[index])) lsWrite(migrated);
        return resolve(migrated);
      }
      const store = tx("readonly");
      const req = store.getAll();
      req.onsuccess = () => persistIndexedMigrations(req.result || []).then(resolve).catch(reject);
      req.onerror = () => reject(req.error);
    });
  }

  return { init, add, update, remove, getAll, get usingFallback() { return useFallback; } };
})();
