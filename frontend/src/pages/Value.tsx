import { DollarSign, TrendingUp, TrendingDown, Zap, Sun, ArrowUpFromLine, ArrowDownToLine } from 'lucide-react'
import { useApi } from '../hooks/useApi'

function formatMoney(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`
}

export default function ValuePage() {
  const { data: value, loading } = useApi<any>('/history/value')
  const { data: todayTotals } = useApi<any>('/history/today')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Energy Value</h2>
        <p className="text-sm text-slate-500">
          {value?.utility ? `${value.utility} - ${value.plan}` : "Today's financial summary"}
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
              {value.net_value >= 0 ? 'You earned more than you spent on electricity today' : 'Grid imports exceeded export credits today'}
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
            {/* Export Credits */}
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpFromLine className="w-4 h-4 text-emerald-400" />
                <span className="card-header mb-0">Export Credits</span>
              </div>
              <div className="stat-value text-emerald-400">+{formatMoney(value.export_credits)}</div>
              <div className="stat-label">Earned from grid exports</div>
              {todayTotals && (
                <div className="text-xs text-slate-500 mt-1">
                  {todayTotals.grid_exported_kwh.toFixed(1)} kWh exported
                </div>
              )}
            </div>

            {/* Solar Savings */}
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <Sun className="w-4 h-4 text-amber-400" />
                <span className="card-header mb-0">Solar Savings</span>
              </div>
              <div className="stat-value text-amber-400">+{formatMoney(value.solar_savings)}</div>
              <div className="stat-label">Avoided grid purchase</div>
              {todayTotals && (
                <div className="text-xs text-slate-500 mt-1">
                  {(todayTotals.home_consumed_kwh - todayTotals.grid_imported_kwh).toFixed(1)} kWh self-consumed
                </div>
              )}
            </div>

            {/* Import Costs */}
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownToLine className="w-4 h-4 text-red-400" />
                <span className="card-header mb-0">Import Costs</span>
              </div>
              <div className="stat-value text-red-400">-{formatMoney(value.import_costs)}</div>
              <div className="stat-label">Paid for grid imports</div>
              {todayTotals && (
                <div className="text-xs text-slate-500 mt-1">
                  {todayTotals.grid_imported_kwh.toFixed(1)} kWh imported
                </div>
              )}
            </div>
          </div>

          {/* TOU Period Breakdown */}
          {value.period_breakdown && Object.keys(value.period_breakdown).length > 0 && (
            <div className="card">
              <div className="card-header">Time-of-Use Breakdown</div>
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
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                                period === 'Peak' ? 'bg-red-500/20 text-red-400' :
                                period === 'Mid-Peak' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-emerald-500/20 text-emerald-400'
                              }`}>
                                {period}
                              </span>
                            </td>
                            <td className="text-right py-2.5 px-4 text-slate-300">{data.exported_kwh.toFixed(1)} kWh</td>
                            <td className="text-right py-2.5 px-4 text-emerald-400">+${data.export_value.toFixed(2)}</td>
                            <td className="text-right py-2.5 px-4 text-slate-300">{data.imported_kwh.toFixed(1)} kWh</td>
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

          {/* Rate Info */}
          <div className="card">
            <div className="card-header">Current Rate Schedule</div>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">Off-Peak</span>
                <span className="text-slate-400">$0.084/kWh</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">Mid-Peak</span>
                <span className="text-slate-400">$0.158/kWh</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Peak</span>
                <span className="text-slate-400">$0.411/kWh</span>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
