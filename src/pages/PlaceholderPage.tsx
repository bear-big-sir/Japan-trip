import type { Trip } from '../types'

interface Props {
  title: string
  stage: string
  features: string[]
  trip: Trip | null
  onGoHome: () => void
}

/** 尚未完成的功能頁：清楚標示會在哪個階段完成，不放任何沒有作用的按鈕 */
export function PlaceholderPage({ title, stage, features, trip, onGoHome }: Props) {
  return (
    <section>
      {trip ? (
        <div className="current-trip">
          目前旅行：<b>{trip.name}</b>（{trip.startDate || '未定'} ～ {trip.endDate || '未定'}）
        </div>
      ) : (
        <div className="warning">
          還沒有選擇旅行。
          <button className="btn btn-small" onClick={onGoHome}>
            到「我的旅行」選擇
          </button>
        </div>
      )}
      <div className="card">
        <h3>{title}</h3>
        <p className="muted">🚧 這一頁會在<b>{stage}</b>完成。資料結構已經準備好，將包含：</p>
        <ul>
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
