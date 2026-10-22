import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { convertTotal, formatMoney, parseAmount, summarize } from './budget'
import { createRecord, deleteRecord, getByTrip, updateRecord } from '../db/db'
import type { BudgetItem } from '../types'

let n = 0
function item(category: BudgetItem['category'], amount: number, currency: string): BudgetItem {
  n++
  return {
    id: `b${n}`, tripId: 't', createdAt: '', updatedAt: '', name: `項目${n}`, date: '', notes: '',
    category, amount, currency,
  }
}

describe('預算計算', () => {
  it('依分類與幣別計算小計及總額', () => {
    const s = summarize([
      item('food', 1200, 'JPY'),
      item('food', 800, 'JPY'),
      item('transport', 3000, 'JPY'),
      item('flight', 15000, 'TWD'),
    ])
    expect(s.byCategory.food).toEqual({ JPY: 2000 })
    expect(s.byCategory.transport).toEqual({ JPY: 3000 })
    expect(s.byCategory.flight).toEqual({ TWD: 15000 })
    expect(s.byCategory.hotel).toBeUndefined()
    expect(s.total).toEqual({ JPY: 5000, TWD: 15000 })
    expect(s.currencies).toEqual(['JPY', 'TWD'])
  })

  it('同一分類有兩種幣別時，分開計算不相加', () => {
    const s = summarize([item('shopping', 5000, 'JPY'), item('shopping', 300, 'TWD')])
    expect(s.byCategory.shopping).toEqual({ JPY: 5000, TWD: 300 })
  })

  it('小數相加不會出現浮點誤差', () => {
    const s = summarize([item('other', 0.1, 'USD'), item('other', 0.2, 'USD')])
    expect(s.total.USD).toBe(0.3)
  })

  it('沒有匯率時不換算合計', () => {
    const r = convertTotal({ JPY: 5000, TWD: 15000 }, { base: 'TWD', rates: {} })
    expect(r.value).toBeNull()
    expect(r.missing).toEqual(['JPY'])
  })

  it('有匯率時才換算成同一幣別合計', () => {
    const r = convertTotal({ JPY: 10000, TWD: 15000 }, { base: 'TWD', rates: { JPY: 0.21 } })
    expect(r).toEqual({ value: 17100, missing: [] })
  })

  it('只缺部分匯率時仍然不顯示合計', () => {
    const r = convertTotal({ JPY: 10000, USD: 10, TWD: 1 }, { base: 'TWD', rates: { JPY: 0.21 } })
    expect(r.value).toBeNull()
    expect(r.missing).toEqual(['USD'])
  })

  it('匯率為 0 或負數視為沒有提供', () => {
    expect(convertTotal({ JPY: 100 }, { base: 'TWD', rates: { JPY: 0 } }).value).toBeNull()
    expect(convertTotal({ JPY: 100 }, { base: 'TWD', rates: { JPY: -1 } }).value).toBeNull()
  })

  it('金額輸入檢查', () => {
    expect(parseAmount('1200')).toBe(1200)
    expect(parseAmount('1,200')).toBe(1200)
    expect(parseAmount(' 12.5 ')).toBe(12.5)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('-5')).toBeNull()
    expect(parseAmount('1.2.3')).toBeNull()
  })

  it('金額格式化', () => {
    expect(formatMoney(12000, 'JPY')).toBe('JPY 12,000')
    expect(formatMoney(12.5, 'USD')).toBe('USD 12.5')
  })
})

describe('預算資料保存', () => {
  it('新增、修改、刪除預算', async () => {
    const trip = await createRecord('trips', {
      name: '預算測試', year: 2026, startDate: '', endDate: '', destination: '', notes: '',
    })
    const b = await createRecord('budget', {
      tripId: trip.id, category: 'food', name: '拉麵', amount: 1200, currency: 'JPY', date: '2026-10-01', notes: '',
    })
    await updateRecord('budget', { ...b, amount: 1500 })
    expect((await getByTrip('budget', trip.id))[0].amount).toBe(1500)
    await deleteRecord('budget', b.id)
    expect(await getByTrip('budget', trip.id)).toHaveLength(0)
  })
})
