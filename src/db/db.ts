/**
 * 資料存取入口：畫面一律從這裡讀寫資料。
 *
 * - 登入雲端並加入家庭後 → 旅行資料讀寫 Supabase（cloud.ts）。
 * - 尚未登入（例如自動測試）→ 使用瀏覽器 IndexedDB（local.ts）。
 * - 網站標題、匯率、裝置名稱等「這台裝置的偏好設定」與本機備份，永遠存在本機。
 */
import { APP_ID, FORMAT_VERSION, type AppData, type DataStoreName, type ExportFile, type LocalBackup, type StoreRecordMap } from '../types'
import { nowIso } from '../lib/id'
import * as local from './local'
import * as cloud from './cloud'

export { openDb, closeDb, getMeta, setMeta, markExported, listBackups, deleteBackup } from './local'
export { isCloudActive, setCloudContext, ConflictError } from './cloud'

const remote = () => cloud.isCloudActive()

type ChildStore = Exclude<DataStoreName, 'trips'>
type NewFields<K extends DataStoreName> = Omit<StoreRecordMap[K], 'id' | 'createdAt' | 'updatedAt'>

export function getAll<K extends DataStoreName>(store: K): Promise<StoreRecordMap[K][]> {
  return remote() ? cloud.getAll(store) : local.getAll(store)
}

export function getById<K extends DataStoreName>(store: K, id: string): Promise<StoreRecordMap[K] | undefined> {
  return remote() ? cloud.getById(store, id) : local.getById(store, id)
}

export function getByTrip<K extends ChildStore>(store: K, tripId: string): Promise<StoreRecordMap[K][]> {
  return remote() ? cloud.getByTrip(store, tripId) : local.getByTrip(store, tripId)
}

export function loadAll(): Promise<AppData> {
  return remote() ? cloud.loadAll() : local.loadAll()
}

export function createRecord<K extends DataStoreName>(store: K, fields: NewFields<K>): Promise<StoreRecordMap[K]> {
  return remote() ? cloud.createRecord(store, fields) : local.createRecord(store, fields)
}

export function updateRecord<K extends DataStoreName>(store: K, record: StoreRecordMap[K]): Promise<StoreRecordMap[K]> {
  return remote() ? cloud.updateRecord(store, record) : local.updateRecord(store, record)
}

export function deleteRecord(store: ChildStore, id: string): Promise<void> {
  return remote() ? cloud.deleteRecord(store, id) : local.deleteRecord(store, id)
}

export function deleteTrip(tripId: string): Promise<void> {
  return remote() ? cloud.deleteTrip(tripId) : local.deleteTrip(tripId)
}

export function putMany(changes: Partial<AppData>): Promise<void> {
  return remote() ? cloud.putMany(changes) : local.putMany(changes)
}

/** 只用於本機模式（整批取代會刪除資料，雲端模式不提供） */
export function replaceAll(data: AppData): Promise<void> {
  if (remote()) throw new Error('雲端模式不提供整批取代，請改用匯入備份。')
  return local.replaceAll(data)
}

export interface Stats {
  counts: Record<DataStoreName, number>
  total: number
  lastModified?: string
  /** 最後更新者（只有雲端模式才有） */
  lastModifiedBy?: string
  lastExportAt?: string
  cloud: boolean
}

export async function getStats(): Promise<Stats> {
  if (!remote()) return { ...(await local.getStats()), cloud: false }
  const [s, lastExportAt] = await Promise.all([cloud.getStats(), local.getMeta<string>('lastExportAt')])
  return { ...s, lastExportAt, cloud: true }
}

export async function buildExportFile(): Promise<ExportFile> {
  return {
    app: APP_ID,
    formatVersion: FORMAT_VERSION,
    exportedAt: nowIso(),
    deviceName: (await local.getMeta<string>('deviceName')) ?? '',
    data: await loadAll(),
  }
}

/** 本機備份：把目前的資料（雲端模式時是雲端資料）存一份在這個瀏覽器 */
export async function createBackup(reason: string): Promise<LocalBackup> {
  return local.saveBackup(reason, await buildExportFile())
}

/**
 * 還原備份：先把目前資料再備份一次。
 * - 本機模式：整批取代。
 * - 雲端模式：把備份內容寫回雲端（覆蓋同一筆資料，但不刪除備份之後新增的資料）。
 */
export async function restoreBackup(id: string) {
  const backup = await local.getBackup(id)
  if (!backup) throw new Error('找不到這份備份。')
  await createBackup('還原備份前的自動備份')
  if (remote()) await cloud.restoreData(backup.file.data)
  else await local.replaceAll(backup.file.data)
}

/** 讀出「這台裝置瀏覽器裡」的舊資料（雲端模式時用來上傳到雲端） */
export async function buildLocalExportFile(): Promise<ExportFile> {
  return local.buildExportFile()
}
