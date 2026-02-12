import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Battery,
  ArrowLeft,
  Shield,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  CheckCircle,
  Info,
  Cpu,
  Zap,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'
import BatteryGauge from '../components/BatteryGauge'
import TimeRangeSelector, { getTimeRange, formatChartTime } from '../components/TimeRangeSelector'

function formatPower(w: number) { return Math.abs(w) >= 1000 ? `${(Math.abs(w)/1000).toFixed(1)} kW` : `${Math.round(Math.abs(w))} W` }

export default function DetailBattery() {
  const navigate = useNavigate()
  const { status: wsStatus } = useWebSocket()
  const { data: polledStatus } = useAutoRefresh<any>('/status', 30000)
  const { data: siteConfig } = useApi('/site/config')
  const { data: health } = useApi<any>('/powerwall/health')
  const { data: throughput } = useApi<any>('/powerwall/health/throughput?days=30')
  const { data: alerts } = useAutoRefresh<any>('/powerwall/health/alerts', 120000)
  const { data: capacity } = useApi<any>('/powerwall/health/capacity')

  const [range, setRange] = useState('today')
  const tr = getTimeRange(range)

  const { data: rangeStats } = useApi<any>(`/history/range-stats?${tr.apiParam}`)
  const { data: readings } = useApi<any>(`/history/readings?${tr.apiParam}&resolution=${tr.resolution}`)

  // Use WebSocket data when available, fall back to API polling
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = wsStatus || validPolled
  const rs = rangeStats || {}

  const charging = status && status.battery_power < -50
  const discharging = status && status.battery_power > 50

  const chartData = readings?.readings?.map((r: any) => ({
    time: formatChartTime(r.timestamp, range),
    soc: r.battery_soc,
    power: Math.round((r.battery_power || 0) / 100) / 10,
  })) || []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </button>
          <Battery className="w-6 h-6 text-blue-500" />
          <h2 className="text-2xl font-bold">Battery</h2>
          {siteConfig?.battery_description && (
            <span className="text-sm text-slate-500">{siteConfig.battery_description}</span>
          )}
        </div>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      {/* Battery Gauge */}
      {status && (
        <div className="max-w-lg">
          <BatteryGauge
            soc={status.battery_soc}
            power={status.battery_power}
            reserve={status.backup_reserve}
            description={siteConfig?.battery_description}
            capacityKwh={siteConfig?.total_capacity_kwh}
            maxPowerKw={siteConfig?.nameplate_power_kw}
          />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-header">Current Power</div>
          <div className={`stat-value ${charging ? 'text-emerald-500 dark:text-emerald-400' : discharging ? 'text-blue-500 dark:text-blue-400' : 'text-slate-500'}`}>
            {status ? formatPower(status.battery_power) : '—'}
          </div>
          <div className="stat-label">{charging ? 'Charging' : discharging ? 'Discharging' : 'Idle'}</div>
        </div>
        <div className="card">
          <div className="card-header">Charged</div>
          <div className="stat-value text-emerald-500 dark:text-emerald-400">{rs.battery_charged_kwh > 0 ? `${rs.battery_charged_kwh} kWh` : '—'}</div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
        <div className="card">
          <div className="card-header">Discharged</div>
          <div className="stat-value text-blue-500 dark:text-blue-400">{rs.battery_discharged_kwh > 0 ? `${rs.battery_discharged_kwh} kWh` : '—'}</div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
        <div className="card">
          <div className="card-header">Cycles</div>
          <div className="stat-value text-slate-600 dark:text-slate-300">
            {rs.battery_discharged_kwh > 0 && siteConfig?.total_capacity_kwh
              ? (rs.battery_discharged_kwh / siteConfig.total_capacity_kwh).toFixed(2)
              : '—'}
          </div>
          <div className="stat-label">{rs.period_label || ''}</div>
        </div>
      </div>

      {/* System Info */}
      {siteConfig && (
        <div className="card">
          <div className="card-header">Battery System</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><span className="text-slate-500">Type</span><p className="font-medium">{siteConfig.battery_description || 'N/A'}</p></div>
            <div><span className="text-slate-500">Capacity</span><p className="font-medium">{siteConfig.total_capacity_kwh} kWh</p></div>
            <div><span className="text-slate-500">Max Output</span><p className="font-medium">{siteConfig.nameplate_power_kw} kW</p></div>
            <div><span className="text-slate-500">Firmware</span><p className="font-medium font-mono text-xs">{siteConfig.firmware_version || 'N/A'}</p></div>
          </div>
        </div>
      )}

      {/* SOC History Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">State of Charge ({rs.period_label || ''})</div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`${v.toFixed(1)}%`, 'SOC']} />
              <Line type="monotone" dataKey="soc" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Battery Power Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">Battery Power ({rs.period_label || ''})</div>
          <p className="text-xs text-slate-500 mb-2">Positive = discharging, Negative = charging</p>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}kW`} />
              <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`${v.toFixed(1)} kW`, v >= 0 ? 'Discharging' : 'Charging']} />
              <Area type="monotone" dataKey="power" stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Alerts */}
      {alerts?.alerts?.length > 0 && (
        <div className="space-y-2">
          {alerts.alerts.map((a: any, i: number) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${
              a.severity === 'critical'
                ? 'border-red-500/30 bg-red-500/5'
                : a.severity === 'warning'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-blue-500/30 bg-blue-500/5'
            }`}>
              {a.severity === 'critical' ? (
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              ) : a.severity === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  a.severity === 'critical' ? 'text-red-400' :
                  a.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                }`}>{a.message}</p>
                {a.started && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {new Date(a.started).toLocaleString()}
                    {a.ended ? ` — ${new Date(a.ended).toLocaleString()}` : ' — ongoing'}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Health Status */}
      {health && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Connectivity */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              {health.connectivity.grid_connected ? (
                <Wifi className="w-4 h-4 text-emerald-400" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-400" />
              )}
              <span className="card-header mb-0">Grid</span>
            </div>
            <div className={`text-lg font-bold ${health.connectivity.grid_connected ? 'text-emerald-400' : 'text-red-400'}`}>
              {health.connectivity.grid_connected ? 'Connected' : 'Islanded'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {health.connectivity.storm_mode_active && (
                <span className="text-amber-400">Storm Watch Active</span>
              )}
              {!health.connectivity.storm_mode_active && health.connectivity.storm_mode_capable && (
                <span>Storm Watch ready</span>
              )}
            </div>
          </div>

          {/* Backup Time */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-blue-400" />
              <span className="card-header mb-0">Backup</span>
            </div>
            <div className="text-lg font-bold text-blue-400">
              {health.battery.backup_time_remaining_hours != null
                ? `${health.battery.backup_time_remaining_hours.toFixed(1)}h`
                : '—'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Estimated backup time · {health.battery.backup_reserve_pct}% reserve
            </div>
          </div>

          {/* System Age */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="card-header mb-0">Installation</span>
            </div>
            <div className="text-lg font-bold text-slate-700 dark:text-slate-300">
              {health.system.days_since_install != null
                ? health.system.days_since_install < 365
                  ? `${health.system.days_since_install} days`
                  : `${(health.system.days_since_install / 365).toFixed(1)} years`
                : '—'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {health.system.utility} · {health.system.tariff_id}
            </div>
          </div>
        </div>
      )}

      {/* Lifetime Stats */}
      {throughput?.totals && (
        <div className="card">
          <div className="card-header">Lifetime Statistics ({throughput.totals.days_tracked} days tracked)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Total Charged</span>
              <p className="text-lg font-bold text-emerald-400">{throughput.totals.total_charged_kwh.toLocaleString()} kWh</p>
            </div>
            <div>
              <span className="text-slate-500">Total Discharged</span>
              <p className="text-lg font-bold text-blue-400">{throughput.totals.total_discharged_kwh.toLocaleString()} kWh</p>
            </div>
            <div>
              <span className="text-slate-500">Battery Cycles</span>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{throughput.totals.total_cycles}</p>
              <p className="text-[10px] text-slate-500">{throughput.totals.avg_daily_cycles}/day avg</p>
            </div>
            <div>
              <span className="text-slate-500">Self-Powered</span>
              <p className="text-lg font-bold text-amber-400">{throughput.totals.self_powered_pct}%</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4">
            <div>
              <span className="text-slate-500">Total Solar</span>
              <p className="font-medium">{throughput.totals.total_solar_kwh.toLocaleString()} kWh</p>
            </div>
            <div>
              <span className="text-slate-500">Total Exported</span>
              <p className="font-medium">{throughput.totals.total_exported_kwh.toLocaleString()} kWh</p>
            </div>
            <div>
              <span className="text-slate-500">Total Imported</span>
              <p className="font-medium">{throughput.totals.total_imported_kwh.toLocaleString()} kWh</p>
            </div>
            <div>
              <span className="text-slate-500">Total Consumed</span>
              <p className="font-medium">{throughput.totals.total_consumed_kwh.toLocaleString()} kWh</p>
            </div>
          </div>
        </div>
      )}

      {/* Battery Health / Capacity */}
      {capacity && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4.5 h-4.5 text-emerald-400" />
            <span className="card-header mb-0">Battery Health</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {/* Estimated Capacity */}
            <div>
              <span className="text-xs text-slate-500">Estimated Capacity</span>
              {capacity.latest_estimate ? (
                <>
                  <p className="text-lg font-bold text-emerald-400">
                    {capacity.latest_estimate.estimated_capacity_kwh} kWh
                  </p>
                  <p className="text-[10px] text-slate-500">
                    of {capacity.nominal_capacity_kwh} kWh nominal
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-bold text-slate-500">—</p>
                  <p className="text-[10px] text-slate-500">Needs a deep cycle (30%+ swing)</p>
                </>
              )}
            </div>

            {/* Health Percentage */}
            <div>
              <span className="text-xs text-slate-500">Health</span>
              {capacity.latest_estimate ? (
                <>
                  <p className={`text-lg font-bold ${
                    capacity.latest_estimate.health_pct >= 95 ? 'text-emerald-400' :
                    capacity.latest_estimate.health_pct >= 85 ? 'text-lime-400' :
                    capacity.latest_estimate.health_pct >= 70 ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {capacity.latest_estimate.health_pct}%
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {capacity.latest_estimate.health_pct >= 95 ? 'Excellent' :
                     capacity.latest_estimate.health_pct >= 85 ? 'Good' :
                     capacity.latest_estimate.health_pct >= 70 ? 'Fair' : 'Degraded'}
                  </p>
                </>
              ) : (
                <p className="text-lg font-bold text-slate-500">—</p>
              )}
            </div>

          </div>

          {/* Health Explanation */}
          {capacity.latest_estimate && (
            <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800/50 mb-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                <span className="font-medium text-slate-700 dark:text-slate-300">How this is calculated: </span>
                On {capacity.latest_estimate.date}, the battery cycled from {capacity.latest_estimate.min_soc}% to {capacity.latest_estimate.max_soc}% ({capacity.latest_estimate.soc_swing_pct}% swing),
                using {capacity.latest_estimate.charged_kwh} kWh. Accounting for ~92% round-trip efficiency,
                that estimates an effective capacity of <span className="font-medium text-slate-700 dark:text-slate-300">{capacity.latest_estimate.estimated_capacity_kwh} kWh</span> out
                of {capacity.nominal_capacity_kwh} kWh nominal = <span className={`font-medium ${
                  capacity.latest_estimate.health_pct >= 95 ? 'text-emerald-400' :
                  capacity.latest_estimate.health_pct >= 85 ? 'text-lime-400' :
                  capacity.latest_estimate.health_pct >= 70 ? 'text-amber-400' : 'text-red-400'
                }`}>{capacity.latest_estimate.health_pct}% health</span>.
              </p>
              <p className="text-[10px] text-slate-500 mt-2">
                {capacity.latest_estimate.health_pct >= 95
                  ? 'Excellent — capacity is at or near nominal. Battery is performing as expected.'
                  : capacity.latest_estimate.health_pct >= 85
                  ? 'Good — slight capacity reduction is normal. No concerns.'
                  : capacity.latest_estimate.health_pct >= 70
                  ? 'Fair — this estimate may be affected by incomplete charge cycles, high loads during charging, or temperature. A single deep cycle (10% to 100%) gives the most accurate reading. This does not necessarily indicate degradation.'
                  : 'Degraded — capacity is significantly below nominal. Monitor over multiple cycles to confirm.'}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                Rating scale: Excellent (95%+), Good (85-95%), Fair (70-85%), Degraded (&lt;70%).
                {capacity.data_points < 5 && ' Accuracy improves with more deep charge cycles.'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

            {/* Round-Trip Efficiency */}
            <div>
              <span className="text-xs text-slate-500">Round-Trip Efficiency</span>
              <p className={`text-lg font-bold ${
                (capacity.avg_efficiency_pct || 0) >= 88 ? 'text-emerald-400' :
                (capacity.avg_efficiency_pct || 0) >= 80 ? 'text-amber-400' :
                'text-red-400'
              }`}>
                {capacity.avg_efficiency_pct ? `${capacity.avg_efficiency_pct}%` : '—'}
              </p>
              <p className="text-[10px] text-slate-500">Energy out / energy in</p>
            </div>

            {/* Data Points */}
            <div>
              <span className="text-xs text-slate-500">Cycle Samples</span>
              <p className="text-lg font-bold text-slate-400">{capacity.data_points}</p>
              <p className="text-[10px] text-slate-500">Deep cycles analyzed</p>
            </div>
          </div>

          {/* Capacity Trend Chart */}
          {capacity.capacity_trend?.length > 1 && (
            <div className="mt-4">
              <p className="text-xs text-slate-500 mb-2">Estimated Capacity Over Time</p>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={capacity.capacity_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="date"
                    stroke="#475569"
                    fontSize={9}
                    tickLine={false}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis
                    stroke="#475569"
                    fontSize={10}
                    tickLine={false}
                    domain={['dataMin - 2', 'dataMax + 2']}
                    tickFormatter={(v) => `${v}`}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                    formatter={(v: number) => [`${v.toFixed(1)} kWh`, 'Capacity']}
                  />
                  <Line type="monotone" dataKey="estimated_capacity_kwh" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Efficiency Trend Chart */}
          {capacity.efficiency_trend?.length > 1 && (
            <div className="mt-4">
              <p className="text-xs text-slate-500 mb-2">Round-Trip Efficiency Over Time</p>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={capacity.efficiency_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="date"
                    stroke="#475569"
                    fontSize={9}
                    tickLine={false}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis
                    stroke="#475569"
                    fontSize={10}
                    tickLine={false}
                    domain={[75, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                    formatter={(v: number) => [`${v.toFixed(1)}%`, 'Efficiency']}
                  />
                  <Line type="monotone" dataKey="efficiency_pct" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: '#8b5cf6' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {capacity.data_points === 0 && (
            <p className="text-xs text-slate-500 italic mt-2">
              Capacity estimation requires at least one deep charge cycle (30%+ SOC swing).
              As GridMind collects more daily data, health trends will appear here.
            </p>
          )}
        </div>
      )}

      {/* Daily Throughput Chart */}
      {throughput?.days?.length > 0 && (
        <div className="card">
          <div className="card-header">Daily Battery Throughput (30 days)</div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={throughput.days}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                stroke="#475569"
                fontSize={9}
                tickLine={false}
                tickFormatter={(d: string) => d.slice(5)}
                interval="preserveStartEnd"
              />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}`} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                formatter={(v: number, name: string) => [
                  `${v.toFixed(1)} kWh`,
                  name === 'charged_kwh' ? 'Charged' : 'Discharged',
                ]}
              />
              <Bar dataKey="charged_kwh" fill="#10b981" radius={[2, 2, 0, 0]} />
              <Bar dataKey="discharged_kwh" fill="#3b82f6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Charged</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Discharged</span>
          </div>
        </div>
      )}

      {/* Hardware Inventory */}
      {health?.hardware?.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-slate-400" />
            <span className="card-header mb-0">Hardware</span>
          </div>
          <div className="space-y-3">
            {health.hardware.map((hw: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800/50">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${hw.active ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <div>
                    <p className="text-sm font-medium">{hw.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono">{hw.serial}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-500">{hw.part_number}</p>
                  {hw.firmware && (
                    <p className="text-[10px] text-slate-500 font-mono">{hw.firmware}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
