/**
 * IndexedDB 儲存層
 *
 * IndexedDB 是「這台裝置、這個瀏覽器」裡的資料庫：
 * - 關閉網頁、重開機後資料仍在。
 * - 不會自動同步到其他裝置，也不是雲端資料庫。
 * - 清除瀏覽器資料、使用無痕模式或更換裝置，資料就不在了，所以要定期匯出備份。
 */
import {
  APP_ID,
  CHILD_STORES,
  DATA_STORES,
  FORMAT_VERSION,
  emptyData,
  type AppData,
  type DataStoreName,
  type ExportFile,
  type LocalBackup,
  type StoreRecordMap,
} from '../types'
import { newId, nowIso } from '../lib/id'

const DB_NAME = 'usagi-japan-trip'
const DB_VERSION = 1
const BACKUP_STORE = 'backups'
const META_STORE = 'meta'
/** 本機最多保留幾份自動備份 */
const MAX_BACKUPS = 10

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of DATA_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' })
          if (name !== 'trips') store.createIndex('tripId', 'tripId', { unique: false })
        }
      }
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => reject(new Error('資料庫被其他分頁占用，請關閉本網站的其他分頁後重新整理。'))
  })
  return dbPromise
}

/** 測試用：關閉連線，讓下一次 openDb 重新連線（模擬關閉網頁再打開） */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return
  const db = await dbPromise
  db.close()
  dbPromise = null
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('交易已取消，資料沒有變更。'))
  })
}

function touch(tx: IDBTransaction) {
  tx.objectStore(META_STORE).put(nowIso(), 'lastModified')
}

// ---------- 讀取 ----------

export async function getAll<K extends DataStoreName>(store: K): Promise<StoreRecordMap[K][]> {
  const db = await openDb()
  return reqToPromise(db.transaction(store).objectStore(store).getAll())
}

export async function getById<K extends DataStoreName>(
  store: K,
  id: string,
): Promise<StoreRecordMap[K] | undefined> {
  const db = await openDb()
  return reqToPromise(db.transaction(store).objectStore(store).get(id))
}

export async function getByTrip<K extends Exclude<DataStoreName, 'trips'>>(
  store: K,
  tripId: string,
): Promise<StoreRecordMap[K][]> {
  const db = await openDb()
  const index = db.transaction(store).objectStore(store).index('tripId')
  return reqToPromise(index.getAll(tripId))
}

/** 一次讀出全部資料（同一個交易，確保是同一瞬間的快照） */
export async function loadAll(): Promise<AppData> {
  const db = await openDb()
  const tx = db.transaction(DATA_STORES, 'readonly')
  const data = emptyData()
  await Promise.all(
    DATA_STORES.map(async (name) => {
      ;(data as Record<DataStoreName, unknown[]>)[name] = await reqToPromise(
        tx.objectStore(name).getAll(),
      )
    }),
  )
  return data
}

// ---------- 新增／修改／刪除 ----------

type NewFields<K extends DataStoreName> = Omit<StoreRecordMap[K], 'id' | 'createdAt' | 'updatedAt'>

/** 新增一筆資料：自動產生 id、建立時間與修改時間 */
export async function createRecord<K extends DataStoreName>(
  store: K,
  fields: NewFields<K>,
): Promise<StoreRecordMap[K]> {
  const now = nowIso()
  const record = { ...fields, id: newId(), createdAt: now, updatedAt: now } as StoreRecordMap[K]
  const db = await openDb()
  const tx = db.transaction([store, META_STORE], 'readwrite')
  tx.objectStore(store).add(record)
  touch(tx)
  await txDone(tx)
  return record
}

/** 修改一筆資料：保留 id 與建立時間，更新修改時間 */
export async function updateRecord<K extends DataStoreName>(
  store: K,
  record: StoreRecordMap[K],
): Promise<StoreRecordMap[K]> {
  const db = await openDb()
  const tx = db.transaction([store, META_STORE], 'readwrite')
  const os = tx.objectStore(store)
  const existing = (await reqToPromise(os.get(record.id))) as StoreRecordMap[K] | undefined
  if (!existing) {
    tx.abort()
    throw new Error('找不到要修改的資料，可能已被刪除。')
  }
  const updated = { ...record, createdAt: existing.createdAt, updatedAt: nowIso() }
  os.put(updated)
  touch(tx)
  await txDone(tx)
  return updated
}

/** 刪除一筆子資料 */
export async function deleteRecord(store: Exclude<DataStoreName, 'trips'>, id: string) {
  const db = await openDb()
  const tx = db.transaction([store, META_STORE], 'readwrite')
  tx.objectStore(store).delete(id)
  touch(tx)
  await txDone(tx)
}

/** 刪除旅行，以及這趟旅行底下所有航班、住宿、行程、待辦、預算（同一個交易，要嘛全刪要嘛都不刪） */
export async function deleteTrip(tripId: string) {
  const db = await openDb()
  const tx = db.transaction(['trips', ...CHILD_STORES, META_STORE], 'readwrite')
  tx.objectStore('trips').delete(tripId)
  for (const name of CHILD_STORES) {
    const index = tx.objectStore(name).index('tripId')
    const keys = await reqToPromise(index.getAllKeys(tripId))
    for (const key of keys) tx.objectStore(name).delete(key)
  }
  touch(tx)
  await txDone(tx)
}

/**
 * 用新資料整批取代全部資料。
 * 全部在同一個交易裡完成：任何一筆寫入失敗，整個交易會取消，原本的資料完整保留。
 * 第四階段的匯入／合併與還原備份都會使用這個函式。
 */
export async function replaceAll(data: AppData) {
  const db = await openDb()
  const tx = db.transaction([...DATA_STORES, META_STORE], 'readwrite')
  try {
    for (const name of DATA_STORES) {
      const os = tx.objectStore(name)
      os.clear()
      for (const rec of data[name]) os.put(rec)
    }
    touch(tx)
  } catch (e) {
    tx.abort()
    throw e
  }
  await txDone(tx)
}

// ---------- 統計、裝置名稱 ----------

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return reqToPromise(db.transaction(META_STORE).objectStore(META_STORE).get(key))
}

export async function setMeta(key: string, value: unknown) {
  const db = await openDb()
  const tx = db.transaction(META_STORE, 'readwrite')
  tx.objectStore(META_STORE).put(value, key)
  await txDone(tx)
}

export interface Stats {
  counts: Record<DataStoreName, number>
  total: number
  lastModified?: string
}

export async function getStats(): Promise<Stats> {
  const db = await openDb()
  const tx = db.transaction([...DATA_STORES, META_STORE])
  const counts = {} as Record<DataStoreName, number>
  await Promise.all(
    DATA_STORES.map(async (name) => {
      counts[name] = await reqToPromise(tx.objectStore(name).count())
    }),
  )
  const lastModified = (await reqToPromise(tx.objectStore(META_STORE).get('lastModified'))) as
    | string
    | undefined
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return { counts, total, lastModified }
}

// ---------- 匯出檔案與本機備份 ----------

export async function buildExportFile(): Promise<ExportFile> {
  return {
    app: APP_ID,
    formatVersion: FORMAT_VERSION,
    exportedAt: nowIso(),
    deviceName: (await getMeta<string>('deviceName')) ?? '',
    data: await loadAll(),
  }
}

/** 建立一份本機備份（存在同一個瀏覽器裡，用於匯入出錯時還原） */
export async function createBackup(reason: string): Promise<LocalBackup> {
  const backup: LocalBackup = {
    id: newId(),
    createdAt: nowIso(),
    reason,
    file: await buildExportFile(),
  }
  const db = await openDb()
  const tx = db.transaction(BACKUP_STORE, 'readwrite')
  const os = tx.objectStore(BACKUP_STORE)
  os.put(backup)
  const all = ((await reqToPromise(os.getAll())) as LocalBackup[]).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
  for (const old of all.slice(MAX_BACKUPS)) os.delete(old.id)
  await txDone(tx)
  return backup
}

export async function listBackups(): Promise<LocalBackup[]> {
  const db = await openDb()
  const all = (await reqToPromise(
    db.transaction(BACKUP_STORE).objectStore(BACKUP_STORE).getAll(),
  )) as LocalBackup[]
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 還原備份：先把目前資料再備份一次，然後整批取代 */
export async function restoreBackup(id: string) {
  const db = await openDb()
  const backup = (await reqToPromise(
    db.transaction(BACKUP_STORE).objectStore(BACKUP_STORE).get(id),
  )) as LocalBackup | undefined
  if (!backup) throw new Error('找不到這份備份。')
  await createBackup('還原備份前的自動備份')
  await replaceAll(backup.file.data)
}

export async function deleteBackup(id: string) {
  const db = await openDb()
  const tx = db.transaction(BACKUP_STORE, 'readwrite')
  tx.objectStore(BACKUP_STORE).delete(id)
  await txDone(tx)
}
