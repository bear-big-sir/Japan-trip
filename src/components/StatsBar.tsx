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
      <div className="stats-time">
        上次匯出備份：{stats.lastExportAt ? formatDateTime(stats.lastExportAt) : '還沒有匯出過'}
      </div>
      {needsExport(stats) && (
        <div className="export-reminder">📤 有新的變更還沒匯出備份，記得按「匯出資料」存一份 JSON 檔。</div>
      )}
    </div>
  )
}

/** 有資料、且最後修改晚於上次匯出時，提醒使用者匯出 */
export function needsExport(stats: Stats): boolean {
  if (stats.total === 0 || !stats.lastModified) return false
  return !stats.lastExportAt || stats.lastModified > stats.lastExportAt
}

export function BackupWarning() {
  return (
    <div className="warning">
      ⚠️ 資料只保存在<b>這台裝置的這個瀏覽器</b>，不會自動跨裝置同步。
      清除瀏覽器資料、裝置故障或更換裝置都可能造成資料遺失，<b>請定期匯出備份</b>。
    </div>
  )
}
