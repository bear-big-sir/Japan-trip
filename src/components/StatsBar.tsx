import { DATA_STORES, STORE_LABELS } from '../types'
import type { Stats } from '../db/db'
import { formatDateTime } from '../lib/id'

export function StatsBar({ stats }: { stats: Stats | null }) {
  if (!stats) return null
  return (
    <div className="stats">
      <div className="stats-counts">
        {DATA_STORES.map((s) => (
          <span key={s} className="stat">
            {STORE_LABELS[s]} <b>{stats.counts[s]}</b>
          </span>
        ))}
      </div>
      <div className="stats-time">本機資料最後修改：{formatDateTime(stats.lastModified)}</div>
    </div>
  )
}

export function BackupWarning() {
  return (
    <div className="warning">
      ⚠️ 資料只保存在<b>這台裝置的這個瀏覽器</b>，不會自動跨裝置同步。
      清除瀏覽器資料、裝置故障或更換裝置都可能造成資料遺失，<b>請定期匯出備份</b>。
    </div>
  )
}
