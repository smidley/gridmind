import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, ArrowLeft } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell, Legend } from 'recharts'
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
  const { data: touSchedule } = useApi<any>('/site/tariff/schedule')
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
          {importing && gridMix?.configured && gridMix.clean_pct != null && (
            <div className={`mt-1.5 text-xs font-medium inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
              gridMix.clean_pct >= 80 ? 'bg-emerald-500/15 text-emerald-500'
              : gridMix.clean_pct >= 50 ? 'bg-amber-500/15 text-amber-500'
              : 'bg-red-500/15 text-red-400'
            }`}>
              {gridMix.clean_pct}% Clean
            </div>
          )}
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

      {/* TOU Rate Schedule */}
      {touSchedule?.configured && touSchedule.weekday && (() => {
        const isWeekday = touSchedule.is_weekday
        const schedule = isWeekday ? touSchedule.weekday : touSchedule.weekend
        const altSchedule = isWeekday ? touSchedule.weekend : touSchedule.weekday
        const currentHour = touSchedule.current_hour

        const periodColors: Record<string, { bg: string, text: string, bar: string }> = {
          'Peak': { bg: 'bg-red-500/15', text: 'text-red-500 dark:text-red-400', bar: '#ef4444' },
          'Mid-Peak': { bg: 'bg-amber-500/15', text: 'text-amber-500 dark:text-amber-400', bar: '#f59e0b' },
          'Off-Peak': { bg: 'bg-emerald-500/15', text: 'text-emerald-500 dark:text-emerald-400', bar: '#10b981' },
        }

        // Get unique periods with rates for the legend
        const periods = new Map<string, number>()
        schedule.forEach((h: any) => { if (!periods.has(h.display)) periods.set(h.display, h.rate) })

        const formatHour = (h: number) => {
          if (h === 0 || h === 24) return '12a'
          if (h === 12) return '12p'
          return h < 12 ? `${h}a` : `${h - 12}p`
        }

        // Check if weekday and weekend are different
        const schedulesDiffer = JSON.stringify(touSchedule.weekday.map((h: any) => h.period)) !==
                                JSON.stringify(touSchedule.weekend.map((h: any) => h.period))

        return (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="card-header mb-0">Rate Schedule</div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {touSchedule.utility} · {touSchedule.plan_name || touSchedule.season}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {Array.from(periods.entries()).map(([display, rate]) => (
                  <div key={display} className="flex items-center gap-1.5 text-xs">
                    <span className={`w-2.5 h-2.5 rounded-sm`} style={{ backgroundColor: periodColors[display]?.bar || '#64748b' }} />
                    <span className="text-slate-500 dark:text-slate-400">{display}</span>
                    {rate > 0 && <span className="font-medium text-slate-700 dark:text-slate-300">${rate.toFixed(2)}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Today's schedule */}
            <div className="mb-2">
              <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1.5">
                {isWeekday ? 'Weekday' : 'Weekend'} (Today)
              </div>
              <div className="flex h-8 rounded-lg overflow-hidden">
                {schedule.map((h: any, i: number) => {
                  const color = periodColors[h.display] || periodColors['Off-Peak']
                  const isCurrent = h.hour === currentHour
                  return (
                    <div
                      key={i}
                      className="relative flex items-center justify-center transition-all duration-300"
                      style={{
                        width: `${100 / 24}%`,
                        backgroundColor: color.bar,
                        opacity: isCurrent ? 1 : 0.6,
                      }}
                      title={`${formatHour(h.hour)} — ${h.display}${h.rate ? ` · $${h.rate.toFixed(2)}/kWh` : ''}`}
                    >
                      {isCurrent && (
                        <div className="absolute inset-0 border-2 border-white dark:border-slate-200 rounded-sm animate-pulse" />
                      )}
                    </div>
                  )
                })}
              </div>
              {/* Hour labels */}
              <div className="flex mt-1">
                {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
                  <div key={h} className="text-[9px] text-slate-500" style={{ width: `${(3 / 24) * 100}%` }}>
                    {formatHour(h)}
                  </div>
                ))}
              </div>
            </div>

            {/* Alternate schedule (weekday/weekend) if different */}
            {schedulesDiffer && (
              <div className="mt-3 pt-3 border-t border-slate-200/30 dark:border-slate-800/50">
                <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1.5">
                  {isWeekday ? 'Weekend' : 'Weekday'}
                </div>
                <div className="flex h-6 rounded-lg overflow-hidden opacity-70">
                  {altSchedule.map((h: any, i: number) => {
                    const color = periodColors[h.display] || periodColors['Off-Peak']
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-center"
                        style={{
                          width: `${100 / 24}%`,
                          backgroundColor: color.bar,
                          opacity: 0.6,
                        }}
                        title={`${formatHour(h.hour)} — ${h.display}${h.rate ? ` · $${h.rate.toFixed(2)}/kWh` : ''}`}
                      />
                    )
                  })}
                </div>
                <div className="flex mt-1">
                  {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
                    <div key={h} className="text-[9px] text-slate-500" style={{ width: `${(3 / 24) * 100}%` }}>
                      {formatHour(h)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

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
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="card-header mb-0">Rate Schedule — {tariff.utility}</div>
              <p className="text-xs text-slate-500">{tariff.plan_name}</p>
            </div>
            {tariff.current_period_display && (
              <div className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                tariff.current_period_display === 'Peak' ? 'bg-red-500/15 text-red-500'
                : tariff.current_period_display === 'Mid-Peak' ? 'bg-amber-500/15 text-amber-500'
                : 'bg-emerald-500/15 text-emerald-500'
              }`}>
                Now: {tariff.current_period_display}
                {tariff.current_rate ? ` · $${tariff.current_rate.toFixed(3)}/kWh` : ''}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm mt-3">
            {tariff.rate_schedule && Object.entries(tariff.rate_schedule).map(([period, info]: [string, any]) => {
              const isActive = info.display_name === tariff.current_period_display
              return (
                <div key={period} className={`flex items-center gap-2 ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    info.display_name === 'Peak' ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                    : info.display_name === 'Mid-Peak' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  }`}>{info.display_name}</span>
                  <span className="text-slate-500">${info.rate?.toFixed(3)}/kWh</span>
                </div>
              )
            })}
          </div>
          {/* Weekend note */}
          {tariff.current_period_display === 'Off-Peak' && (() => {
            const day = new Date().getDay()
            const isWeekend = day === 0 || day === 6
            return isWeekend ? (
              <p className="text-xs text-emerald-500/70 mt-3">Weekends are off-peak all day on this plan.</p>
            ) : null
          })()}
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
        const currentHour = new Date().getHours()
        // Build chart data from hourly breakdown
        const chartData = gridMix.hourly.map((h: any) => {
          // Use local_hour from backend (already converted from UTC)
          const hr = h.local_hour ?? 0
          const label = hr === 0 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p`
          return {
            label,
            hour: hr,
            isCurrent: hr === currentHour,
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
        const currentIndex = chartData.findIndex((d: any) => d.isCurrent)

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
                <XAxis
                  dataKey="label"
                  stroke="#475569"
                  fontSize={10}
                  tickLine={false}
                  tick={({ x, y, payload }: any) => {
                    const idx = chartData.findIndex((d: any) => d.label === payload.value)
                    const isNow = idx >= 0 && chartData[idx].isCurrent
                    return (
                      <text x={x} y={y + 12} textAnchor="middle" fontSize={10}
                        fill={isNow ? '#10b981' : '#475569'}
                        fontWeight={isNow ? 700 : 400}>
                        {isNow ? 'Now' : payload.value}
                      </text>
                    )
                  }}
                />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#94a3b8' }}
                  cursor={{ fill: 'rgba(148, 163, 184, 0.06)' }}
                  labelFormatter={(label) => {
                    const idx = chartData.findIndex((d: any) => d.label === label)
                    return idx >= 0 && chartData[idx].isCurrent ? `${label} (Now)` : label
                  }}
                  formatter={(v: number, name: string) => {
                    const nameMap: Record<string, string> = { WAT: 'Hydro', WND: 'Wind', SUN: 'Solar', NUC: 'Nuclear', BAT: 'Battery', NG: 'Gas', COL: 'Coal', OIL: 'Oil', OTH: 'Other' }
                    return [`${v.toFixed(1)}%`, nameMap[name] || name]
                  }}
                />
                {currentIndex >= 0 && (
                  <ReferenceLine x={chartData[currentIndex].label} stroke="#10b981" strokeWidth={2} strokeDasharray="4 2" />
                )}
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
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(v: number) => [`${v.toFixed(1)}%`, 'Clean Energy']}
                  />
                  <Area type="monotone" dataKey="clean_pct" stroke="#10b981" fill="#10b98120" strokeWidth={2} dot={false} />
                  <ReferenceLine y={50} stroke="#475569" strokeDasharray="3 3" />
                  {currentIndex >= 0 && (
                    <ReferenceLine x={chartData[currentIndex].label} stroke="#10b981" strokeWidth={2} strokeDasharray="4 2" />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
