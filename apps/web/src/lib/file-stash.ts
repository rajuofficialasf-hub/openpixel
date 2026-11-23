/**
 * Local IndexedDB file stash for My Files & Recent Files.
 *
 * Keeps up to 20 recently processed output blobs (≤ 15 MB each)
 * strictly inside the user's browser so they can re-download or
 * forward a recent result to another tool without re-uploading.
 * Never uploads anything; degrades silently when IndexedDB is
 * unavailable (e.g. restricted private mode or unit test env).
 */

const DB_NAME = 'openpixel.files.v1'
const STORE_NAME = 'files'
const MAX_STORED_FILES = 20
const MAX_FILE_BYTES = 15 * 1024 * 1024

interface StashedRecord {
  id: string
  fileName: string
  mimeType: string
  blob: Blob
  size: number
  at: number
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function saveStashedFile(id: string, fileName: string, blob: Blob): Promise<void> {
  if (blob.size <= 0 || blob.size > MAX_FILE_BYTES) return
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const rec: StashedRecord = {
        id,
        fileName,
        mimeType: blob.type || 'application/octet-stream',
        blob,
        size: blob.size,
        at: Date.now(),
      }
      store.put(rec)
      // Prune oldest records past MAX_STORED_FILES
      const allReq = store.getAll()
      allReq.onsuccess = () => {
        const rows = (allReq.result as StashedRecord[]).sort((a, b) => b.at - a.at)
        for (const extra of rows.slice(MAX_STORED_FILES)) {
          store.delete(extra.id)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}

export async function getStashedFile(id: string): Promise<File | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const rec = await new Promise<StashedRecord | undefined>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(id)
      req.onsuccess = () => resolve(req.result as StashedRecord | undefined)
      req.onerror = () => resolve(undefined)
    })
    if (!rec?.blob) return null
    return new File([rec.blob], rec.fileName, { type: rec.mimeType || rec.blob.type })
  } finally {
    db.close()
  }
}

export async function listStashedSummary(): Promise<{ ids: Set<string>; totalBytes: number }> {
  const db = await openDb()
  if (!db) return { ids: new Set(), totalBytes: 0 }
  try {
    const rows = await new Promise<StashedRecord[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () => resolve((req.result as StashedRecord[]) ?? [])
      req.onerror = () => resolve([])
    })
    const ids = new Set<string>()
    let totalBytes = 0
    for (const r of rows) {
      ids.add(r.id)
      totalBytes += r.size || 0
    }
    return { ids, totalBytes }
  } finally {
    db.close()
  }
}

export async function deleteStashedFile(id: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}

export async function clearStashedFiles(): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}
