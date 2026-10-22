import { BUDGET_CATEGORY_LABELS, type BudgetCategory, type BudgetItem } from '../types'

/** 常用幣別（表單下拉選單用） */
export const CURRENCIES: { code: string; label: string }[] = [
  { code: 'JPY', label: 'JPY 日圓' },
  { code: 'TWD', label: 'TWD 新台幣' },
  { code: 'USD', label: 'USD 美元' },
  { code: 'HKD', label: 'HKD 港幣' },
  { code: 'KRW', label: 'KRW 韓圓' },
  { code: 'CNY', label: 'CNY 人民幣' },
  { code: 'EUR', label: 'EUR 歐元' },
]

export const BUDGET_CATEGORIES = Object.keys(BUDGET_CATEGORY_LABELS) as BudgetCategory[]

/** 各幣別的金額，例如 { JPY: 32000, TWD: 15000 } */
export type CurrencyAmounts = Record<string, number>

/** 避免 0.1 + 0.2 = 0.30000000000000004 這類小數誤差 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function add(target: CurrencyAmounts, currency: string, amount: number) {
  target[currency] = round2((target[currency] ?? 0) + amount)
}

export interface BudgetSummary {
  /** 各分類、各幣別的小計（沒有資料的分類不會出現） */
  byCategory: Partial<Record<BudgetCategory, CurrencyAmounts>>
  /** 各幣別的總額：不同幣別分開計算，絕不直接相加 */
  total: CurrencyAmounts
  /** 出現過的幣別，依字母排序 */
  currencies: string[]
}

export function summarize(items: BudgetItem[]): BudgetSummary {
  const byCategory: BudgetSummary['byCategory'] = {}
  const total: CurrencyAmounts = {}
  for (const it of items) {
    if (!Number.isFinite(it.amount)) continue
    const cat = (byCategory[it.category] ??= {})
    add(cat, it.currency, it.amount)
    add(total, it.currency, it.amount)
  }
  return { byCategory, total, currencies: Object.keys(total).sort() }
}

/** 使用者自己輸入的匯率：rates[X] = 1 單位 X 等於多少 base */
export interface ExchangeRates {
  base: string
  rates: Record<string, number>
}

export interface Converted {
  /** 換算成 base 後的合計；有幣別缺匯率時為 null，不顯示錯誤的總額 */
  value: number | null
  /** 缺少匯率的幣別 */
  missing: string[]
}

/**
 * 把多種幣別換算成同一種幣別。
 * 只有「每一種幣別都有使用者提供的匯率」時才相加；否則回傳 value = null。
 */
export function convertTotal(amounts: CurrencyAmounts, rates: ExchangeRates): Converted {
  let sum = 0
  const missing: string[] = []
  for (const [cur, amount] of Object.entries(amounts)) {
    if (cur === rates.base) {
      sum += amount
      continue
    }
    const r = rates.rates[cur]
    if (typeof r === 'number' && Number.isFinite(r) && r > 0) sum += amount * r
    else missing.push(cur)
  }
  return missing.length ? { value: null, missing: missing.sort() } : { value: round2(sum), missing: [] }
}

/** 把表單輸入的金額轉成數字；不合法回傳 null。可接受「1,200」這種寫法 */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[,，\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** 依幣別格式化：日圓、韓圓、新台幣通常不顯示小數 */
export function formatMoney(amount: number, currency: string): string {
  const noDecimals = ['JPY', 'KRW', 'TWD'].includes(currency)
  const n = amount.toLocaleString('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: noDecimals && Number.isInteger(amount) ? 0 : 2,
  })
  return `${currency} ${n}`
}
