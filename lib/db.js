// db.js — tiny IndexedDB wrapper: "pages" (HTTP cache) and "runs" (fetch results)
const NAME = "qa-toolkit";
let _db;
function open() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("pages", { keyPath: "key" });
      db.createObjectStore("runs", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const dbGet = (s, k) => tx(s, "readonly", (o) => o.get(k));
export const dbPut = (s, v) => tx(s, "readwrite", (o) => o.put(v));
export const dbDelete = (s, k) => tx(s, "readwrite", (o) => o.delete(k));
export const dbAll = (s) => tx(s, "readonly", (o) => o.getAll());
export const dbClear = (s) => tx(s, "readwrite", (o) => o.clear());
export const dbCount = (s) => tx(s, "readonly", (o) => o.count());
