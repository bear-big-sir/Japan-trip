import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Trip } from './types'
import {
  buildExportFile,
  createRecord,
  getAll,
  getMeta,
  getStats,
  isCloudActive,
  markExported,
  setMeta,
  type Stats,
} from './db/db'
import { friendlyError } from './auth/household'
import { DEFAULT_TITLE, tabTitle } from './lib/title'
import { TitleDialog } from './components/TitleDialog'
import { downloadJson } from './lib/download'
import { HomePage } from './pages/HomePage'
import { ExchangePage } from './pages/ExchangePage'
import { FlightsPage } from './pages/FlightsPage'
import { HotelsPage } from './pages/HotelsPage'
import { ItineraryPage } from './pages/ItineraryPage'
import { ResearchPage } from './pages/ResearchPage'
import { TodosPage } from './pages/TodosPage'
import { BudgetPage } from './pages/BudgetPage'
import { TripBar } from './components/TripBar'
import { AccountBar } from './components/AccountBar'
import type { TripFields } from './components/TripForm'

type PageKey =
  | 'trips'
  | 'flights'
  | 'hotels'
  | 'itinerary'
  | 'research'
  | 'todos'
  | 'budget'
  | 'exchange'

const MENU: { key: PageKey; icon: string; label: string }[] = [
  { key: 'trips', icon: '🗾', label: '我的旅行' },
  { key: 'flights', icon: '✈️', label: '航班與機場' },
  { key: 'hotels', icon: '🏨', label: '飯店住宿' },
  { key: 'itinerary', icon: '📅', label: '每日行程' },
  { key: 'research', icon: '📝', label: '旅遊功課' },
  { key: 'todos', icon: '✅', label: '待辦事項' },
  { key: 'budget', icon: '💴', label: '旅遊預算' },
  { key: 'exchange', icon: '🔄', label: '資料交換與備份' },
]

const CURRENT_TRIP_KEY = 'usagi-current-trip'

export default function App() {
  const [page, setPage] = useState<PageKey>('trips')
  const [trips, setTrips] = useState<Trip[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [currentTripId, setCurrentTripId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CURRENT_TRIP_KEY)
    } catch {
      return null
    }
  })
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [editingTitle, setEditingTitle] = useState(false)

  useEffect(() => {
    getMeta<string>('appTitle')
      .then((t) => t && setTitle(t))
      .catch(() => {})
  }, [])

  useEffect(() => {
    document.title = tabTitle(title)
  }, [title])

  async function saveTitle(t: string) {
    await setMeta('appTitle', t)
    setTitle(t)
    setEditingTitle(false)
  }

  const reload = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([getAll('trips'), getStats()])
      setTrips(t)
      setStats(s)
    } catch (e) {
      setError(
        isCloudActive()
          ? `無法讀取雲端資料：${friendlyError(e)}`
          : `無法開啟本機資料庫：${(e as Error).message}。若使用無痕模式，請改用一般模式開啟。`,
      )
    }
  }, [])

  // 儲存、刪除等動作若失敗（例如斷線、版本衝突），統一在畫面上方顯示原因，不會假裝已儲存
  useEffect(() => {
    const onRejection = (ev: PromiseRejectionEvent) => setToast(friendlyError(ev.reason))
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  function selectTrip(id: string) {
    setCurrentTripId(id)
    try {
      localStorage.setItem(CURRENT_TRIP_KEY, id)
    } catch {
      // 無法記住選擇也沒關係
    }
  }

  async function createTrip(fields: TripFields) {
    const t = await createRecord('trips', fields)
    selectTrip(t.id)
    await reload()
  }

  async function exportAll() {
    const file = await buildExportFile()
    downloadJson(file)
    await markExported(file.exportedAt)
    await reload()
  }

  const currentTrip = trips.find((t) => t.id === currentTripId) ?? null
  const menuItem = MENU.find((m) => m.key === page)!

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <h1>{title}</h1>
          <button className="title-edit" onClick={() => setEditingTitle(true)} aria-label="修改網站標題">
            ✏️
          </button>
        </div>
        <AccountBar />
        <nav className="menu" aria-label="主要選單">
          {MENU.map((m) => (
            <button
              key={m.key}
              className={'menu-item' + (m.key === page ? ' active' : '')}
              onClick={() => setPage(m.key)}
            >
              <span className="menu-icon">{m.icon}</span>
              <span>{m.label}</span>
            </button>
          ))}
          <a className="menu-item" href="./drive-map.html">
            <span className="menu-icon">🚗</span>
            <span>自駕地圖</span>
          </a>
        </nav>
      </header>

      <main className="main">
        <h2 className="page-title">
          {menuItem.icon} {menuItem.label}
        </h2>
        {error && <div className="error-box">{error}</div>}
        {toast &&
          createPortal(
            <div className="error-toast" role="alert">
              <span>❌ 沒有儲存成功：{toast}</span>
              <button className="btn btn-small" onClick={() => setToast('')}>
                知道了
              </button>
            </div>,
            document.body,
          )}

        {page === 'trips' && (
          <HomePage
            trips={trips}
            stats={stats}
            currentTripId={currentTrip?.id ?? null}
            onSelectTrip={selectTrip}
            onChanged={reload}
            onExport={exportAll}
            onGoExchange={() => setPage('exchange')}
          />
        )}
        {page === 'exchange' && (
          <ExchangePage stats={stats} onExport={exportAll} onChanged={reload} />
        )}
        {page !== 'trips' && page !== 'exchange' && (
          <TripBar
            trips={trips}
            current={currentTrip}
            onSelect={selectTrip}
            onCreate={createTrip}
          />
        )}
        {currentTrip && page === 'flights' && (
          <FlightsPage key={currentTrip.id} trip={currentTrip} onChanged={reload} />
        )}
        {currentTrip && page === 'hotels' && (
          <HotelsPage key={currentTrip.id} trip={currentTrip} onChanged={reload} />
        )}
        {currentTrip && page === 'itinerary' && (
          <ItineraryPage key={currentTrip.id} trip={currentTrip} trips={trips} onChanged={reload} />
        )}
        {currentTrip && page === 'research' && (
          <ResearchPage key={currentTrip.id} trip={currentTrip} onChanged={reload} />
        )}
        {currentTrip && page === 'todos' && (
          <TodosPage key={currentTrip.id} trip={currentTrip} onChanged={reload} />
        )}
        {currentTrip && page === 'budget' && (
          <BudgetPage key={currentTrip.id} trip={currentTrip} onChanged={reload} />
        )}
      </main>

      {editingTitle && (
        <TitleDialog current={title} onSave={saveTitle} onCancel={() => setEditingTitle(false)} />
      )}

      <footer className="footer">
        {stats?.cloud
          ? '旅行資料存在 Supabase 雲端資料庫，家人登入後看到的是同一份資料。請定期匯出 JSON 備份。'
          : '旅行資料保存在本裝置瀏覽器（IndexedDB）。'}
      </footer>
    </div>
  )
}
