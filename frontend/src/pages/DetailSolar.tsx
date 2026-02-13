import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sun, ArrowLeft, Cloud, CloudSun, CloudLightning, Wind, Droplets, AlertTriangle, DollarSign, RefreshCw } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'
import SolarGoal from '../components/SolarGoal'
import TimeRangeSelector, { getTimeRange, formatChartTime } from '../components/TimeRangeSelector'

function formatPower(w: number) { return Math.abs(w) >= 1000 ? `${(Math.abs(w)/1000).toFixed(1)} kW` : `${Math.round(Math.abs(w))} W` }

export default function DetailSolar() {
  const navigate = useNavigate()
  const { status: wsStatus } = useWebSocket()
  const { data: polledStatus } = useAutoRefresh<any>('/status', 30000)
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = wsStatus || validPolled

  const [range, setRange] = useState('today')
  const tr = getTimeRange(range)

  const { data: rangeStats } = useApi<any>(`/history/range-stats?${tr.apiParam}`)
  const { data: readings } = useApi<any>(`/history/readings?${tr.apiParam}&resolution=${tr.resolution}`)
  const { data: forecast } = useApi('/history/forecast')
  const { data: vsActual } = useApi('/history/forecast/vs-actual')
  const { data: solarConfig } = useApi('/settings/setup/solar')
  const { data: weather } = useApi<any>('/history/weather')
  const { data: todayTotals } = useAutoRefresh<any>('/history/today', 60000)

  const rs = rangeStats || {}

  const chartData = readings?.readings?.map((r: any) => ({
    time: formatChartTime(r.timestamp, range),
    solar: Math.round((r.solar_power || 0) / 100) / 10,
  })) || []

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </button>
          <Sun className="w-6 h-6 text-amber-500" />
          <h2 className="text-2xl font-bold">Solar</h2>
        </div>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-header">Current Output</div>
          <div className="stat-value text-amber-500 dark:text-amber-400">{status ? formatPower(status.solar_power) : '—'}</div>
        </div>
        <div className="card">
          <div className="card-header">Generated</div>
          <div className="stat-value text-amber-500 dark:text-amber-400">{rs.solar_generated_kwh > 0 ? `${rs.solar_generated_kwh} kWh` : '—'}</div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
        <div className="card">
          <div className="card-header">Forecast Today</div>
          <div className="stat-value text-amber-500/70 dark:text-amber-400/70">{forecast?.today ? `${forecast.today.estimated_kwh} kWh` : '—'}</div>
          <div className="stat-label">{forecast?.today?.condition?.replace('_', ' ')}</div>
        </div>
        <div className="card">
          <div className="card-header">Forecast Tomorrow</div>
          <div className="stat-value text-blue-500 dark:text-blue-400">{forecast?.tomorrow ? `${forecast.tomorrow.estimated_kwh} kWh` : '—'}</div>
          <div className="stat-label">{forecast?.tomorrow?.condition?.replace('_', ' ')}</div>
        </div>
      </div>

      {/* Solar Goal */}
      {rs.solar_generated_kwh > 0 && forecast?.today && (
        <div className="card">
          <SolarGoal actual={rs.solar_generated_kwh} forecast={forecast.today.estimated_kwh} label="Today's Solar Goal" />
        </div>
      )}

      {/* Production Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">Solar Production ({rs.period_label || ''})</div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="solarDetailGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}kW`} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                formatter={(v: number) => [`${v.toFixed(1)} kW`, 'Solar']}
              />
              <Area type="monotone" dataKey="solar" stroke="#fbbf24" fill="url(#solarDetailGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Forecast vs Actual */}
      {vsActual?.hourly && (
        <div className="card">
          <div className="card-header">Forecast vs Actual</div>
          <div className="flex gap-4 text-xs text-slate-500 mb-2">
            <span>Forecast: <span className="text-amber-500">{vsActual.forecast_total_kwh} kWh</span></span>
            <span>Actual: <span className="text-emerald-500">{vsActual.actual_total_kwh} kWh</span></span>
            {vsActual.forecast_total_kwh > 0 && (
              <span>{((vsActual.actual_total_kwh / vsActual.forecast_total_kwh) * 100).toFixed(0)}% of forecast</span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={vsActual.hourly.map((h: any) => ({
              hour: h.hour === 0 ? '12a' : h.hour === 12 ? '12p' : h.hour < 12 ? `${h.hour}a` : `${h.hour-12}p`,
              forecast: Math.round(h.forecast_w / 10) / 100,
              actual: h.actual_w != null ? Math.round(h.actual_w / 10) / 100 : undefined,
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="hour" stroke="#475569" fontSize={10} tickLine={false} />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}kW`} />
              <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`${v.toFixed(2)} kW`, '']} />
              <Area type="monotone" dataKey="forecast" stroke="#fbbf24" fill="#fbbf2410" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
              <Area type="monotone" dataKey="actual" stroke="#34d399" fill="#34d39915" strokeWidth={2.5} dot={false} connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tomorrow's Hourly Forecast */}
      {forecast?.tomorrow?.hourly && (
        <div className="card">
          <div className="card-header">Tomorrow — {forecast.tomorrow.estimated_kwh} kWh forecast</div>
          <div className="flex gap-3 text-xs text-slate-500 mb-2">
            <span>Peak: {(forecast.tomorrow.peak_watts / 1000).toFixed(1)} kW</span>
            <span className="capitalize">{forecast.tomorrow.condition?.replace('_', ' ')}</span>
            {forecast.today && (
              <span className={forecast.tomorrow.estimated_kwh >= forecast.today.estimated_kwh ? 'text-emerald-400' : 'text-amber-400'}>
                {forecast.tomorrow.estimated_kwh >= forecast.today.estimated_kwh ? '+' : ''}
                {(forecast.tomorrow.estimated_kwh - forecast.today.estimated_kwh).toFixed(1)} kWh vs today
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={forecast.tomorrow.hourly.map((h: any) => ({
              hour: h.hour === 0 ? '12a' : h.hour === 12 ? '12p' : h.hour < 12 ? `${h.hour}a` : `${h.hour-12}p`,
              kw: Math.round(h.generation_w / 10) / 100,
            }))}>
              <defs>
                <linearGradient id="tmrwGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="hour" stroke="#475569" fontSize={10} tickLine={false} />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}kW`} />
              <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`${v.toFixed(2)} kW`, 'Forecast']} />
              <Area type="monotone" dataKey="kw" stroke="#60a5fa" fill="url(#tmrwGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 7-Day Weather */}
      {weather?.days?.length > 0 && (
        <div className="card">
          <div className="card-header">7-Day Weather</div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {weather.days.map((day: any) => {
              const isToday = day.date === new Date().toISOString().slice(0, 10)
              const dayName = new Date(day.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })
              return (
                <div key={day.date} className={`p-2 rounded-xl text-center ${
                  day.is_storm ? 'bg-red-500/10 border border-red-500/30' :
                  day.is_severe ? 'bg-amber-500/10 border border-amber-500/30' :
                  isToday ? 'bg-amber-500/5 ring-1 ring-amber-500/20' :
                  'bg-slate-100 dark:bg-slate-800/30'
                }`}>
                  <div className={`text-[10px] font-medium ${isToday ? 'text-amber-400' : 'text-slate-500'}`}>
                    {isToday ? 'Today' : dayName}
                  </div>
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-1">
                    {day.temp_high_f}°/{day.temp_low_f}°
                  </div>
                  <div className={`text-[9px] mt-0.5 ${day.is_storm ? 'text-red-400' : day.is_severe ? 'text-amber-400' : 'text-slate-500'}`}>
                    {day.description}
                  </div>
                  {day.storm_watch_likely && (
                    <div className="text-[8px] bg-amber-500/15 text-amber-500 px-1 py-0.5 rounded mt-1 font-medium">Storm</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* System Info */}
      {solarConfig?.configured && (
        <div className="card">
          <div className="card-header">Solar System</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><span className="text-slate-500">Array Size</span><p className="font-medium">{solarConfig.capacity_kw} kW DC</p></div>
            <div><span className="text-slate-500">Tilt</span><p className="font-medium">{solarConfig.tilt}°</p></div>
            <div><span className="text-slate-500">Azimuth</span><p className="font-medium">{solarConfig.azimuth === 0 ? 'South' : `${solarConfig.azimuth}°`}</p></div>
            <div><span className="text-slate-500">Inverter Efficiency</span><p className="font-medium">{(solarConfig.inverter_efficiency * 100).toFixed(0)}%</p></div>
            <div><span className="text-slate-500">System Losses</span><p className="font-medium">{solarConfig.system_losses}%</p></div>
            <div><span className="text-slate-500">DC/AC Ratio</span><p className="font-medium">{solarConfig.dc_ac_ratio}</p></div>
          </div>
        </div>
      )}
    </div>
  )
}
