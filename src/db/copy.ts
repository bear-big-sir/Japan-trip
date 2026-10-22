/**
 * 複製功能：一律產生「新的 ID」的新資料，原本的資料完全不會被修改或刪除。
 */
import type { AppData, Flight, Hotel, ItineraryItem, ResearchNote, TodoItem, Trip } from '../types'
import { newId, nowIso } from '../lib/id'
import { diffDays, isDate, shiftDate } from '../lib/date'
import { getById, getByTrip, putMany } from './db'

function fresh<T extends { id: string; createdAt: string; updatedAt: string }>(rec: T, now: string): T {
  return { ...rec, id: newId(), createdAt: now, updatedAt: now }
}

/** 同一天內的行程，依 order 排序 */
export function sortDay(items: ItineraryItem[]): ItineraryItem[] {
  return [...items].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
}

/** 某一天的下一個 order 值 */
export function nextOrder(items: ItineraryItem[], date: string): number {
  const sameDay = items.filter((i) => i.date === date)
  return sameDay.length ? Math.max(...sameDay.map((i) => i.order)) + 1 : 0
}

/**
 * 把 fromTripId 某一天的行程複製到 toTripId 的 toDate（可以是同一趟或另一趟旅行）。
 * 複製出來的行程接在目標日期原有行程的後面。回傳複製的筆數。
 */
export async function copyDay(
  fromTripId: string,
  fromDate: string,
  toTripId: string,
  toDate: string,
): Promise<number> {
  const source = sortDay((await getByTrip('itinerary', fromTripId)).filter((i) => i.date === fromDate))
  if (source.length === 0) return 0
  const target = await getByTrip('itinerary', toTripId)
  let order = nextOrder(target, toDate)
  const now = nowIso()
  const copies = source.map((i) => ({ ...fresh(i, now), tripId: toTripId, date: toDate, order: order++ }))
  await putMany({ itinerary: copies })
  return copies.length
}

/** 重新排列某一天的行程：只更新 order 有變動的資料 */
export async function saveDayOrder(ordered: ItineraryItem[]) {
  const now = nowIso()
  const changed = ordered
    .map((item, idx) => (item.order === idx ? null : { ...item, order: idx, updatedAt: now }))
    .filter((x): x is ItineraryItem => x !== null)
  await putMany({ itinerary: changed })
}

export interface TemplateOptions {
  name: string
  startDate: string
  itinerary: boolean
  hotels: boolean
  flights: boolean
  todos: boolean
  /** 舊的呼叫端沒有這個選項時視為不複製 */
  research?: boolean
}

/**
 * 以過去的旅行為範本建立新旅行。
 * - 所有日期依新的出發日期平移。
 * - 不複製訂房編號、航班訂位資訊等私人資料；待辦一律改回「未完成」；不複製預算。
 * - 原旅行及其資料完全不變。
 */
export async function copyTripAsTemplate(sourceId: string, opt: TemplateOptions): Promise<Trip> {
  const src = await getById('trips', sourceId)
  if (!src) throw new Error('找不到原本的旅行。')
  const shift = isDate(src.startDate) && isDate(opt.startDate) ? diffDays(src.startDate, opt.startDate) : 0
  const now = nowIso()
  const startDate = opt.startDate || src.startDate
  const trip: Trip = {
    ...fresh(src, now),
    name: opt.name,
    startDate,
    endDate: shiftDate(src.endDate, shift),
    year: isDate(startDate) ? Number(startDate.slice(0, 4)) : src.year,
  }
  const changes: Partial<AppData> = { trips: [trip] }

  if (opt.itinerary) {
    changes.itinerary = (await getByTrip('itinerary', sourceId)).map(
      (i): ItineraryItem => ({ ...fresh(i, now), tripId: trip.id, date: shiftDate(i.date, shift) }),
    )
  }
  if (opt.hotels) {
    changes.hotels = (await getByTrip('hotels', sourceId)).map(
      (h): Hotel => ({
        ...fresh(h, now),
        tripId: trip.id,
        checkIn: shiftDate(h.checkIn, shift),
        checkOut: shiftDate(h.checkOut, shift),
        bookingNumber: '',
      }),
    )
  }
  if (opt.flights) {
    changes.flights = (await getByTrip('flights', sourceId)).map(
      (f): Flight => ({
        ...fresh(f, now),
        tripId: trip.id,
        departDateTime: shiftDate(f.departDateTime, shift),
        arriveDateTime: shiftDate(f.arriveDateTime, shift),
        bookingInfo: '',
      }),
    )
  }
  if (opt.todos) {
    changes.todos = (await getByTrip('todos', sourceId)).map(
      (t): TodoItem => ({ ...fresh(t, now), tripId: trip.id, done: false }),
    )
  }
  if (opt.research) {
    changes.research = (await getByTrip('research', sourceId)).map(
      (r): ResearchNote => ({ ...fresh(r, now), tripId: trip.id }),
    )
  }
  await putMany(changes)
  return trip
}
