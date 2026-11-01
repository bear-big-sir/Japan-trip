import { DATA_STORES, STORE_LABELS } from '../types'
import { isCloudActive, type Stats } from '../db/db'
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
      <div className="stats-time">
        {stats.cloud ? '雲端資料最後更新' : '本機資料最後修改'}：{formatDateTime(stats.lastModified)}
        {stats.lastModifiedBy && `（${stats.lastModifiedBy}）`}
      </div>
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

export function BackupWarning({ cloud = isCloudActive() }: { cloud?: boolean }) {
  if (cloud) {
    return (
      <div className="warning">
        ☁️ 資料存在 <b>Supabase 雲端資料庫</b>，兔兔和先生登入後看到的是同一份資料。
        Supabase 免費方案<b>沒有可下載的自動備份</b>，請定期按「匯出資料」存一份 JSON 檔。
      </div>
    )
  }
  return (
    <div className="warning">
      ⚠️ 資料只保存在<b>這台裝置的這個瀏覽器</b>，不會自動跨裝置同步。
      清除瀏覽器資料、裝置故障或更換裝置都可能造成資料遺失，<b>請定期匯出備份</b>。
    </div>
  )
}
