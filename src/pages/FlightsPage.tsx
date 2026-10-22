import { useState } from 'react'
import type { Flight, Trip } from '../types'
import { createRecord, deleteRecord, updateRecord } from '../db/db'
import { useTripRecords } from '../lib/useTripRecords'
import { formatLocalDateTime } from '../lib/date'
import { RecordForm, toValues, type FieldDef } from '../components/RecordForm'
import { ConfirmDialog } from '../components/Modal'

const FIELDS: FieldDef[] = [
  { key: 'airline', label: '航空公司', required: true, half: true, placeholder: '例如：長榮航空' },
  { key: 'flightNumber', label: '航班號碼', required: true, half: true, placeholder: '例如：BR116' },
  { key: 'departDateTime', label: '出發日期及時間', type: 'datetime-local', half: true },
  { key: 'arriveDateTime', label: '抵達日期及時間', type: 'datetime-local', half: true },
  { key: 'departAirport', label: '出發機場', half: true, placeholder: '例如：桃園 TPE' },
  { key: 'departTerminal', label: '出發航廈', half: true, placeholder: '例如：第二航廈' },
  { key: 'arriveAirport', label: '抵達機場', half: true, placeholder: '例如：新千歲 CTS' },
  { key: 'arriveTerminal', label: '抵達航廈', half: true, placeholder: '例如：國際線' },
  {
    key: 'bookingInfo',
    label: '訂位資訊',
    type: 'textarea',
    placeholder: '訂位代號、座位、行李額度…',
    hint: '🔒 訂位資訊屬於私人資料，匯出的 JSON 檔請妥善保存。',
  },
  { key: 'notes', label: '備註', type: 'textarea' },
]
const KEYS = FIELDS.map((f) => f.key)

export function FlightsPage({ trip, onChanged }: { trip: Trip; onChanged: () => Promise<void> }) {
  const [flights, reload] = useTripRecords('flights', trip.id)
  const [editing, setEditing] = useState<Flight | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Flight | null>(null)

  const sorted = [...flights].sort((a, b) =>
    (a.departDateTime || '9').localeCompare(b.departDateTime || '9'),
  )

  async function save(v: Record<string, string>) {
    const fields = Object.fromEntries(KEYS.map((k) => [k, v[k].trim()])) as Omit<
      Flight,
      'id' | 'createdAt' | 'updatedAt' | 'tripId'
    >
    if (editing === 'new') await createRecord('flights', { ...fields, tripId: trip.id })
    else if (editing) await updateRecord('flights', { ...editing, ...fields })
    setEditing(null)
    await Promise.all([reload(), onChanged()])
  }

  async function remove() {
    if (!deleting) return
    await deleteRecord('flights', deleting.id)
    setDeleting(null)
    await Promise.all([reload(), onChanged()])
  }

  return (
    <section>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          ＋ 新增航班
        </button>
      </div>

      {sorted.length === 0 && <div className="empty">這趟旅行還沒有航班資料。</div>}

      {sorted.map((f) => (
        <article key={f.id} className="card">
          <div className="item-title">
            ✈️ {f.airline} {f.flightNumber}
          </div>
          <div className="flight-route">
            <div>
              <div className="muted small">出發</div>
              <b>{formatLocalDateTime(f.departDateTime)}</b>
              <div>
                {f.departAirport || '—'}
                {f.departTerminal && ` · ${f.departTerminal}`}
              </div>
            </div>
            <div className="flight-arrow">→</div>
            <div>
              <div className="muted small">抵達</div>
              <b>{formatLocalDateTime(f.arriveDateTime)}</b>
              <div>
                {f.arriveAirport || '—'}
                {f.arriveTerminal && ` · ${f.arriveTerminal}`}
              </div>
            </div>
          </div>
          {f.bookingInfo && <div className="item-line">🔒 {f.bookingInfo}</div>}
          {f.notes && <div className="item-line muted">{f.notes}</div>}
          <div className="card-actions">
            <button className="btn btn-small" onClick={() => setEditing(f)}>
              修改
            </button>
            <button className="btn btn-small btn-danger-outline" onClick={() => setDeleting(f)}>
              刪除
            </button>
          </div>
        </article>
      ))}

      {editing && (
        <RecordForm
          title={editing === 'new' ? '新增航班' : '修改航班'}
          fields={FIELDS}
          initial={
            editing === 'new'
              ? Object.fromEntries(KEYS.map((k) => [k, '']))
              : toValues(editing, KEYS)
          }
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="確定要刪除這個航班？"
          danger
          confirmLabel="確定刪除"
          message={
            <p>
              將刪除「{deleting.airline} {deleting.flightNumber}」，刪除後無法復原。
            </p>
          }
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
