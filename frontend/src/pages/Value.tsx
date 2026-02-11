import {
  DollarSign, Sun, ArrowUpFromLine, ArrowDownToLine,
  PieChart as PieIcon,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

function formatMoney(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`
}

const TOU_COLORS: Record<string, string> = {
  'Peak': '#f87171',
  'Mid-Peak': '#fbbf24',
  'Off-Peak': '#34d399',
}

export default function ValuePage() {
  const { data: value, loading } = useAutoRefresh<any>('/history/value', 30000)
  const { data: todayTotals } = useAutoRefresh<any>('/history/today', 30000)

  // Build chart data from period breakdown
  const periodData = value?.period_breakdown
    ? Object.entries(value.period_breakdown)
        .sort(([a], [b]) => {
          const order: Record<string, number> = { 'Peak': 0, 'Mid-Peak': 1, 'Off-Peak': 2 }
          return (order[a] ?? 3) - (order[b] ?? 3)
        })
        .map(([period, data]: [string, any]) => ({
          name: period,
          exported: data.exported_kwh,
          imported: data.imported_kwh,
          exportValue: data.export_value,
          importCost: data.import_cost,
          net: data.export_value - data.import_cost,
          color: TOU_COLORS[period] || '#64748b',
        }))
    : []

  // Pie chart data for value sources
  const valuePieData = value ? [
    { name: 'Export Credits', value: value.export_credits, color: '#34d399' },
    { name: 'Solar Savings', value: value.solar_savings, color: '#fbbf24' },
  ].filter(d => d.value > 0) : []

  // Cost pie
  const costPieData = value ? [
    { name: 'Peak Import', value: value.period_breakdown?.['Peak']?.import_cost || 0, color: '#f87171' },
    { name: 'Mid-Peak Import', value: value.period_breakdown?.['Mid-Peak']?.import_cost || 0, color: '#fbbf24' },
    { name: 'Off-Peak Import', value: value.period_breakdown?.['Off-Peak']?.import_cost || 0, color: '#34d399' },
  ].filter(d => d.value > 0) : []

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
                    {todayTotals.grid_exported_kwh.toFixed(1)} kWh exported - {todayTotals.grid_imported_kwh.toFixed(1)} kWh imported
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

          {/* Value Breakdown Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpFromLine className="w-4 h-4 text-emerald-400" />
                <span className="card-header mb-0">Export Credits</span>
              </div>
              <div className="stat-value text-emerald-400">+{formatMoney(value.export_credits)}</div>
              <div className="stat-label">Earned from grid exports</div>
              {todayTotals && (
                <div className="text-xs text-slate-500 mt-1">{todayTotals.grid_exported_kwh.toFixed(1)} kWh exported</div>
              )}
            </div>

            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <Sun className="w-4 h-4 text-amber-400" />
                <span className="card-header mb-0">Solar Savings</span>
              </div>
              <div className="stat-value text-amber-400">+{formatMoney(value.solar_savings)}</div>
              <div className="stat-label">Avoided grid purchase</div>
              {todayTotals && (
                <div className="text-xs text-slate-500 mt-1">
                  {Math.max(todayTotals.home_consumed_kwh - todayTotals.grid_imported_kwh, 0).toFixed(1)} kWh self-consumed
                </div>
              )}
            </div>

            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownToLine className="w-4 h-4 text-red-400" />
                <span className="card-header mb-0">Import Costs</span>
              </div>
              <div className="stat-value text-red-400">-{formatMoney(value.import_costs)}</div>
              <div className="stat-label">Paid for grid imports</div>
              {todayTotals && (
                <div className="text-xs text-slate-500 mt-1">{todayTotals.grid_imported_kwh.toFixed(1)} kWh imported</div>
              )}
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* TOU Export Value Bar Chart */}
            {periodData.length > 0 && (
              <div className="card">
                <div className="card-header">Value by TOU Period</div>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={periodData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" stroke="#475569" fontSize={11} tickLine={false}
                      tickFormatter={(v) => `$${v.toFixed(2)}`} />
                    <YAxis type="category" dataKey="name" stroke="#475569" fontSize={11} tickLine={false} width={70} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, '']}
                    />
                    <Bar dataKey="exportValue" name="Export Credits" fill="#34d399" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="importCost" name="Import Costs" fill="#f87171" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Value Sources Pie */}
            {valuePieData.length > 0 && (
              <div className="card">
                <div className="card-header">Where Your Value Comes From</div>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={valuePieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                      stroke="none"
                    >
                      {valuePieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, '']}
                    />
                    <Legend
                      formatter={(value) => <span className="text-slate-300 text-xs">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Energy Flow by TOU Period */}
          {periodData.length > 0 && (
            <div className="card">
              <div className="card-header">Energy Flow by TOU Period (kWh)</div>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={periodData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#475569" fontSize={11} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={11} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(v: number) => [`${v.toFixed(1)} kWh`, '']}
                  />
                  <Legend />
                  <Bar dataKey="exported" name="Exported" fill="#34d399" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="imported" name="Imported" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* TOU Period Breakdown Table */}
          {value.period_breakdown && Object.keys(value.period_breakdown).length > 0 && (
            <div className="card">
              <div className="card-header">Detailed Breakdown</div>
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
                    {periodData.map(({ name, exported, exportValue, imported, importCost, net }) => (
                      <tr key={name} className="border-b border-slate-800/50">
                        <td className="py-2.5 pr-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium`}
                            style={{ backgroundColor: `${TOU_COLORS[name]}20`, color: TOU_COLORS[name] }}>
                            {name}
                          </span>
                        </td>
                        <td className="text-right py-2.5 px-4 text-slate-300">{exported.toFixed(1)} kWh</td>
                        <td className="text-right py-2.5 px-4 text-emerald-400">+${exportValue.toFixed(2)}</td>
                        <td className="text-right py-2.5 px-4 text-slate-300">{imported.toFixed(1)} kWh</td>
                        <td className="text-right py-2.5 px-4 text-red-400">-${importCost.toFixed(2)}</td>
                        <td className={`text-right py-2.5 pl-4 font-medium ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {net >= 0 ? '+' : '-'}${Math.abs(net).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Rate Info */}
          <div className="card">
            <div className="card-header">Current Rate Schedule</div>
            <div className="flex flex-wrap gap-4 text-sm">
              {periodData.map(({ name }) => {
                const rates: Record<string, number> = { 'Off-Peak': 0.08388, 'Mid-Peak': 0.15766, 'Peak': 0.41108 }
                return (
                  <div key={name} className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ backgroundColor: `${TOU_COLORS[name]}20`, color: TOU_COLORS[name] }}>
                      {name}
                    </span>
                    <span className="text-slate-400">${(rates[name] || 0).toFixed(3)}/kWh</span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
