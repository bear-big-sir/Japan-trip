import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { missingPresets, TODO_PRESETS } from './todoPresets'
import { createRecord, deleteRecord, getByTrip, updateRecord } from '../db/db'

describe('待辦事項', () => {
  it('常見待辦不會重複加入', () => {
    expect(missingPresets([])).toHaveLength(TODO_PRESETS.length)
    const left = missingPresets([{ title: TODO_PRESETS[0].title }, { title: '自己加的' }])
    expect(left).toHaveLength(TODO_PRESETS.length - 1)
    expect(left.some((p) => p.title === TODO_PRESETS[0].title)).toBe(false)
  })

  it('新增、勾選完成、修改、刪除待辦', async () => {
    const trip = await createRecord('trips', {
      name: '待辦測試', year: 2026, startDate: '', endDate: '', destination: '', notes: '',
    })
    const t = await createRecord('todos', { tripId: trip.id, category: 'documents', title: '護照', done: false, notes: '' })
    const checked = await updateRecord('todos', { ...t, done: true })
    expect(checked.done).toBe(true)
    expect(checked.id).toBe(t.id)
    await updateRecord('todos', { ...checked, title: '護照影本', category: 'other' })
    const [saved] = await getByTrip('todos', trip.id)
    expect(saved).toMatchObject({ title: '護照影本', category: 'other', done: true })
    await deleteRecord('todos', t.id)
    expect(await getByTrip('todos', trip.id)).toHaveLength(0)
  })
})
