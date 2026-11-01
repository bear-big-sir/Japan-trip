import { useState } from 'react'
import type { Hotel, Trip } from '../types'
import { createRecord, deleteRecord, updateRecord } from '../db/db'
import { useTripRecords } from '../lib/useTripRecords'
import { diffDays, formatDay, isDate } from '../lib/date'
import { RecordForm, toValues, type FieldDef } from '../components/RecordForm'
import { ConfirmDialog } from '../components/Modal'

const FIELDS: FieldDef[] = [
  { key: 'name', label: '飯店名稱', required: true, placeholder: '例如：JR Tower Hotel Nikko Sapporo' },
  { key: 'checkIn', label: '入住日期', type: 'date', half: true },
  { key: 'checkOut', label: '退房日期', type: 'date', half: true },
  { key: 'address', label: '地址', placeholder: '可貼上日文地址，方便給計程車司機看' },
  { key: 'phone', label: '電話', type: 'tel', half: true, placeholder: '+81-11-xxx-xxxx' },
  { key: 'roomType', label: '房型', half: true, placeholder: '例如：雙人房' },
  {
    key: 'bookingNumber',
    label: '訂房編號',
    placeholder: '例如：1234567890',
    hint: '🔒 訂房編號屬於私人資料。匯出的 JSON 檔會包含它，請妥善保存，不要公開分享。',
  },
  { key: 'notes', label: '備註', type: 'textarea', placeholder: '早餐、停車、Check-in 時間…' },
]
const KEYS = FIELDS.map((f) => f.key)

export function HotelsPage({ trip, onChanged }: { trip: Trip; onChanged: () => Promise<void> }) {
  const [hotels, reload] = useTripRecords('hotels', trip.id)
  const [editing, setEditing] = useState<Hotel | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Hotel | null>(null)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const sorted = [...hotels].sort((a, b) => (a.checkIn || '9').localeCompare(b.checkIn || '9'))

  async function save(v: Record<string, string>) {
    const fields = Object.fromEntries(KEYS.map((k) => [k, v[k].trim()])) as unknown as Omit<
      Hotel,
      'id' | 'createdAt' | 'updatedAt' | 'tripId'
    >
    if (editing === 'new') await createRecord('hotels', { ...fields, tripId: trip.id })
    else if (editing) await updateRecord('hotels', { ...editing, ...fields })
    setEditing(null)
    await Promise.all([reload(), onChanged()])
  }

  async function remove() {
    if (!deleting) return
    await deleteRecord('hotels', deleting.id)
    setDeleting(null)
    await Promise.all([reload(), onChanged()])
  }

  function toggleReveal(id: string) {
    setRevealed((old) => {
      const s = new Set(old)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  return (
    <section>
      <div className="warning">
        🔒 訂房編號屬於私人資料。匯出的 JSON 檔案會包含訂房編號，請妥善保存，不要公開分享或上傳到 GitHub。
      </div>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          ＋ 新增住宿
        </button>
      </div>

      {sorted.length === 0 && <div className="empty">這趟旅行還沒有住宿資料。</div>}

      {sorted.map((h) => {
        const nights = isDate(h.checkIn) && isDate(h.checkOut) ? diffDays(h.checkIn, h.checkOut) : null
        return (
          <article key={h.id} className="card">
            <div className="item-title">🏨 {h.name}</div>
            <div className="item-line">
              {formatDay(h.checkIn)} 入住 → {formatDay(h.checkOut)} 退房
              {nights !== null && nights > 0 && <span className="badge-soft">{nights} 晚</span>}
            </div>
            {h.address && (
              <div className="item-line">
                📍{' '}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.address)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {h.address}
                </a>
              </div>
            )}
            {h.phone && (
              <div className="item-line">
                📞 <a href={`tel:${h.phone.replace(/[^\d+]/g, '')}`}>{h.phone}</a>
              </div>
            )}
            {h.roomType && <div className="item-line">🛏 {h.roomType}</div>}
            {h.bookingNumber && (
              <div className="item-line">
                🔒 訂房編號：
                <button className="link-btn" onClick={() => toggleReveal(h.id)}>
                  {revealed.has(h.id) ? h.bookingNumber : '●●●●●●（點一下顯示）'}
                </button>
              </div>
            )}
            {h.notes && <div className="item-line muted pre">{h.notes}</div>}
            <div className="card-actions">
              <button className="btn btn-small" onClick={() => setEditing(h)}>
                修改
              </button>
              <button className="btn btn-small btn-danger-outline" onClick={() => setDeleting(h)}>
                刪除
              </button>
            </div>
          </article>
        )
      })}

      {editing && (
        <RecordForm
          title={editing === 'new' ? '新增住宿' : '修改住宿'}
          fields={FIELDS}
          initial={
            editing === 'new'
              ? {
                  ...Object.fromEntries(KEYS.map((k) => [k, ''])),
                  checkIn: trip.startDate,
                  checkOut: trip.endDate,
                }
              : toValues(editing, KEYS)
          }
          validate={(v) =>
            v.checkIn && v.checkOut && v.checkOut < v.checkIn ? '退房日期不能早於入住日期。' : undefined
          }
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="確定要刪除這筆住宿？"
          danger
          confirmLabel="確定刪除"
          message={<p>將刪除「{deleting.name}」，刪除後無法復原。</p>}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
