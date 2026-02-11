import { useNavigate } from 'react-router-dom'
import { Battery, ArrowLeft } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'
import BatteryGauge from '../components/BatteryGauge'

function formatPower(w: number) { return Math.abs(w) >= 1000 ? `${(Math.abs(w)/1000).toFixed(1)} kW` : `${Math.round(Math.abs(w))} W` }

export default function DetailBattery() {
  const navigate = useNavigate()
  const { status } = useWebSocket()
  const { data: todayTotals } = useAutoRefresh<any>('/history/today', 30000)
  const { data: siteConfig } = useApi('/site/config')
  const { data: readings } = useApi('/history/readings?hours=24&resolution=5')

  const charging = status && status.battery_power < -50
  const discharging = status && status.battery_power > 50

  const chartData = readings?.readings?.map((r: any) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    soc: r.battery_soc,
    power: Math.round((r.battery_power || 0) / 100) / 10,
  })) || []

  return (
    <div className="p-6 space-y-6">
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
          <div className="card-header">Charged Today</div>
          <div className="stat-value text-emerald-500 dark:text-emerald-400">{todayTotals ? `${todayTotals.battery_charged_kwh.toFixed(1)} kWh` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-header">Discharged Today</div>
          <div className="stat-value text-blue-500 dark:text-blue-400">{todayTotals ? `${todayTotals.battery_discharged_kwh.toFixed(1)} kWh` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-header">Cycles Today</div>
          <div className="stat-value text-slate-600 dark:text-slate-300">
            {todayTotals && siteConfig?.total_capacity_kwh
              ? ((todayTotals.battery_discharged_kwh / siteConfig.total_capacity_kwh).toFixed(2))
              : '—'}
          </div>
          <div className="stat-label">Full discharge equivalents</div>
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
          <div className="card-header">State of Charge (Last 24h)</div>
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
          <div className="card-header">Battery Power (Last 24h)</div>
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
    </div>
  )
}
