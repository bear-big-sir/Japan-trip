import type { Trip } from '../types'

interface Props {
  trips: Trip[]
  current: Trip | null
  onSelect: (id: string) => void
  onGoHome: () => void
}

/** 子頁面上方的「目前旅行」切換列 */
export function TripBar({ trips, current, onSelect, onGoHome }: Props) {
  if (trips.length === 0) {
    return (
      <div className="warning">
        還沒有任何旅行。
        <button className="btn btn-small" onClick={onGoHome}>
          到「我的旅行」新增
        </button>
      </div>
    )
  }
  const sorted = [...trips].sort(
    (a, b) => b.year - a.year || (b.startDate || '').localeCompare(a.startDate || ''),
  )
  return (
    <label className="trip-bar">
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
  )
}
