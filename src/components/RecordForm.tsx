import { useState, type FormEvent, type ReactNode } from 'react'
import { Modal } from './Modal'

export interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'date' | 'datetime-local' | 'time' | 'textarea' | 'tel' | 'select'
  placeholder?: string
  required?: boolean
  /** 在寬螢幕時佔半行，相鄰兩個 half 欄位會並排 */
  half?: boolean
  options?: { value: string; label: string }[]
  hint?: ReactNode
}

type Values = Record<string, string>

interface Props {
  title: string
  fields: FieldDef[]
  initial: Values
  /** 回傳錯誤訊息代表不能儲存 */
  validate?: (v: Values) => string | undefined
  onSave: (v: Values) => Promise<void>
  onCancel: () => void
  extra?: ReactNode
}

/** 共用的新增／修改表單：明確的「儲存」與「取消」按鈕 */
export function RecordForm({ title, fields, initial, validate, onSave, onCancel, extra }: Props) {
  const [values, setValues] = useState<Values>(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (key: string, v: string) => setValues((old) => ({ ...old, [key]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    for (const f of fields) {
      if (f.required && !values[f.key]?.trim()) return setError(`請填寫「${f.label}」。`)
    }
    const msg = validate?.(values)
    if (msg) return setError(msg)
    setError('')
    setSaving(true)
    try {
      await onSave(values)
    } catch (err) {
      setError(`儲存失敗：${(err as Error).message}`)
      setSaving(false)
    }
  }

  // 把相鄰的 half 欄位兩兩組成一列
  const rows: FieldDef[][] = []
  for (const f of fields) {
    const last = rows[rows.length - 1]
    if (f.half && last && last.length === 1 && last[0].half) last.push(f)
    else rows.push([f])
  }

  const renderField = (f: FieldDef) => (
    <label key={f.key}>
      <span>
        {f.label} {f.required && <span className="required">*</span>}
      </span>
      {f.type === 'textarea' ? (
        <textarea
          rows={3}
          value={values[f.key] ?? ''}
          placeholder={f.placeholder}
          onChange={(e) => set(f.key, e.target.value)}
        />
      ) : f.type === 'select' ? (
        <select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={f.type ?? 'text'}
          inputMode={f.type === 'tel' ? 'tel' : undefined}
          value={values[f.key] ?? ''}
          placeholder={f.placeholder}
          onChange={(e) => set(f.key, e.target.value)}
        />
      )}
      {f.hint && <span className="hint">{f.hint}</span>}
    </label>
  )

  return (
    <Modal title={title} onClose={onCancel}>
      <form onSubmit={submit} className="form">
        {rows.map((r) =>
          r.length === 2 ? (
            <div className="form-row" key={r[0].key}>
              {r.map(renderField)}
            </div>
          ) : (
            renderField(r[0])
          ),
        )}
        {extra}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** 把資料轉成表單用的字串值 */
export function toValues<T extends object>(rec: T, keys: string[]): Values {
  const out: Values = {}
  for (const k of keys) out[k] = String((rec as Record<string, unknown>)[k] ?? '')
  return out
}
