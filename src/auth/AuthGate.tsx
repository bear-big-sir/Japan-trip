import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { useOnline } from '../lib/useOnline'
import { AuthContext, type AuthState } from './context'
import { createHousehold, friendlyError, loadMembership, type Membership } from './household'
import { setCloudContext } from '../db/cloud'

type Phase = 'loading' | 'signedOut' | 'noHousehold' | 'ready' | 'error'

/**
 * 登入檢查：
 * 1. 沒登入 → 顯示登入畫面（不提供註冊）。
 * 2. 已登入但沒有家庭 → 顯示「建立家庭／等待邀請」。
 * 3. 已登入且是家庭成員 → 顯示主畫面。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const online = useOnline()
  const [session, setSession] = useState<Session | null>(null)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')

  const resolve = useCallback(async (s: Session | null) => {
    setSession(s)
    if (!s || !supabase) {
      setCloudContext(null)
      setMembership(null)
      setPhase('signedOut')
      return
    }
    try {
      const m = await loadMembership(supabase, s.user.id)
      // 先設定好雲端連線，主畫面一出現就從雲端讀資料
      setCloudContext(m ? { client: supabase, householdId: m.householdId, userId: s.user.id } : null)
      setMembership(m)
      setError('')
      setPhase(m ? 'ready' : 'noHousehold')
    } catch (e) {
      setError(friendlyError(e))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) void resolve(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      // 自動更新登入憑證時不必重新查詢家庭
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setTimeout(() => {
          if (alive) void resolve(s)
        }, 0)
      }
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [resolve])

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
  }, [])
  const refresh = useCallback(() => resolve(session), [resolve, session])

  const value = useMemo<AuthState | null>(
    () =>
      supabase && session && membership
        ? { client: supabase, user: session.user, membership, online, signOut, refresh }
        : null,
    [session, membership, online, signOut, refresh],
  )

  if (!supabaseConfigured) {
    return (
      <Shell>
        <div className="error-box">
          <b>尚未設定雲端資料庫。</b>
          <p className="small">
            網站缺少 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY 設定。本機開發請建立 .env.local；
            正式網站請在 GitHub → Settings → Secrets and variables → Actions 新增這兩個設定後重新部署。
          </p>
        </div>
      </Shell>
    )
  }

  if (phase === 'loading') {
    return (
      <Shell>
        <p className="muted">正在確認登入狀態…</p>
      </Shell>
    )
  }

  if (phase === 'signedOut') return <LoginPage online={online} />

  if (phase === 'error') {
    return (
      <Shell>
        <OfflineBanner online={online} />
        <div className="error-box">
          <p className="error">{error}</p>
        </div>
        <div className="form-actions">
          <button className="btn" onClick={signOut}>
            登出
          </button>
          <button className="btn btn-primary" onClick={() => resolve(session)}>
            重新連線
          </button>
        </div>
      </Shell>
    )
  }

  if (phase === 'noHousehold' || !value) {
    return (
      <HouseholdSetup
        email={session?.user.email ?? ''}
        online={online}
        onRecheck={() => resolve(session)}
        onSignOut={signOut}
      />
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <h1>🐰 兔兔家的日本自由行</h1>
        </div>
      </header>
      <main className="main auth-main">{children}</main>
    </div>
  )
}

export function OfflineBanner({ online }: { online: boolean }) {
  if (online) return null
  return (
    <div className="offline-banner" role="status">
      📴 目前離線：無法連線到雲端資料庫，網路恢復後會自動重新讀取。
    </div>
  )
}

function LoginPage({ online }: { online: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(friendlyError(error))
  }

  return (
    <Shell>
      <OfflineBanner online={online} />
      <div className="card auth-card">
        <h2 className="modal-title">登入</h2>
        <p className="muted small">只有家庭成員可以登入。帳號由家庭管理者建立，本網站不開放自行註冊。</p>
        <form className="form" onSubmit={submit}>
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            <span>密碼</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !online}>
              {busy ? '登入中…' : '登入'}
            </button>
          </div>
        </form>
        <p className="hint">忘記密碼時，請管理者到 Supabase 後台 Authentication → Users 重新設定密碼。</p>
      </div>
    </Shell>
  )
}

function HouseholdSetup({
  email,
  online,
  onRecheck,
  onSignOut,
}: {
  email: string
  online: boolean
  onRecheck: () => void
  onSignOut: () => void
}) {
  const [name, setName] = useState('兔兔家')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    try {
      await createHousehold(supabase, name.trim(), displayName.trim())
      onRecheck()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <OfflineBanner online={online} />
      <p className="muted small">目前登入：{email}</p>
      <div className="card auth-card">
        <h2 className="modal-title">你還沒有加入家庭工作區</h2>
        <p>
          <b>如果你是家人（例如先生）：</b>請家庭管理者在「家庭成員」裡邀請你的 Email（{email}），
          然後按下方「重新檢查邀請」。
        </p>
        <div className="form-actions">
          <button className="btn" onClick={onSignOut}>
            登出
          </button>
          <button className="btn btn-primary" onClick={onRecheck}>
            重新檢查邀請
          </button>
        </div>
      </div>
      <div className="card auth-card">
        <h3>如果你是第一位使用者（家庭管理者）</h3>
        <p className="muted small">建立家庭工作區後，你會成為管理者，之後可以邀請家人加入。每個帳號只能屬於一個家庭。</p>
        <form className="form" onSubmit={submit}>
          <label>
            <span>家庭名稱</span>
            <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>我的稱呼</span>
            <input
              required
              maxLength={50}
              placeholder="例如：兔兔"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <span className="hint">會顯示在「最後更新者」與修改紀錄。</span>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !online}>
              {busy ? '建立中…' : '建立家庭工作區'}
            </button>
          </div>
        </form>
      </div>
    </Shell>
  )
}
