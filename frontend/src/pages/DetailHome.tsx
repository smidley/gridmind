import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Home, ArrowLeft, Sun, Battery, Zap, Layers } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'
import TimeRangeSelector, { getTimeRange, formatChartTime } from '../components/TimeRangeSelector'

function formatPower(w: number) { return Math.abs(w) >= 1000 ? `${(Math.abs(w)/1000).toFixed(1)} kW` : `${Math.round(Math.abs(w))} W` }

export default function DetailHome() {
  const navigate = useNavigate()
  const { status: wsStatus } = useWebSocket()
  const { data: polledStatus } = useAutoRefresh<any>('/status', 30000)
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = wsStatus || validPolled

  const [range, setRange] = useState('today')
  const [showSources, setShowSources] = useState(false)
  const tr = getTimeRange(range)

  const { data: rangeStats } = useApi<any>(`/history/range-stats?${tr.apiParam}`)
  const { data: readings } = useApi<any>(`/history/readings?${tr.apiParam}&resolution=${tr.resolution}`)

  const chartData = readings?.readings?.map((r: any) => {
    const solar = Math.max(r.solar_power || 0, 0) / 1000
    const batteryDischarge = Math.max(r.battery_power || 0, 0) / 1000  // positive = discharging
    const gridImport = Math.max(r.grid_power || 0, 0) / 1000  // positive = importing
    return {
      time: formatChartTime(r.timestamp, range),
      home: Math.round((r.home_power || 0) / 100) / 10,
      solar: Math.round(solar * 10) / 10,
      battery: Math.round(batteryDischarge * 10) / 10,
      grid: Math.round(gridImport * 10) / 10,
    }
  }) || []

  const rs = rangeStats || {}

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </button>
          <Home className="w-6 h-6 text-cyan-500" />
          <h2 className="text-2xl font-bold">Home</h2>
        </div>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-header">Current Load</div>
          <div className="stat-value text-cyan-500 dark:text-cyan-400">{status ? formatPower(status.home_power) : '—'}</div>
        </div>
        <div className="card">
          <div className="card-header">Consumed</div>
          <div className="stat-value text-cyan-500 dark:text-cyan-400">{rs.consumed_kwh > 0 ? `${rs.consumed_kwh} kWh` : '—'}</div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
        <div className="card">
          <div className="card-header">Peak Load</div>
          <div className="stat-value text-slate-600 dark:text-slate-300">{rs.peak_load_w > 0 ? formatPower(rs.peak_load_w) : '—'}</div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
        <div className="card">
          <div className="card-header">Average Load</div>
          <div className="stat-value text-slate-600 dark:text-slate-300">{rs.avg_load_w > 0 ? formatPower(rs.avg_load_w) : '—'}</div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
      </div>

      {/* Power Sources */}
      {rs.reading_count > 0 && (
        <div className="card">
          <div className="card-header">Power Sources</div>
          <div className="flex h-6 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800 mb-3">
            {rs.source_solar_pct > 0 && (
              <div
                className="bg-amber-400 dark:bg-amber-500 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
                style={{ width: `${rs.source_solar_pct}%` }}
              >
                {rs.source_solar_pct >= 12 && `${rs.source_solar_pct}%`}
              </div>
            )}
            {rs.source_battery_pct > 0 && (
              <div
                className="bg-blue-400 dark:bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
                style={{ width: `${rs.source_battery_pct}%` }}
              >
                {rs.source_battery_pct >= 12 && `${rs.source_battery_pct}%`}
              </div>
            )}
            {rs.source_grid_pct > 0 && (
              <div
                className="bg-red-300 dark:bg-red-400 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
                style={{ width: `${rs.source_grid_pct}%` }}
              >
                {rs.source_grid_pct >= 12 && `${rs.source_grid_pct}%`}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-4 sm:gap-6 text-xs">
            <div className="flex items-center gap-1.5">
              <Sun className="w-3 h-3 text-amber-400" />
              <span className="text-amber-400 font-medium">{rs.source_solar_pct}%</span>
              <span className="text-slate-500">Solar ({rs.solar_generated_kwh} kWh)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Battery className="w-3 h-3 text-blue-400" />
              <span className="text-blue-400 font-medium">{rs.source_battery_pct}%</span>
              <span className="text-slate-500">Battery ({rs.battery_discharged_kwh} kWh)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-red-400" />
              <span className="text-red-400 font-medium">{rs.source_grid_pct}%</span>
              <span className="text-slate-500">Grid ({rs.grid_imported_kwh} kWh)</span>
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Self-powered: <span className="text-emerald-400 font-medium">{rs.self_powered_pct}%</span>
          </div>
        </div>
      )}

      {/* Consumption Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <div className="card-header mb-0">
              {showSources ? 'Power Sources' : 'Home Consumption'} ({rs.period_label || ''})
            </div>
            <button
              onClick={() => setShowSources(!showSources)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                showSources
                  ? 'bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30'
                  : 'bg-slate-200/60 dark:bg-slate-800/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Sources
            </button>
          </div>

          {showSources ? (
            <>
              <div className="flex gap-4 text-[10px] text-slate-500 mb-2">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" /> Solar</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500" /> Battery</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400" /> Grid</span>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="srcSolar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="srcBattery" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="srcGrid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f87171" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f87171" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}kW`} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                    formatter={(v: number, name: string) => [
                      `${v.toFixed(1)} kW`,
                      name === 'solar' ? 'Solar' : name === 'battery' ? 'Battery' : 'Grid',
                    ]}
                  />
                  <Area type="monotone" dataKey="grid" stackId="1" stroke="#f87171" fill="url(#srcGrid)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="battery" stackId="1" stroke="#3b82f6" fill="url(#srcBattery)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="solar" stackId="1" stroke="#f59e0b" fill="url(#srcSolar)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          ) : (
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
                <Tooltip
                  contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                  formatter={(v: number) => [`${v.toFixed(1)} kW`, 'Home']}
                />
                <Area type="monotone" dataKey="home" stroke="#22d3ee" fill="url(#homeDetailGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}
