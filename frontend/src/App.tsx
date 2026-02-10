import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Zap,
  History,
  Settings,
  Sun,
  Activity,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Rules from './pages/Rules'
import HistoryPage from './pages/History'
import SettingsPage from './pages/Settings'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/rules', icon: Zap, label: 'Automation' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen">
        {/* Sidebar */}
        <nav className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
          <div className="p-5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">GridMind</h1>
                <p className="text-xs text-slate-500">Powerwall Automation</p>
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
                      ? 'bg-blue-600/20 text-blue-400'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="w-4.5 h-4.5" />
                {label}
              </NavLink>
            ))}
          </div>

          <div className="p-4 border-t border-slate-800">
            <a
              href="https://github.com/smidley/gridmind"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              <Sun className="w-3.5 h-3.5" />
              <span>GridMind v0.2.0</span>
            </a>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
