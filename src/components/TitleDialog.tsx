import { useState } from 'react'
import { Modal } from './Modal'
import { DEFAULT_TITLE } from '../lib/title'

interface Props {
  current: string
  onSave: (title: string) => Promise<void>
  onCancel: () => void
}

/** 修改網站標題：只存在這台裝置，不會影響別人看到的標題 */
export function TitleDialog({ current, onSave, onCancel }: Props) {
  const [value, setValue] = useState(current)
  const [saving, setSaving] = useState(false)

  async function save(title: string) {
    setSaving(true)
    await onSave(title.trim() || DEFAULT_TITLE)
  }

  return (
    <Modal title="修改網站標題" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          save(value)
        }}
      >
        <label>
          <span>網站標題</span>
          <input value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} placeholder={DEFAULT_TITLE} />
          <span className="hint">
            標題只保存在這台裝置。朋友打開同一個網址，看到的是預設的「{DEFAULT_TITLE}」或他們自己設定的標題。
          </span>
        </label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => save(DEFAULT_TITLE)} disabled={saving}>
            恢復預設
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            儲存
          </button>
        </div>
      </form>
    </Modal>
  )
}
