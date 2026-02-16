import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, ArrowLeft } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Legend } from 'recharts'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'
import TimeRangeSelector, { getTimeRange, formatChartTime } from '../components/TimeRangeSelector'

function formatPower(w: number) { return Math.abs(w) >= 1000 ? `${(Math.abs(w)/1000).toFixed(1)} kW` : `${Math.round(Math.abs(w))} W` }

export default function DetailGrid() {
  const navigate = useNavigate()
  const { status: wsStatus } = useWebSocket()
  const { data: polledStatus } = useAutoRefresh<any>('/status', 30000)
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = wsStatus || validPolled

  const [range, setRange] = useState('today')
  const tr = getTimeRange(range)

  const { data: rangeStats } = useApi<any>(`/history/range-stats?${tr.apiParam}`)
  const { data: readings } = useApi<any>(`/history/readings?${tr.apiParam}&resolution=${tr.resolution}`)
  const { data: tariff } = useApi('/site/tariff')
  const { data: value } = useAutoRefresh<any>('/history/value', 60000)
  const { data: gridMix } = useAutoRefresh<any>('/grid/energy-mix', 300000)

  const rs = rangeStats || {}
  const importing = status && status.grid_power > 50
  const exporting = status && status.grid_power < -50
  const netCredit = (rs.grid_exported_kwh || 0) - (rs.grid_imported_kwh || 0)

  const chartData = readings?.readings?.map((r: any) => ({
    time: formatChartTime(r.timestamp, range),
    grid: Math.round((r.grid_power || 0) / 100) / 10,
  })) || []

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-header">Current</div>
          <div className={`stat-value ${importing ? 'text-red-500 dark:text-red-400' : exporting ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-500'}`}>
            {status ? formatPower(status.grid_power) : '—'}
          </div>
          <div className="stat-label">{importing ? 'Importing' : exporting ? 'Exporting' : 'Idle'}</div>
        </div>
        <div className="card">
          <div className="card-header">Exported</div>
          <div className="stat-value text-emerald-500 dark:text-emerald-400">{rs.grid_exported_kwh > 0 ? `${rs.grid_exported_kwh} kWh` : '—'}</div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
        <div className="card">
          <div className="card-header">Imported</div>
          <div className="stat-value text-red-500 dark:text-red-400">{rs.grid_imported_kwh > 0 ? `${rs.grid_imported_kwh} kWh` : '—'}</div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
        <div className="card">
          <div className="card-header">Net Credit</div>
          <div className={`stat-value ${netCredit >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {rs.reading_count > 0 ? `${netCredit.toFixed(1)} kWh` : '—'}
          </div>
          <div className="stat-label">{rs.period_label || ''}</div>
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
      {chartData.length > 0 && (() => {
        // Calculate where zero falls in the chart's Y range for the gradient split
        const values = chartData.map((d: any) => d.grid)
        const maxVal = Math.max(...values, 0.1)
        const minVal = Math.min(...values, -0.1)
        const range = maxVal - minVal
        // Zero point as a fraction from top (0) to bottom (1)
        const zeroPoint = range > 0 ? maxVal / range : 0.5

        return (
        <div className="card">
          <div className="card-header">Grid Power ({rs.period_label || ''})</div>
          <p className="text-xs text-slate-500 mb-2">Above zero = importing, below zero = exporting</p>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gridSplitFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" stopOpacity={0.25} />
                  <stop offset={`${(zeroPoint * 100).toFixed(1)}%`} stopColor="#f87171" stopOpacity={0.03} />
                  <stop offset={`${(zeroPoint * 100).toFixed(1)}%`} stopColor="#34d399" stopOpacity={0.03} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.25} />
                </linearGradient>
                <linearGradient id="gridSplitStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" />
                  <stop offset={`${(zeroPoint * 100).toFixed(1)}%`} stopColor="#f87171" />
                  <stop offset={`${(zeroPoint * 100).toFixed(1)}%`} stopColor="#34d399" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}kW`} />
              <Tooltip
               
                formatter={(v: number) => [`${Math.abs(v).toFixed(1)} kW`, v >= 0 ? 'Importing' : 'Exporting']}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="grid" stroke="url(#gridSplitStroke)" fill="url(#gridSplitFill)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        )
      })()}

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

      {/* Grid Energy Sources */}
      {gridMix?.configured && gridMix?.sources && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="card-header mb-0">Grid Energy Sources</div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              gridMix.clean_pct >= 80 ? 'bg-emerald-500/15 text-emerald-500'
              : gridMix.clean_pct >= 50 ? 'bg-amber-500/15 text-amber-500'
              : 'bg-red-500/15 text-red-400'
            }`}>
              {gridMix.clean_pct}% Clean
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Region: {gridMix.balancing_authority} · Last updated: {gridMix.period || '—'}
            {' · '}
            <a href="https://www.eia.gov/opendata/" target="_blank" rel="noreferrer" className="underline hover:text-slate-400 transition-colors">
              Source: U.S. Energy Information Administration (EIA)
            </a>
          </p>

          {/* Stacked bar */}
          <div className="flex h-8 rounded-lg overflow-hidden mb-3">
            {Object.entries(gridMix.sources as Record<string, any>)
              .sort(([,a]: any, [,b]: any) => b.pct - a.pct)
              .map(([fuel, info]: [string, any]) => {
                const colorMap: Record<string, string> = {
                  WAT: 'bg-blue-500', SUN: 'bg-amber-400', WND: 'bg-teal-400',
                  NUC: 'bg-violet-500', BAT: 'bg-cyan-400', NG: 'bg-orange-400',
                  COL: 'bg-stone-500', OIL: 'bg-red-400', OTH: 'bg-slate-500',
                }
                return (
                  <div
                    key={fuel}
                    className={`${colorMap[fuel] || 'bg-slate-500'} flex items-center justify-center text-[9px] font-bold text-white transition-all duration-700`}
                    style={{ width: `${info.pct}%` }}
                    title={`${info.name}: ${info.pct}%`}
                  >
                    {info.pct >= 8 && `${info.pct}%`}
                  </div>
                )
              })}
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {Object.entries(gridMix.sources as Record<string, any>)
              .sort(([,a]: any, [,b]: any) => b.pct - a.pct)
              .map(([fuel, info]: [string, any]) => {
                const dotColorMap: Record<string, string> = {
                  WAT: 'bg-blue-500', SUN: 'bg-amber-400', WND: 'bg-teal-400',
                  NUC: 'bg-violet-500', BAT: 'bg-cyan-400', NG: 'bg-orange-400',
                  COL: 'bg-stone-500', OIL: 'bg-red-400', OTH: 'bg-slate-500',
                }
                return (
                  <div key={fuel} className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${dotColorMap[fuel] || 'bg-slate-500'}`} />
                    <span className="text-slate-500 dark:text-slate-400">{info.name}</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{info.pct}%</span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Grid Cleanliness Over Time */}
      {gridMix?.configured && gridMix?.hourly?.length > 0 && (() => {
        // Build chart data from hourly breakdown
        const chartData = gridMix.hourly.map((h: any) => {
          // Use local_hour from backend (already converted from UTC)
          const hr = h.local_hour ?? 0
          const label = hr === 0 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p`
          return {
            label,
            hour: hr,
            WAT: h.WAT || 0,
            WND: h.WND || 0,
            SUN: h.SUN || 0,
            NUC: h.NUC || 0,
            BAT: h.BAT || 0,
            NG: h.NG || 0,
            COL: h.COL || 0,
            OIL: h.OIL || 0,
            OTH: h.OTH || 0,
            clean_pct: h.clean_pct || 0,
          }
        })

        return (
          <div className="card">
            <div className="card-header">Grid Source Mix — Last 24 Hours</div>
            <p className="text-xs text-slate-500 mb-3">
              Percentage of generation by fuel type each hour ·{' '}
              <a href="https://www.eia.gov/opendata/" target="_blank" rel="noreferrer" className="underline hover:text-slate-400">
                Source: U.S. Energy Information Administration
              </a>
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} stackOffset="expand">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" stroke="#475569" fontSize={10} tickLine={false} />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.06)' }}
                  formatter={(v: number, name: string) => {
                    const nameMap: Record<string, string> = { WAT: 'Hydro', WND: 'Wind', SUN: 'Solar', NUC: 'Nuclear', BAT: 'Battery', NG: 'Gas', COL: 'Coal', OIL: 'Oil', OTH: 'Other' }
                    return [`${v.toFixed(1)}%`, nameMap[name] || name]
                  }}
                />
                <Legend formatter={(val) => {
                  const nameMap: Record<string, string> = { WAT: 'Hydro', WND: 'Wind', SUN: 'Solar', NUC: 'Nuclear', BAT: 'Battery', NG: 'Gas', COL: 'Coal', OIL: 'Oil', OTH: 'Other' }
                  return <span className="text-xs text-slate-600 dark:text-slate-300">{nameMap[val] || val}</span>
                }} />
                {/* Clean sources (bottom) */}
                <Bar dataKey="WAT" stackId="fuel" fill="#3b82f6" />
                <Bar dataKey="WND" stackId="fuel" fill="#2dd4bf" />
                <Bar dataKey="SUN" stackId="fuel" fill="#fbbf24" />
                <Bar dataKey="NUC" stackId="fuel" fill="#8b5cf6" />
                <Bar dataKey="BAT" stackId="fuel" fill="#22d3ee" />
                {/* Fossil sources (top) */}
                <Bar dataKey="NG" stackId="fuel" fill="#fb923c" />
                <Bar dataKey="COL" stackId="fuel" fill="#78716c" />
                <Bar dataKey="OIL" stackId="fuel" fill="#f87171" />
                <Bar dataKey="OTH" stackId="fuel" fill="#64748b" />
              </BarChart>
            </ResponsiveContainer>

            {/* Clean % line below */}
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="card-header">Clean Energy % Over Time</div>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#475569" fontSize={10} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Clean Energy']} />
                  <Area type="monotone" dataKey="clean_pct" stroke="#10b981" fill="#10b98120" strokeWidth={2} dot={false} />
                  <ReferenceLine y={50} stroke="#475569" strokeDasharray="3 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
