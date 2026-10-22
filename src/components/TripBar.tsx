import { useState } from 'react'
import type { Trip } from '../types'
import { TripForm, type TripFields } from './TripForm'

interface Props {
  trips: Trip[]
  current: Trip | null
  onSelect: (id: string) => void
  /** 直接在這一頁新增旅行，新增後自動選取 */
  onCreate: (fields: TripFields) => Promise<void>
}

/** 子頁面上方的「目前旅行」切換列 */
export function TripBar({ trips, current, onSelect, onCreate }: Props) {
  const [creating, setCreating] = useState(false)

  async function save(fields: TripFields) {
    await onCreate(fields)
    setCreating(false)
  }

  const form = creating && <TripForm onSave={save} onCancel={() => setCreating(false)} />

  if (trips.length === 0) {
    return (
      <div className="warning trip-bar-empty">
        <p>航班、住宿、行程、功課、待辦和預算都會記在某一趟旅行底下，請先建立一趟旅行。</p>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          ＋ 新增旅行
        </button>
        {form}
      </div>
    )
  }
  const sorted = [...trips].sort(
    (a, b) => b.year - a.year || (b.startDate || '').localeCompare(a.startDate || ''),
  )
  return (
    <div className="trip-bar">
      <label className="trip-bar-select">
        <span>目前旅行</span>
        <select value={current?.id ?? ''} onChange={(e) => onSelect(e.target.value)}>
          {!current && <option value="">請選擇旅行…</option>}
          {sorted.map((t) => (
            <option key={t.id} value={t.id}>
              {t.year}｜{t.name}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-small" onClick={() => setCreating(true)} aria-label="新增旅行">
        ＋ 新旅行
      </button>
      {form}
    </div>
  )
}
