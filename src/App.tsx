import { useCallback, useEffect, useState } from 'react'
import type { Trip } from './types'
import { buildExportFile, getAll, getStats, type Stats } from './db/db'
import { downloadJson } from './lib/download'
import { HomePage } from './pages/HomePage'
import { ExchangePage } from './pages/ExchangePage'
import { PlaceholderPage } from './pages/PlaceholderPage'

type PageKey = 'trips' | 'flights' | 'hotels' | 'itinerary' | 'todos' | 'budget' | 'exchange'

const MENU: { key: PageKey; icon: string; label: string }[] = [
  { key: 'trips', icon: '🗾', label: '我的旅行' },
  { key: 'flights', icon: '✈️', label: '航班與機場' },
  { key: 'hotels', icon: '🏨', label: '飯店住宿' },
  { key: 'itinerary', icon: '📅', label: '每日行程' },
  { key: 'todos', icon: '✅', label: '待辦事項' },
  { key: 'budget', icon: '💴', label: '旅遊預算' },
  { key: 'exchange', icon: '🔄', label: '資料交換與備份' },
]

const PLACEHOLDERS: Record<
  Exclude<PageKey, 'trips' | 'exchange'>,
  { stage: string; features: string[] }
> = {
  flights: {
    stage: '第二階段',
    features: ['航空公司、航班號碼', '出發／抵達日期時間、機場及航廈', '訂位資訊及備註', '新增、修改、刪除'],
  },
  hotels: {
    stage: '第二階段',
    features: ['飯店名稱、地址、電話', '入住／退房日期', '訂房編號（私人資料提醒）、房型及備註', '新增、修改、刪除'],
  },
  itinerary: {
    stage: '第二階段',
    features: ['依日期查看單日完整行程', '時間、景點、地址、交通、停留時間、餐廳購物、備註', '調整順序', '複製某一天、複製過去旅行當範本（不改動原資料）'],
  },
  todos: {
    stage: '第三階段',
    features: ['機票、飯店、護照文件、網路交通票券、行李、自訂', '勾選完成、修改、刪除'],
  },
  budget: {
    stage: '第三階段',
    features: ['機票、住宿、交通、餐飲、購物、門票、其他', '名稱、金額、幣別、日期、備註', '分類小計與總額（不同幣別分開計算，可自訂匯率）'],
  },
}

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

  const reload = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([getAll('trips'), getStats()])
      setTrips(t)
      setStats(s)
    } catch (e) {
      setError(
        `無法開啟本機資料庫：${(e as Error).message}。若使用無痕模式，請改用一般模式開啟。`,
      )
    }
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

  async function exportAll() {
    downloadJson(await buildExportFile())
  }

  const currentTrip = trips.find((t) => t.id === currentTripId) ?? null
  const menuItem = MENU.find((m) => m.key === page)!

  return (
    <div className="app">
      <header className="header">
        <h1>🐰 兔兔家的日本自由行</h1>
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
        </nav>
      </header>

      <main className="main">
        <h2 className="page-title">
          {menuItem.icon} {menuItem.label}
        </h2>
        {error && <div className="error-box">{error}</div>}

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
          <PlaceholderPage
            title={menuItem.label}
            stage={PLACEHOLDERS[page].stage}
            features={PLACEHOLDERS[page].features}
            trip={currentTrip}
            onGoHome={() => setPage('trips')}
          />
        )}
      </main>

      <footer className="footer">
        資料只保存在本裝置瀏覽器（IndexedDB），不會上傳到任何伺服器。
      </footer>
    </div>
  )
}
