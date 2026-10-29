// Your journal lives in this browser (IndexedDB) and can be exported to,
// imported from, or continuously backed up to a JSON file you choose.

const DB = 'breathfield';
const VERSION = 1;
const memory = { sessions: new Map(), kv: new Map() }; // fallback when IndexedDB is blocked
let dbp = null;
let useMemory = false;

function open() {
  if (useMemory) return Promise.resolve(null);
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const r = indexedDB.open(DB, VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => { useMemory = true; resolve(null); };
        r.onblocked = () => { useMemory = true; resolve(null); };
      } catch (e) { useMemory = true; resolve(null); }
    });
  }
  return dbp;
}

function req(store, mode, fn) {
  return open().then((db) => {
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  });
}

export const isPersistent = async () => !!(await open());

export async function allSessions() {
  const db = await open();
  if (!db) return [...memory.sessions.values()];
  return req('sessions', 'readonly', (s) => s.getAll());
}

export async function putSession(session) {
  const db = await open();
  if (!db) { memory.sessions.set(session.id, session); return; }
  await req('sessions', 'readwrite', (s) => s.put(session));
}

export async function deleteSession(id) {
  const db = await open();
  if (!db) { memory.sessions.delete(id); return; }
  await req('sessions', 'readwrite', (s) => s.delete(id));
}

export async function get(key, fallback) {
  const db = await open();
  const v = db ? await req('kv', 'readonly', (s) => s.get(key)) : memory.kv.get(key);
  return v === undefined ? fallback : v;
}

export async function set(key, value) {
  const db = await open();
  if (!db) { memory.kv.set(key, value); return; }
  await req('kv', 'readwrite', (s) => s.put(value, key));
}

// ---------- export / import ----------

export async function exportAll() {
  return {
    app: 'breathfield',
    format: 1,
    exportedAt: new Date().toISOString(),
    settings: await get('settings', null),
    level: await get('level', null),
    sessions: (await allSessions()).sort((a, b) => a.start.localeCompare(b.start)),
  };
}

/** Merge a previously exported journal. Returns how many sessions were new. */
export async function importAll(data) {
  if (!data || data.app !== 'breathfield' || !Array.isArray(data.sessions)) {
    throw new Error('This file is not a Breathfield journal.');
  }
  const have = new Set((await allSessions()).map((s) => s.id));
  let added = 0;
  for (const s of data.sessions) {
    if (!s || !s.id || !s.start || have.has(s.id)) continue;
    await putSession(s);
    added++;
  }
  const level = await get('level', null);
  if (data.level && (!level || (data.level.peakRank || 0) > (level.peakRank || 0))) {
    await set('level', data.level);
  }
  if (data.settings && !(await get('settings', null))) await set('settings', data.settings);
  return added;
}

export function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- continuous backup to a file (Chrome / Edge) ----------

export const canBackupToFile = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export async function chooseBackupFile() {
  const handle = await window.showSaveFilePicker({
    suggestedName: 'breathfield-journal.json',
    types: [{ description: 'Breathfield journal', accept: { 'application/json': ['.json'] } }],
  });
  await set('backupHandle', handle);
  return writeBackup(true);
}

/** Write the journal to the chosen file. ask: may show a permission prompt. */
export async function writeBackup(ask = false) {
  const handle = await get('backupHandle', null);
  if (!handle) return { state: 'none' };
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted' && ask) perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return { state: 'needs-permission', name: handle.name };
  const w = await handle.createWritable();
  await w.write(JSON.stringify(await exportAll(), null, 1));
  await w.close();
  const at = new Date().toISOString();
  await set('backupAt', at);
  return { state: 'ok', name: handle.name, at };
}

export async function forgetBackupFile() {
  await set('backupHandle', null);
}
