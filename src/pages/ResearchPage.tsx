import { useState } from 'react'
import {
  RESEARCH_CATEGORY_LABELS,
  type ResearchCategory,
  type ResearchNote,
  type Trip,
} from '../types'
import { createRecord, deleteRecord, updateRecord } from '../db/db'
import { useTripRecords } from '../lib/useTripRecords'
import { RecordForm, toValues, type FieldDef } from '../components/RecordForm'
import { ConfirmDialog } from '../components/Modal'

const CATEGORIES = Object.keys(RESEARCH_CATEGORY_LABELS) as ResearchCategory[]

const ICONS: Record<ResearchCategory, string> = {
  sight: '⛩',
  food: '🍣',
  shopping: '🛍',
  transport: '🚃',
  tips: '💡',
  other: '📌',
}

const STARS = ['未標記', '★ 有空再去', '★★ 想去', '★★★ 一定要去']

const FIELDS: FieldDef[] = [
  {
    key: 'category',
    label: '分類',
    type: 'select',
    half: true,
    options: CATEGORIES.map((c) => ({ value: c, label: `${ICONS[c]} ${RESEARCH_CATEGORY_LABELS[c]}` })),
  },
  {
    key: 'priority',
    label: '想去程度',
    type: 'select',
    half: true,
    options: STARS.map((s, i) => ({ value: String(i), label: s })),
  },
  { key: 'title', label: '標題', required: true, placeholder: '例如：小樽運河夜景、六花亭本店' },
  { key: 'address', label: '地址或地點', placeholder: '會自動變成 Google 地圖連結' },
  { key: 'url', label: '參考網址', type: 'text', placeholder: 'https://…（部落格、官網、IG）' },
  {
    key: 'content',
    label: '筆記內容',
    type: 'textarea',
    placeholder: '營業時間、推薦菜色、門票價格、要預約嗎、交通方式…',
  },
]
const KEYS = FIELDS.map((f) => f.key)

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s)

export function ResearchPage({ trip, onChanged }: { trip: Trip; onChanged: () => Promise<void> }) {
  const [notes, reload] = useTripRecords('research', trip.id)
  const [editing, setEditing] = useState<ResearchNote | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ResearchNote | null>(null)
  const [filter, setFilter] = useState<ResearchCategory | 'all'>('all')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const shown = notes
    .filter((n) => filter === 'all' || n.category === filter)
    .filter(
      (n) => !q || [n.title, n.address, n.content, n.url].some((s) => s.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))

  async function refresh() {
    await Promise.all([reload(), onChanged()])
  }

  async function save(v: Record<string, string>) {
    const p = Number(v.priority)
    const fields = {
      category: (CATEGORIES.includes(v.category as ResearchCategory) ? v.category : 'other') as ResearchCategory,
      priority: p >= 0 && p <= 3 ? p : 0,
      title: v.title.trim(),
      address: v.address.trim(),
      url: v.url.trim(),
      content: v.content.trim(),
    }
    if (editing === 'new') await createRecord('research', { ...fields, tripId: trip.id })
    else if (editing) await updateRecord('research', { ...editing, ...fields })
    setEditing(null)
    await refresh()
  }

  async function remove() {
    if (!deleting) return
    await deleteRecord('research', deleting.id)
    setDeleting(null)
    await refresh()
  }

  return (
    <section>
      <p className="muted small">
        把出發前查到的景點、美食、交通資訊和網址記在這裡。旅遊功課會一起匯出、備份，也能和另一半交換合併。
      </p>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          ＋ 新增功課
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="empty">這趟旅行還沒有旅遊功課。</div>
      ) : (
        <>
          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 搜尋標題、地址、筆記內容"
          />
          <div className="filter-chips" role="group" aria-label="依分類篩選">
            <button className={'chip' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>
              全部（{notes.length}）
            </button>
            {CATEGORIES.filter((c) => notes.some((n) => n.category === c)).map((c) => (
              <button
                key={c}
                className={'chip' + (filter === c ? ' active' : '')}
                onClick={() => setFilter(c)}
              >
                {ICONS[c]} {RESEARCH_CATEGORY_LABELS[c]}（{notes.filter((n) => n.category === c).length}）
              </button>
            ))}
          </div>
          {shown.length === 0 && <div className="empty">找不到符合的功課。</div>}
        </>
      )}

      {shown.map((n) => (
        <article key={n.id} className="card">
          <div className="item-title">
            {ICONS[n.category]} {n.title}
            {n.priority > 0 && <span className="stars">{'★'.repeat(n.priority)}</span>}
          </div>
          <div className="item-line muted small">{RESEARCH_CATEGORY_LABELS[n.category]}</div>
          {n.address && (
            <div className="item-line">
              📍{' '}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.address)}`}
                target="_blank"
                rel="noreferrer"
              >
                {n.address}
              </a>
            </div>
          )}
          {n.url && (
            <div className="item-line">
              🔗{' '}
              {isUrl(n.url) ? (
                <a href={n.url} target="_blank" rel="noreferrer">
                  {n.url}
                </a>
              ) : (
                n.url
              )}
            </div>
          )}
          {n.content && <div className="item-line pre research-content">{n.content}</div>}
          <div className="card-actions">
            <button className="btn btn-small" onClick={() => setEditing(n)}>
              修改
            </button>
            <button className="btn btn-small btn-danger-outline" onClick={() => setDeleting(n)}>
              刪除
            </button>
          </div>
        </article>
      ))}

      {editing && (
        <RecordForm
          title={editing === 'new' ? '新增旅遊功課' : '修改旅遊功課'}
          fields={FIELDS}
          initial={
            editing === 'new'
              ? {
                  category: filter === 'all' ? 'sight' : filter,
                  priority: '0',
                  title: '',
                  address: '',
                  url: '',
                  content: '',
                }
              : toValues(editing, KEYS)
          }
          validate={(v) =>
            v.url.trim() && !isUrl(v.url.trim()) ? '網址請以 http:// 或 https:// 開頭。' : undefined
          }
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="確定要刪除這則功課？"
          danger
          confirmLabel="確定刪除"
          message={<p>將刪除「{deleting.title}」，刪除後無法復原。</p>}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
