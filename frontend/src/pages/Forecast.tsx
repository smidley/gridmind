import { useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  ReferenceLine,
} from 'recharts'
import { Sun, Cloud, CloudSun, RefreshCw, DollarSign } from 'lucide-react'
import { useApi, apiFetch } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import SolarGoal from '../components/SolarGoal'

function ConditionIcon({ condition, className }: { condition: string; className?: string }) {
  if (condition === 'sunny') return <Sun className={className} />
  if (condition === 'partly_cloudy') return <CloudSun className={className} />
  return <Cloud className={className} />
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  if (hour < 12) return `${hour}am`
  return `${hour - 12}pm`
}

export default function ForecastPage() {
  const { data: forecast, loading, refetch } = useApi<any>('/history/forecast')
  const { data: valueData } = useApi<any>('/history/value')
  const { data: tariff } = useApi<any>('/site/tariff')
  const { data: vsActual } = useApi<any>('/history/forecast/vs-actual')
  const { data: todayTotals } = useAutoRefresh<any>('/history/today', 30000)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await apiFetch('/history/forecast/refresh', { method: 'POST' })
      refetch()
    } catch (e) {
      console.error(e)
    }
    setRefreshing(false)
  }

  const today = forecast?.today
  const tomorrow = forecast?.tomorrow

  const todayChart = today?.hourly?.map((h: any) => ({
    hour: formatHour(h.hour),
    generation: Math.round(h.generation_w),
    cloud: h.cloud_pct,
  })) || []

  const tomorrowChart = tomorrow?.hourly?.map((h: any) => ({
    hour: formatHour(h.hour),
    generation: Math.round(h.generation_w),
    cloud: h.cloud_pct,
  })) || []

  // Comparison bar data
  const comparisonData = []
  if (today) comparisonData.push({ name: 'Today', kwh: today.estimated_kwh, peak: Math.round(today.peak_watts / 1000 * 10) / 10 })
  if (tomorrow) comparisonData.push({ name: 'Tomorrow', kwh: tomorrow.estimated_kwh, peak: Math.round(tomorrow.peak_watts / 1000 * 10) / 10 })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Solar Forecast</h2>
          <p className="text-sm text-slate-500">Predicted solar generation from weather data</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="card text-center py-12 text-slate-500">Loading forecast...</div>
      ) : !today && !tomorrow ? (
        <div className="card text-center py-12">
          <Sun className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-400 mb-2">No Forecast Data</h3>
          <p className="text-sm text-slate-500 mb-4">
            Make sure your location is configured in Settings, then click Refresh.
          </p>
          <button onClick={handleRefresh} disabled={refreshing} className="btn-primary text-sm">
            {refreshing ? 'Fetching...' : 'Fetch Forecast'}
          </button>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {today && (
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <div className="card-header mb-0">Today</div>
                  <ConditionIcon
                    condition={today.condition}
                    className={`w-5 h-5 ${
                      today.condition === 'sunny' ? 'text-amber-400' :
                      today.condition === 'partly_cloudy' ? 'text-amber-300' : 'text-slate-400'
                    }`}
                  />
                </div>
                <div className="stat-value text-amber-400">{today.estimated_kwh} kWh</div>
                <div className="stat-label">Estimated generation</div>
                <div className="flex gap-4 mt-3 text-sm text-slate-400">
                  <span>Peak: {(today.peak_watts / 1000).toFixed(1)} kW</span>
                  <span>Cloud: {today.avg_cloud_cover.toFixed(0)}%</span>
                  <span className="capitalize">{today.condition.replace('_', ' ')}</span>
                </div>
                {todayTotals && (
                  <div className="mt-4 pt-4 border-t border-slate-800">
                    <SolarGoal
                      actual={todayTotals.solar_generated_kwh}
                      forecast={today.estimated_kwh}
                      label="Generation Goal"
                    />
                  </div>
                )}
                {valueData && !valueData.error && (
                  <div className="flex items-center gap-1.5 mt-3 text-sm font-medium text-emerald-400">
                    <DollarSign className="w-3.5 h-3.5" />
                    Actual value: +${valueData.net_value.toFixed(2)}
                  </div>
                )}
              </div>
            )}

            {tomorrow && (
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <div className="card-header mb-0">Tomorrow</div>
                  <ConditionIcon
                    condition={tomorrow.condition}
                    className={`w-5 h-5 ${
                      tomorrow.condition === 'sunny' ? 'text-blue-400' :
                      tomorrow.condition === 'partly_cloudy' ? 'text-blue-300' : 'text-slate-400'
                    }`}
                  />
                </div>
                <div className="stat-value text-blue-400">{tomorrow.estimated_kwh} kWh</div>
                <div className="stat-label">Estimated generation</div>
                <div className="flex gap-4 mt-3 text-sm text-slate-400">
                  <span>Peak: {(tomorrow.peak_watts / 1000).toFixed(1)} kW</span>
                  <span>Cloud: {tomorrow.avg_cloud_cover.toFixed(0)}%</span>
                  <span className="capitalize">{tomorrow.condition.replace('_', ' ')}</span>
                </div>

                {today && (
                  <div className={`mt-3 text-sm font-medium ${
                    tomorrow.estimated_kwh >= today.estimated_kwh ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {tomorrow.estimated_kwh >= today.estimated_kwh ? '+' : ''}
                    {(tomorrow.estimated_kwh - today.estimated_kwh).toFixed(1)} kWh vs today
                    ({tomorrow.estimated_kwh >= today.estimated_kwh ? 'more' : 'less'} sun)
                  </div>
                )}
                {valueData && !valueData.error && today && today.estimated_kwh > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 text-sm font-medium text-blue-400">
                    <DollarSign className="w-3.5 h-3.5" />
                    Potential: ~${((valueData.net_value / today.estimated_kwh) * tomorrow.estimated_kwh).toFixed(2)}
                    <span className="text-xs text-slate-500 font-normal">(estimated)</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Forecast vs Actual Overlay */}
          {vsActual?.hourly && (
            <div className="card">
              <div className="flex items-center justify-between mb-1">
                <div className="card-header mb-0">Today: Forecast vs Actual</div>
                <div className="flex gap-4 text-xs text-slate-500">
                  <span>Forecast: <span className="text-amber-400">{vsActual.forecast_total_kwh} kWh</span></span>
                  <span>Actual: <span className="text-emerald-400">{vsActual.actual_total_kwh} kWh</span></span>
                  {vsActual.forecast_total_kwh > 0 && (
                    <span className={vsActual.actual_total_kwh >= vsActual.forecast_total_kwh ? 'text-emerald-400' : 'text-amber-400'}>
                      {((vsActual.actual_total_kwh / vsActual.forecast_total_kwh) * 100).toFixed(0)}% of forecast
                    </span>
                  )}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={vsActual.hourly.map((h: any) => ({
                  hour: formatHour(h.hour),
                  forecast: Math.round(h.forecast_w),
                  actual: h.actual_w !== null ? Math.round(h.actual_w) : undefined,
                }))}>
                  <defs>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="hour" stroke="#475569" fontSize={10} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)}kW`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(v: number, name: string) => [
                      `${(v / 1000).toFixed(2)} kW`,
                      name === 'forecast' ? 'Forecast' : 'Actual'
                    ]}
                  />
                  <Legend
                    formatter={(val) => <span className="text-slate-300 text-xs">{val === 'forecast' ? 'Forecast' : 'Actual'}</span>}
                  />
                  {/* Forecast as dashed area */}
                  <Area
                    type="monotone"
                    dataKey="forecast"
                    stroke="#fbbf24"
                    fill="url(#forecastFill)"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    dot={false}
                  />
                  {/* Actual as solid area */}
                  <Area
                    type="monotone"
                    dataKey="actual"
                    stroke="#34d399"
                    fill="url(#actualFill)"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tomorrow's Hourly Chart */}
          {tomorrowChart.length > 0 && (
            <div className="card">
              <div className="card-header">Tomorrow - Hourly Forecast</div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={tomorrowChart.map((h: any) => ({
                  ...h,
                  generationKw: Math.round(h.generation / 10) / 100,
                }))}>
                  <defs>
                    <linearGradient id="solarGradient2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="hour" stroke="#475569" fontSize={10} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false}
                    tickFormatter={(v) => `${v.toFixed(1)}kW`} />
                  <Tooltip
                    contentStyle={{
                  borderRadius: '8px',
                  fontSize: '12px',
                    }}
                    formatter={(value: number) => [`${value.toFixed(2)} kW`, 'Forecast']}
                  />
                  <Area
                    type="monotone"
                    dataKey="generationKw"
                    stroke="#60a5fa"
                    fill="url(#solarGradient2)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Cloud Cover Comparison */}
          {todayChart.length > 0 && tomorrowChart.length > 0 && (
            <div className="card">
              <div className="card-header">Cloud Cover Comparison (%)</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={todayChart.map((t: any, i: number) => ({
                  hour: t.hour,
                  today: t.cloud,
                  tomorrow: tomorrowChart[i]?.cloud || 0,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="hour" stroke="#475569" fontSize={11} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={11} tickLine={false} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                  borderRadius: '8px',
                  fontSize: '12px',
                    }}
                    formatter={(value: number) => [`${value}%`, '']}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="today" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.1} strokeWidth={1.5} name="Today" />
                  <Area type="monotone" dataKey="tomorrow" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.1} strokeWidth={1.5} name="Tomorrow" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
