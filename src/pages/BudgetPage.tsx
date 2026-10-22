import { useEffect, useState } from 'react'
import { BUDGET_CATEGORY_LABELS, type BudgetCategory, type BudgetItem, type Trip } from '../types'
import { createRecord, deleteRecord, getMeta, setMeta, updateRecord } from '../db/db'
import { useTripRecords } from '../lib/useTripRecords'
import { formatDay } from '../lib/date'
import {
  BUDGET_CATEGORIES,
  CURRENCIES,
  convertTotal,
  formatMoney,
  parseAmount,
  summarize,
  type ExchangeRates,
} from '../lib/budget'
import { RecordForm, toValues, type FieldDef } from '../components/RecordForm'
import { ConfirmDialog } from '../components/Modal'

const CATEGORY_ICONS: Record<BudgetCategory, string> = {
  flight: '✈️',
  hotel: '🏨',
  transport: '🚃',
  food: '🍜',
  shopping: '🛍',
  tickets: '🎫',
  other: '📦',
}

function currencyOptions(extra?: string) {
  const list = CURRENCIES.map((c) => ({ value: c.code, label: c.label }))
  if (extra && !list.some((o) => o.value === extra)) list.push({ value: extra, label: extra })
  return list
}

function fieldsFor(extraCurrency?: string): FieldDef[] {
  return [
    {
      key: 'category',
      label: '分類',
      type: 'select',
      options: BUDGET_CATEGORIES.map((c) => ({ value: c, label: BUDGET_CATEGORY_LABELS[c] })),
    },
    { key: 'name', label: '名稱', required: true, placeholder: '例如：一蘭拉麵、Suica 儲值' },
    { key: 'amount', label: '金額', required: true, half: true, placeholder: '例如：1200' },
    { key: 'currency', label: '幣別', type: 'select', half: true, options: currencyOptions(extraCurrency) },
    { key: 'date', label: '日期', type: 'date' },
    { key: 'notes', label: '備註', type: 'textarea', placeholder: '付款方式、誰付的…' },
  ]
}
const KEYS = ['category', 'name', 'amount', 'currency', 'date', 'notes']

const ratesKey = (tripId: string) => `budgetRates:${tripId}`

export function BudgetPage({ trip, onChanged }: { trip: Trip; onChanged: () => Promise<void> }) {
  const [items, reload] = useTripRecords('budget', trip.id)
  const [editing, setEditing] = useState<BudgetItem | 'new' | null>(null)
  const [deleting, setDeleting] = useState<BudgetItem | null>(null)
  const [filter, setFilter] = useState<BudgetCategory | 'all'>('all')
  const [rates, setRates] = useState<ExchangeRates>({ base: 'TWD', rates: {} })

  useEffect(() => {
    let alive = true
    getMeta<ExchangeRates>(ratesKey(trip.id)).then((r) => {
      if (alive && r) setRates(r)
    })
    return () => {
      alive = false
    }
  }, [trip.id])

  const summary = summarize(items)
  const converted = convertTotal(summary.total, rates)
  const lastCurrency =
    [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.currency ?? 'JPY'
  const shown = [...items]
    .filter((i) => filter === 'all' || i.category === filter)
    .sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || a.createdAt.localeCompare(b.createdAt))

  async function refresh() {
    await Promise.all([reload(), onChanged()])
  }

  async function save(v: Record<string, string>) {
    const fields = {
      category: (BUDGET_CATEGORIES.includes(v.category as BudgetCategory) ? v.category : 'other') as BudgetCategory,
      name: v.name.trim(),
      amount: parseAmount(v.amount) ?? 0,
      currency: v.currency.trim().toUpperCase(),
      date: v.date,
      notes: v.notes.trim(),
    }
    if (editing === 'new') await createRecord('budget', { ...fields, tripId: trip.id })
    else if (editing) await updateRecord('budget', { ...editing, ...fields })
    setEditing(null)
    await refresh()
  }

  async function remove() {
    if (!deleting) return
    await deleteRecord('budget', deleting.id)
    setDeleting(null)
    await refresh()
  }

  async function saveRates(next: ExchangeRates) {
    setRates(next)
    await setMeta(ratesKey(trip.id), next)
  }

  const editingCurrency = editing && editing !== 'new' ? editing.currency : undefined

  return (
    <section>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          ＋ 新增花費
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty">這趟旅行還沒有預算或花費紀錄。</div>
      ) : (
        <div className="card">
          <h3>分類小計與總額</h3>
          <div className="table-wrap">
            <table className="budget-table">
              <thead>
                <tr>
                  <th>分類</th>
                  {summary.currencies.map((c) => (
                    <th key={c} className="num">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BUDGET_CATEGORIES.filter((c) => summary.byCategory[c]).map((c) => (
                  <tr key={c}>
                    <td>
                      {CATEGORY_ICONS[c]} {BUDGET_CATEGORY_LABELS[c]}
                    </td>
                    {summary.currencies.map((cur) => (
                      <td key={cur} className="num">
                        {summary.byCategory[c]?.[cur] !== undefined
                          ? formatMoney(summary.byCategory[c]![cur], cur).replace(`${cur} `, '')
                          : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>總額</th>
                  {summary.currencies.map((cur) => (
                    <th key={cur} className="num">
                      {formatMoney(summary.total[cur], cur)}
                    </th>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          {summary.currencies.length > 1 && (
            <p className="muted small">
              ⚠️ 不同幣別分開計算，不會直接相加。若想看合計，請在下方「匯率換算」填入匯率。
            </p>
          )}
        </div>
      )}

      {summary.currencies.some((c) => c !== rates.base) && (
        <RatesCard
          currencies={summary.currencies}
          rates={rates}
          onSave={saveRates}
          convertedValue={converted.value}
          missing={converted.missing}
        />
      )}

      {items.length > 0 && (
        <>
          <div className="filter-chips" role="group" aria-label="依分類篩選">
            <button className={'chip' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>
              全部（{items.length}）
            </button>
            {BUDGET_CATEGORIES.filter((c) => summary.byCategory[c]).map((c) => (
              <button
                key={c}
                className={'chip' + (filter === c ? ' active' : '')}
                onClick={() => setFilter(c)}
              >
                {CATEGORY_ICONS[c]} {BUDGET_CATEGORY_LABELS[c]}（{items.filter((i) => i.category === c).length}）
              </button>
            ))}
          </div>
          {shown.map((i) => (
            <article key={i.id} className="card budget-item">
              <div className="budget-row">
                <div className="budget-name">
                  {CATEGORY_ICONS[i.category]} {i.name}
                </div>
                <div className="budget-amount">{formatMoney(i.amount, i.currency)}</div>
              </div>
              <div className="item-line muted">
                {BUDGET_CATEGORY_LABELS[i.category]}・{i.date ? formatDay(i.date) : '未定日期'}
              </div>
              {i.notes && <div className="item-line muted pre">{i.notes}</div>}
              <div className="card-actions">
                <button className="btn btn-small" onClick={() => setEditing(i)}>
                  修改
                </button>
                <button className="btn btn-small btn-danger-outline" onClick={() => setDeleting(i)}>
                  刪除
                </button>
              </div>
            </article>
          ))}
        </>
      )}

      {editing && (
        <RecordForm
          title={editing === 'new' ? '新增花費' : '修改花費'}
          fields={fieldsFor(editingCurrency)}
          initial={
            editing === 'new'
              ? {
                  category: filter === 'all' ? 'food' : filter,
                  name: '',
                  amount: '',
                  currency: lastCurrency,
                  date: trip.startDate,
                  notes: '',
                }
              : toValues(editing, KEYS)
          }
          validate={(v) => {
            const n = parseAmount(v.amount)
            if (n === null) return '金額請輸入數字，例如 1200 或 12.5。'
            return undefined
          }}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="確定要刪除這筆花費？"
          danger
          confirmLabel="確定刪除"
          message={
            <p>
              將刪除「{deleting.name}」（{formatMoney(deleting.amount, deleting.currency)}），刪除後無法復原。
            </p>
          }
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

interface RatesProps {
  currencies: string[]
  rates: ExchangeRates
  onSave: (r: ExchangeRates) => Promise<void>
  convertedValue: number | null
  missing: string[]
}

/** 使用者自行輸入匯率後，才把不同幣別換算成同一幣別合計 */
function RatesCard({ currencies, rates, onSave, convertedValue, missing }: RatesProps) {
  const [open, setOpen] = useState(false)
  const [base, setBase] = useState(rates.base)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  function startEdit() {
    setBase(rates.base)
    setDraft(Object.fromEntries(Object.entries(rates.rates).map(([k, v]) => [k, String(v)])))
    setError('')
    setOpen(true)
  }

  async function submit() {
    const next: Record<string, number> = {}
    for (const c of currencies) {
      if (c === base) continue
      const s = (draft[c] ?? '').trim()
      if (!s) continue
      const n = Number(s)
      if (!Number.isFinite(n) || n <= 0) return setError(`「${c}」的匯率請輸入大於 0 的數字。`)
      next[c] = n
    }
    // 保留目前沒用到的幣別匯率，之後新增該幣別的花費時還能用
    for (const [k, v] of Object.entries(rates.rates)) if (!currencies.includes(k)) next[k] = v
    await onSave({ base, rates: next })
    setOpen(false)
  }

  const others = currencies.filter((c) => c !== base)
  const baseOptions = Array.from(new Set([...CURRENCIES.map((c) => c.code), ...currencies]))

  return (
    <div className="card">
      <h3>💱 匯率換算（選填）</h3>
      {!open && (
        <>
          {convertedValue !== null ? (
            <p>
              依你輸入的匯率，全部合計約 <b>{formatMoney(convertedValue, rates.base)}</b>
            </p>
          ) : (
            <p className="muted">
              尚未提供 {missing.join('、')} 對 {rates.base} 的匯率，所以不顯示合計（不同幣別不能直接相加）。
            </p>
          )}
          {Object.keys(rates.rates).length > 0 && (
            <p className="muted small">
              目前匯率：
              {Object.entries(rates.rates)
                .filter(([k]) => currencies.includes(k) && k !== rates.base)
                .map(([k, v]) => `1 ${k} = ${v} ${rates.base}`)
                .join('；')}
            </p>
          )}
          <button className="btn btn-small" onClick={startEdit}>
            設定匯率
          </button>
          <p className="hint">匯率只保存在這台裝置，不會隨 JSON 匯出。</p>
        </>
      )}
      {open && (
        <div className="form">
          <label>
            <span>換算成哪一種幣別</span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              {baseOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {others.map((c) => (
            <label key={c}>
              <span>
                1 {c} 等於多少 {base}？
              </span>
              <input
                inputMode="decimal"
                value={draft[c] ?? ''}
                placeholder={c === 'JPY' && base === 'TWD' ? '例如：0.21' : '例如：1.5'}
                onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))}
              />
            </label>
          ))}
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={submit}>
              儲存
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
