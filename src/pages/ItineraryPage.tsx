import { useMemo, useState } from 'react'
import type { ItineraryItem, Trip } from '../types'
import { createRecord, deleteRecord, updateRecord } from '../db/db'
import { copyDay, nextOrder, saveDayOrder, sortDay } from '../db/copy'
import { useTripRecords } from '../lib/useTripRecords'
import { dateRange, diffDays, formatDay, isDate } from '../lib/date'
import { RecordForm, toValues, type FieldDef } from '../components/RecordForm'
import { ConfirmDialog, Modal } from '../components/Modal'

const FIELDS: FieldDef[] = [
  { key: 'date', label: '日期', type: 'date', half: true },
  { key: 'time', label: '預計時間', type: 'time', half: true },
  { key: 'title', label: '景點或活動名稱', required: true, placeholder: '例如：函館山夜景' },
  { key: 'address', label: '地址', placeholder: '可貼上日文地址或 Google 地圖地名' },
  { key: 'transport', label: '交通方式', half: true, placeholder: '例如：市電 → 纜車' },
  { key: 'duration', label: '預計停留時間', half: true, placeholder: '例如：1.5 小時' },
  { key: 'foodShopping', label: '餐廳或購物資訊', type: 'textarea' },
  { key: 'notes', label: '備註', type: 'textarea' },
]
const KEYS = FIELDS.map((f) => f.key)
const NO_DATE = ''

function dayLabel(trip: Trip, d: string): string {
  if (d === NO_DATE) return '未定日期'
  if (isDate(trip.startDate) && d >= trip.startDate) return `Day ${diffDays(trip.startDate, d) + 1}`
  return '行前'
}

interface Props {
  trip: Trip
  trips: Trip[]
  onChanged: () => Promise<void>
}

export function ItineraryPage({ trip, trips, onChanged }: Props) {
  const [items, reload] = useTripRecords('itinerary', trip.id)
  const [day, setDay] = useState<string | null>(null)
  const [editing, setEditing] = useState<ItineraryItem | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ItineraryItem | null>(null)
  const [copying, setCopying] = useState(false)
  const [message, setMessage] = useState('')

  // 日期清單：旅行期間的每一天 + 有行程但在期間外的日期 + 未定日期
  const days = useMemo(() => {
    const set = new Set(dateRange(trip.startDate, trip.endDate))
    for (const i of items) set.add(i.date)
    const list = [...set].filter((d) => d !== NO_DATE).sort()
    if (items.some((i) => i.date === NO_DATE)) list.push(NO_DATE)
    return list
  }, [items, trip.startDate, trip.endDate])

  const selected = day !== null && days.includes(day) ? day : (days[0] ?? NO_DATE)
  const dayItems = sortDay(items.filter((i) => i.date === selected))

  async function refresh() {
    await Promise.all([reload(), onChanged()])
  }

  async function save(v: Record<string, string>) {
    const fields = Object.fromEntries(KEYS.map((k) => [k, v[k].trim()])) as Omit<
      ItineraryItem,
      'id' | 'createdAt' | 'updatedAt' | 'tripId' | 'order'
    >
    if (editing === 'new') {
      await createRecord('itinerary', {
        ...fields,
        tripId: trip.id,
        order: nextOrder(items, fields.date),
      })
    } else if (editing) {
      // 換到別的日期時，排在那一天的最後面
      const order = fields.date === editing.date ? editing.order : nextOrder(items, fields.date)
      await updateRecord('itinerary', { ...editing, ...fields, order })
    }
    setDay(fields.date)
    setEditing(null)
    await refresh()
  }

  async function move(index: number, delta: -1 | 1) {
    const list = [...dayItems]
    const j = index + delta
    if (j < 0 || j >= list.length) return
    ;[list[index], list[j]] = [list[j], list[index]]
    await saveDayOrder(list)
    await refresh()
  }

  async function sortByTime() {
    const list = [...dayItems].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
    await saveDayOrder(list)
    await refresh()
  }

  async function remove() {
    if (!deleting) return
    await deleteRecord('itinerary', deleting.id)
    setDeleting(null)
    await refresh()
  }

  return (
    <section>
      {days.length > 0 && (
        <div className="day-tabs" role="tablist">
          {days.map((d) => {
            const count = items.filter((i) => i.date === d).length
            return (
              <button
                key={d || 'none'}
                role="tab"
                aria-selected={d === selected}
                className={'day-tab' + (d === selected ? ' active' : '')}
                onClick={() => setDay(d)}
              >
                <span className="day-tab-label">
                  {dayLabel(trip, d)}
                </span>
                <span className="day-tab-date">{d === NO_DATE ? '' : formatDay(d)}</span>
                {count > 0 && <span className="day-tab-count">{count}</span>}
              </button>
            )
          })}
        </div>
      )}

      {message && (
        <div className="notice" onClick={() => setMessage('')}>
          {message}
        </div>
      )}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          ＋ 新增行程
        </button>
        <button className="btn" onClick={() => setCopying(true)} disabled={dayItems.length === 0}>
          📋 複製這一天
        </button>
        <button className="btn" onClick={sortByTime} disabled={dayItems.length < 2}>
          🕘 依時間排序
        </button>
      </div>

      <h3 className="day-heading">
        {selected === NO_DATE ? '未定日期的行程' : `${formatDay(selected)} 完整行程`}
        <span className="muted small">（{dayItems.length} 個行程）</span>
      </h3>

      {days.length === 0 && (
        <div className="empty">
          這趟旅行還沒有設定出發／回程日期，也還沒有行程。按「＋ 新增行程」開始規劃，
          或到「我的旅行」設定日期。
        </div>
      )}
      {days.length > 0 && dayItems.length === 0 && (
        <div className="empty">這一天還沒有行程。</div>
      )}

      <ol className="timeline">
        {dayItems.map((it, idx) => (
          <li key={it.id} className="card timeline-item">
            <div className="timeline-time">{it.time || '—'}</div>
            <div className="timeline-body">
              <div className="item-title">{it.title}</div>
              {it.address && (
                <div className="item-line">
                  📍{' '}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.address)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {it.address}
                  </a>
                </div>
              )}
              {(it.transport || it.duration) && (
                <div className="item-line">
                  {it.transport && <>🚃 {it.transport}　</>}
                  {it.duration && <>⏱ 停留 {it.duration}</>}
                </div>
              )}
              {it.foodShopping && <div className="item-line pre">🍜 {it.foodShopping}</div>}
              {it.notes && <div className="item-line muted pre">{it.notes}</div>}
              <div className="card-actions">
                <button
                  className="btn btn-small"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  aria-label="往上移"
                >
                  ↑
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => move(idx, 1)}
                  disabled={idx === dayItems.length - 1}
                  aria-label="往下移"
                >
                  ↓
                </button>
                <button className="btn btn-small" onClick={() => setEditing(it)}>
                  修改
                </button>
                <button className="btn btn-small btn-danger-outline" onClick={() => setDeleting(it)}>
                  刪除
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {editing && (
        <RecordForm
          title={editing === 'new' ? '新增行程' : '修改行程'}
          fields={FIELDS}
          initial={
            editing === 'new'
              ? { ...Object.fromEntries(KEYS.map((k) => [k, ''])), date: selected }
              : toValues(editing, KEYS)
          }
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="確定要刪除這個行程？"
          danger
          confirmLabel="確定刪除"
          message={<p>將刪除「{deleting.title}」，刪除後無法復原。</p>}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
      {copying && (
        <CopyDayDialog
          trip={trip}
          trips={trips}
          fromDate={selected}
          count={dayItems.length}
          onCancel={() => setCopying(false)}
          onDone={async (n, toTrip, toDate) => {
            setCopying(false)
            if (toTrip === trip.id) setDay(toDate)
            const tripName = trips.find((t) => t.id === toTrip)?.name ?? ''
            setMessage(`已複製 ${n} 個行程到「${tripName}」${formatDay(toDate)}。原本的行程沒有變動。`)
            await refresh()
          }}
        />
      )}
    </section>
  )
}

interface CopyProps {
  trip: Trip
  trips: Trip[]
  fromDate: string
  count: number
  onCancel: () => void
  onDone: (n: number, toTripId: string, toDate: string) => Promise<void>
}

function CopyDayDialog({ trip, trips, fromDate, count, onCancel, onDone }: CopyProps) {
  const [toTrip, setToTrip] = useState(trip.id)
  const target = trips.find((t) => t.id === toTrip)
  const defaultDate = (t: Trip | undefined) =>
    t?.id === trip.id && isDate(fromDate) && trip.endDate && fromDate < trip.endDate
      ? dateRange(fromDate, trip.endDate)[1]
      : (t?.startDate ?? '')
  const [toDate, setToDate] = useState(defaultDate(trip))
  const [error, setError] = useState('')

  async function submit() {
    if (!toDate) return setError('請選擇要複製到哪一天。')
    try {
      const n = await copyDay(trip.id, fromDate, toTrip, toDate)
      await onDone(n, toTrip, toDate)
    } catch (e) {
      setError(`複製失敗，原有資料沒有變更：${(e as Error).message}`)
    }
  }

  return (
    <Modal title="複製這一天的行程" onClose={onCancel}>
      <div className="form">
        <p className="muted">
          將「{fromDate ? formatDay(fromDate) : '未定日期'}」的 {count} 個行程複製一份。
          原本的行程不會被修改或刪除。
        </p>
        <label>
          <span>複製到哪一趟旅行</span>
          <select
            value={toTrip}
            onChange={(e) => {
              setToTrip(e.target.value)
              setToDate(defaultDate(trips.find((t) => t.id === e.target.value)))
            }}
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.year}｜{t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>複製到哪一天</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          {target?.startDate && (
            <span className="hint">
              這趟旅行期間：{target.startDate} ～ {target.endDate || '未定'}
            </span>
          )}
        </label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            確定複製
          </button>
        </div>
      </div>
    </Modal>
  )
}
