/**
 * 匯入 JSON 與安全合併
 *
 * 合併規則（不會互相覆蓋）：
 * 1. ID 不同的資料 → 新增。
 * 2. ID 相同、內容完全相同 → 只保留一份（略過）。
 * 3. ID 相同、內容不同 → 列為衝突，由使用者逐筆選擇保留哪一份。
 * 4. 只有本機有的資料 → 保持不變（合併不會刪除任何資料）。
 *
 * 這個檔案只做「檢查」與「計算」，不寫入資料庫；寫入在 importMerge() 一次完成。
 */
import {
  APP_ID,
  CHILD_STORES,
  DATA_STORES,
  FORMAT_VERSION,
  MIN_FORMAT_VERSION,
  STORE_LABELS,
  META_FIELDS,
  emptyData,
  type AppData,
  type BaseRecord,
  type DataStoreName,
  type ExportFile,
} from '../types'
import { createBackup, loadAll, putMany } from './db'

type FieldType = 'string' | 'number' | 'boolean'

/** 每一種資料必須有的欄位與型別（id、createdAt、updatedAt 另外檢查） */
export const SCHEMA: Record<DataStoreName, Record<string, FieldType>> = {
  trips: {
    name: 'string', year: 'number', startDate: 'string', endDate: 'string', destination: 'string', notes: 'string',
  },
  flights: {
    tripId: 'string', airline: 'string', flightNumber: 'string', departDateTime: 'string', departAirport: 'string',
    departTerminal: 'string', arriveDateTime: 'string', arriveAirport: 'string', arriveTerminal: 'string',
    bookingInfo: 'string', notes: 'string',
  },
  hotels: {
    tripId: 'string', name: 'string', address: 'string', phone: 'string', checkIn: 'string', checkOut: 'string',
    bookingNumber: 'string', roomType: 'string', notes: 'string',
  },
  itinerary: {
    tripId: 'string', date: 'string', time: 'string', title: 'string', address: 'string', transport: 'string',
    duration: 'string', foodShopping: 'string', notes: 'string', order: 'number',
  },
  research: {
    tripId: 'string', category: 'string', title: 'string', address: 'string', url: 'string', content: 'string',
    priority: 'number',
  },
  todos: { tripId: 'string', category: 'string', title: 'string', done: 'boolean', notes: 'string' },
  budget: {
    tripId: 'string', category: 'string', name: 'string', amount: 'number', currency: 'string', date: 'string',
    notes: 'string',
  },
}

/** 衝突畫面顯示用的欄位名稱 */
export const FIELD_LABELS: Record<string, string> = {
  tripId: '所屬旅行', name: '名稱', year: '年份', startDate: '出發日期', endDate: '回程日期', destination: '目的地',
  notes: '備註', airline: '航空公司', flightNumber: '航班號碼', departDateTime: '出發時間', departAirport: '出發機場',
  departTerminal: '出發航廈', arriveDateTime: '抵達時間', arriveAirport: '抵達機場', arriveTerminal: '抵達航廈',
  bookingInfo: '訂位資訊', address: '地址', phone: '電話', checkIn: '入住', checkOut: '退房',
  bookingNumber: '訂房編號', roomType: '房型', date: '日期', time: '時間', title: '標題', transport: '交通方式',
  duration: '停留時間', foodShopping: '餐廳／購物', order: '順序', category: '分類', done: '完成',
  amount: '金額', currency: '幣別', url: '網址', content: '內容', priority: '想去程度', createdAt: '建立時間',
}

/** 這個版本才開始有的資料表；比它舊的檔案沒有這些資料表是正常的 */
const STORE_SINCE: Partial<Record<DataStoreName, number>> = { research: 2 }

const MAX_ERRORS = 8

export type ValidateResult =
  | { ok: true; file: ExportFile }
  | { ok: false; errors: string[] }

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 檢查匯入的檔案：JSON 格式、版本、必要欄位、重複 ID、子資料是否對應到旅行。
 * localTripIds：本機已有的旅行 ID（子資料可以指向本機已有的旅行）。
 */
export function validateImport(text: string, localTripIds: Iterable<string> = []): ValidateResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['這不是正確的 JSON 檔案，可能檔案損壞或選錯檔案。'] }
  }
  if (!isObj(raw) || raw.app !== APP_ID) {
    return { ok: false, errors: ['這個檔案不是本系統（日本自由行管理）匯出的資料。'] }
  }
  const v = raw.formatVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_FORMAT_VERSION) {
    return { ok: false, errors: ['檔案的格式版本不正確，無法匯入。'] }
  }
  if (v > FORMAT_VERSION) {
    return {
      ok: false,
      errors: [`這個檔案是用較新版的網頁匯出的（版本 ${v}），請先重新整理網頁更新到最新版再匯入。`],
    }
  }
  if (!isObj(raw.data)) return { ok: false, errors: ['檔案裡找不到旅行資料（data）。'] }

  const errors: string[] = []
  const err = (m: string) => {
    if (errors.length < MAX_ERRORS) errors.push(m)
    else if (errors.length === MAX_ERRORS) errors.push('…還有其他錯誤，未全部列出。')
  }
  const data = emptyData()

  for (const store of DATA_STORES) {
    const list = raw.data[store]
    const label = STORE_LABELS[store]
    if (list === undefined && (STORE_SINCE[store] ?? 1) > v) continue
    if (!Array.isArray(list)) {
      err(`缺少「${label}」資料。`)
      continue
    }
    const seen = new Set<string>()
    list.forEach((rec, i) => {
      const where = `${label}第 ${i + 1} 筆`
      if (!isObj(rec)) return err(`${where}格式不正確。`)
      if (typeof rec.id !== 'string' || !rec.id) return err(`${where}缺少 ID。`)
      if (seen.has(rec.id)) return err(`${where}的 ID 重複了（${rec.id}）。`)
      seen.add(rec.id)
      for (const k of ['createdAt', 'updatedAt']) {
        if (typeof rec[k] !== 'string') return err(`${where}缺少建立或修改時間。`)
      }
      for (const [k, t] of Object.entries(SCHEMA[store])) {
        if (typeof rec[k] !== t) return err(`${where}缺少必要欄位「${FIELD_LABELS[k] ?? k}」或格式不對。`)
      }
      ;(data[store] as unknown[]).push(rec)
    })
  }

  // 子資料必須對應到檔案裡或本機已有的旅行
  const tripIds = new Set([...data.trips.map((t) => t.id), ...localTripIds])
  for (const store of CHILD_STORES) {
    for (const rec of data[store]) {
      if (!tripIds.has(rec.tripId)) err(`${STORE_LABELS[store]}「${recordTitle(store, rec)}」對應不到任何旅行。`)
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    file: {
      app: APP_ID,
      formatVersion: v,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      deviceName: typeof raw.deviceName === 'string' ? raw.deviceName : '',
      data,
    },
  }
}

/** 一筆資料的顯示名稱 */
export function recordTitle(_store: DataStoreName, rec: object): string {
  const r = rec as Record<string, unknown>
  const t = r.name ?? r.title ?? r.flightNumber
  if (typeof t === 'string' && t) return t
  return typeof r.id === 'string' ? r.id.slice(0, 8) : '（未命名）'
}

/** 依固定順序把物件轉成字串，用來比較兩筆資料內容是否完全相同 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** 內容是否相同：只差在「最後修改時間、版本號、修改者」也算相同 */
export function sameContent(a: BaseRecord, b: BaseRecord): boolean {
  const strip = (r: BaseRecord) => {
    const copy: Record<string, unknown> = { ...r }
    for (const k of META_FIELDS) delete copy[k]
    return copy
  }
  return stable(strip(a)) === stable(strip(b))
}

/** 兩筆資料有差異的欄位 */
export function diffFields(a: BaseRecord, b: BaseRecord): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of META_FIELDS) keys.delete(k)
  keys.delete('id')
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  return [...keys].filter((k) => stable(ra[k]) !== stable(rb[k]))
}

export interface Conflict {
  /** store:id，用來記錄使用者的選擇 */
  key: string
  store: DataStoreName
  local: BaseRecord
  incoming: BaseRecord
  fields: string[]
}

export interface MergePlan {
  added: Partial<AppData>
  addedCount: Record<DataStoreName, number>
  sameCount: Record<DataStoreName, number>
  conflicts: Conflict[]
  totals: { added: number; same: number; conflicts: number }
}

function zero(): Record<DataStoreName, number> {
  return Object.fromEntries(DATA_STORES.map((s) => [s, 0])) as Record<DataStoreName, number>
}

/** 比對本機資料與匯入資料，算出要新增、略過及衝突的項目（不寫入） */
export function planMerge(local: AppData, incoming: AppData): MergePlan {
  const added: Partial<AppData> = {}
  const addedCount = zero()
  const sameCount = zero()
  const conflicts: Conflict[] = []
  for (const store of DATA_STORES) {
    const mine = new Map<string, BaseRecord>((local[store] ?? []).map((r) => [r.id, r]))
    const toAdd: BaseRecord[] = []
    for (const rec of (incoming[store] ?? []) as BaseRecord[]) {
      const cur = mine.get(rec.id)
      if (!cur) toAdd.push(rec)
      else if (sameContent(cur, rec)) sameCount[store]++
      else conflicts.push({ key: `${store}:${rec.id}`, store, local: cur, incoming: rec, fields: diffFields(cur, rec) })
    }
    addedCount[store] = toAdd.length
    if (toAdd.length) (added as Record<string, BaseRecord[]>)[store] = toAdd
  }
  const sum = (c: Record<DataStoreName, number>) => Object.values(c).reduce((a, b) => a + b, 0)
  return {
    added,
    addedCount,
    sameCount,
    conflicts,
    totals: { added: sum(addedCount), same: sum(sameCount), conflicts: conflicts.length },
  }
}

export type Choice = 'local' | 'incoming'

/** 依照計畫與使用者的選擇，算出要寫入資料庫的資料 */
export function buildChanges(plan: MergePlan, choices: Record<string, Choice>): Partial<AppData> {
  const changes: Record<string, BaseRecord[]> = {}
  for (const [store, list] of Object.entries(plan.added)) changes[store] = [...(list as BaseRecord[])]
  for (const c of plan.conflicts) {
    const choice = choices[c.key]
    if (!choice) throw new Error('還有衝突沒有選擇要保留哪一份。')
    if (choice === 'incoming') (changes[c.store] ??= []).push(c.incoming)
  }
  return changes as Partial<AppData>
}

export interface MergeResult {
  added: number
  skipped: number
  conflicts: number
  usedIncoming: number
  keptLocal: number
  backupId: string
}

/**
 * 執行安全合併：
 * 1. 先建立本機備份（失敗就停止，不做任何變更）。
 * 2. 重新讀取本機資料並再比對一次，確保預覽之後資料沒有被改過。
 * 3. 全部寫入放在同一個交易：任何一筆失敗，整批都不會寫入。
 */
export async function importMerge(file: ExportFile, choices: Record<string, Choice>): Promise<MergeResult> {
  const backup = await createBackup(`匯入「${file.deviceName || '未命名裝置'}」的檔案前自動備份`)
  const plan = planMerge(await loadAll(), file.data)
  const changes = buildChanges(plan, choices)
  await putMany(changes)
  const usedIncoming = plan.conflicts.filter((c) => choices[c.key] === 'incoming').length
  return {
    added: plan.totals.added,
    skipped: plan.totals.same,
    conflicts: plan.totals.conflicts,
    usedIncoming,
    keptLocal: plan.totals.conflicts - usedIncoming,
    backupId: backup.id,
  }
}
