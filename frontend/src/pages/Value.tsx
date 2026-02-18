import {
  DollarSign, Sun, ArrowUpFromLine, ArrowDownToLine, Brain, Shield, Zap, Receipt,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  AreaChart, Area, ReferenceLine,
  LineChart, Line, ReferenceArea,
} from 'recharts'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import AnimatedValue from '../components/AnimatedValue'
import MoneyGoal from '../components/MoneyGoal'

function formatMoney(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`
}

function formatHour(hour: number): string {
  if (hour === 0) return '12a'
  if (hour === 12) return '12p'
  if (hour < 12) return `${hour}a`
  return `${hour - 12}p`
}

const TOU_COLORS: Record<string, string> = {
  'Peak': '#f87171',
  'Mid-Peak': '#fbbf24',
  'Off-Peak': '#34d399',
}

const TOU_BG: Record<string, string> = {
  'Peak': 'rgba(248,113,113,0.08)',
  'Mid-Peak': 'rgba(251,191,36,0.06)',
  'Off-Peak': 'rgba(52,211,153,0.04)',
}

/* Custom pie tooltip since Recharts formatter is broken for Pie */
function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const { name, value, payload: item } = payload[0]
  return (
    <div className="bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
        <span className="text-slate-600 dark:text-slate-300">{name}</span>
      </div>
      <div className="text-slate-900 dark:text-white font-medium mt-0.5">${value.toFixed(2)}</div>
    </div>
  )
}

/* Custom bar tooltip for hourly chart */
function HourlyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const data = payload[0]?.payload
  if (!data) return null
  return (
    <div className="bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-500 dark:text-slate-400 mb-1">{label} - <span style={{ color: TOU_COLORS[data.period] || '#64748b' }}>{data.period}</span></div>
      {data.net >= 0 ? (
        <div className="text-emerald-400 font-medium">+${data.net.toFixed(2)} net</div>
      ) : (
        <div className="text-red-400 font-medium">-${Math.abs(data.net).toFixed(2)} net</div>
      )}
      <div className="text-slate-500 mt-0.5">
        Export: ${data.export_value.toFixed(2)} ({data.exported_kwh.toFixed(1)} kWh)
      </div>
      <div className="text-slate-500">
        Import: ${data.import_cost.toFixed(2)} ({data.imported_kwh.toFixed(1)} kWh)
      </div>
    </div>
  )
}

export default function ValuePage() {
  const { data: value, loading } = useAutoRefresh<any>('/history/value', 30000)
  const { data: todayTotals } = useAutoRefresh<any>('/history/today', 30000)
  const { data: forecast } = useAutoRefresh<any>('/history/forecast', 60000)
  const { data: savings } = useAutoRefresh<any>('/powerwall/health/savings', 60000)
  const { data: billEstimate } = useApi<any>('/ai/bill-estimate')

  // Build hourly chart data
  const hourlyChart = value?.hourly_breakdown?.map((h: any) => ({
    ...h,
    label: formatHour(h.hour),
    netPositive: h.net >= 0 ? h.net : 0,
    netNegative: h.net < 0 ? h.net : 0,
  })) || []

  // Cumulative value data
  let cumTotal = 0
  const cumulativeChart = hourlyChart.map((h: any) => {
    cumTotal += h.net || 0
    return { ...h, cumulative: Math.round(cumTotal * 100) / 100 }
  })

  // Pie chart data for value sources
  const valuePieData = value ? [
    { name: 'Export Credits', value: value.export_credits, color: '#34d399' },
    { name: 'Solar Savings', value: value.solar_savings, color: '#fbbf24' },
  ].filter(d => d.value > 0.01) : []

  // Find TOU period boundaries for reference areas
  // Use the label strings from hourlyChart for x1/x2
  const touBands: { startLabel: string; endLabel: string; period: string }[] = []
  if (hourlyChart.length > 0) {
    let currentStart = 0
    let currentPeriod = hourlyChart[0].period
    for (let i = 1; i < hourlyChart.length; i++) {
      if (hourlyChart[i].period !== currentPeriod) {
        touBands.push({
          startLabel: hourlyChart[currentStart].label,
          endLabel: hourlyChart[i].label, // extend to the start of the next period (no gap)
          period: currentPeriod,
        })
        currentStart = i
        currentPeriod = hourlyChart[i].period
      }
    }
    // Last band extends to the last data point
    touBands.push({
      startLabel: hourlyChart[currentStart].label,
      endLabel: hourlyChart[hourlyChart.length - 1].label,
      period: currentPeriod,
    })
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Energy Value</h2>
        <p className="text-sm text-slate-500">
          {value?.utility ? `${value.utility}` : "Today's financial summary"}
        </p>
      </div>

      {loading ? (
        <div className="card text-center py-12 text-slate-500">Calculating value...</div>
      ) : value?.error ? (
        <div className="card text-center py-12">
          <DollarSign className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-400 mb-2">No Value Data</h3>
          <p className="text-sm text-slate-500">{value.error}</p>
        </div>
      ) : value ? (
        <>
          {/* Net Value Hero */}
          <div className="card text-center py-8">
            <p className="text-sm text-slate-400 uppercase tracking-wider mb-2">Today's Net Value</p>
            <div className={`text-5xl font-bold tabular-nums ${value.net_value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {value.net_value >= 0 ? '+' : '-'}{formatMoney(value.net_value)}
            </div>
            <p className="text-sm text-slate-500 mt-2">
              {value.net_value >= 0 ? 'Export credits exceed import costs' : 'Import costs exceed export credits'}
              <span className="text-slate-600"> (export credits - import costs)</span>
            </p>
          </div>

          {/* Value Goals */}
          {forecast?.today && todayTotals && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Value Goal - estimate target from forecast scaled by current $/kWh */}
              {(() => {
                const forecastKwh = forecast.today.estimated_kwh
                const actualKwh = todayTotals.solar_generated_kwh
                // Estimate daily value target: scale current net value by forecast/actual ratio
                // Or use a simpler approach: forecast * average export rate
                const avgRate = actualKwh > 0 ? (value.export_credits + value.solar_savings) / actualKwh : 0.20
                const valueTarget = forecastKwh * avgRate - value.import_costs
                return (
                  <div className="card">
                    <MoneyGoal
                      actual={value.net_value}
                      target={Math.max(valueTarget, 1)}
                      label="Net Value Goal"
                    />
                  </div>
                )
              })()}

              {/* Export Credits Goal */}
              {(() => {
                const forecastKwh = forecast.today.estimated_kwh
                const actualKwh = todayTotals.solar_generated_kwh
                const avgExportRate = todayTotals.grid_exported_kwh > 0 ? value.export_credits / todayTotals.grid_exported_kwh : 0.15
                const exportTarget = (forecastKwh * 0.6) * avgExportRate // Assume ~60% gets exported
                return exportTarget > 0 ? (
                  <div className="card">
                    <MoneyGoal
                      actual={value.export_credits}
                      target={Math.max(exportTarget, 1)}
                      label="Export Credits Goal"
                    />
                  </div>
                ) : null
              })()}
            </div>
          )}

          {/* Net Grid Credit */}
          {todayTotals && (
            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400 uppercase tracking-wider mb-1">Net Grid Credit</p>
                  <div className={`text-3xl font-bold tabular-nums ${
                    todayTotals.grid_exported_kwh - todayTotals.grid_imported_kwh >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {todayTotals.grid_exported_kwh - todayTotals.grid_imported_kwh >= 0 ? '+' : ''}
                    {(todayTotals.grid_exported_kwh - todayTotals.grid_imported_kwh).toFixed(1)} kWh
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    {todayTotals.grid_exported_kwh.toFixed(1)} exported - {todayTotals.grid_imported_kwh.toFixed(1)} imported
                  </p>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold tabular-nums ${
                    value.export_credits - value.import_costs >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {value.export_credits - value.import_costs >= 0 ? '+' : '-'}
                    {formatMoney(value.export_credits - value.import_costs)}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Net grid value</p>
                </div>
              </div>
            </div>
          )}

          {/* GridMind Optimize Savings */}
          {value.optimize_savings && (() => {
            const os = value.optimize_savings
            const hasToday = os.total_benefit > 0
            const hasLifetime = os.lifetime_total > 0

            if (!hasToday && !hasLifetime) return null

            return (
              <div className="card border-blue-500/20 bg-gradient-to-r from-blue-500/5 to-transparent">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4.5 h-4.5 text-blue-400" />
                  <span className="card-header mb-0">GridMind Optimize</span>
                </div>

                {/* Lifetime + Today side by side */}
                <div className="grid grid-cols-2 gap-4">
                  {hasLifetime && (
                    <div>
                      <div className="text-3xl font-bold tabular-nums text-blue-400">
                        +{formatMoney(os.lifetime_total)}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Lifetime savings · {os.lifetime_days} day{os.lifetime_days !== 1 ? 's' : ''}
                      </p>
                      {os.lifetime_avg_daily > 0 && (
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          ~${os.lifetime_avg_daily.toFixed(2)}/day avg
                          {os.lifetime_days >= 30 && ` · ~$${(os.lifetime_avg_daily * 30).toFixed(0)}/mo`}
                        </p>
                      )}
                    </div>
                  )}
                  {hasToday && (
                    <div className={hasLifetime ? 'text-right' : ''}>
                      <div className="text-2xl font-bold tabular-nums text-emerald-400">
                        +{formatMoney(os.total_benefit)}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Today</p>
                    </div>
                  )}
                  {!hasToday && hasLifetime && (
                    <div className="text-right">
                      <div className="text-lg text-slate-500">—</div>
                      <p className="text-xs text-slate-500 mt-1">No peak today</p>
                    </div>
                  )}
                </div>

                {/* Today's breakdown (only when there's peak data) */}
                {hasToday && (
                  <div className="mt-3 pt-3 border-t border-blue-500/10 space-y-1.5 text-xs">
                    {os.avoided_imports_kwh > 0 && (
                      <div className="flex items-center gap-2">
                        <Shield className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-slate-500">
                          Avoided <span className="text-slate-700 dark:text-slate-300 font-medium">{os.avoided_imports_kwh} kWh</span> peak imports
                          <span className="text-emerald-400 font-medium"> (${os.avoided_cost.toFixed(2)} saved</span> at ${os.peak_buy_rate.toFixed(3)}/kWh)
                        </span>
                      </div>
                    )}
                    {os.peak_exported_kwh > 0 && (
                      <div className="flex items-center gap-2">
                        <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                        <span className="text-slate-500">
                          Exported <span className="text-slate-700 dark:text-slate-300 font-medium">{os.peak_exported_kwh} kWh</span> during peak
                          <span className="text-amber-400 font-medium"> (+${os.peak_export_credits.toFixed(2)} earned</span> at ${os.peak_sell_rate.toFixed(3)}/kWh)
                        </span>
                      </div>
                    )}
                    {os.actual_peak_imports_kwh > 0 && (
                      <div className="flex items-center gap-2 text-slate-600">
                        <ArrowDownToLine className="w-3 h-3 shrink-0" />
                        <span>Peak imports: {os.actual_peak_imports_kwh} kWh (-${os.actual_peak_import_cost.toFixed(2)})</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Value Breakdown Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpFromLine className="w-4 h-4 text-emerald-400" />
                <span className="card-header mb-0">Export Credits</span>
              </div>
              <div className="stat-value text-emerald-400">+<AnimatedValue value={value.export_credits} format={formatMoney} /></div>
              <div className="stat-label">Earned from grid exports</div>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <Sun className="w-4 h-4 text-amber-400" />
                <span className="card-header mb-0">Solar Savings</span>
              </div>
              <div className="stat-value text-amber-400">+<AnimatedValue value={value.solar_savings} format={formatMoney} /></div>
              <div className="stat-label">Avoided grid purchase</div>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownToLine className="w-4 h-4 text-red-400" />
                <span className="card-header mb-0">Import Costs</span>
              </div>
              <div className="stat-value text-red-400">-<AnimatedValue value={value.import_costs} format={formatMoney} /></div>
              <div className="stat-label">Paid for grid imports</div>
            </div>
          </div>

          {/* Hourly Value Timeline */}
          {hourlyChart.length > 0 && (
            <div className="card">
              <div className="card-header">Hourly Value Timeline</div>
              <p className="text-xs text-slate-500 mb-3">Net earnings (green) or costs (red) for each hour</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={hourlyChart} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#475569" fontSize={10} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false}
                    tickFormatter={(v) => `$${v.toFixed(2)}`} />
                  <Tooltip cursor={{ fill: 'rgba(148, 163, 184, 0.06)' }} content={<HourlyTooltip />} />
                  <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
                  <Bar dataKey="netPositive" name="Earned" fill="#34d399" radius={[3, 3, 0, 0]} stackId="net" />
                  <Bar dataKey="netNegative" name="Cost" fill="#f87171" radius={[0, 0, 3, 3]} stackId="net" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Cumulative Value Curve */}
          {cumulativeChart.length > 0 && (
            <div className="card">
              <div className="card-header">Cumulative Value Throughout the Day</div>
              <p className="text-xs text-slate-500 mb-3">Running total of net value from midnight</p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={cumulativeChart}>
                  <defs>
                    <linearGradient id="cumGradientPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  {/* TOU period background bands */}
                  {touBands.map((band, i) => (
                    <ReferenceArea
                      key={i}
                      x1={band.startLabel}
                      x2={band.endLabel}
                      fill={TOU_BG[band.period] || 'transparent'}
                      fillOpacity={1}
                    />
                  ))}
                  <XAxis dataKey="label" stroke="#475569" fontSize={10} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false}
                    tickFormatter={(v) => `$${v.toFixed(2)}`} />
                  <Tooltip
                   
                    formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cumulative']}
                    labelFormatter={(l) => {
                      const d = cumulativeChart.find((c: any) => c.label === l)
                      return d ? `${l} (${d.period})` : l
                    }}
                  />
                  <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke="#34d399"
                    fill="url(#cumGradientPos)"
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Charts Row: Export Timing + Pie */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Export Timing Heatmap */}
            {hourlyChart.length > 0 && (
              <div className="card">
                <div className="card-header">Export Timing</div>
                <p className="text-xs text-slate-500 mb-3">When you exported and at what rate. Bigger dots = more kWh.</p>
                <div className="flex flex-wrap gap-1">
                  {hourlyChart.map((h: any) => {
                    const maxExport = Math.max(...hourlyChart.map((x: any) => x.exported_kwh), 0.1)
                    const size = Math.max((h.exported_kwh / maxExport) * 36, h.exported_kwh > 0 ? 8 : 0)
                    const bgColor = TOU_BG[h.period] || 'transparent'
                    const dotColor = TOU_COLORS[h.period] || '#64748b'
                    return (
                      <div
                        key={h.hour}
                        className="flex flex-col items-center rounded-md border border-slate-800 py-2 relative"
                        style={{ width: 38, backgroundColor: bgColor }}
                        title={`${formatHour(h.hour)}: ${h.exported_kwh.toFixed(1)} kWh @ $${(h.sell_rate || 0).toFixed(3)}/kWh = $${h.export_value.toFixed(2)}`}
                      >
                        <div className="flex-1 flex items-center justify-center" style={{ minHeight: 40 }}>
                          {size > 0 && (
                            <div
                              className="rounded-full"
                              style={{
                                width: size,
                                height: size,
                                backgroundColor: dotColor,
                                opacity: 0.8,
                                boxShadow: `0 0 ${size / 2}px ${dotColor}40`,
                              }}
                            />
                          )}
                        </div>
                        <span className="text-[9px] text-slate-500 mt-1">{formatHour(h.hour)}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-[10px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TOU_COLORS['Peak'] }} />
                    Peak
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TOU_COLORS['Mid-Peak'] }} />
                    Mid-Peak
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TOU_COLORS['Off-Peak'] }} />
                    Off-Peak
                  </div>
                </div>
              </div>
            )}

            {/* Value Sources Pie */}
            {valuePieData.length > 0 && (
              <div className="card">
                <div className="card-header">Where Your Value Comes From</div>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={valuePieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={95}
                      paddingAngle={4}
                      dataKey="value"
                      nameKey="name"
                      stroke="none"
                    >
                      {valuePieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend
                      formatter={(legendValue) => <span className="text-slate-600 dark:text-slate-300 text-xs">{legendValue}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Detailed Breakdown Table */}
          {value.period_breakdown && Object.keys(value.period_breakdown).length > 0 && (
            <div className="card">
              <div className="card-header">TOU Period Summary</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-2 pr-4 font-medium">Period</th>
                      <th className="text-right py-2 px-4 font-medium">Exported</th>
                      <th className="text-right py-2 px-4 font-medium">Export Value</th>
                      <th className="text-right py-2 px-4 font-medium">Imported</th>
                      <th className="text-right py-2 px-4 font-medium">Import Cost</th>
                      <th className="text-right py-2 pl-4 font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(value.period_breakdown)
                      .sort(([a], [b]) => {
                        const order: Record<string, number> = { 'Peak': 0, 'Mid-Peak': 1, 'Off-Peak': 2 }
                        return (order[a] ?? 3) - (order[b] ?? 3)
                      })
                      .map(([period, data]: [string, any]) => {
                        const net = data.export_value - data.import_cost
                        return (
                          <tr key={period} className="border-b border-slate-800/50">
                            <td className="py-2.5 pr-4">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                                style={{ backgroundColor: `${TOU_COLORS[period]}20`, color: TOU_COLORS[period] }}>
                                {period}
                              </span>
                            </td>
                            <td className="text-right py-2.5 px-4 text-slate-600 dark:text-slate-300">{data.exported_kwh.toFixed(1)} kWh</td>
                            <td className="text-right py-2.5 px-4 text-emerald-400">+${data.export_value.toFixed(2)}</td>
                            <td className="text-right py-2.5 px-4 text-slate-600 dark:text-slate-300">{data.imported_kwh.toFixed(1)} kWh</td>
                            <td className="text-right py-2.5 px-4 text-red-400">-${data.import_cost.toFixed(2)}</td>
                            <td className={`text-right py-2.5 pl-4 font-medium ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {net >= 0 ? '+' : '-'}${Math.abs(net).toFixed(2)}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Lifetime System Value */}
          {savings && !savings.error && (
            <div className="card border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-transparent">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-4.5 h-4.5 text-emerald-400" />
                <span className="card-header mb-0">Lifetime System Value</span>
              </div>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-4xl font-bold tabular-nums text-emerald-400">
                    ${savings.total_savings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Total savings over {savings.days_tracked} days
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                <div>
                  <span className="text-xs text-slate-500">Today</span>
                  <p className="font-bold text-emerald-400">${savings.today_savings.toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Daily Avg</span>
                  <p className="font-bold text-slate-700 dark:text-slate-300">${savings.avg_daily_savings.toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Monthly Est.</span>
                  <p className="font-bold text-slate-700 dark:text-slate-300">${savings.monthly_estimate.toFixed(0)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Yearly Est.</span>
                  <p className="font-bold text-slate-700 dark:text-slate-300">${savings.yearly_estimate?.toFixed(0) || '—'}</p>
                </div>
              </div>

              {/* Break-even progress */}
              {savings.breakeven ? (
                <div className="mt-4 pt-4 border-t border-emerald-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {savings.breakeven.paid_off ? 'System Paid Off!' : 'Break-Even Progress'}
                    </span>
                    <span className="text-sm font-bold text-emerald-400">{savings.breakeven.pct.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(savings.breakeven.pct, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>${savings.total_savings.toLocaleString(undefined, { maximumFractionDigits: 0 })} saved</span>
                    <span>${savings.breakeven.system_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })} system cost</span>
                  </div>
                  {!savings.breakeven.paid_off && savings.breakeven.estimated_date && (
                    <div className="mt-3 text-xs text-slate-500">
                      <span className="text-slate-700 dark:text-slate-300 font-medium">
                        ${savings.breakeven.remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })} remaining
                      </span>
                      {' · '}Estimated break-even:{' '}
                      <span className="text-emerald-400 font-medium">
                        {new Date(savings.breakeven.estimated_date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                      </span>
                      {savings.breakeven.estimated_years > 0 && (
                        <span> ({savings.breakeven.estimated_years} years)</span>
                      )}
                    </div>
                  )}
                  {savings.breakeven.paid_off && (
                    <div className="mt-3 text-sm text-emerald-400 font-medium">
                      Your system has paid for itself! Everything from here is profit.
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 pt-4 border-t border-emerald-500/10">
                  <p className="text-xs text-slate-500">
                    Set your system cost in <span className="text-slate-700 dark:text-slate-300 font-medium">Settings</span> to track break-even progress.
                  </p>
                </div>
              )}
            </div>
          )}
          {/* AI Monthly Bill Estimate */}
          {billEstimate && !billEstimate.error && billEstimate.estimated_total != null && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4.5 h-4.5 text-blue-400" />
                  <span className="card-header mb-0">Estimated Monthly Bill</span>
                </div>
                <div className="flex items-center gap-2">
                  {billEstimate.confidence && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                      billEstimate.confidence === 'high' ? 'bg-emerald-500/15 text-emerald-500'
                      : billEstimate.confidence === 'medium' ? 'bg-amber-500/15 text-amber-500'
                      : 'bg-slate-500/15 text-slate-400'
                    }`}>
                      {billEstimate.confidence} confidence
                    </span>
                  )}
                  <span className="text-[9px] text-slate-500">{billEstimate.provider}</span>
                </div>
              </div>

              <div className="text-center mb-4">
                <div className="stat-value text-blue-400">
                  <AnimatedValue value={billEstimate.estimated_total} format={(v) => `$${v.toFixed(2)}`} />
                </div>
                <div className="stat-label">{billEstimate.month} estimate</div>
                <p className="text-[10px] text-slate-500 mt-1">
                  {billEstimate.days_tracked} of {billEstimate.days_in_month} days tracked
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {billEstimate.energy_charges != null && (
                  <div>
                    <span className="text-slate-500">Energy Charges</span>
                    <p className="font-bold text-red-400">${billEstimate.energy_charges.toFixed(2)}</p>
                  </div>
                )}
                {billEstimate.export_credits != null && (
                  <div>
                    <span className="text-slate-500">Export Credits</span>
                    <p className="font-bold text-emerald-400">${Math.abs(billEstimate.export_credits).toFixed(2)}</p>
                  </div>
                )}
                {billEstimate.fixed_fees != null && (
                  <div>
                    <span className="text-slate-500">Fixed Fees</span>
                    <p className="font-bold text-slate-300">${billEstimate.fixed_fees.toFixed(2)}</p>
                  </div>
                )}
                {billEstimate.taxes_and_fees != null && (
                  <div>
                    <span className="text-slate-500">Taxes & Fees</span>
                    <p className="font-bold text-slate-300">${billEstimate.taxes_and_fees.toFixed(2)}</p>
                  </div>
                )}
              </div>

              {billEstimate.note && (
                <p className="text-[10px] text-slate-500 mt-3 pt-3 border-t border-slate-200/30 dark:border-slate-800/50">
                  {billEstimate.note}
                </p>
              )}
            </div>
          )}

        </>
      ) : null}
    </div>
  )
}
