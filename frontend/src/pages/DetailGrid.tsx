import { useNavigate } from 'react-router-dom'
import { Zap, ArrowLeft } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'

function formatPower(w: number) { return Math.abs(w) >= 1000 ? `${(Math.abs(w)/1000).toFixed(1)} kW` : `${Math.round(Math.abs(w))} W` }

export default function DetailGrid() {
  const navigate = useNavigate()
  const { status: wsStatus } = useWebSocket()
  const { data: polledStatus } = useAutoRefresh<any>('/status', 30000)
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = wsStatus || validPolled
  const { data: todayTotals } = useAutoRefresh<any>('/history/today', 30000)
  const { data: tariff } = useApi('/site/tariff')
  const { data: value } = useAutoRefresh<any>('/history/value', 30000)
  const { data: readings } = useApi('/history/readings?hours=24&resolution=5')

  const importing = status && status.grid_power > 50
  const exporting = status && status.grid_power < -50

  const chartData = readings?.readings?.map((r: any) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    grid: Math.round((r.grid_power || 0) / 100) / 10,
  })) || []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-500" />
        </button>
        <Zap className="w-6 h-6 text-slate-500" />
        <h2 className="text-2xl font-bold">Grid</h2>
        {tariff?.configured && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            tariff.current_period_display === 'Peak' ? 'bg-red-500/20 text-red-600 dark:text-red-400'
            : tariff.current_period_display === 'Mid-Peak' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
            : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
          }`}>{tariff.current_period_display} · ${tariff.current_rate?.toFixed(3)}/kWh</span>
        )}
      </div>

      {/* Live + Today Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-header">Current</div>
          <div className={`stat-value ${importing ? 'text-red-500 dark:text-red-400' : exporting ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-500'}`}>
            {status ? formatPower(status.grid_power) : '—'}
          </div>
          <div className="stat-label">{importing ? 'Importing' : exporting ? 'Exporting' : 'Idle'}</div>
        </div>
        <div className="card">
          <div className="card-header">Exported Today</div>
          <div className="stat-value text-emerald-500 dark:text-emerald-400">{todayTotals ? `${todayTotals.grid_exported_kwh.toFixed(1)} kWh` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-header">Imported Today</div>
          <div className="stat-value text-red-500 dark:text-red-400">{todayTotals ? `${todayTotals.grid_imported_kwh.toFixed(1)} kWh` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-header">Net Credit</div>
          <div className={`stat-value ${todayTotals && todayTotals.grid_exported_kwh - todayTotals.grid_imported_kwh >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {todayTotals ? `${(todayTotals.grid_exported_kwh - todayTotals.grid_imported_kwh).toFixed(1)} kWh` : '—'}
          </div>
        </div>
      </div>

      {/* Value Summary */}
      {value && !value.error && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card">
            <div className="card-header">Export Credits</div>
            <div className="stat-value text-emerald-500 dark:text-emerald-400">+${value.export_credits.toFixed(2)}</div>
          </div>
          <div className="card">
            <div className="card-header">Import Costs</div>
            <div className="stat-value text-red-500 dark:text-red-400">-${value.import_costs.toFixed(2)}</div>
          </div>
          <div className="card">
            <div className="card-header">Net Value</div>
            <div className={`stat-value ${value.net_value >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
              {value.net_value >= 0 ? '+' : '-'}${Math.abs(value.net_value).toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Grid Power Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">Grid Power (Last 24h)</div>
          <p className="text-xs text-slate-500 mb-2">Above zero = importing, below zero = exporting</p>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gridPosGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gridNegGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}kW`} />
              <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`${v.toFixed(1)} kW`, v >= 0 ? 'Importing' : 'Exporting']} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="grid" stroke="#94a3b8" fill="url(#gridPosGrad)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Rate Schedule */}
      {tariff?.configured && (
        <div className="card">
          <div className="card-header">Rate Schedule — {tariff.utility}</div>
          <p className="text-xs text-slate-500 mb-2">{tariff.plan_name}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            {tariff.rate_schedule && Object.entries(tariff.rate_schedule).map(([period, info]: [string, any]) => (
              <div key={period} className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  info.display_name === 'Peak' ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                  : info.display_name === 'Mid-Peak' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                }`}>{info.display_name}</span>
                <span className="text-slate-500">${info.rate?.toFixed(3)}/kWh</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
