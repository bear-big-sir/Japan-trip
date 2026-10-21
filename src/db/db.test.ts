import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  buildExportFile,
  closeDb,
  createBackup,
  createRecord,
  deleteTrip,
  getAll,
  getByTrip,
  getStats,
  listBackups,
  replaceAll,
  restoreBackup,
  updateRecord,
} from './db'
import { FORMAT_VERSION, type AppData } from '../types'

const tripFields = {
  name: '2026 北海道',
  year: 2026,
  startDate: '2026-10-01',
  endDate: '2026-10-07',
  destination: '札幌',
  notes: '',
}

describe('IndexedDB 儲存層', () => {
  it('新增旅行會產生唯一 ID 與時間', async () => {
    const a = await createRecord('trips', tripFields)
    const b = await createRecord('trips', tripFields)
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.createdAt).toBe(a.updatedAt)
  })

  it('修改旅行保留建立時間、更新修改時間', async () => {
    const t = await createRecord('trips', tripFields)
    await new Promise((r) => setTimeout(r, 5))
    const u = await updateRecord('trips', { ...t, name: '改名', createdAt: 'x' })
    expect(u.name).toBe('改名')
    expect(u.createdAt).toBe(t.createdAt)
    expect(u.updatedAt > t.updatedAt).toBe(true)
  })

  it('關閉資料庫再重新開啟，資料仍存在', async () => {
    const t = await createRecord('trips', { ...tripFields, name: '持久化測試' })
    await closeDb()
    const all = await getAll('trips')
    expect(all.find((x) => x.id === t.id)?.name).toBe('持久化測試')
  })

  it('刪除旅行會一併刪除子資料，其他旅行不受影響', async () => {
    const t1 = await createRecord('trips', tripFields)
    const t2 = await createRecord('trips', tripFields)
    const base = { notes: '', foodShopping: '', address: '', transport: '', duration: '', time: '09:00', date: '2026-10-02', order: 0 }
    await createRecord('itinerary', { ...base, tripId: t1.id, title: '函館山' })
    await createRecord('itinerary', { ...base, tripId: t2.id, title: '小樽' })
    await deleteTrip(t1.id)
    expect(await getByTrip('itinerary', t1.id)).toHaveLength(0)
    expect(await getByTrip('itinerary', t2.id)).toHaveLength(1)
  })

  it('匯出檔案包含格式版本與全部資料表', async () => {
    const f = await buildExportFile()
    expect(f.formatVersion).toBe(FORMAT_VERSION)
    expect(Object.keys(f.data).sort()).toEqual(
      ['budget', 'flights', 'hotels', 'itinerary', 'todos', 'trips'],
    )
    const stats = await getStats()
    expect(stats.counts.trips).toBe(f.data.trips.length)
    expect(stats.lastModified).toBeTruthy()
  })

  it('整批取代失敗時，原有資料完整保留', async () => {
    const before = await buildExportFile()
    const bad = {
      ...before.data,
      trips: [...before.data.trips, { name: '沒有 id 的壞資料' }],
    } as unknown as AppData
    await expect(replaceAll(bad)).rejects.toBeTruthy()
    const after = await buildExportFile()
    expect(after.data).toEqual(before.data)
  })

  it('備份後可以還原', async () => {
    const before = await buildExportFile()
    const b = await createBackup('測試')
    await createRecord('trips', { ...tripFields, name: '備份後新增' })
    await restoreBackup(b.id)
    const after = await buildExportFile()
    expect(after.data).toEqual(before.data)
    expect((await listBackups()).length).toBeGreaterThanOrEqual(2)
  })
})
