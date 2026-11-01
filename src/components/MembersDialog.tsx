import { useCallback, useEffect, useState } from 'react'
import { Modal, ConfirmDialog } from './Modal'
import { useAuth } from '../auth/context'
import {
  cancelInvite,
  friendlyError,
  inviteMember,
  listInvites,
  listMembers,
  removeMember,
  setMyDisplayName,
  type Invite,
  type Member,
} from '../auth/household'
import { formatDateTime } from '../lib/id'

/** 家庭成員：查看成員、修改自己的稱呼；管理者可以邀請與移除成員 */
export function MembersDialog({ onClose }: { onClose: () => void }) {
  const { client, user, membership, refresh, online } = useAuth()
  const isOwner = membership.role === 'owner'
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [myName, setMyName] = useState(membership.displayName)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)

  const load = useCallback(async () => {
    try {
      setMembers(await listMembers(client))
      setInvites(isOwner ? await listInvites(client) : [])
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [client, isOwner])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(done)
      await load()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="👪 家庭成員" onClose={onClose}>
      <p className="muted small">家庭工作區：{membership.householdName}</p>
      {error && <p className="error">{error}</p>}
      {message && <p className="notice">{message}</p>}

      <ul className="member-list">
        {members.map((m) => (
          <li key={m.userId} className="member-item">
            <div>
              <b>{m.displayName || '（未設定稱呼）'}</b>
              {m.userId === user.id && <span className="badge-soft"> 我</span>}
              <span className="badge"> {m.role === 'owner' ? '管理者' : '成員'}</span>
              <div className="muted small">{m.email}</div>
            </div>
            {isOwner && m.userId !== user.id && (
              <button className="btn btn-small btn-danger-outline" disabled={busy || !online} onClick={() => setRemoving(m)}>
                移除
              </button>
            )}
          </li>
        ))}
      </ul>

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await setMyDisplayName(client, myName)
            await refresh()
          }, '已更新你的稱呼。')
        }}
      >
        <label>
          <span>我的稱呼</span>
          <input required maxLength={50} value={myName} onChange={(e) => setMyName(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={busy || !online}>
          儲存稱呼
        </button>
      </form>

      {isOwner && (
        <>
          <h3>邀請家人</h3>
          <p className="muted small">
            步驟：① 先在 Supabase 後台 Authentication → Users 建立對方的帳號；② 在這裡輸入同一個 Email 送出邀請；
            ③ 對方登入後就會自動加入。邀請 14 天內有效。
          </p>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                await inviteMember(client, email, inviteName)
                setEmail('')
                setInviteName('')
              }, '已建立邀請。請對方用這個 Email 登入。')
            }}
          >
            <label>
              <span>對方的 Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              <span>對方的稱呼</span>
              <input maxLength={50} placeholder="例如：先生" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !online}>
                送出邀請
              </button>
            </div>
          </form>
          {invites.length > 0 && (
            <>
              <h3>等待加入</h3>
              <ul className="member-list">
                {invites.map((i) => (
                  <li key={i.id} className="member-item">
                    <div>
                      <b>{i.displayName || i.email}</b>
                      <div className="muted small">
                        {i.email}・期限 {formatDateTime(i.expiresAt)}
                      </div>
                    </div>
                    <button
                      className="btn btn-small"
                      disabled={busy || !online}
                      onClick={() => void run(() => cancelInvite(client, i.id), '已取消邀請。')}
                    >
                      取消邀請
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          關閉
        </button>
      </div>

      {removing && (
        <ConfirmDialog
          title="移除成員"
          danger
          confirmLabel="確定移除"
          message={`確定要把「${removing.displayName || removing.email}」移出家庭嗎？移除後對方將看不到任何旅行資料（已建立的資料會保留）。`}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const m = removing
            setRemoving(null)
            void run(() => removeMember(client, m.userId), '已移除成員。')
          }}
        />
      )}
    </Modal>
  )
}
