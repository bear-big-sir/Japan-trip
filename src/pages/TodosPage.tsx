import { useState } from 'react'
import { TODO_CATEGORY_LABELS, type TodoCategory, type TodoItem, type Trip } from '../types'
import { createRecord, deleteRecord, updateRecord } from '../db/db'
import { useTripRecords } from '../lib/useTripRecords'
import { missingPresets } from '../lib/todoPresets'
import { RecordForm, toValues, type FieldDef } from '../components/RecordForm'
import { ConfirmDialog } from '../components/Modal'

const CATEGORIES = Object.keys(TODO_CATEGORY_LABELS) as TodoCategory[]

const FIELDS: FieldDef[] = [
  {
    key: 'category',
    label: '分類',
    type: 'select',
    options: CATEGORIES.map((c) => ({ value: c, label: TODO_CATEGORY_LABELS[c] })),
  },
  { key: 'title', label: '待辦事項', required: true, placeholder: '例如：預約 JR Pass' },
  { key: 'notes', label: '備註', type: 'textarea', placeholder: '期限、網址、誰負責…' },
]
const KEYS = FIELDS.map((f) => f.key)

export function TodosPage({ trip, onChanged }: { trip: Trip; onChanged: () => Promise<void> }) {
  const [todos, reload] = useTripRecords('todos', trip.id)
  const [editing, setEditing] = useState<TodoItem | 'new' | null>(null)
  const [newCategory, setNewCategory] = useState<TodoCategory>('other')
  const [deleting, setDeleting] = useState<TodoItem | null>(null)
  const [hideDone, setHideDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const doneCount = todos.filter((t) => t.done).length
  const presets = missingPresets(todos)

  async function refresh() {
    await Promise.all([reload(), onChanged()])
  }

  async function save(v: Record<string, string>) {
    const fields = {
      category: (CATEGORIES.includes(v.category as TodoCategory) ? v.category : 'other') as TodoCategory,
      title: v.title.trim(),
      notes: v.notes.trim(),
    }
    if (editing === 'new') await createRecord('todos', { ...fields, done: false, tripId: trip.id })
    else if (editing) await updateRecord('todos', { ...editing, ...fields })
    setEditing(null)
    await refresh()
  }

  async function toggle(t: TodoItem) {
    await updateRecord('todos', { ...t, done: !t.done })
    await refresh()
  }

  async function remove() {
    if (!deleting) return
    await deleteRecord('todos', deleting.id)
    setDeleting(null)
    await refresh()
  }

  async function addPresets() {
    setBusy(true)
    try {
      for (const p of presets) {
        await createRecord('todos', { ...p, done: false, notes: '', tripId: trip.id })
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  function openNew(category: TodoCategory) {
    setNewCategory(category)
    setEditing('new')
  }

  return (
    <section>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => openNew('other')}>
          ＋ 新增待辦
        </button>
        {presets.length > 0 && (
          <button className="btn" onClick={addPresets} disabled={busy}>
            {busy ? '加入中…' : `📋 加入常見待辦（${presets.length} 項）`}
          </button>
        )}
      </div>

      {todos.length > 0 && (
        <div className="stats todo-progress">
          <div>
            已完成 <b>{doneCount}</b> / {todos.length} 項
            {doneCount === todos.length && ' 🎉 全部完成！'}
          </div>
          <div className="progress" aria-hidden="true">
            <div className="progress-bar" style={{ width: `${(doneCount / todos.length) * 100}%` }} />
          </div>
          <label className="check">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            隱藏已完成的項目
          </label>
        </div>
      )}

      {todos.length === 0 && (
        <div className="empty">
          這趟旅行還沒有待辦事項。
          <br />
          可以按「加入常見待辦」一次加入建議清單，之後再自行修改或刪除。
        </div>
      )}

      {CATEGORIES.map((c) => {
        const all = todos
          .filter((t) => t.category === c)
          .sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt.localeCompare(b.createdAt))
        if (all.length === 0) return null
        const shown = hideDone ? all.filter((t) => !t.done) : all
        return (
          <div key={c} className="card">
            <div className="todo-group-head">
              <h3>
                {TODO_CATEGORY_LABELS[c]}
                <span className="badge-soft">
                  {all.filter((t) => t.done).length}/{all.length}
                </span>
              </h3>
              <button className="btn btn-small" onClick={() => openNew(c)}>
                ＋ 新增
              </button>
            </div>
            {shown.length === 0 && <p className="muted small">這一類都完成了 👍</p>}
            <ul className="todo-list">
              {shown.map((t) => (
                <li key={t.id} className={'todo-item' + (t.done ? ' done' : '')}>
                  <label className="check todo-check">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => toggle(t)}
                      aria-label={`${t.title}：${t.done ? '已完成' : '未完成'}`}
                    />
                    <span className="todo-title">{t.title}</span>
                  </label>
                  {t.notes && <div className="item-line muted pre todo-notes">{t.notes}</div>}
                  <div className="card-actions todo-actions">
                    <button className="btn btn-small" onClick={() => setEditing(t)}>
                      修改
                    </button>
                    <button className="btn btn-small btn-danger-outline" onClick={() => setDeleting(t)}>
                      刪除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      {editing && (
        <RecordForm
          title={editing === 'new' ? '新增待辦' : '修改待辦'}
          fields={FIELDS}
          initial={
            editing === 'new'
              ? { category: newCategory, title: '', notes: '' }
              : toValues(editing, KEYS)
          }
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="確定要刪除這項待辦？"
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
