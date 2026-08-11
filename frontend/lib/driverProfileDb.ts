import type { SessionSummary } from "./driverProfile";

const DB_NAME = "racing-driver-profile";
const STORE_NAME = "sessions";
const DB_VERSION = 1;

function idb(): IDBFactory | undefined {
  if (typeof indexedDB === "undefined") return undefined;
  return indexedDB;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = idb();
    if (!factory) {
      reject(new Error("IndexedDB is unavailable in this environment."));
      return;
    }
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "inspection_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSessionSummary(summary: SessionSummary): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(summary);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getAllSessionSummaries(): Promise<SessionSummary[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const rows = await requestToPromise(store.getAll() as IDBRequest<SessionSummary[]>);
    return rows.sort((a, b) => b.analyzed_at - a.analyzed_at);
  } finally {
    db.close();
  }
}

export async function deleteSessionSummary(inspectionId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(inspectionId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function clearAllSummaries(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function importSummaries(summaries: SessionSummary[]): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const summary of summaries) {
      store.put(summary);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return summaries.length;
  } finally {
    db.close();
  }
}

export async function exportSummariesJson(): Promise<string> {
  const sessions = await getAllSessionSummaries();
  return JSON.stringify({ schema_version: 1, exported_at: new Date().toISOString(), sessions }, null, 2);
}
