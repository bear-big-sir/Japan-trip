import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildExportFile,
  closeDb,
  createRecord,
  getAll,
  listBackups,
  loadAll,
  replaceAll,
  updateRecord,
} from './db'
import { importMerge, planMerge, validateImport } from './merge'
import { emptyData, type AppData, type ExportFile } from '../types'

const trip = (name: string) => ({
  name, year: 2026, startDate: '2026-10-01', endDate: '2026-10-05', destination: '北海道', notes: '',
})
const hotel = (tripId: string, name: string) => ({
  tripId, name, address: '', phone: '', checkIn: '2026-10-01', checkOut: '2026-10-02', bookingNumber: '',
  roomType: '', notes: '',
})
const spot = (tripId: string, title: string) => ({
  tripId, date: '2026-10-02', time: '10:00', title, address: '', transport: '', duration: '', foodShopping: '',
  notes: '', order: 0,
})

const json = (f: ExportFile) => JSON.stringify(f)

beforeEach(async () => {
  await replaceAll(emptyData())
})

/** 模擬兩台裝置：兔兔與先生，一開始都有同一趟旅行 */
async function twoDevices() {
  const t = await createRecord('trips', trip('2026 北海道'))
  const shared = await buildExportFile()
  // 兔兔新增北海道飯店
  await createRecord('hotels', hotel(t.id, '札幌飯店'))
  const mine = await buildExportFile()
  // 先生的裝置：從共同資料開始，新增函館景點
  await replaceAll(shared.data)
  await createRecord('itinerary', spot(t.id, '函館山夜景'))
  const his = await buildExportFile()
  // 回到兔兔的裝置
  await replaceAll(mine.data)
  return { t, mine, his }
}

describe('匯入檢查', () => {
  it('不是 JSON', () => {
    const r = validateImport('這不是 JSON')
    expect(r.ok).toBe(false)
  })

  it('不是本系統的檔案', () => {
    expect(validateImport('{"hello":1}').ok).toBe(false)
  })

  it('版本太新', async () => {
    const f = await buildExportFile()
    const r = validateImport(json({ ...f, formatVersion: 99 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('較新版')
  })

  it('版本 1 的舊檔案（沒有旅遊功課）可以匯入', async () => {
    await createRecord('trips', trip('舊旅行'))
    const f = await buildExportFile()
    const old = { ...f, formatVersion: 1, data: { ...f.data } as Partial<AppData> }
    delete old.data.research
    const r = validateImport(JSON.stringify(old))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.data.research).toEqual([])
  })

  it('缺少必要欄位', async () => {
    const t = await createRecord('trips', trip('A'))
    const f = await buildExportFile()
    const broken = { ...t } as Partial<typeof t>
    delete broken.name
    const r = validateImport(json({ ...f, data: { ...f.data, trips: [broken as typeof t] } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('名稱')
  })

  it('檔案內 ID 重複', async () => {
    const t = await createRecord('trips', trip('A'))
    const f = await buildExportFile()
    const r = validateImport(json({ ...f, data: { ...f.data, trips: [t, { ...t, name: 'B' }] } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('重複')
  })

  it('子資料對應不到旅行', async () => {
    const f = await buildExportFile()
    const h = { ...hotel('不存在的旅行', '孤兒飯店'), id: 'h1', createdAt: 'x', updatedAt: 'x' }
    const r = validateImport(json({ ...f, data: { ...f.data, hotels: [h] } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('對應不到')
    // 若旅行已在本機，就可以
    expect(validateImport(json({ ...f, data: { ...f.data, hotels: [h] } }), ['不存在的旅行']).ok).toBe(true)
  })
})

describe('安全合併', () => {
  it('兩人各自新增的資料都會保留，不互相覆蓋', async () => {
    const { his } = await twoDevices()
    const r = validateImport(json(his))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const plan = planMerge(await loadAll(), r.file.data)
    expect(plan.totals).toEqual({ added: 1, same: 1, conflicts: 0 })
    const result = await importMerge(r.file, {})
    expect(result).toMatchObject({ added: 1, skipped: 1, conflicts: 0 })
    expect((await getAll('hotels')).map((h) => h.name)).toEqual(['札幌飯店'])
    expect((await getAll('itinerary')).map((i) => i.title)).toEqual(['函館山夜景'])
  })

  it('相同 ID、相同內容不會重複', async () => {
    await createRecord('trips', trip('A'))
    const f = await buildExportFile()
    const result = await importMerge(f, {})
    expect(result).toMatchObject({ added: 0, skipped: 1, conflicts: 0 })
    expect(await getAll('trips')).toHaveLength(1)
  })

  it('同一個檔案匯入兩次，第二次全部略過', async () => {
    const { his } = await twoDevices()
    await importMerge(his, {})
    const again = await importMerge(his, {})
    expect(again).toMatchObject({ added: 0, conflicts: 0 })
    expect(await getAll('itinerary')).toHaveLength(1)
  })

  it('相同 ID、不同內容會列為衝突，選擇前不會覆蓋', async () => {
    const t = await createRecord('trips', trip('北海道'))
    const other = { ...t, name: '北海道（先生改的）', updatedAt: '2030-01-01T00:00:00.000Z' }
    await updateRecord('trips', { ...t, notes: '兔兔加的備註' })
    const f = await buildExportFile()
    const incoming = { ...f, data: { ...f.data, trips: [other] } }
    const plan = planMerge(await loadAll(), incoming.data)
    expect(plan.totals.conflicts).toBe(1)
    expect(plan.conflicts[0].fields.sort()).toEqual(['name', 'notes'])
    // 沒有選擇就執行 → 失敗，資料不變
    await expect(importMerge(incoming, {})).rejects.toThrow()
    expect((await getAll('trips'))[0].notes).toBe('兔兔加的備註')
  })

  it('衝突選「保留我的」與「用對方的」', async () => {
    const t = await createRecord('trips', trip('北海道'))
    const f = await buildExportFile()
    const incoming = { ...f, data: { ...f.data, trips: [{ ...t, name: '對方的名字' }] } }
    const key = `trips:${t.id}`
    const kept = await importMerge(incoming, { [key]: 'local' })
    expect(kept).toMatchObject({ keptLocal: 1, usedIncoming: 0 })
    expect((await getAll('trips'))[0].name).toBe('北海道')
    const used = await importMerge(incoming, { [key]: 'incoming' })
    expect(used).toMatchObject({ keptLocal: 0, usedIncoming: 1 })
    expect((await getAll('trips'))[0].name).toBe('對方的名字')
  })

  it('匯入前自動建立本機備份', async () => {
    const before = (await listBackups()).length
    const { his } = await twoDevices()
    await importMerge(his, {})
    const backups = await listBackups()
    expect(backups.length).toBeGreaterThan(before)
    expect(backups[0].reason).toContain('匯入')
    // 備份是合併前的資料：只有飯店、沒有函館景點
    expect(backups[0].file.data.itinerary).toHaveLength(0)
    expect(backups[0].file.data.hotels).toHaveLength(1)
  })

  it('錯誤的檔案不會破壞現有資料', async () => {
    await createRecord('trips', trip('重要的旅行'))
    const before = await loadAll()
    for (const bad of ['', '{', '[]', '{"app":"usagi-japan-trip","formatVersion":2,"data":{"trips":"壞掉"}}']) {
      expect(validateImport(bad).ok).toBe(false)
    }
    expect(await loadAll()).toEqual(before)
  })

  it('合併結果在關閉並重新開啟後仍存在', async () => {
    const { his } = await twoDevices()
    await importMerge(his, {})
    await closeDb()
    expect(await getAll('itinerary')).toHaveLength(1)
    expect(await getAll('hotels')).toHaveLength(1)
  })
})
