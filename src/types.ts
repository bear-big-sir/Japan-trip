/**
 * 兔兔家的日本自由行：資料結構
 *
 * 規則（之後的匯入／安全合併都依賴這些規則）：
 * 1. 每一筆資料都有穩定且唯一的 id（UUID），建立後永遠不會改變。
 * 2. 每一筆資料都有 createdAt（建立時間）與 updatedAt（最後修改時間），格式為 ISO 8601 字串。
 * 3. 子資料（航班、住宿、行程、待辦、預算）都用 tripId 指向所屬旅行。
 * 4. 匯出檔案帶有 formatVersion，未來格式升級時可以判斷相容性。
 */

/** 匯出檔案的格式版本。資料結構有不相容的變更時才加 1。 */
export const FORMAT_VERSION = 1

/** 用來辨識「這是本系統匯出的檔案」 */
export const APP_ID = 'usagi-japan-trip'

/** 所有資料共有的欄位 */
export interface BaseRecord {
  id: string
  createdAt: string
  updatedAt: string
}

/** 屬於某一趟旅行的子資料 */
export interface TripChild extends BaseRecord {
  tripId: string
}

/** 旅行 */
export interface Trip extends BaseRecord {
  name: string
  year: number
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  destination: string
  notes: string
}

/** 航班 */
export interface Flight extends TripChild {
  airline: string
  flightNumber: string
  departDateTime: string // YYYY-MM-DDTHH:mm
  departAirport: string
  departTerminal: string
  arriveDateTime: string
  arriveAirport: string
  arriveTerminal: string
  bookingInfo: string
  notes: string
}

/** 飯店住宿（bookingNumber 屬於私人資料） */
export interface Hotel extends TripChild {
  name: string
  address: string
  phone: string
  checkIn: string // YYYY-MM-DD
  checkOut: string
  bookingNumber: string
  roomType: string
  notes: string
}

/** 每日行程中的一筆活動 */
export interface ItineraryItem extends TripChild {
  date: string // YYYY-MM-DD
  time: string // HH:mm
  title: string
  address: string
  transport: string
  duration: string
  foodShopping: string
  notes: string
  /** 同一天內的排列順序，數字小的在前 */
  order: number
}

export type TodoCategory = 'flight' | 'hotel' | 'documents' | 'network' | 'luggage' | 'other'

export const TODO_CATEGORY_LABELS: Record<TodoCategory, string> = {
  flight: '機票確認',
  hotel: '飯店確認',
  documents: '護照及旅行文件',
  network: '網路及交通票券',
  luggage: '行李準備',
  other: '其他',
}

/** 待辦事項 */
export interface TodoItem extends TripChild {
  category: TodoCategory
  title: string
  done: boolean
  notes: string
}

export type BudgetCategory =
  | 'flight'
  | 'hotel'
  | 'transport'
  | 'food'
  | 'shopping'
  | 'tickets'
  | 'other'

export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  flight: '機票',
  hotel: '住宿',
  transport: '交通',
  food: '餐飲',
  shopping: '購物',
  tickets: '門票',
  other: '其他費用',
}

/** 幣別（ISO 4217 代碼，例如 TWD、JPY） */
export type Currency = string

/** 預算／花費 */
export interface BudgetItem extends TripChild {
  category: BudgetCategory
  name: string
  amount: number
  currency: Currency
  date: string // YYYY-MM-DD
  notes: string
}

/** 所有資料表（IndexedDB object store）名稱 */
export type DataStoreName = 'trips' | 'flights' | 'hotels' | 'itinerary' | 'todos' | 'budget'

export const DATA_STORES: DataStoreName[] = [
  'trips',
  'flights',
  'hotels',
  'itinerary',
  'todos',
  'budget',
]

export const CHILD_STORES: Exclude<DataStoreName, 'trips'>[] = [
  'flights',
  'hotels',
  'itinerary',
  'todos',
  'budget',
]

export const STORE_LABELS: Record<DataStoreName, string> = {
  trips: '旅行',
  flights: '航班',
  hotels: '住宿',
  itinerary: '行程',
  todos: '待辦',
  budget: '預算',
}

export interface StoreRecordMap {
  trips: Trip
  flights: Flight
  hotels: Hotel
  itinerary: ItineraryItem
  todos: TodoItem
  budget: BudgetItem
}

/** 全部資料（同時也是匯出檔案中 data 的格式） */
export type AppData = { [K in DataStoreName]: StoreRecordMap[K][] }

/** 匯出的 JSON 檔案格式 */
export interface ExportFile {
  app: typeof APP_ID
  formatVersion: number
  exportedAt: string
  /** 匯出者自填的裝置名稱（例如「兔兔的 iPhone」），方便辨認是誰的檔案 */
  deviceName: string
  data: AppData
}

/** 匯入前自動建立的本機備份 */
export interface LocalBackup {
  id: string
  createdAt: string
  reason: string
  file: ExportFile
}

export function emptyData(): AppData {
  return { trips: [], flights: [], hotels: [], itinerary: [], todos: [], budget: [] }
}
