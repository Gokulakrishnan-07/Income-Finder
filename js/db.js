/* Server-primary data client. IndexedDB/localStorage is retained only as a migration source/cache. */
const ScrapDB = (() => {
  const DB_NAME = "ScrapLedgerDB";
  const DB_VERSION = 1;
  const STORE = "income";
  const LS_KEY = "scrapLedgerFallback";
  const MIGRATION_KEY = "scrapLedgerServerMigration";
  const API = "/.netlify/functions/data";

  let db = null;
  let useFallback = false;
  let serverRecords = [];
  let initialized = false;

  function openDB() {
    return new Promise((resolve) => {
      if (!("indexedDB" in window)) { useFallback = true; return resolve(null); }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("date", "date", { unique: false });
          store.createIndex("category", "category", { unique: false });
        }
      };
      req.onsuccess = event => { db = event.target.result; resolve(db); };
      req.onerror = () => { useFallback = true; resolve(null); };
    });
  }

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch (_) { return []; }
  }
  function lsWrite(rows) { localStorage.setItem(LS_KEY, JSON.stringify(rows)); }

  function localRead() {
    if (useFallback) return Promise.resolve(lsRead());
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function replaceLocalCache(rows) {
    try {
      if (useFallback) { lsWrite(rows); return Promise.resolve(); }
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        store.clear();
        rows.forEach(row => store.put(row));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("Local cache update failed."));
      });
    } catch (error) { return Promise.reject(error); }
  }

  async function request(method, body) {
    const response = await fetch(API, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to sync data. Please check your internet connection and try again.");
    return payload;
  }

  async function init() {
    await openDB();
    const localRows = await localRead();
    let payload = await request("GET");
    const migrationDone = localStorage.getItem(MIGRATION_KEY) === "complete";
    if (localRows.length && !migrationDone) {
      payload = await request("POST", { action: "import", records: localRows });
      localStorage.setItem(MIGRATION_KEY, "complete");
    } else if (!localRows.length) {
      localStorage.setItem(MIGRATION_KEY, "complete");
    }
    serverRecords = payload.records || [];
    initialized = true;
    await replaceLocalCache(serverRecords).catch(() => {});
    return { usingFallback: false, shared: true, migrated: localRows.length > 0 && !migrationDone };
  }

  function ensureReady() {
    if (!initialized) throw new Error("Shared data is not ready.");
  }

  async function syncResponse(payload) {
    serverRecords = payload.records || serverRecords;
    await replaceLocalCache(serverRecords).catch(() => {});
    return payload;
  }

  async function add(record) {
    ensureReady();
    const payload = await request("POST", { record });
    await syncResponse(payload);
    return payload.record || serverRecords[serverRecords.length - 1];
  }

  async function update(record) {
    ensureReady();
    const payload = await request("PUT", { id: record.id, record });
    await syncResponse(payload);
    return payload.record || record;
  }

  async function remove(id) {
    ensureReady();
    const payload = await request("DELETE", { id });
    await syncResponse(payload);
    return true;
  }

  async function importRecords(records) {
    ensureReady();
    const payload = await request("POST", { action: "import", records });
    await syncResponse(payload);
    return payload;
  }

  function getAll() {
    ensureReady();
    return Promise.resolve(serverRecords.slice());
  }

  return { init, add, update, remove, import: importRecords, getAll, get usingFallback() { return false; } };
})();
