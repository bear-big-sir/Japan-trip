/**
 * Supabase 雲端儲存層
 *
 * 和 local.ts（IndexedDB）提供同樣名稱的函式，畫面不必知道資料存在哪裡。
 * - 新增：ID 由前端產生（UUID），重送也不會變成兩筆。
 * - 修改：一定帶上讀到的 version；資料庫發現版本不同（家人已改過）就拒絕，不會默默覆蓋。
 * - 所有錯誤都轉成中文訊息丟出，表單會停在原畫面讓使用者重試。
 * - 權限由資料庫的 RLS 檢查，這裡不做任何「隱藏按鈕式」的保護。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CHILD_STORES,
  DATA_STORES,
  emptyData,
  type AppData,
  type BaseRecord,
  type DataStoreName,
  type StoreRecordMap,
} from '../types'
import { newId, nowIso } from '../lib/id'
import { friendlyError } from '../auth/household'

// ---------- 連線狀態（登入並加入家庭後由 AuthGate 設定） ----------

interface CloudContext {
  client: SupabaseClient
  householdId: string
  userId: string
}

let ctx: CloudContext | null = null

export function setCloudContext(next: CloudContext | null) {
  ctx = next
}

export function isCloudActive(): boolean {
  return ctx !== null
}

function need(): CloudContext {
  if (!ctx) throw new Error('尚未登入雲端，無法讀寫資料。')
  return ctx
}

/** 版本衝突：家人已經修改過這筆資料 */
export class ConflictError extends Error {
  constructor() {
    super('這筆資料剛剛已被家人修改過，為了避免覆蓋對方的內容，這次沒有儲存。請關閉表單、重新開啟後再修改。')
    this.name = 'ConflictError'
  }
}

function fail(error: { message?: string; code?: string } | null): never {
  if (error && /VERSION_CONFLICT/.test(error.message ?? '')) throw new ConflictError()
  throw new Error(friendlyError(error))
}

// ---------- 欄位對照：畫面用的名稱 ↔ 資料庫欄位 ----------

type Kind = 'text' | 'date' | 'datetime' | 'time' | 'number' | 'bool'
type Col = [front: string, db: string, kind: Kind]

const TABLE: Record<DataStoreName, string> = {
  trips: 'trips',
  flights: 'flights',
  hotels: 'hotels',
  itinerary: 'itinerary_items',
  research: 'places',
  todos: 'todos',
  budget: 'expenses',
}

const COLS: Record<DataStoreName, Col[]> = {
  trips: [
    ['name', 'name', 'text'],
    ['year', 'year', 'number'],
    ['startDate', 'start_date', 'date'],
    ['endDate', 'end_date', 'date'],
    ['destination', 'destination', 'text'],
    ['notes', 'notes', 'text'],
  ],
  flights: [
    ['tripId', 'trip_id', 'text'],
    ['airline', 'airline', 'text'],
    ['flightNumber', 'flight_number', 'text'],
    ['departDateTime', 'depart_at', 'datetime'],
    ['departAirport', 'depart_airport', 'text'],
    ['departTerminal', 'depart_terminal', 'text'],
    ['arriveDateTime', 'arrive_at', 'datetime'],
    ['arriveAirport', 'arrive_airport', 'text'],
    ['arriveTerminal', 'arrive_terminal', 'text'],
    ['bookingInfo', 'booking_info', 'text'],
    ['notes', 'notes', 'text'],
  ],
  hotels: [
    ['tripId', 'trip_id', 'text'],
    ['name', 'name', 'text'],
    ['address', 'address', 'text'],
    ['phone', 'phone', 'text'],
    ['checkIn', 'check_in', 'date'],
    ['checkOut', 'check_out', 'date'],
    ['bookingNumber', 'booking_number', 'text'],
    ['roomType', 'room_type', 'text'],
    ['notes', 'notes', 'text'],
  ],
  itinerary: [
    ['tripId', 'trip_id', 'text'],
    ['date', 'day_date', 'date'],
    ['time', 'start_time', 'time'],
    ['title', 'title', 'text'],
    ['address', 'address', 'text'],
    ['transport', 'transport', 'text'],
    ['duration', 'duration', 'text'],
    ['foodShopping', 'food_shopping', 'text'],
    ['notes', 'notes', 'text'],
    ['order', 'sort_order', 'number'],
  ],
  research: [
    ['tripId', 'trip_id', 'text'],
    ['category', 'category', 'text'],
    ['title', 'title', 'text'],
    ['address', 'address', 'text'],
    ['url', 'url', 'text'],
    ['content', 'content', 'text'],
    ['priority', 'priority', 'number'],
  ],
  todos: [
    ['tripId', 'trip_id', 'text'],
    ['category', 'category', 'text'],
    ['title', 'title', 'text'],
    ['done', 'done', 'bool'],
    ['notes', 'notes', 'text'],
  ],
  budget: [
    ['tripId', 'trip_id', 'text'],
    ['category', 'category', 'text'],
    ['name', 'name', 'text'],
    ['amount', 'amount', 'number'],
    ['currency', 'currency', 'text'],
    ['date', 'spent_on', 'date'],
    ['notes', 'notes', 'text'],
  ],
}

type Row = Record<string, unknown>

function toDb(kind: Kind, v: unknown): unknown {
  switch (kind) {
    case 'date':
    case 'datetime':
    case 'time':
      return typeof v === 'string' && v.trim() ? v.trim() : null
    case 'number':
      return typeof v === 'number' ? v : Number(v ?? 0)
    case 'bool':
      return Boolean(v)
    default:
      return typeof v === 'string' ? v : v == null ? '' : String(v)
  }
}

function fromDb(kind: Kind, v: unknown): unknown {
  switch (kind) {
    case 'date':
      return typeof v === 'string' ? v.slice(0, 10) : ''
    case 'datetime':
      return typeof v === 'string' ? v.replace(' ', 'T').slice(0, 16) : ''
    case 'time':
      return typeof v === 'string' ? v.slice(0, 5) : ''
    case 'number':
      return v == null ? 0 : Number(v)
    case 'bool':
      return Boolean(v)
    default:
      return v ?? ''
  }
}

/** 資料庫時間統一轉成 2026-01-02T03:04:05.000Z，讓匯出後再匯入時能比對內容是否相同 */
function iso(v: unknown): string {
  if (typeof v !== 'string') return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toISOString()
}

/** 畫面資料 → 資料庫一列（不含 version、建立者等由資料庫維護的欄位） */
export function toRow<K extends DataStoreName>(store: K, rec: Partial<StoreRecordMap[K]>, householdId: string): Row {
  const r = rec as Record<string, unknown>
  const row: Row = { id: r.id, household_id: householdId }
  if (typeof r.createdAt === 'string' && r.createdAt) row.created_at = r.createdAt
  for (const [front, db, kind] of COLS[store]) row[db] = toDb(kind, r[front])
  return row
}

/** 資料庫一列 → 畫面資料 */
export function fromRow<K extends DataStoreName>(store: K, row: Row): StoreRecordMap[K] {
  const rec: Record<string, unknown> = {
    id: row.id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    version: row.version,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  }
  for (const [front, db, kind] of COLS[store]) rec[front] = fromDb(kind, row[db])
  return rec as unknown as StoreRecordMap[K]
}

// ---------- 讀取 ----------

export async function getAll<K extends DataStoreName>(store: K): Promise<StoreRecordMap[K][]> {
  const { client } = need()
  const { data, error } = await client.from(TABLE[store]).select('*').order('created_at')
  if (error) fail(error)
  return (data ?? []).map((r) => fromRow(store, r))
}

export async function getById<K extends DataStoreName>(store: K, id: string): Promise<StoreRecordMap[K] | undefined> {
  const { client } = need()
  const { data, error } = await client.from(TABLE[store]).select('*').eq('id', id).maybeSingle()
  if (error) fail(error)
  return data ? fromRow(store, data) : undefined
}

export async function getByTrip<K extends Exclude<DataStoreName, 'trips'>>(
  store: K,
  tripId: string,
): Promise<StoreRecordMap[K][]> {
  const { client } = need()
  const { data, error } = await client.from(TABLE[store]).select('*').eq('trip_id', tripId).order('created_at')
  if (error) fail(error)
  return (data ?? []).map((r) => fromRow(store, r))
}

export async function loadAll(): Promise<AppData> {
  const data = emptyData()
  const lists = await Promise.all(DATA_STORES.map((s) => getAll(s)))
  DATA_STORES.forEach((s, i) => {
    ;(data as Record<DataStoreName, unknown[]>)[s] = lists[i]
  })
  return data
}

// ---------- 新增／修改／刪除 ----------

type NewFields<K extends DataStoreName> = Omit<StoreRecordMap[K], 'id' | 'createdAt' | 'updatedAt'>

/** 新增：寫入資料庫成功後才回傳（畫面才會顯示已儲存） */
export async function createRecord<K extends DataStoreName>(store: K, fields: NewFields<K>): Promise<StoreRecordMap[K]> {
  const { client, householdId } = need()
  const row = toRow(store, { ...fields, id: newId() } as Partial<StoreRecordMap[K]>, householdId)
  delete row.created_at
  const { data, error } = await client.from(TABLE[store]).insert(row).select('*').single()
  if (error) fail(error)
  return fromRow(store, data)
}

/** 修改：帶上讀到的 version，版本不同代表家人已改過 → 丟出 ConflictError */
export async function updateRecord<K extends DataStoreName>(store: K, record: StoreRecordMap[K]): Promise<StoreRecordMap[K]> {
  const { client, householdId } = need()
  if (typeof record.version !== 'number') {
    throw new Error('這筆資料缺少版本資訊，請重新整理頁面後再修改。')
  }
  const row = toRow(store, record, householdId)
  delete row.id
  delete row.household_id
  delete row.created_at
  row.version = record.version
  const { data, error } = await client.from(TABLE[store]).update(row).eq('id', record.id).select('*').maybeSingle()
  if (error) fail(error)
  if (!data) throw new Error('找不到要修改的資料，可能已被家人刪除。請重新整理頁面。')
  return fromRow(store, data)
}

export async function deleteRecord(store: Exclude<DataStoreName, 'trips'>, id: string) {
  const { client } = need()
  const { error } = await client.from(TABLE[store]).delete().eq('id', id)
  if (error) fail(error)
}

/** 刪除旅行：資料庫的外鍵會一併刪除底下所有資料（同一個交易），刪除內容仍保留在修改紀錄 */
export async function deleteTrip(tripId: string) {
  const { client } = need()
  const { error } = await client.from('trips').delete().eq('id', tripId)
  if (error) fail(error)
}

/**
 * 一次寫入多筆（新增或覆寫），用於複製行程、調整順序、匯入備份。
 * - 先寫旅行，再寫子資料（子資料需要旅行先存在）。
 * - 雲端還沒有的資料：每一類一次 insert（整批成功或整批失敗）。
 * - 雲端已經有的資料：逐筆 update，並帶上版本做衝突檢查。
 *   不能用 upsert：資料庫的新增觸發器會把 version 設回 1，已存在的資料會被誤判為版本衝突。
 * - 帶有 version 的資料（畫面上讀到的）用自己的版本；沒有 version 的資料（例如匯入檔）
 *   代表使用者在匯入預覽中選擇了「用匯入的內容」，以目前雲端版本覆寫。
 */
export async function putMany(changes: Partial<AppData>) {
  const { client, householdId } = need()
  for (const store of ['trips', ...CHILD_STORES] as DataStoreName[]) {
    const list = (changes[store] ?? []) as BaseRecord[]
    if (list.length === 0) continue
    const ids = list.map((r) => r.id)
    const { data: existing, error: readError } = await client
      .from(TABLE[store])
      .select('id, version')
      .in('id', ids)
    if (readError) fail(readError)
    const current = new Map((existing ?? []).map((r) => [r.id as string, r.version as number]))

    const now = nowIso()
    const inserts = list
      .filter((rec) => !current.has(rec.id))
      .map((rec) => {
        const row = toRow(store, rec as Partial<StoreRecordMap[typeof store]>, householdId)
        // 每一列的欄位必須一致，否則沒有提供的欄位會被當成空值
        row.created_at = row.created_at ?? now
        return row
      })
    if (inserts.length > 0) {
      const { error } = await client.from(TABLE[store]).insert(inserts)
      if (error) fail(error)
    }

    for (const rec of list.filter((r) => current.has(r.id))) {
      const row = toRow(store, rec as Partial<StoreRecordMap[typeof store]>, householdId)
      delete row.id
      delete row.household_id
      delete row.created_at
      row.version = rec.version ?? current.get(rec.id)
      const { data, error } = await client.from(TABLE[store]).update(row).eq('id', rec.id).select('id').maybeSingle()
      if (error) fail(error)
      if (!data) throw new Error('找不到要修改的資料，可能已被家人刪除。請重新整理頁面。')
    }
  }
}

/** 還原備份：把備份內容寫回雲端（不會刪除備份之後新增的資料） */
export async function restoreData(data: AppData) {
  const stripVersions = (list: BaseRecord[] | undefined) => (list ?? []).map((r) => ({ ...r, version: undefined }))
  const changes: Partial<AppData> = {}
  for (const s of DATA_STORES) {
    ;(changes as Record<string, BaseRecord[]>)[s] = stripVersions(data[s] as BaseRecord[] | undefined)
  }
  await putMany(changes)
}

// ---------- 統計與最後更新者 ----------

export interface CloudStats {
  counts: Record<DataStoreName, number>
  total: number
  lastModified?: string
  lastModifiedBy?: string
}

export async function getStats(): Promise<CloudStats> {
  const { client } = need()
  const counts = {} as Record<DataStoreName, number>
  await Promise.all(
    DATA_STORES.map(async (s) => {
      const { count, error } = await client.from(TABLE[s]).select('id', { count: 'exact', head: true })
      if (error) fail(error)
      counts[s] = count ?? 0
    }),
  )
  const { data: last, error } = await client
    .from('audit_logs')
    .select('changed_at, changed_by')
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) fail(error)
  let lastModifiedBy: string | undefined
  if (last?.changed_by) {
    const names = await memberNames()
    lastModifiedBy = names.get(last.changed_by as string)
  }
  return {
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    lastModified: last ? iso(last.changed_at) : undefined,
    lastModifiedBy,
  }
}

/** 家庭成員的帳號 ID → 稱呼（用來顯示「最後更新者」） */
export async function memberNames(): Promise<Map<string, string>> {
  const { client } = need()
  const { data, error } = await client.from('household_members').select('user_id, display_name, email')
  if (error) fail(error)
  return new Map((data ?? []).map((m) => [m.user_id as string, (m.display_name as string) || (m.email as string)]))
}
