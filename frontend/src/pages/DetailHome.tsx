import { useNavigate } from 'react-router-dom'
import { Home, ArrowLeft } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'

function formatPower(w: number) { return Math.abs(w) >= 1000 ? `${(Math.abs(w)/1000).toFixed(1)} kW` : `${Math.round(Math.abs(w))} W` }

export default function DetailHome() {
  const navigate = useNavigate()
  const { status: wsStatus } = useWebSocket()
  const { data: polledStatus } = useAutoRefresh<any>('/status', 30000)
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = wsStatus || validPolled
  const { data: todayTotals } = useAutoRefresh<any>('/history/today', 30000)
  const { data: readings } = useApi('/history/readings?hours=24&resolution=5')

  const chartData = readings?.readings?.map((r: any) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    home: Math.round((r.home_power || 0) / 100) / 10,
  })) || []

  // Calculate peak and average
  const powers = readings?.readings?.map((r: any) => r.home_power || 0) || []
  const peakW = powers.length > 0 ? Math.max(...powers) : 0
  const avgW = powers.length > 0 ? powers.reduce((a: number, b: number) => a + b, 0) / powers.length : 0

  // Self-consumption ratio
  const selfConsumed = todayTotals ? Math.max(todayTotals.home_consumed_kwh - todayTotals.grid_imported_kwh, 0) : 0
  const selfRatio = todayTotals && todayTotals.home_consumed_kwh > 0 ? (selfConsumed / todayTotals.home_consumed_kwh) * 100 : 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-500" />
        </button>
        <Home className="w-6 h-6 text-cyan-500" />
        <h2 className="text-2xl font-bold">Home</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-header">Current Load</div>
          <div className="stat-value text-cyan-500 dark:text-cyan-400">{status ? formatPower(status.home_power) : '—'}</div>
        </div>
        <div className="card">
          <div className="card-header">Consumed Today</div>
          <div className="stat-value text-cyan-500 dark:text-cyan-400">{todayTotals ? `${todayTotals.home_consumed_kwh.toFixed(1)} kWh` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-header">Peak Load</div>
          <div className="stat-value text-slate-600 dark:text-slate-300">{peakW > 0 ? formatPower(peakW) : '—'}</div>
          <div className="stat-label">Last 24 hours</div>
        </div>
        <div className="card">
          <div className="card-header">Self-Powered</div>
          <div className="stat-value text-emerald-500 dark:text-emerald-400">{selfRatio > 0 ? `${selfRatio.toFixed(0)}%` : '—'}</div>
          <div className="stat-label">{selfConsumed.toFixed(1)} kWh from solar/battery</div>
        </div>
      </div>

      {/* Average load */}
      <div className="card">
        <div className="card-header">Average Load</div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold text-slate-700 dark:text-slate-200">{avgW > 0 ? formatPower(avgW) : '—'}</span>
          <span className="text-sm text-slate-500">over last 24 hours</span>
        </div>
      </div>

      {/* Consumption Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">Home Consumption (Last 24h)</div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="homeDetailGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}kW`} />
              <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`${v.toFixed(1)} kW`, 'Home']} />
              <Area type="monotone" dataKey="home" stroke="#22d3ee" fill="url(#homeDetailGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
