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
  Activity,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Rules from './pages/Rules'
import HistoryPage from './pages/History'
import ForecastPage from './pages/Forecast'
import ValuePage from './pages/Value'
import SettingsPage from './pages/Settings'
import { useTheme } from './hooks/useTheme'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/forecast', icon: CloudSun, label: 'Forecast' },
  { to: '/value', icon: DollarSign, label: 'Value' },
  { to: '/rules', icon: Zap, label: 'Automation' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function App() {
  const { theme, setTheme, resolved } = useTheme()

  const cycleTheme = () => {
    const order = ['system', 'light', 'dark'] as const
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % order.length])
  }

  const ThemeIcon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon

  return (
    <BrowserRouter>
      <div className="flex h-screen">
        {/* Sidebar */}
        <nav className="w-64 bg-slate-100 border-r border-slate-200/60 flex flex-col dark:bg-slate-900 dark:border-slate-800">
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
            {/* Theme toggle */}
            <button
              onClick={cycleTheme}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors w-full"
              title={`Theme: ${theme}`}
            >
              <ThemeIcon className="w-3.5 h-3.5" />
              <span className="capitalize">{theme === 'system' ? 'System' : theme} mode</span>
            </button>

            <a
              href="https://github.com/smidley/gridmind"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400 transition-colors"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>GridMind v0.9.2</span>
            </a>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-950">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/forecast" element={<ForecastPage />} />
            <Route path="/value" element={<ValuePage />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
