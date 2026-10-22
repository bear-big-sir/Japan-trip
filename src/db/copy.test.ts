import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createRecord, getAll, getByTrip, loadAll } from './db'
import { copyDay, copyTripAsTemplate, saveDayOrder, sortDay } from './copy'
import { addDays, dateRange, diffDays, shiftDate } from '../lib/date'

const blankItem = { address: '', transport: '', duration: '', foodShopping: '', notes: '', time: '' }

async function setup() {
  const trip = await createRecord('trips', {
    name: '2025 北海道', year: 2025, startDate: '2025-10-01', endDate: '2025-10-03', destination: '函館', notes: '',
  })
  const a = await createRecord('itinerary', { ...blankItem, tripId: trip.id, date: '2025-10-01', title: '函館山', order: 0 })
  const b = await createRecord('itinerary', { ...blankItem, tripId: trip.id, date: '2025-10-01', title: '金森倉庫', order: 1 })
  await createRecord('hotels', {
    tripId: trip.id, name: '函館飯店', address: '', phone: '', checkIn: '2025-10-01', checkOut: '2025-10-03',
    bookingNumber: 'SECRET-123', roomType: '', notes: '',
  })
  await createRecord('flights', {
    tripId: trip.id, airline: '長榮', flightNumber: 'BR116', departDateTime: '2025-10-01T08:30', departAirport: 'TPE',
    departTerminal: '', arriveDateTime: '2025-10-01T13:00', arriveAirport: 'CTS', arriveTerminal: '', bookingInfo: 'PNR-XYZ', notes: '',
  })
  await createRecord('todos', { tripId: trip.id, category: 'documents', title: '護照', done: true, notes: '' })
  return { trip, a, b }
}

describe('日期工具', () => {
  it('跨月計算正確', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(diffDays('2026-02-27', '2026-03-02')).toBe(3)
    expect(dateRange('2026-10-01', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(shiftDate('2025-10-01T08:30', 365)).toBe('2026-10-01T08:30')
    expect(shiftDate('', 10)).toBe('')
  })
})

describe('複製功能（不得改動原資料）', () => {
  it('複製某一天：產生新 ID，接在目標日期後面，原資料不變', async () => {
    const { trip } = await setup()
    const before = JSON.stringify(await getByTrip('itinerary', trip.id))
    await createRecord('itinerary', { ...blankItem, tripId: trip.id, date: '2025-10-02', title: '五稜郭', order: 0 })
    const n = await copyDay(trip.id, '2025-10-01', trip.id, '2025-10-02')
    expect(n).toBe(2)
    const all = await getByTrip('itinerary', trip.id)
    const day2 = sortDay(all.filter((i) => i.date === '2025-10-02'))
    expect(day2.map((i) => i.title)).toEqual(['五稜郭', '函館山', '金森倉庫'])
    const day1 = all.filter((i) => i.date === '2025-10-01')
    expect(JSON.stringify(sortDay(day1))).toBe(JSON.stringify(sortDay(JSON.parse(before))))
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length)
  })

  it('調整順序', async () => {
    const { a, b } = await setup()
    await saveDayOrder([b, a])
    const items = sortDay(await getByTrip('itinerary', a.tripId))
    expect(items.map((i) => i.title)).toEqual(['金森倉庫', '函館山'])
  })

  it('複製旅行為範本：日期平移、不含私人資料、原旅行不變', async () => {
    const { trip } = await setup()
    const snapshot = JSON.stringify(await loadAll())
    const t = await copyTripAsTemplate(trip.id, {
      name: '2026 北海道', startDate: '2026-10-10', itinerary: true, hotels: true, flights: true, todos: true,
    })
    expect(t.id).not.toBe(trip.id)
    expect(t.year).toBe(2026)
    expect(t.endDate).toBe('2026-10-12')
    const it = await getByTrip('itinerary', t.id)
    expect(it.map((i) => i.date)).toEqual(['2026-10-10', '2026-10-10'])
    const [h] = await getByTrip('hotels', t.id)
    expect(h.checkOut).toBe('2026-10-12')
    expect(h.bookingNumber).toBe('')
    const [f] = await getByTrip('flights', t.id)
    expect(f.departDateTime).toBe('2026-10-10T08:30')
    expect(f.bookingInfo).toBe('')
    const [todo] = await getByTrip('todos', t.id)
    expect(todo.done).toBe(false)
    // 原本的資料一筆都沒變
    const after = await loadAll()
    const original = JSON.parse(snapshot)
    for (const store of Object.keys(original) as (keyof typeof original)[]) {
      for (const rec of original[store]) {
        expect((after[store] as { id: string }[]).find((r) => r.id === rec.id)).toEqual(rec)
      }
    }
    expect((await getAll('trips')).length).toBe(original.trips.length + 1)
  })
})
