/** 日期工具（全部使用 YYYY-MM-DD 字串，以 UTC 計算避免時區造成差一天） */

const DAY = 86400000

function parse(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isDate(d: string | undefined): d is string {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)
}

export function addDays(d: string, n: number): string {
  return format(parse(d) + n * DAY)
}

/** b 比 a 晚幾天 */
export function diffDays(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / DAY)
}

/** 從 start 到 end（含）的每一天；最多 60 天 */
export function dateRange(start: string, end: string): string[] {
  if (!isDate(start) || !isDate(end) || end < start) return []
  const n = Math.min(diffDays(start, end), 59)
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i))
}

/**
 * 把 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm 的日期部分平移 n 天，時間不變。
 * 空字串維持空字串。
 */
export function shiftDate(value: string, n: number): string {
  if (!value || n === 0) return value
  const datePart = value.slice(0, 10)
  if (!isDate(datePart)) return value
  return addDays(datePart, n) + value.slice(10)
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 10/22（四） */
export function formatDay(d: string): string {
  if (!isDate(d)) return d || '未定日期'
  const w = new Date(parse(d)).getUTCDay()
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WEEKDAYS[w]}）`
}

/** 2026-10-22T09:30 → 10/22（四）09:30 */
export function formatLocalDateTime(v: string): string {
  if (!v) return '未定'
  const t = v.slice(11, 16)
  return `${formatDay(v.slice(0, 10))}${t ? ' ' + t : ''}`
}
