import { useState } from 'react'
import type { Trip } from '../types'
import { copyTripAsTemplate, type TemplateOptions } from '../db/copy'
import { Modal } from './Modal'

interface Props {
  source: Trip
  onCancel: () => void
  onDone: (trip: Trip) => Promise<void>
}

/** 以過去旅行為範本建立新旅行 */
export function TemplateDialog({ source, onCancel, onDone }: Props) {
  const [opt, setOpt] = useState<TemplateOptions>({
    name: `${source.name}（複製）`,
    startDate: '',
    itinerary: true,
    hotels: true,
    flights: false,
    todos: true,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const check = (key: 'itinerary' | 'hotels' | 'flights' | 'todos', label: string) => (
    <label className="check">
      <input
        type="checkbox"
        checked={opt[key]}
        onChange={(e) => setOpt({ ...opt, [key]: e.target.checked })}
      />
      <span>{label}</span>
    </label>
  )

  async function submit() {
    if (!opt.name.trim()) return setError('請輸入新旅行的名稱。')
    setSaving(true)
    try {
      const trip = await copyTripAsTemplate(source.id, { ...opt, name: opt.name.trim() })
      await onDone(trip)
    } catch (e) {
      setError(`建立失敗，原有資料沒有變更：${(e as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <Modal title="以這趟旅行為範本建立新旅行" onClose={onCancel}>
      <div className="form">
        <p className="muted">
          會建立一趟<b>全新的旅行</b>，「{source.name}」原本的資料不會被修改或刪除。
        </p>
        <label>
          <span>
            新旅行名稱 <span className="required">*</span>
          </span>
          <input value={opt.name} onChange={(e) => setOpt({ ...opt, name: e.target.value })} />
        </label>
        <label>
          <span>新的出發日期</span>
          <input
            type="date"
            value={opt.startDate}
            onChange={(e) => setOpt({ ...opt, startDate: e.target.value })}
          />
          <span className="hint">
            填了之後，行程、住宿、航班的日期都會依照新的出發日期自動平移。不填則保留原日期。
          </span>
        </label>
        <div>
          <div className="field-label">要一起複製的內容</div>
          {check('itinerary', '每日行程')}
          {check('hotels', '飯店住宿（不含訂房編號）')}
          {check('flights', '航班（不含訂位資訊）')}
          {check('todos', '待辦事項（全部改回未完成）')}
          <p className="hint">預算不會被複製。</p>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? '建立中…' : '建立新旅行'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
