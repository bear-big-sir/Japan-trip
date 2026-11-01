import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as db from './db'
import * as local from './local'
import { importMerge, planMerge, validateImport } from './merge'
import { ConflictError } from './cloud'

/**
 * 模擬 Supabase（PostgREST）的假資料庫，行為和 supabase/migrations 的觸發器一致：
 * - insert：version 一律設為 1，建立者 = 登入者
 * - update：送來的 version 必須等於目前版本，否則 VERSION_CONFLICT；成功後 version + 1
 * - upsert：和真的資料庫一樣，insert 觸發器會先把 version 改成 1（所以前端不能用 upsert 覆寫）
 * - 刪除旅行會連同子資料一起刪除
 */
const USER = 'user-usagi'
const HOUSEHOLD = 'hh-1'
type Row = Record<string, unknown>

function fakeClient() {
  const tables = new Map<string, Row[]>()
  const audit: Row[] = []
  const t = (name: string) => {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }
  t('household_members').push({ user_id: USER, display_name: '兔兔', email: 'u@example.com' })
  let clock = Date.parse('2026-11-01T00:00:00Z')
  const now = () => new Date((clock += 1000)).toISOString().replace('Z', '+00:00')
  const conflict = { message: 'VERSION_CONFLICT: 這筆資料已被其他人修改', code: 'P0409' }

  function insertRow(table: string, input: Row) {
    if (t(table).some((r) => r.id === input.id)) return { error: { message: 'duplicate key value violates unique constraint' } }
    const row = {
      ...input,
      created_at: input.created_at ?? now(),
      updated_at: now(),
      created_by: USER,
      updated_by: USER,
      version: 1,
    }
    t(table).push(row)
    audit.push({ changed_at: row.updated_at, changed_by: USER })
    return { row }
  }

  function updateRow(table: string, row: Row, patch: Row) {
    if (patch.version !== row.version) return { error: conflict }
    Object.assign(row, patch, { updated_at: now(), updated_by: USER, version: (row.version as number) + 1 })
    audit.push({ changed_at: row.updated_at, changed_by: USER })
    return { row }
  }

  function query(table: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    let payload: Row | Row[] = {}
    const filters: ((r: Row) => boolean)[] = []
    let single: 'single' | 'maybe' | null = null
    let head = false
    let order: [string, boolean] | null = null
    let limit = Infinity

    function run() {
      const rows = t(table)
      if (op === 'insert' || op === 'upsert') {
        const out: Row[] = []
        for (const input of Array.isArray(payload) ? payload : [payload]) {
          const existing = rows.find((r) => r.id === input.id)
          const res =
            op === 'upsert' && existing
              ? updateRow(table, existing, { ...input, version: 1 }) // insert 觸發器先把 version 設成 1
              : insertRow(table, input)
          if (res.error) return { data: null, error: res.error }
          out.push(res.row)
        }
        return finish(out)
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)))
      if (op === 'update') {
        for (const r of matched) {
          const res = updateRow(table, r, payload as Row)
          if (res.error) return { data: null, error: res.error }
        }
        return finish(matched)
      }
      if (op === 'delete') {
        tables.set(table, rows.filter((r) => !matched.includes(r)))
        if (table === 'trips') {
          for (const [name, list] of tables) {
            if (name !== 'trips') tables.set(name, list.filter((r) => !matched.some((m) => m.id === r.trip_id)))
          }
        }
        return { data: null, error: null }
      }
      let list = [...matched]
      if (order) {
        const [col, asc] = order
        list.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
      }
      list = list.slice(0, limit)
      if (head) return { data: null, count: list.length, error: null }
      return finish(list)
    }

    function finish(list: Row[]) {
      const copy = list.map((r) => ({ ...r }))
      if (single === 'single') return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: 'not single' } }
      if (single === 'maybe') return { data: copy[0] ?? null, error: null }
      return { data: copy, error: null }
    }

    const q = {
      select(_cols?: string, opts?: { head?: boolean }) {
        head = Boolean(opts?.head)
        return q
      },
      insert(p: Row | Row[]) {
        op = 'insert'
        payload = p
        return q
      },
      upsert(p: Row | Row[]) {
        op = 'upsert'
        payload = p
        return q
      },
      update(p: Row) {
        op = 'update'
        payload = p
        return q
      },
      delete() {
        op = 'delete'
        return q
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v)
        return q
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]))
        return q
      },
      order(col: string, o?: { ascending?: boolean }) {
        order = [col, o?.ascending ?? true]
        return q
      },
      limit(n: number) {
        limit = n
        return q
      },
      single() {
        single = 'single'
        return q
      },
      maybeSingle() {
        single = 'maybe'
        return q
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return q
  }

  const client = {
    from: (table: string) => (table === 'audit_logs' ? auditQuery() : query(table)),
  }
  function auditQuery() {
    const q = query('__audit')
    tables.set('__audit', audit)
    return q
  }
  return { client: client as unknown as SupabaseClient, tables }
}

const trip = (name: string) => ({
  name, year: 2026, startDate: '2026-11-20', endDate: '2026-11-25', destination: '北陸', notes: '',
})
const flight = (tripId: string) => ({
  tripId, airline: '長榮', flightNumber: 'BR158', departDateTime: '2026-11-20T08:30', departAirport: 'TPE',
  departTerminal: 'T2', arriveDateTime: '2026-11-20T12:45', arriveAirport: 'KMQ', arriveTerminal: '',
  bookingInfo: '', notes: '',
})
const spot = (tripId: string, title: string) => ({
  tripId, date: '2026-11-21', time: '10:00', title, address: '', transport: '', duration: '', foodShopping: '',
  notes: '', order: 0,
})

let fake: ReturnType<typeof fakeClient>

beforeEach(async () => {
  db.setCloudContext(null)
  await local.closeDb()
  indexedDB.deleteDatabase('usagi-japan-trip')
  fake = fakeClient()
})

const goCloud = () => db.setCloudContext({ client: fake.client, householdId: HOUSEHOLD, userId: USER })

describe('雲端資料層', () => {
  it('新增後讀回來的欄位和原本一樣，並帶有版本與建立者', async () => {
    goCloud()
    const t = await db.createRecord('trips', trip('北陸'))
    const f = await db.createRecord('flights', flight(t.id))
    expect(fake.tables.get('flights')![0]).toMatchObject({
      household_id: HOUSEHOLD, trip_id: t.id, flight_number: 'BR158', depart_at: '2026-11-20T08:30',
    })
    const [back] = await db.getByTrip('flights', t.id)
    expect(back).toEqual(f)
    expect(back).toMatchObject({ ...flight(t.id), version: 1, createdBy: USER, updatedBy: USER })
  })

  it('修改會增加版本；用舊版本修改會被擋下（不會覆蓋家人的修改）', async () => {
    goCloud()
    const t = await db.createRecord('trips', trip('北陸'))
    const v2 = await db.updateRecord('trips', { ...t, name: '北陸（兔兔改）' })
    expect(v2.version).toBe(2)
    await expect(db.updateRecord('trips', { ...t, name: '先生用舊畫面改' })).rejects.toBeInstanceOf(ConflictError)
    expect((await db.getById('trips', t.id))?.name).toBe('北陸（兔兔改）')
  })

  it('刪除旅行會一併刪除底下資料', async () => {
    goCloud()
    const t = await db.createRecord('trips', trip('北陸'))
    await db.createRecord('itinerary', spot(t.id, '兼六園'))
    await db.deleteTrip(t.id)
    const all = await db.loadAll()
    expect(all.trips).toHaveLength(0)
    expect(all.itinerary).toHaveLength(0)
  })

  it('統計會顯示筆數與最後更新者', async () => {
    goCloud()
    const t = await db.createRecord('trips', trip('北陸'))
    await db.createRecord('flights', flight(t.id))
    const s = await db.getStats()
    expect(s.cloud).toBe(true)
    expect(s.counts.trips).toBe(1)
    expect(s.counts.flights).toBe(1)
    expect(s.total).toBe(2)
    expect(s.lastModifiedBy).toBe('兔兔')
  })

  it('putMany 可同時新增與覆寫已存在的資料（不會被誤判成版本衝突）', async () => {
    goCloud()
    const t = await db.createRecord('trips', trip('北陸'))
    const v2 = await db.updateRecord('trips', { ...t, notes: '第一次修改' })
    expect(v2.version).toBe(2)
    const newTrip = { ...t, id: 'new-trip-id', name: '九州', version: undefined }
    await db.putMany({ trips: [{ ...v2, version: undefined, notes: '匯入覆寫' }, newTrip] })
    const all = await db.getAll('trips')
    expect(all.map((x) => x.name).sort()).toEqual(['九州', '北陸'])
    expect(all.find((x) => x.id === t.id)).toMatchObject({ notes: '匯入覆寫', version: 3 })
  })
})

describe('把這台裝置的舊資料上傳到雲端', () => {
  it('第一次全部新增；再上傳一次全部判定為相同，不會重複', async () => {
    // 1. 改版前：資料存在本機 IndexedDB
    const t = await db.createRecord('trips', trip('2026日本北陸'))
    await db.createRecord('flights', flight(t.id))
    await db.createRecord('itinerary', spot(t.id, '兼六園'))
    await db.createRecord('itinerary', spot(t.id, '近江町市場'))

    // 2. 登入後：從本機讀出舊資料，匯入雲端
    goCloud()
    const localFile = await db.buildLocalExportFile()
    expect(localFile.data.trips).toHaveLength(1)
    const check = validateImport(JSON.stringify(localFile), [])
    expect(check.ok).toBe(true)
    if (!check.ok) return
    const plan = planMerge(await db.loadAll(), check.file.data)
    expect(plan.totals).toMatchObject({ added: 4, same: 0, conflicts: 0 })
    const result = await importMerge(check.file, {})
    expect(result.added).toBe(4)

    const cloudData = await db.loadAll()
    expect(cloudData.trips[0]).toMatchObject({ id: t.id, name: '2026日本北陸', version: 1 })
    expect(cloudData.flights[0]).toMatchObject(flight(t.id))
    expect(cloudData.itinerary).toHaveLength(2)

    // 3. 不小心再按一次：全部相同，不會新增重複資料
    const again = validateImport(JSON.stringify(localFile), cloudData.trips.map((x) => x.id))
    if (!again.ok) throw new Error(again.errors.join())
    const plan2 = planMerge(cloudData, again.file.data)
    expect(plan2.totals).toMatchObject({ added: 0, same: 4, conflicts: 0 })

    // 4. 本機舊資料仍然保留
    db.setCloudContext(null)
    expect(await db.getAll('trips')).toHaveLength(1)
  })

  it('雲端匯出的 JSON 再匯入雲端：全部相同', async () => {
    goCloud()
    const t = await db.createRecord('trips', trip('北陸'))
    await db.createRecord('flights', flight(t.id))
    await db.updateRecord('trips', { ...t, notes: '改過一次' })
    const file = await db.buildExportFile()
    const r = validateImport(JSON.stringify(file), [t.id])
    if (!r.ok) throw new Error(r.errors.join())
    const plan = planMerge(await db.loadAll(), r.file.data)
    expect(plan.totals).toMatchObject({ added: 0, same: 2, conflicts: 0 })
  })

  it('匯入時選擇「用檔案的內容」會覆寫雲端那一筆', async () => {
    goCloud()
    const t = await db.createRecord('trips', trip('北陸'))
    const file = await db.buildExportFile()
    file.data.trips[0] = { ...file.data.trips[0], notes: '檔案裡的版本', updatedAt: '2027-01-01T00:00:00.000Z' }
    const r = validateImport(JSON.stringify(file), [t.id])
    if (!r.ok) throw new Error(r.errors.join())
    const plan = planMerge(await db.loadAll(), r.file.data)
    expect(plan.totals.conflicts).toBe(1)
    await importMerge(r.file, { [plan.conflicts[0].key]: 'incoming' })
    expect(await db.getById('trips', t.id)).toMatchObject({ notes: '檔案裡的版本', version: 2 })
  })
})
