import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun,
  Zap,
  Home,
  Battery,
  Car,
  Cloud,
  Wifi,
  WifiOff,
  Shield,
  Settings,
  ArrowDownToLine,
  ArrowUpFromLine,
  DollarSign,
  Activity,
  Brain,
  AlertTriangle,
  Lightbulb,
  Trophy,
  Info,
  Shield as ShieldIcon,
  PiggyBank,
  BarChart3,
} from 'lucide-react'
import { useWebSocket, type PowerwallStatus } from '../hooks/useWebSocket'
import { useApi } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import PowerFlowDiagram from '../components/PowerFlowDiagram'
import BatteryGauge from '../components/BatteryGauge'
import SolarGoal from '../components/SolarGoal'

function formatEnergy(kwh: number): string {
  if (kwh >= 100) return `${Math.round(kwh)} kWh`
  if (kwh >= 10) return `${kwh.toFixed(1)} kWh`
  return `${kwh.toFixed(2)} kWh`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { status: liveStatus, vehicleStatus: wsVehicle, connected } = useWebSocket()
  const { data: polledStatus } = useApi<PowerwallStatus>('/status')
  const { data: polledVehicle } = useApi<any>('/vehicle/status')
  const { data: forecast } = useApi('/history/forecast')
  const { data: setupStatus } = useApi<any>('/settings/setup/status')
  const { data: todayTotals } = useAutoRefresh<any>('/history/today', 60000)
  const { data: siteConfig } = useApi<any>('/site/config')
  const { data: tariff } = useAutoRefresh<any>('/site/tariff', 120000)
  const { data: valueData } = useAutoRefresh<any>('/history/value', 60000)
  const { data: optimizeStatus } = useAutoRefresh<any>('/settings/optimize/status', 60000)
  const { data: aiInsights } = useApi<any>('/ai/insights')
  const { data: aiAnomalies } = useApi<any>('/ai/anomalies')
  const { data: healthData } = useApi<any>('/powerwall/health')
  const { data: savingsData } = useApi<any>('/powerwall/health/savings')

  // Only use polledStatus if it has actual Powerwall data (not an error response)
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = liveStatus || validPolled

  // Vehicle data: WebSocket primary, API fallback
  const vehicleStatus = wsVehicle || polledVehicle
  const vehicleCS = vehicleStatus?.charge_state
  const vehicleInfo = vehicleStatus?.vehicle
  const hasVehicle = vehicleCS != null

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-sm text-slate-500">Real-time Powerwall monitoring</p>
        </div>
        <div className="relative group flex items-center gap-2 cursor-help">
          {connected ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Wifi className="w-3.5 h-3.5" /> Live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <WifiOff className="w-3.5 h-3.5" /> Offline
            </span>
          )}
          <span className="text-[10px] text-slate-500">WebSocket</span>
          {/* Tooltip */}
          <div className="absolute right-0 top-full mt-2 w-64 p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 text-xs text-slate-500 dark:text-slate-400">
            {connected ? (
              <p><span className="text-emerald-400 font-medium">Connected</span> — Real-time data is streaming. Power flow and stats update instantly.</p>
            ) : (
              <>
                <p className="mb-2"><span className="text-slate-400 font-medium">Disconnected</span> — Data updates via polling instead of real-time streaming.</p>
                <p>If you're using a reverse proxy, enable <span className="font-medium text-slate-300">WebSocket support</span> in your proxy settings for the GridMind host.</p>
              </>
            )}
          </div>
        </div>
      </div>

      {!status ? (
        <div className="card text-center py-16">
          <Zap className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-400 mb-2">
            {setupStatus && !setupStatus.setup_complete ? 'Welcome to GridMind!' : 'No Data Available'}
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            {setupStatus && !setupStatus.setup_complete
              ? 'Set up your Tesla API credentials and location to get started.'
              : 'Complete Tesla authentication in Settings to start monitoring your Powerwall.'}
          </p>
          <button
            onClick={() => navigate('/settings')}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            Go to Settings
          </button>
        </div>
      ) : (
        <>
          {/* Power Flow */}
          <div className="card">
            <div className="card-header">Power Flow</div>
            <PowerFlowDiagram
              status={status}
              tariff={tariff}
              evChargingWatts={hasVehicle && vehicleCS.charging_state === 'Charging' ? (vehicleCS.charger_power || 0) * 1000 : 0}
              evSoc={hasVehicle ? vehicleCS.battery_level : undefined}
              evName={vehicleInfo?.display_name}
            />
          </div>

          {/* Daily Totals + Battery */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Solar Generated Today */}
            <div className="card cursor-pointer hover:ring-1 hover:ring-amber-500/30 transition-all" onClick={() => navigate('/detail/solar')}>
              <div className="flex items-center gap-2 mb-2">
                <Sun className="w-4 h-4 text-amber-400" />
                <span className="card-header mb-0">Generated</span>
              </div>
              <div className="stat-value text-amber-400">
                {todayTotals ? formatEnergy(todayTotals.solar_generated_kwh) : '—'}
              </div>
              <div className="stat-label">Solar today</div>
              {forecast?.today && forecast.today.remaining_sunlight_hours !== null && forecast.today.remaining_sunlight_hours > 0 && (
                <div className="text-xs text-slate-500 mt-1.5 space-y-0.5">
                  <div>{forecast.today.remaining_sunlight_hours}h sunlight remaining</div>
                  {forecast.today.remaining_kwh !== null && (
                    <div>~{forecast.today.remaining_kwh} kWh potential remaining</div>
                  )}
                </div>
              )}
              {forecast?.today && (forecast.today.remaining_sunlight_hours === 0 || forecast.today.remaining_sunlight_hours === null) && (
                <div className="text-xs text-slate-600 mt-1.5">Sun has set</div>
              )}
            </div>

            {/* Grid Exported Today */}
            <div className="card cursor-pointer hover:ring-1 hover:ring-emerald-500/30 transition-all" onClick={() => navigate('/detail/grid')}>
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpFromLine className="w-4 h-4 text-emerald-400" />
                <span className="card-header mb-0">Exported</span>
              </div>
              <div className="stat-value text-emerald-400">
                {todayTotals ? formatEnergy(todayTotals.grid_exported_kwh) : '—'}
              </div>
              <div className="stat-label">To grid today</div>
            </div>

            {/* Home Consumed Today */}
            <div className="card cursor-pointer hover:ring-1 hover:ring-cyan-500/30 transition-all" onClick={() => navigate('/detail/home')}>
              <div className="flex items-center gap-2 mb-2">
                <Home className="w-4 h-4 text-cyan-400" />
                <span className="card-header mb-0">Consumed</span>
              </div>
              <div className="stat-value text-cyan-400">
                {todayTotals ? formatEnergy(todayTotals.home_consumed_kwh) : '—'}
              </div>
              <div className="stat-label">Home today</div>
            </div>

            {/* Battery */}
            <div className="cursor-pointer hover:ring-1 hover:ring-blue-500/30 transition-all rounded-xl" onClick={() => navigate('/detail/battery')}>
              <BatteryGauge
                soc={status.battery_soc}
                power={status.battery_power}
                reserve={status.backup_reserve}
                description={siteConfig?.battery_description}
                capacityKwh={siteConfig?.total_capacity_kwh}
                maxPowerKw={siteConfig?.nameplate_power_kw}
              />
            </div>
          </div>

          {/* EV Tile */}
          {hasVehicle && (
            <div className="card cursor-pointer hover:ring-1 hover:ring-violet-500/30 transition-all" onClick={() => navigate('/vehicle')}>
              <div className="flex items-center gap-2 mb-2">
                <Car className="w-4 h-4 text-violet-400" />
                <span className="card-header mb-0">{vehicleInfo?.display_name || 'Vehicle'}</span>
              </div>

              {/* Mini charge bar */}
              <div className="relative w-full h-6 bg-slate-800 rounded-md overflow-hidden border border-slate-700 mb-2">
                <div
                  className={`absolute top-0 bottom-0 left-0 transition-all duration-1000 ${
                    vehicleCS.battery_level <= 20 ? 'bg-orange-500' :
                    vehicleCS.battery_level <= 50 ? 'bg-yellow-500' :
                    vehicleCS.battery_level <= 90 ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${vehicleCS.battery_level}%` }}
                />
                {vehicleCS.charge_limit_soc > 0 && vehicleCS.charge_limit_soc < 100 && (
                  <div className="absolute top-0 bottom-0" style={{ left: `${vehicleCS.charge_limit_soc}%`, width: '1.5px', backgroundColor: '#ffffff50' }} />
                )}
                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow">
                  {vehicleCS.battery_level}%
                </div>
              </div>

              <div className="flex justify-between text-sm">
                <span className={
                  vehicleCS.charging_state === 'Charging' ? 'text-emerald-400' :
                  vehicleCS.charging_state === 'Complete' ? 'text-blue-400' :
                  vehicleCS.charging_state === 'Stopped' ? 'text-amber-400' :
                  'text-slate-500'
                }>
                  {vehicleCS.charging_state === 'Charging' ? 'Charging' :
                   vehicleCS.charging_state === 'Complete' ? 'Complete' :
                   vehicleCS.charging_state === 'Stopped' ? 'Plugged In' :
                   'Unplugged'}
                </span>
                <span className="font-medium text-slate-400">
                  {vehicleCS.charging_state === 'Charging'
                    ? `${vehicleCS.charger_power.toFixed(1)} kW`
                    : `${Math.round(vehicleCS.battery_range)} mi`}
                </span>
              </div>
            </div>
          )}

          {/* GridMind Optimize Status */}
          {optimizeStatus && (() => {
            const phase = optimizeStatus.phase
            const enabled = optimizeStatus.enabled
            const isHolding = enabled && phase === 'peak_hold'
            const isComplete = enabled && phase === 'complete'

            // Distinguish actual exporting vs powering home during "dumping" phase
            // grid_power < -50 means actually exporting to grid
            const isExporting = enabled && phase === 'dumping' && status && status.grid_power < -50
            const isPoweringHome = enabled && phase === 'dumping' && (!status || status.grid_power >= -50)
            const isDumping = isExporting  // Only use amber "Dumping" when actually exporting
            const isWaiting = enabled && !isDumping && !isPoweringHome && !isHolding && !isComplete

            const solidColor = isDumping ? '#f59e0b' : isPoweringHome ? '#06b6d4' : isHolding ? '#3b82f6' : '#10b981'
            const glowColor = isDumping ? 'rgba(245,158,11,0.12)' : isPoweringHome ? 'rgba(6,182,212,0.10)' : isHolding ? 'rgba(59,130,246,0.10)' : 'rgba(16,185,129,0.08)'

            return (
            <div className="relative rounded-xl" style={{
              padding: enabled ? '2px' : 0,
              boxShadow: enabled ? `0 0 12px ${glowColor}, 0 0 24px ${glowColor}` : undefined,
            }}>
              {/* Rotating conic gradient border */}
              {enabled && (
                <>
                <style>{`
                  @keyframes rotateBorder {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}</style>
                <div className="absolute inset-0 rounded-xl overflow-hidden">
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      /* Must be larger than the card diagonal. Card is ~960px wide, ~80px tall.
                         Diagonal ≈ 963px. Use 200% of the larger dimension to be safe. */
                      width: '200vw',
                      height: '200vw',
                      marginTop: '-100vw',
                      marginLeft: '-100vw',
                      borderRadius: '50%',
                      background: `conic-gradient(from 0deg, transparent 0%, transparent 30%, ${solidColor}40 38%, ${solidColor} 45%, ${solidColor} 55%, ${solidColor}40 62%, transparent 70%, transparent 100%)`,
                      animation: `rotateBorder ${isDumping ? '2s' : isPoweringHome ? '3s' : isHolding ? '4s' : '6s'} linear infinite`,
                    }}
                  />
                </div>
                </>
              )}

              {/* Card inner - opaque background covers the gradient except at the 2px border */}
              <div className="relative rounded-xl p-5 bg-slate-100 dark:bg-slate-900 overflow-hidden" style={{
                border: enabled ? 'none' : undefined,
              }}>

              <div className="relative flex items-center gap-5">
                {/* Left: icon + title */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="relative">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      !enabled ? 'bg-slate-200/60 dark:bg-slate-800'
                        : isDumping ? 'bg-amber-500/15 dark:bg-amber-500/20'
                        : isPoweringHome ? 'bg-cyan-500/15 dark:bg-cyan-500/20'
                        : isHolding ? 'bg-blue-500/15 dark:bg-blue-500/20'
                        : 'bg-emerald-500/15 dark:bg-emerald-500/20'
                    }`}>
                      <Activity className={`w-6 h-6 ${
                        !enabled ? 'text-slate-400 dark:text-slate-600'
                          : isDumping ? 'text-amber-500'
                          : isPoweringHome ? 'text-cyan-500'
                          : isHolding ? 'text-blue-500'
                          : 'text-emerald-500'
                      }`} />
                    </div>
                    {(isDumping || isPoweringHome || isHolding) && (
                      <div className={`absolute -inset-1 rounded-xl border-2 animate-pulse ${
                        isDumping ? 'border-amber-500/30' : isPoweringHome ? 'border-cyan-500/30' : 'border-blue-500/30'
                      }`} />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200">GridMind</div>
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200 -mt-0.5">Optimize</div>
                  </div>
                </div>

                {/* Center: description */}
                <div className="flex-1 min-w-0">
                  {enabled && (
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium inline-block mb-1">Enabled</span>
                  )}
                  <p className="text-xs text-slate-500">
                    {enabled
                      ? isDumping && optimizeStatus.estimated_finish
                        ? `Exporting battery to grid · ${status ? `${(Math.abs(status.grid_power) / 1000).toFixed(1)} kW to grid` : ''} · Est. finish: ${optimizeStatus.estimated_finish}`
                        : isPoweringHome
                        ? `Battery powering home during peak · ${status ? `${(status.home_power / 1000).toFixed(1)} kW home load` : ''} · Exporting surplus when available`
                        : isHolding
                        ? `Self-powered during peak · ${optimizeStatus.last_calculation?.available_kwh || '?'} kWh available · Calculating optimal dump time`
                        : isComplete
                        ? 'Peak period finished · Normal operation restored'
                        : `Peak: ${optimizeStatus.peak_start_hour > 12 ? optimizeStatus.peak_start_hour - 12 : optimizeStatus.peak_start_hour}:00 ${optimizeStatus.peak_start_hour >= 12 ? 'PM' : 'AM'} – ${optimizeStatus.peak_end_hour > 12 ? optimizeStatus.peak_end_hour - 12 : optimizeStatus.peak_end_hour}:00 ${optimizeStatus.peak_end_hour >= 12 ? 'PM' : 'AM'}`
                      : 'Smart peak export strategy'}
                  </p>
                </div>

                {/* Right: large status badge */}
                <div className="shrink-0">
                  {enabled ? (
                    <div className={`px-4 py-2 rounded-lg font-bold text-sm uppercase tracking-wider ${
                      isDumping
                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 animate-pulse'
                        : isPoweringHome
                        ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'
                        : isHolding
                        ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                        : isComplete
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    }`}>
                      {isDumping ? 'Exporting'
                        : isPoweringHome ? 'Powering Home'
                        : isHolding ? 'Holding'
                        : isComplete ? 'Complete'
                        : 'Waiting for Peak'}
                    </div>
                  ) : (
                    <div className="px-4 py-2 rounded-lg font-bold text-sm uppercase tracking-wider bg-slate-200/60 text-slate-400 dark:bg-slate-800 dark:text-slate-600">
                      Off
                    </div>
                  )}
                </div>
              </div>

              {/* Calculation breakdown — shown during peak phases */}
              {enabled && optimizeStatus.last_calculation && (isHolding || isDumping || isPoweringHome) && (() => {
                const calc = optimizeStatus.last_calculation
                return (
                  <div className="mt-4 pt-3 border-t border-slate-200/30 dark:border-slate-800/50">
                    <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-2">How It's Thinking</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500">Available Energy</span>
                        <p className="font-bold text-blue-400">{calc.available_kwh} kWh</p>
                        <p className="text-[10px] text-slate-600">at {calc.battery_soc.toFixed(0)}% SOC</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Home Load</span>
                        <p className="font-bold text-cyan-400">{calc.home_load_kw} kW</p>
                        <p className="text-[10px] text-slate-600">rolling average</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Net Export Rate</span>
                        <p className="font-bold text-emerald-400">{calc.net_export_kw} kW</p>
                        <p className="text-[10px] text-slate-600">to grid after home</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Time Needed</span>
                        <p className="font-bold text-amber-400">{calc.minutes_needed > 60 ? `${Math.floor(calc.minutes_needed / 60)}h ${Math.round(calc.minutes_needed % 60)}m` : `${Math.round(calc.minutes_needed)}m`}</p>
                        <p className="text-[10px] text-slate-600">to fully export</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                      <span>Peak remaining: {calc.minutes_remaining > 60 ? `${Math.floor(calc.minutes_remaining / 60)}h ${Math.round(calc.minutes_remaining % 60)}m` : `${Math.round(calc.minutes_remaining)}m`}</span>
                      <span>Buffer: {optimizeStatus.buffer_minutes}m safety margin</span>
                      <span>Trigger: {isHolding ? `starts when ≤${Math.round(calc.trigger_at_minutes)}m remain` : `triggered at ${Math.round(calc.trigger_at_minutes)}m`}</span>
                      <span>Decision: <span className={`font-medium ${calc.decision === 'dump' ? 'text-amber-400' : calc.decision === 'hold' ? 'text-blue-400' : 'text-slate-400'}`}>{calc.decision === 'dump' ? 'Export now' : calc.decision === 'hold' ? 'Keep holding' : calc.decision}</span></span>
                    </div>
                  </div>
                )
              })()}
            </div>
            </div>
            )
          })()}

          {/* Solar Goal + Tomorrow Forecast */}
          {forecast?.today && todayTotals && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="card">
                <SolarGoal
                  actual={todayTotals.solar_generated_kwh}
                  forecast={forecast.today.estimated_kwh}
                  label="Today's Solar Goal"
                />
                <div className="flex gap-3 mt-3 text-xs text-slate-500">
                  <span>{forecast.today.condition === 'sunny' ? 'Sunny' :
                   forecast.today.condition === 'partly_cloudy' ? 'Partly Cloudy' : 'Cloudy'}</span>
                  <span>Peak: {(forecast.today.peak_watts / 1000).toFixed(1)} kW</span>
                  {forecast.today.remaining_sunlight_hours != null && forecast.today.remaining_sunlight_hours > 0 && (
                    <span>{forecast.today.remaining_sunlight_hours}h sun left</span>
                  )}
                </div>
              </div>

              {forecast?.tomorrow && (
                <div className="card">
                  <div className="card-header">Tomorrow's Forecast</div>
                  <div className="stat-value text-blue-400">
                    {forecast.tomorrow.estimated_kwh} kWh
                  </div>
                  <div className="stat-label">
                    {forecast.tomorrow.condition === 'sunny' ? 'Sunny' :
                     forecast.tomorrow.condition === 'partly_cloudy' ? 'Partly Cloudy' : 'Cloudy'}
                    {' '} - Peak {(forecast.tomorrow.peak_watts / 1000).toFixed(1)} kW
                  </div>
                  {forecast.today && (
                    <div className={`text-sm font-medium mt-2 ${
                      forecast.tomorrow.estimated_kwh >= forecast.today.estimated_kwh ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {forecast.tomorrow.estimated_kwh >= forecast.today.estimated_kwh ? '+' : ''}
                      {(forecast.tomorrow.estimated_kwh - forecast.today.estimated_kwh).toFixed(1)} kWh vs today
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Backup Time + Cost Savings */}
          {(healthData || savingsData) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Backup Duration */}
              {healthData?.battery?.backup_time_remaining_hours != null && (
                <div className="card">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldIcon className="w-4 h-4 text-blue-400" />
                    <span className="card-header mb-0">Backup Reserve</span>
                  </div>
                  <div className="stat-value text-blue-400">
                    {healthData.battery.backup_time_remaining_hours >= 24
                      ? `${(healthData.battery.backup_time_remaining_hours / 24).toFixed(1)} days`
                      : `${healthData.battery.backup_time_remaining_hours.toFixed(1)} hours`}
                  </div>
                  <div className="stat-label">
                    Estimated backup at current usage · {healthData.battery.backup_reserve_pct}% reserve
                  </div>
                </div>
              )}

              {/* Cost Savings */}
              {savingsData && !savingsData.error && (
                <div className="card">
                  <div className="flex items-center gap-2 mb-2">
                    <PiggyBank className="w-4 h-4 text-emerald-400" />
                    <span className="card-header mb-0">Savings</span>
                  </div>
                  <div className="stat-value text-emerald-400">
                    ${savingsData.total_savings.toLocaleString()}
                  </div>
                  <div className="stat-label">
                    Total saved over {savingsData.days_tracked} days · ~${savingsData.avg_daily_savings}/day
                  </div>
                  {savingsData.today_savings > 0 && (
                    <div className="text-xs text-emerald-500/70 mt-1">
                      +${savingsData.today_savings.toFixed(2)} today
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 7-Day Solar Forecast */}
          {forecast?.week?.length > 2 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-amber-400" />
                <span className="card-header mb-0">7-Day Solar Forecast</span>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {forecast.week.map((day: any) => {
                  const dayName = new Date(day.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })
                  const isToday = day.date === new Date().toISOString().slice(0, 10)
                  return (
                    <div key={day.date} className={`text-center p-2 rounded-lg ${
                      isToday ? 'bg-amber-500/10 ring-1 ring-amber-500/30' : 'bg-slate-800/30'
                    }`}>
                      <div className={`text-[10px] font-medium ${isToday ? 'text-amber-400' : 'text-slate-500'}`}>
                        {isToday ? 'Today' : dayName}
                      </div>
                      <div className={`text-sm font-bold mt-1 ${
                        day.condition === 'sunny' ? 'text-amber-400' :
                        day.condition === 'partly_cloudy' ? 'text-amber-300/70' :
                        'text-slate-400'
                      }`}>
                        {day.estimated_kwh}
                      </div>
                      <div className="text-[9px] text-slate-500">kWh</div>
                      <div className="text-[9px] mt-1">
                        {day.condition === 'sunny' ? '☀️' :
                         day.condition === 'partly_cloudy' ? '⛅' : '☁️'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* AI Insights */}
          {aiInsights?.insights?.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4.5 h-4.5 text-violet-400" />
                <span className="card-header mb-0">AI Insights</span>
                <span className="text-[10px] text-slate-600">{aiInsights.model}</span>
              </div>
              <div className="space-y-2">
                {aiInsights.insights.map((insight: any, i: number) => (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-800/30">
                    {insight.type === 'achievement' ? (
                      <Trophy className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    ) : insight.type === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    ) : insight.type === 'tip' ? (
                      <Lightbulb className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{insight.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{insight.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Anomalies */}
          {aiAnomalies?.anomalies?.length > 0 && (
            <div className="space-y-2">
              {aiAnomalies.anomalies.map((anomaly: any, i: number) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${
                  anomaly.severity === 'critical'
                    ? 'border-red-500/30 bg-red-500/5'
                    : anomaly.severity === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-blue-500/30 bg-blue-500/5'
                }`}>
                  <Brain className={`w-4 h-4 shrink-0 mt-0.5 ${
                    anomaly.severity === 'critical' ? 'text-red-400' :
                    anomaly.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                  }`} />
                  <div>
                    <p className={`text-sm font-medium ${
                      anomaly.severity === 'critical' ? 'text-red-400' :
                      anomaly.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                    }`}>{anomaly.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{anomaly.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* System Status Bar — pinned to bottom */}
          <div className="card">
            <div className="flex flex-wrap gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  status.grid_status === 'connected' ? 'bg-emerald-400' : 'bg-red-400'
                }`} />
                <span className="text-slate-400">Grid:</span>
                <span className="font-medium">
                  {status.grid_status === 'connected' ? 'Connected' : 'Islanded (Off-Grid)'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-400">Mode:</span>
                <span className="font-medium">
                  {status.operation_mode === 'self_consumption' ? 'Self-Powered' : 'Time-Based Control'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Battery className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-400">Reserve:</span>
                <span className="font-medium">{status.backup_reserve}%</span>
              </div>

              {todayTotals && todayTotals.grid_imported_kwh > 0 && (
                <div className="flex items-center gap-2">
                  <ArrowDownToLine className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-400">Imported:</span>
                  <span className="font-medium">{formatEnergy(todayTotals.grid_imported_kwh)}</span>
                </div>
              )}

              {valueData && !valueData.error && (
                <div className="flex items-center gap-2">
                  <DollarSign className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-400">Today:</span>
                  <span className={`font-medium ${valueData.net_value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {valueData.net_value >= 0 ? '+' : '-'}${Math.abs(valueData.net_value).toFixed(2)}
                  </span>
                </div>
              )}

              {status.storm_mode && (
                <div className="flex items-center gap-2">
                  <Cloud className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-medium text-amber-400">Storm Watch</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
