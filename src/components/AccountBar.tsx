import { useState } from 'react'
import { useAuth } from '../auth/context'
import { OfflineBanner } from '../auth/AuthGate'
import { ConfirmDialog } from './Modal'
import { MembersDialog } from './MembersDialog'

/** 頁首下方：目前登入者、家庭成員、登出；離線時顯示提示 */
export function AccountBar() {
  const { membership, user, signOut, online } = useAuth()
  const [showMembers, setShowMembers] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <>
      <div className="account-bar">
        <span className={'sync-dot' + (online ? ' on' : '')} aria-hidden="true" />
        <span className="account-name">
          {membership.displayName || user.email}
          <span className="account-role">（{membership.role === 'owner' ? '管理者' : '成員'}）</span>
        </span>
        <button className="btn btn-small account-btn" onClick={() => setShowMembers(true)}>
          👪 家庭成員
        </button>
        <button className="btn btn-small account-btn" onClick={() => setConfirmLogout(true)}>
          登出
        </button>
      </div>
      <OfflineBanner online={online} />
      {showMembers && <MembersDialog onClose={() => setShowMembers(false)} />}
      {confirmLogout && (
        <ConfirmDialog
          title="登出"
          message="確定要登出嗎？再次使用時需要重新輸入 Email 和密碼。"
          confirmLabel="登出"
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            setConfirmLogout(false)
            void signOut()
          }}
        />
      )}
    </>
  )
}
