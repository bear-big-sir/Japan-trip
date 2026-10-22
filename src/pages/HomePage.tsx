import { useMemo, useState } from 'react'
import type { Trip } from '../types'
import { createRecord, deleteTrip, updateRecord, type Stats } from '../db/db'
import { formatDateTime } from '../lib/id'
import { ConfirmDialog } from '../components/Modal'
import { TripForm, type TripFields } from '../components/TripForm'
import { BackupWarning, StatsBar } from '../components/StatsBar'
import { TemplateDialog } from '../components/TemplateDialog'

interface Props {
  trips: Trip[]
  stats: Stats | null
  currentTripId: string | null
  onSelectTrip: (id: string) => void
  onChanged: () => Promise<void>
  onExport: () => Promise<void>
  onGoExchange: () => void
}

export function HomePage({
  trips,
  stats,
  currentTripId,
  onSelectTrip,
  onChanged,
  onExport,
  onGoExchange,
}: Props) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Trip | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Trip | null>(null)
  const [templating, setTemplating] = useState<Trip | null>(null)

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = trips.filter((t) =>
      !q
        ? true
        : [t.name, t.destination, t.notes, String(t.year)].some((s) =>
            s.toLowerCase().includes(q),
          ),
    )
    filtered.sort(
      (a, b) => b.year - a.year || (b.startDate || '').localeCompare(a.startDate || ''),
    )
    const map = new Map<number, Trip[]>()
    for (const t of filtered) {
      if (!map.has(t.year)) map.set(t.year, [])
      map.get(t.year)!.push(t)
    }
    return [...map.entries()]
  }, [trips, query])

  async function save(fields: TripFields) {
    if (editing === 'new') {
      const t = await createRecord('trips', fields)
      onSelectTrip(t.id)
    } else if (editing) {
      await updateRecord('trips', { ...editing, ...fields })
    }
    setEditing(null)
    await onChanged()
  }

  async function confirmDelete() {
    if (!deleting) return
    await deleteTrip(deleting.id)
    setDeleting(null)
    await onChanged()
  }

  return (
    <section>
      <BackupWarning />
      <StatsBar stats={stats} />

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          ＋ 新增旅行
        </button>
        <button className="btn" onClick={onExport}>
          ⬇ 匯出資料
        </button>
        <button className="btn" onClick={onGoExchange}>
          ⬆ 匯入資料
        </button>
      </div>

      <input
        className="search"
        type="search"
        placeholder="🔍 搜尋旅行名稱、目的地、年份…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {trips.length === 0 && (
        <div className="empty">
          還沒有任何旅行。按「＋ 新增旅行」建立第一趟旅行，
          或到「資料交換與備份」匯入對方的資料。
        </div>
      )}
      {trips.length > 0 && grouped.length === 0 && (
        <div className="empty">找不到符合「{query}」的旅行。</div>
      )}

      {grouped.map(([year, list]) => (
        <div key={year} className="year-group">
          <h3 className="year-title">{year} 年</h3>
          {list.map((t) => (
            <article
              key={t.id}
              className={'card trip-card' + (t.id === currentTripId ? ' selected' : '')}
            >
              <div className="trip-main" onClick={() => onSelectTrip(t.id)}>
                <div className="trip-name">
                  {t.id === currentTripId && <span className="badge">目前旅行</span>}
                  {t.name}
                </div>
                <div className="trip-meta">
                  {t.startDate || '未定'} ～ {t.endDate || '未定'}
                  {t.destination && <> · 📍 {t.destination}</>}
                </div>
                {t.notes && <div className="trip-notes">{t.notes}</div>}
                <div className="trip-time">
                  建立：{formatDateTime(t.createdAt)}　最後修改：{formatDateTime(t.updatedAt)}
                </div>
              </div>
              <div className="card-actions">
                {t.id !== currentTripId && (
                  <button className="btn btn-small" onClick={() => onSelectTrip(t.id)}>
                    選擇
                  </button>
                )}
                <button className="btn btn-small" onClick={() => setEditing(t)}>
                  修改
                </button>
                <button className="btn btn-small" onClick={() => setTemplating(t)}>
                  複製為範本
                </button>
                <button className="btn btn-small btn-danger-outline" onClick={() => setDeleting(t)}>
                  刪除
                </button>
              </div>
            </article>
          ))}
        </div>
      ))}

      <details className="help">
        <summary>💾 備份及還原說明</summary>
        <ol>
          <li>資料只存在「這台裝置的這個瀏覽器」裡，不會自動同步到先生／太太的手機。</li>
          <li>請定期按「匯出資料」下載 JSON 備份檔，並存到安全的地方（例如自己的雲端硬碟）。</li>
          <li>要還原時，到「資料交換與備份」匯入備份檔即可。</li>
          <li>每次匯入前，系統會自動在本機建立一份備份，萬一合併結果不滿意可以一鍵還原。</li>
          <li>⚠️ 匯出的 JSON 可能含訂房編號等私人資料，請勿公開分享或上傳到 GitHub。</li>
        </ol>
      </details>

      {editing && (
        <TripForm
          initial={editing === 'new' ? undefined : editing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {templating && (
        <TemplateDialog
          source={templating}
          onCancel={() => setTemplating(null)}
          onDone={async (t) => {
            setTemplating(null)
            onSelectTrip(t.id)
            await onChanged()
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="確定要刪除這趟旅行？"
          danger
          confirmLabel="確定刪除"
          message={
            <>
              <p>
                將刪除「<b>{deleting.name}</b>」以及底下所有航班、住宿、行程、待辦和預算。
              </p>
              <p>刪除後無法復原。如果不確定，建議先匯出備份。</p>
            </>
          }
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
