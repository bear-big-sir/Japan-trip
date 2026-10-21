import { useEffect, useState } from 'react'
import type { LocalBackup } from '../types'
import {
  createBackup,
  deleteBackup,
  getMeta,
  listBackups,
  restoreBackup,
  setMeta,
  type Stats,
} from '../db/db'
import { formatDateTime } from '../lib/id'
import { downloadJson, exportFileName } from '../lib/download'
import { ConfirmDialog } from '../components/Modal'
import { BackupWarning, StatsBar } from '../components/StatsBar'

interface Props {
  stats: Stats | null
  onExport: () => Promise<void>
  onChanged: () => Promise<void>
}

export function ExchangePage({ stats, onExport, onChanged }: Props) {
  const [deviceName, setDeviceName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [backups, setBackups] = useState<LocalBackup[]>([])
  const [restoring, setRestoring] = useState<LocalBackup | null>(null)
  const [deletingBackup, setDeletingBackup] = useState<LocalBackup | null>(null)
  const [message, setMessage] = useState('')

  async function refresh() {
    setBackups(await listBackups())
  }

  useEffect(() => {
    getMeta<string>('deviceName').then((n) => {
      setDeviceName(n ?? '')
      setSavedName(n ?? '')
    })
    refresh()
  }, [])

  async function saveName() {
    await setMeta('deviceName', deviceName.trim())
    setSavedName(deviceName.trim())
    setMessage('已儲存裝置名稱。')
  }

  async function manualBackup() {
    await createBackup('手動建立的本機備份')
    await refresh()
    setMessage('已在本機建立備份。注意：本機備份也存在這個瀏覽器裡，請另外匯出 JSON 檔。')
  }

  async function doRestore() {
    if (!restoring) return
    try {
      await restoreBackup(restoring.id)
      setMessage(`已還原 ${formatDateTime(restoring.createdAt)} 的備份。`)
    } catch (e) {
      setMessage(`還原失敗，原有資料沒有變更：${(e as Error).message}`)
    }
    setRestoring(null)
    await refresh()
    await onChanged()
  }

  async function doDeleteBackup() {
    if (!deletingBackup) return
    await deleteBackup(deletingBackup.id)
    setDeletingBackup(null)
    await refresh()
  }

  const countOf = (b: LocalBackup) =>
    Object.values(b.file.data).reduce((sum, list) => sum + list.length, 0)

  return (
    <section>
      <BackupWarning />
      <StatsBar stats={stats} />
      {message && (
        <div className="notice" onClick={() => setMessage('')}>
          {message}
        </div>
      )}

      <div className="card">
        <h3>① 這台裝置的名稱</h3>
        <p className="muted">匯出檔案會記錄這個名稱，方便分辨是誰匯出的（例如「兔兔的 iPhone」）。</p>
        <div className="inline-form">
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="例如：兔兔的 iPhone"
          />
          <button className="btn" onClick={saveName} disabled={deviceName.trim() === savedName}>
            儲存
          </button>
        </div>
      </div>

      <div className="card">
        <h3>② 匯出 JSON</h3>
        <p>匯出這台裝置上的全部旅行及相關資料，檔名會像 {exportFileName()}。</p>
        <p className="warning-text">
          ⚠️ 檔案可能包含訂房編號、航班訂位等私人資料，請妥善保存，不要公開分享或上傳到 GitHub。
        </p>
        <button className="btn btn-primary" onClick={onExport}>
          ⬇ 匯出全部資料
        </button>
      </div>

      <div className="card">
        <h3>③ 匯入 JSON 與安全合併</h3>
        <p className="muted">
          🚧 匯入、預覽、衝突比對與安全合併會在<b>第四階段</b>完成。
          現在的資料結構已經為合併做好準備：每筆資料都有唯一 ID、建立時間及修改時間。
        </p>
      </div>

      <div className="card">
        <h3>④ 本機備份與還原</h3>
        <p className="muted">
          每次匯入前系統會自動建立備份（最多保留 10 份）。本機備份和資料存在同一個瀏覽器，
          清除瀏覽器資料時會一起消失，所以仍然要匯出 JSON 檔另外保存。
        </p>
        <button className="btn" onClick={manualBackup}>
          ＋ 立即建立本機備份
        </button>
        {backups.length === 0 ? (
          <p className="muted">目前沒有本機備份。</p>
        ) : (
          <ul className="backup-list">
            {backups.map((b) => (
              <li key={b.id} className="backup-item">
                <div>
                  <b>{formatDateTime(b.createdAt)}</b>
                  <div className="muted small">
                    {b.reason} · {b.file.data.trips.length} 趟旅行，共 {countOf(b)} 筆資料
                  </div>
                </div>
                <div className="card-actions">
                  <button className="btn btn-small" onClick={() => downloadJson(b.file)}>
                    下載
                  </button>
                  <button className="btn btn-small" onClick={() => setRestoring(b)}>
                    還原
                  </button>
                  <button
                    className="btn btn-small btn-danger-outline"
                    onClick={() => setDeletingBackup(b)}
                  >
                    刪除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>💑 夫妻資料交換步驟</h3>
        <ol>
          <li>兩個人各自在自己的手機或電腦上新增、修改資料。</li>
          <li>各自按「匯出全部資料」，取得最新的 JSON 檔。</li>
          <li>把自己的 JSON 傳給對方（例如 AirDrop、私訊或 Email），再把對方的 JSON 匯入自己的裝置。</li>
          <li>使用「安全合併」：不同的資料會自動加入，完全相同的只保留一份。</li>
          <li>如果同一筆資料兩人都改過，系統會列出雙方內容與修改時間，由你選擇要保留哪一份。</li>
          <li>合併完成後，再匯出一次完整資料，作為下一次交換的基礎。</li>
        </ol>
        <p className="warning-text">
          💡 如果兩個人長時間各自編輯，衝突會變多。建議每次修改完行程後就先交換、合併一次。
        </p>
      </div>

      {restoring && (
        <ConfirmDialog
          title="確定要還原這份備份？"
          danger
          confirmLabel="確定還原"
          message={
            <>
              <p>
                目前所有資料會被替換成 <b>{formatDateTime(restoring.createdAt)}</b> 的備份內容
                （{countOf(restoring)} 筆資料）。
              </p>
              <p>還原前，系統會先把目前的資料再自動備份一次。</p>
            </>
          }
          onConfirm={doRestore}
          onCancel={() => setRestoring(null)}
        />
      )}
      {deletingBackup && (
        <ConfirmDialog
          title="確定要刪除這份本機備份？"
          danger
          confirmLabel="確定刪除"
          message={<p>刪除 {formatDateTime(deletingBackup.createdAt)} 的備份後無法復原。</p>}
          onConfirm={doDeleteBackup}
          onCancel={() => setDeletingBackup(null)}
        />
      )}
    </section>
  )
}
