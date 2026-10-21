import { useState, type FormEvent } from 'react'
import type { Trip } from '../types'
import { Modal } from './Modal'

export type TripFields = Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>

interface Props {
  initial?: Trip
  onSave: (fields: TripFields) => Promise<void>
  onCancel: () => void
}

export function TripForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [year, setYear] = useState(String(initial?.year ?? new Date().getFullYear()))
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [destination, setDestination] = useState(initial?.destination ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function onStartChange(v: string) {
    setStartDate(v)
    // 選了出發日期時，自動帶入年份
    if (/^\d{4}-/.test(v)) setYear(v.slice(0, 4))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const y = Number(year)
    if (!name.trim()) return setError('請輸入旅行名稱。')
    if (!Number.isInteger(y) || y < 1900 || y > 2200) return setError('請輸入正確的年份。')
    if (startDate && endDate && endDate < startDate) return setError('回程日期不能早於出發日期。')
    setError('')
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        year: y,
        startDate,
        endDate,
        destination: destination.trim(),
        notes,
      })
    } catch (err) {
      setError(`儲存失敗：${(err as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <Modal title={initial ? '修改旅行' : '新增旅行'} onClose={onCancel}>
      <form onSubmit={submit} className="form">
        <label>
          <span>旅行名稱 <span className="required">*</span></span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：2026 北海道賞楓"
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            出發日期
            <input type="date" value={startDate} onChange={(e) => onStartChange(e.target.value)} />
          </label>
          <label>
            回程日期
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>旅行年份 <span className="required">*</span></span>
            <input
              type="number"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </label>
          <label>
            主要目的地
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="例如：札幌、函館"
            />
          </label>
        </div>
        <label>
          旅行備註
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
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
