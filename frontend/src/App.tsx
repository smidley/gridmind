import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Rules from './pages/Rules'
import HistoryPage from './pages/History'
import ForecastPage from './pages/Forecast'
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
  { to: '/vehicle', icon: Car, label: 'Vehicle' },
  { to: '/forecast', icon: CloudSun, label: 'Forecast' },
  { to: '/value', icon: DollarSign, label: 'Value' },
  { to: '/rules', icon: Zap, label: 'Automation' },
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
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950">
        <Activity className="w-8 h-8 text-amber-500 animate-pulse" />
      </div>
    )
  }

  // Show login if auth is enabled and no valid session
  if (needsLogin) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen">
        {/* Desktop Sidebar — hidden on mobile */}
        <nav className="hidden md:flex w-64 bg-slate-100 border-r border-slate-200/60 flex-col dark:bg-slate-900 dark:border-slate-800">
          <div className="p-5 border-b border-slate-200/60 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-white">GridMind</h1>
                <p className="text-xs text-slate-400 dark:text-slate-500">Powerwall Automation</p>
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
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="w-4.5 h-4.5" />
                {label}
              </NavLink>
            ))}
          </div>

          <div className="p-4 border-t border-slate-200/60 dark:border-slate-800 space-y-3">
            <button
              onClick={cycleTheme}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors w-full"
              title={`Theme: ${theme}`}
            >
              <ThemeIcon className="w-3.5 h-3.5" />
              <span className="capitalize">{theme === 'system' ? 'System' : theme} mode</span>
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-red-400 dark:text-slate-500 dark:hover:text-red-400 transition-colors w-full"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>

            <a
              href="https://github.com/smidley/gridmind"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400 transition-colors"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>GridMind v1.1.0</span>
            </a>
          </div>
        </nav>

        {/* Main Content — adds bottom padding on mobile for nav bar */}
        <main className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-950 pb-16 md:pb-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/vehicle" element={<VehiclePage />} />
            <Route path="/forecast" element={<ForecastPage />} />
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
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 z-50">
          <div className="flex justify-around items-center h-14">
            {navItems.slice(0, 5).map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg min-w-0 ${
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span className="text-[9px] font-medium leading-none truncate">{label}</span>
              </NavLink>
            ))}
            {/* More menu: Settings + remaining items */}
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-400 dark:text-slate-500'
                }`
              }
            >
              <Settings className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-none">Settings</span>
            </NavLink>
          </div>
        </nav>
      </div>
    </BrowserRouter>
  )
}
