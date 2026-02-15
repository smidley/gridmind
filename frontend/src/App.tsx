import { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Zap,
  History,
  Settings,
  Sun,
  Moon,
  Monitor,
  CloudSun,
  DollarSign,
  Car,
  Activity,
  LogOut,
  Trophy,
  Home,
  Battery,
  Workflow,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Rules from './pages/Rules'
import HistoryPage from './pages/History'
// Forecast page removed — content merged into Solar detail page
import ValuePage from './pages/Value'
import SettingsPage from './pages/Settings'
import DetailSolar from './pages/DetailSolar'
import DetailGrid from './pages/DetailGrid'
import DetailHome from './pages/DetailHome'
import DetailBattery from './pages/DetailBattery'
import VehiclePage from './pages/Vehicle'
import Achievements from './pages/Achievements'
import Login from './pages/Login'
import { useTheme } from './hooks/useTheme'
import { apiFetch } from './hooks/useApi'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/detail/solar', icon: Sun, label: 'Solar' },
  { to: '/detail/home', icon: Home, label: 'Home' },
  { to: '/detail/grid', icon: Zap, label: 'Grid' },
  { to: '/detail/battery', icon: Battery, label: 'Battery' },
  { to: '/vehicle', icon: Car, label: 'Vehicle' },
  { to: '/value', icon: DollarSign, label: 'Value' },
  { to: '/rules', icon: Workflow, label: 'Automation' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/achievements', icon: Trophy, label: 'Achievements' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function App() {
  const { theme, setTheme, resolved } = useTheme()
  const [authChecked, setAuthChecked] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)

  // Check if auth is enabled and if we have a valid session
  useEffect(() => {
    apiFetch('/app-auth/status')
      .then((data: any) => {
        if (data.auth_enabled) {
          // Test a protected endpoint to see if our session is valid
          apiFetch('/status')
            .then(() => setAuthChecked(true))
            .catch(() => { setNeedsLogin(true); setAuthChecked(true) })
        } else {
          setAuthChecked(true)
        }
      })
      .catch(() => setAuthChecked(true))
  }, [])

  const handleLogin = () => {
    setNeedsLogin(false)
  }

  const handleLogout = async () => {
    await apiFetch('/app-auth/logout', { method: 'POST' }).catch(() => {})
    setNeedsLogin(true)
  }

  const cycleTheme = () => {
    const order = ['system', 'light', 'dark'] as const
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % order.length])
  }

  const ThemeIcon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-100 dark:bg-slate-950">
        <Activity className="w-8 h-8 text-amber-500 animate-pulse" />
      </div>
    )
  }

  // Show login if auth is enabled and no valid session
  if (needsLogin) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <ErrorBoundary>
    <BrowserRouter>
      <div className="flex h-screen safe-top">
        {/* Desktop Sidebar — hidden on mobile */}
        <nav className="hidden md:flex w-64 bg-stone-50 border-r border-stone-200/60 flex-col dark:bg-slate-900 dark:border-slate-800">
          <div className="p-5 border-b border-stone-200/60 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-white">GridMind</h1>
                <p className="text-xs text-stone-400 dark:text-slate-500">Powerwall Automation</p>
              </div>
            </div>
          </div>

          <div className="flex-1 py-4">
            {navItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-2.5 mx-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600/10 text-blue-600 dark:bg-blue-600/20 dark:text-blue-400'
                      : 'text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="w-4.5 h-4.5" />
                {label}
              </NavLink>
            ))}
          </div>

          <div className="p-4 border-t border-stone-200/60 dark:border-slate-800 space-y-3">
            <button
              onClick={cycleTheme}
              className="flex items-center gap-2 text-xs text-stone-400 hover:text-stone-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors w-full"
              title={`Theme: ${theme}`}
            >
              <ThemeIcon className="w-3.5 h-3.5" />
              <span className="capitalize">{theme === 'system' ? 'System' : theme} mode</span>
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-xs text-stone-400 hover:text-red-400 dark:text-slate-500 dark:hover:text-red-400 transition-colors w-full"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>

            <a
              href="https://buymeacoffee.com/smidley"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-amber-500/70 hover:text-amber-500 transition-colors w-full"
            >
              <span>☕</span>
              <span>Buy Me a Coffee</span>
            </a>

            <a
              href="https://github.com/smidley/gridmind"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-stone-400 hover:text-stone-600 dark:text-slate-600 dark:hover:text-slate-400 transition-colors"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>GridMind v1.2.12</span>
            </a>
          </div>
        </nav>

        {/* Main Content — bottom padding accounts for nav bar + safe area on mobile */}
        <main className="flex-1 overflow-auto bg-stone-100 dark:bg-slate-950 main-content-mobile md:pb-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/vehicle" element={<VehiclePage />} />
            {/* /forecast removed — content on Solar page now */}
            <Route path="/value" element={<ValuePage />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/detail/solar" element={<DetailSolar />} />
            <Route path="/detail/grid" element={<DetailGrid />} />
            <Route path="/detail/home" element={<DetailHome />} />
            <Route path="/detail/battery" element={<DetailBattery />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>

        {/* Mobile Bottom Navigation — visible only on small screens */}
        <MobileNav onLogout={handleLogout} />
      </div>
    </BrowserRouter>
    </ErrorBoundary>
  )
}

/** Error boundary — catches unhandled React errors and shows a recovery UI */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('GridMind error boundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-100 dark:bg-slate-950 p-6">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-6">
              <Activity className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.href = '/'
              }}
              className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}


/** Mobile bottom nav with expandable "More" menu for all pages */
function MobileNav({ onLogout }: { onLogout: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const { theme, setTheme } = useTheme()

  const cycleTheme = () => {
    const order = ['system', 'light', 'dark'] as const
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % order.length])
  }
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon

  const primaryItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/detail/solar', icon: Sun, label: 'Solar' },
    { to: '/detail/battery', icon: Battery, label: 'Battery' },
    { to: '/vehicle', icon: Car, label: 'Vehicle' },
  ]

  const moreItems = [
    { to: '/detail/home', icon: Home, label: 'Home' },
    { to: '/detail/grid', icon: Zap, label: 'Grid' },
    { to: '/value', icon: DollarSign, label: 'Value' },
    { to: '/rules', icon: Workflow, label: 'Automation' },
    { to: '/history', icon: History, label: 'History' },
    { to: '/achievements', icon: Trophy, label: 'Achievements' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ]

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute above-safe-nav left-2 right-2 bg-stone-50 dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 shadow-xl p-3 grid grid-cols-4 gap-2" onClick={(e) => e.stopPropagation()}>
            {moreItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl text-center ${
                    isActive
                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'text-stone-500 dark:text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </NavLink>
            ))}
            <button
              onClick={() => { cycleTheme() }}
              className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl text-stone-500 dark:text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-800"
            >
              <ThemeIcon className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none capitalize">{theme === 'system' ? 'System' : theme}</span>
            </button>
            <button
              onClick={() => { onLogout(); setMoreOpen(false) }}
              className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl text-stone-400 hover:text-red-400 hover:bg-red-500/5"
            >
              <LogOut className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none">Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-stone-50/95 dark:bg-slate-900/95 backdrop-blur border-t border-stone-200 dark:border-slate-800 z-50 safe-bottom">
        <div className="flex justify-around items-center h-14">
          {primaryItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg min-w-0 ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-stone-400 dark:text-slate-500'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-none truncate">{label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg ${
              moreOpen ? 'text-blue-600 dark:text-blue-400' : 'text-stone-400 dark:text-slate-500'
            }`}
          >
            <Activity className="w-5 h-5" />
            <span className="text-[9px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
