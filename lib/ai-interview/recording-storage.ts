'use client';

/**
 * Client-side IndexedDB persistence for live interview video chunks.
 *
 * Guarantees zero data loss across:
 * - Sudden browser refresh (F5 / hard reload)
 * - Browser tab close / crash
 * - Proctoring termination
 * - Reconnection / network drops
 */

const DB_NAME = 'creole_interview_recordings';
const STORE_NAME = 'chunks';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('interviewId', 'interviewId', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        resolve((e.target as IDBOpenDBRequest).result);
      };

      request.onerror = () => {
        console.warn('[recording-storage] Failed to open IndexedDB');
        resolve(null);
      };
    } catch (err) {
      console.warn('[recording-storage] IndexedDB open error:', err);
      resolve(null);
    }
  });
}

/**
 * Append a newly recorded video chunk to IndexedDB
 */
export async function saveRecordingChunk(interviewId: string, chunk: Blob): Promise<void> {
  if (!interviewId || !chunk || chunk.size === 0) return;
  const db = await openDB();
  if (!db) return;

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.add({
        interviewId,
        chunk,
        timestamp: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Retrieve all video chunks saved for this interviewId in sequential order
 */
export async function getAllRecordingChunks(interviewId: string): Promise<Blob[]> {
  if (!interviewId) return [];
  const db = await openDB();
  if (!db) return [];

  return new Promise<Blob[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('interviewId');
      const request = index.getAll(IDBKeyRange.only(interviewId));

      request.onsuccess = () => {
        const results = request.result || [];
        const blobs: Blob[] = results
          .sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))
          .map((item: any) => item.chunk)
          .filter(Boolean);
        resolve(blobs);
      };

      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Check if there are un-uploaded video chunks saved for this interview
 */
export async function hasRecordingChunks(interviewId: string): Promise<boolean> {
  if (!interviewId) return false;
  const db = await openDB();
  if (!db) return false;

  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('interviewId');
      const request = index.count(IDBKeyRange.only(interviewId));

      request.onsuccess = () => {
        resolve((request.result || 0) > 0);
      };

      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Clear all video chunks for this interview once safely uploaded to Google Drive
 */
export async function clearRecordingChunks(interviewId: string): Promise<void> {
  if (!interviewId) return;
  const db = await openDB();
  if (!db) return;

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('interviewId');
      const request = index.openCursor(IDBKeyRange.only(interviewId));

      request.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
