import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Car,
  ArrowLeft,
  Play,
  Square,
  Zap,
  Battery,
  Clock,
  Gauge,
  Sun,
  Home,
  Timer,
  Plug,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CircleAlert,
  CheckCircle,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { useApi, apiFetch } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'
import ChargeGauge from '../components/ChargeGauge'

type Strategy = 'off' | 'tou_aware' | 'solar_surplus' | 'departure'

interface ScheduleConfig {
  strategy: Strategy
  solar_surplus_threshold_kw: number
  solar_surplus_min_soc: number
  departure_time: string
  departure_target_soc: number
  battery_capacity_kwh: number
  grid_charge_limit: number
  solar_charge_limit: number
}

export default function VehiclePage() {
  const navigate = useNavigate()
  // WebSocket for real-time vehicle updates (primary)
  const { vehicleStatus: wsVehicle } = useWebSocket()
  // API fallback for initial load and when WebSocket hasn't received data yet
  const { data: polledStatus, loading, error, refetch } = useApi<any>('/vehicle/status')
  const { data: vehicleList, refetch: refetchList } = useApi<any>('/vehicle/list')
  const { data: schedule, refetch: refetchSchedule } = useApi<ScheduleConfig>('/vehicle/schedule')
  const { data: readings } = useApi<any>('/vehicle/history?hours=24&resolution=5')
  const { data: chargeSource } = useAutoRefresh<any>('/vehicle/charge-source', 15000)
  const { data: wallConnector } = useAutoRefresh<any>('/vehicle/wall-connector', 30000)
  const { data: detailedStatus } = useAutoRefresh<any>('/vehicle/detailed-status', 30000)
  const { data: solarMiles } = useAutoRefresh<any>('/vehicle/solar-miles', 60000)

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [pendingSchedule, setPendingSchedule] = useState<ScheduleConfig | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sliderLimit, setSliderLimit] = useState<number | null>(null)

  // Use WebSocket data when available, fall back to polled API data
  const vehicleStatus = wsVehicle || polledStatus

  const cs = vehicleStatus?.charge_state
  const vehicle = vehicleStatus?.vehicle
  const isAsleep = vehicle?.state === 'asleep'
  const isCharging = cs?.charging_state === 'Charging'
  // Use Wall Connector data as a fallback for plug state (works even when car is asleep)
  const wcPluggedIn = vehicleStatus?.wc_plugged_in === true
  const vehiclePluggedIn = cs?.charging_state && cs.charging_state !== 'Disconnected'
  const isPluggedIn = vehiclePluggedIn || wcPluggedIn

  // Build chart data from readings
  const chartData = readings?.readings?.map((r: any) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    soc: r.battery_level,
    power: r.charger_power || 0,
  })) || []

  // Schedule form state
  const sched = pendingSchedule || schedule || {
    strategy: 'off' as Strategy,
    solar_surplus_threshold_kw: 1.5,
    solar_surplus_min_soc: 20,
    departure_time: '07:30',
    departure_target_soc: 80,
    battery_capacity_kwh: 75.0,
    grid_charge_limit: 0,
    solar_charge_limit: 0,
  }

  const updateScheduleField = (field: string, value: any) => {
    setPendingSchedule({ ...sched, [field]: value })
  }

  // --- Actions ---

  const doAction = async (path: string, body?: any) => {
    setActionLoading(true)
    setActionError(null)
    try {
      const result = await apiFetch(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      if (result.warning) setActionError(result.warning)
      setTimeout(refetch, 2000) // Refresh status after action
    } catch (e: any) {
      setActionError(e.message)
    } finally {
      setActionLoading(false)
    }
  }

  const saveSchedule = async () => {
    if (!pendingSchedule) return
    setActionLoading(true)
    setActionError(null)
    try {
      await apiFetch('/vehicle/schedule', {
        method: 'POST',
        body: JSON.stringify(pendingSchedule),
      })
      setPendingSchedule(null)
      refetchSchedule()
    } catch (e: any) {
      setActionError(e.message)
    } finally {
      setActionLoading(false)
    }
  }

  const selectVehicle = async (vehicleId: string, name: string, vin?: string) => {
    setActionLoading(true)
    try {
      await apiFetch('/vehicle/select', {
        method: 'POST',
        body: JSON.stringify({ vehicle_id: vehicleId, display_name: name, vin }),
      })
      refetchList()
      setTimeout(refetch, 1000)
    } catch (e: any) {
      setActionError(e.message)
    } finally {
      setActionLoading(false)
    }
  }

  // --- No vehicle selected ---

  if (!loading && vehicleList && !vehicleList.selected_vehicle_id) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </button>
          <Car className="w-6 h-6 text-violet-500" />
          <h2 className="text-2xl font-bold">Vehicle</h2>
        </div>

        <div className="card text-center py-12">
          <Car className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-400 mb-2">Select Your Vehicle</h3>
          <p className="text-sm text-slate-500 mb-6">Choose which Tesla to monitor and control.</p>

          {vehicleList?.vehicles?.length > 0 ? (
            <div className="space-y-3 max-w-sm mx-auto">
              {vehicleList.vehicles.map((v: any) => (
                <button
                  key={v.id}
                  onClick={() => selectVehicle(v.id, v.display_name, v.vin)}
                  className="w-full p-4 rounded-xl border border-slate-700 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all text-left"
                >
                  <div className="font-medium">{v.display_name}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    VIN: {v.vin} &middot; {v.state}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No vehicles found on your Tesla account.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-500" />
        </button>
        <Car className="w-6 h-6 text-violet-500" />
        <h2 className="text-2xl font-bold">Vehicle</h2>
        {vehicle?.display_name && (
          <span className="text-sm text-slate-500">{vehicle.display_name}</span>
        )}
        {isAsleep && (
          <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">Asleep</span>
        )}
      </div>

      {/* Asleep / stale data notice */}
      {isAsleep && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-sm">
          <div className="flex items-center gap-2 text-slate-500">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Vehicle is asleep{wcPluggedIn ? ' (plugged in via Wall Connector)' : ''}. Charge data may be stale. Wake to refresh.
            </span>
          </div>
          <button
            onClick={() => doAction('/vehicle/wake').then(() => setTimeout(refetch, 5000))}
            disabled={actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500/15 text-violet-500 hover:bg-violet-500/25 transition-colors shrink-0 ml-3"
          >
            <Zap className="w-3.5 h-3.5" />
            Wake & Refresh
          </button>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {actionError}
        </div>
      )}

      {/* Charge Gauge */}
      {cs && (
        <div className="max-w-lg">
          <ChargeGauge
            soc={cs.battery_level}
            chargeLimit={cs.charge_limit_soc}
            chargingState={cs.charging_state}
            power={cs.charger_power}
            range={cs.battery_range}
            displayName={vehicle?.display_name}
            gridChargeLimit={sched.grid_charge_limit || 0}
            solarChargeLimit={sched.solar_charge_limit || 0}
          />
        </div>
      )}

      {/* Missing scopes notice */}
      {vehicleStatus?.missing_scopes && (
        <div className="card border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-amber-500 mb-1">Vehicle Scopes Required</h3>
              <p className="text-sm text-slate-400 mb-2">
                Your Tesla Developer App needs vehicle permissions to show charge data and controls.
              </p>
              <ol className="text-sm text-slate-400 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://developer.tesla.com" target="_blank" rel="noreferrer" className="text-blue-400 underline">developer.tesla.com</a></li>
                <li>Edit your app and enable <strong>Vehicle Information</strong> and <strong>Vehicle Charging Management</strong> scopes</li>
                <li>Go to <a href="/settings" className="text-blue-400 underline">Settings</a> and re-authenticate with Tesla</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Asleep state — wake button */}
      {isAsleep && !cs && !vehicleStatus?.missing_scopes && (
        <div className="card text-center py-8">
          <p className="text-slate-500 mb-4">Vehicle is asleep. Wake it to see charge status.</p>
          <button
            onClick={() => doAction('/vehicle/wake')}
            disabled={actionLoading}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Zap className="w-4 h-4" />
            Wake Vehicle
          </button>
        </div>
      )}

      {/* Stats */}
      {cs && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card">
            <div className="card-header">Battery Level</div>
            <div className="stat-value text-violet-500 dark:text-violet-400">{cs.battery_level}%</div>
            <div className="stat-label">of {cs.charge_limit_soc}% limit</div>
          </div>
          <div className="card">
            <div className="card-header">Range</div>
            <div className="stat-value text-blue-500 dark:text-blue-400">{Math.round(cs.battery_range)} mi</div>
            <div className="stat-label">Rated range</div>
          </div>
          {isCharging ? (
            <>
              <div className="card">
                <div className="card-header">Charge Rate</div>
                <div className="stat-value text-emerald-500 dark:text-emerald-400">
                  {cs.charger_power >= 1 ? `${cs.charger_power.toFixed(1)} kW` : `${Math.round(cs.charger_power * 1000)} W`}
                </div>
                <div className="stat-label">
                  {cs.charger_voltage}V &middot; {cs.charger_actual_current}A
                  {cs.charger_phases && cs.charger_phases > 1 ? ` &middot; ${cs.charger_phases}φ` : ''}
                </div>
              </div>
              <div className="card">
                <div className="card-header">Session</div>
                <div className="stat-value text-amber-500 dark:text-amber-400">
                  {cs.charge_energy_added.toFixed(1)} kWh
                </div>
                <div className="stat-label">
                  +{Math.round(cs.charge_miles_added_rated)} mi
                  {cs.charge_rate > 0 && ` · ${Math.round(cs.charge_rate)} mi/hr`}
                </div>
                {cs.time_to_full_charge > 0 && (
                  <div className="text-xs text-slate-500 mt-1">
                    {cs.time_to_full_charge < 1
                      ? `${Math.round(cs.time_to_full_charge * 60)}m to full`
                      : `${Math.floor(cs.time_to_full_charge)}h ${Math.round((cs.time_to_full_charge % 1) * 60)}m to full`}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="card">
                <div className="card-header">Status</div>
                <div className={`stat-value text-sm ${
                  detailedStatus?.status?.startsWith('charging') ? 'text-emerald-500 dark:text-emerald-400' :
                  detailedStatus?.status === 'complete' || detailedStatus?.status === 'at_limit' ? 'text-blue-400' :
                  detailedStatus?.status?.startsWith('paused') || detailedStatus?.status?.startsWith('waiting') ? 'text-amber-500 dark:text-amber-400' :
                  detailedStatus?.status === 'disconnected' ? 'text-slate-500' :
                  'text-amber-400'
                }`}>
                  {detailedStatus?.label ||
                   (cs.charging_state === 'Complete' ? 'Complete' :
                    cs.charging_state === 'Stopped' ? 'Plugged In' :
                    cs.charging_state === 'NoPower' ? 'Plugged In (No Power)' :
                    wcPluggedIn ? 'Plugged In (via WC)' :
                    'Unplugged')}
                </div>
                <div className="stat-label">
                  {detailedStatus?.detail ||
                   (cs.conn_charge_cable && cs.conn_charge_cable !== '<invalid>' ? `Cable: ${cs.conn_charge_cable}` : 'No cable connected')}
                </div>
              </div>
              <div className="card">
                <div className="card-header">Last Session</div>
                <div className="stat-value text-slate-500 dark:text-slate-400">
                  {cs.charge_energy_added > 0 ? `${cs.charge_energy_added.toFixed(1)} kWh` : '—'}
                </div>
                <div className="stat-label">
                  {cs.charge_energy_added > 0
                    ? `+${Math.round(cs.charge_miles_added_rated)} mi added`
                    : 'No session'}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tesla Charge Settings (from the car's own schedule) */}
      {cs && (cs.off_peak_charging_enabled || cs.scheduled_charging_mode !== 'Off') && (
        <div className="card border-slate-300/30 dark:border-slate-700/30">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="card-header mb-0">Tesla Charge Schedule</span>
            <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-medium">From Vehicle</span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {cs.off_peak_charging_enabled && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-slate-500">TOU Charging:</span>
                <span className="font-medium text-emerald-500 dark:text-emerald-400">Active</span>
                {cs.off_peak_charging_times && (
                  <span className="text-xs text-slate-500">({cs.off_peak_charging_times.replace('_', ' ')})</span>
                )}
              </div>
            )}
            {cs.scheduled_charging_mode !== 'Off' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-slate-500">Schedule:</span>
                <span className="font-medium text-blue-500 dark:text-blue-400">
                  {cs.scheduled_charging_mode === 'StartAt' ? 'Start At' :
                   cs.scheduled_charging_mode === 'DepartBy' ? 'Depart By' :
                   cs.scheduled_charging_mode}
                </span>
                {cs.scheduled_charging_start_time && (
                  <span className="text-xs text-slate-500">
                    {(() => {
                      const mins = cs.scheduled_charging_start_time
                      // Could be minutes after midnight or a unix timestamp
                      if (mins > 1440) {
                        const d = new Date(mins * 1000)
                        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      }
                      const h = Math.floor(mins / 60)
                      const m = mins % 60
                      return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
                    })()}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            These settings are configured in the Tesla app. GridMind's Smart Charge Schedule works alongside or can override these.
          </p>
        </div>
      )}

      {/* Solar Miles */}
      {solarMiles && (
        <div className="card border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-transparent">
          <div className="flex items-center gap-2 mb-3">
            <Sun className="w-4.5 h-4.5 text-amber-400" />
            <span className="card-header mb-0">Miles on Sunshine</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-xs text-slate-500">Today</span>
              <p className="text-2xl font-bold text-amber-500 tabular-nums">
                {solarMiles.today_solar_miles}
                <span className="text-sm font-medium text-amber-500/60 ml-1">mi</span>
              </p>
              <p className="text-[10px] text-slate-500">{solarMiles.today_solar_kwh} kWh solar</p>
            </div>
            <div>
              <span className="text-xs text-slate-500">All Time</span>
              <p className="text-2xl font-bold text-amber-400 tabular-nums">
                {solarMiles.total_solar_miles.toLocaleString()}
                <span className="text-sm font-medium text-amber-400/60 ml-1">mi</span>
              </p>
              <p className="text-[10px] text-slate-500">{solarMiles.total_solar_kwh.toLocaleString()} kWh solar</p>
            </div>
          </div>
          {/* Live solar charging — separate row so it's always visible on mobile */}
          {isCharging && chargeSource?.sources?.solar_pct > 0 && (
            <div className="mt-3 pt-3 border-t border-amber-500/10 flex items-center gap-3">
              <Sun className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="text-lg font-bold text-emerald-400 tabular-nums">{chargeSource.sources.solar_pct}%</span>
                <span className="text-xs text-slate-500 ml-2">solar powered right now</span>
                {chargeSource.sources.solar_kw > 0 && (
                  <span className="text-xs text-amber-400/70 ml-2">({chargeSource.sources.solar_kw} kW)</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Charge Source */}
      {isCharging && chargeSource?.charging && chargeSource.sources && (
        <div className="card">
          <div className="card-header">Charging From</div>
          <div className="flex items-center gap-4">
            {/* Source bars */}
            <div className="flex-1">
              <div className="flex h-6 rounded-lg overflow-hidden bg-slate-800">
                {chargeSource.sources.solar_pct > 0 && (
                  <div
                    className="bg-amber-500 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
                    style={{ width: `${chargeSource.sources.solar_pct}%` }}
                    title={`Solar: ${chargeSource.sources.solar_kw} kW`}
                  >
                    {chargeSource.sources.solar_pct >= 5 && `${chargeSource.sources.solar_pct}%`}
                  </div>
                )}
                {chargeSource.sources.battery_pct > 0 && (
                  <div
                    className="bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
                    style={{ width: `${chargeSource.sources.battery_pct}%` }}
                    title={`Battery: ${chargeSource.sources.battery_kw} kW`}
                  >
                    {chargeSource.sources.battery_pct >= 5 && `${chargeSource.sources.battery_pct}%`}
                  </div>
                )}
                {chargeSource.sources.grid_pct > 0 && (
                  <div
                    className="bg-red-400 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
                    style={{ width: `${chargeSource.sources.grid_pct}%` }}
                    title={`Grid: ${chargeSource.sources.grid_kw} kW`}
                  >
                    {chargeSource.sources.grid_pct >= 5 && `${chargeSource.sources.grid_pct}%`}
                  </div>
                )}
              </div>
              {/* Legend */}
              <div className="flex gap-4 mt-2 text-xs">
                {chargeSource.sources.solar_pct > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Sun className="w-3 h-3 text-amber-400" />
                    <span className="text-amber-400 font-medium">{chargeSource.sources.solar_kw} kW</span>
                    <span className="text-slate-500">Solar</span>
                  </div>
                )}
                {chargeSource.sources.battery_pct > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Battery className="w-3 h-3 text-blue-400" />
                    <span className="text-blue-400 font-medium">{chargeSource.sources.battery_kw} kW</span>
                    <span className="text-slate-500">Powerwall</span>
                  </div>
                )}
                {chargeSource.sources.grid_pct > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-red-400" />
                    <span className="text-red-400 font-medium">{chargeSource.sources.grid_kw} kW</span>
                    <span className="text-slate-500">Grid</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      {cs && isPluggedIn && (
        <div className="card">
          <div className="card-header">Charge Controls</div>
          <div className="flex flex-wrap gap-4 items-center">
            {/* Start/Stop */}
            {isCharging ? (
              <button
                onClick={() => doAction('/vehicle/charge/stop')}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors font-medium text-sm"
              >
                <Square className="w-4 h-4" />
                Stop Charging
              </button>
            ) : (
              <button
                onClick={() => doAction('/vehicle/charge/start')}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors font-medium text-sm"
              >
                <Play className="w-4 h-4" />
                Start Charging
              </button>
            )}

            {/* Charge Limit Slider */}
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-slate-500 mb-1 block">
                Charge Limit: {sliderLimit ?? cs.charge_limit_soc}%
              </label>
              <input
                type="range"
                min={50}
                max={100}
                value={sliderLimit ?? cs.charge_limit_soc}
                onChange={(e) => setSliderLimit(Number(e.target.value))}
                onMouseUp={() => {
                  if (sliderLimit !== null && sliderLimit !== cs.charge_limit_soc) {
                    doAction('/vehicle/charge/limit', { percent: sliderLimit })
                  }
                  setSliderLimit(null)
                }}
                onTouchEnd={() => {
                  if (sliderLimit !== null && sliderLimit !== cs.charge_limit_soc) {
                    doAction('/vehicle/charge/limit', { percent: sliderLimit })
                  }
                  setSliderLimit(null)
                }}
                className="w-full accent-violet-500"
              />
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Smart Schedule */}
      <div className="card">
        <button
          onClick={() => setScheduleOpen(!scheduleOpen)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-violet-500" />
            <span className="card-header mb-0">Smart Charge Schedule</span>
            {sched.strategy !== 'off' && (
              <span className="text-[10px] bg-violet-500/15 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded font-medium">
                {sched.strategy === 'tou_aware' ? 'TOU-Aware' :
                 sched.strategy === 'solar_surplus' ? 'Solar Surplus' :
                 sched.strategy === 'departure' ? 'Departure' : 'Off'}
              </span>
            )}
          </div>
          {scheduleOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>

        {scheduleOpen && (
          <div className="mt-4 space-y-4">
            {/* Strategy Selector */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {([
                { id: 'off', label: 'Off', icon: Square, desc: 'Manual control' },
                { id: 'tou_aware', label: 'TOU-Aware', icon: Clock, desc: 'Charge off-peak only' },
                { id: 'solar_surplus', label: 'Solar Surplus', icon: Sun, desc: 'Charge from excess solar' },
                { id: 'departure', label: 'Departure', icon: Gauge, desc: 'Ready by leave time' },
              ] as const).map(({ id, label, icon: Icon, desc }) => (
                <button
                  key={id}
                  onClick={() => updateScheduleField('strategy', id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    sched.strategy === id
                      ? 'border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30'
                      : 'border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <Icon className={`w-4 h-4 mb-1 ${sched.strategy === id ? 'text-violet-400' : 'text-slate-500'}`} />
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-[10px] text-slate-500">{desc}</div>
                </button>
              ))}
            </div>

            {/* Strategy-specific settings */}
            {sched.strategy === 'solar_surplus' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Min Surplus (kW)</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.5}
                    max={10}
                    value={sched.solar_surplus_threshold_kw}
                    onChange={(e) => updateScheduleField('solar_surplus_threshold_kw', Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Start charging when surplus exceeds this</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Min Vehicle SOC (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={sched.solar_surplus_min_soc}
                    onChange={(e) => updateScheduleField('solar_surplus_min_soc', Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Always charge below this level</p>
                </div>
              </div>
            )}

            {sched.strategy === 'departure' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Departure Time</label>
                  <input
                    type="time"
                    value={sched.departure_time}
                    onChange={(e) => updateScheduleField('departure_time', e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Target SOC (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={sched.departure_target_soc}
                    onChange={(e) => updateScheduleField('departure_target_soc', Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Battery Capacity (kWh)</label>
                  <input
                    type="number"
                    step={1}
                    min={20}
                    max={200}
                    value={sched.battery_capacity_kwh}
                    onChange={(e) => updateScheduleField('battery_capacity_kwh', Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Vehicle battery size</p>
                </div>
              </div>
            )}

            {sched.strategy === 'tou_aware' && (
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 text-sm text-slate-500 dark:text-slate-400">
                <p>Automatically pauses charging during peak TOU periods and resumes during off-peak.</p>
                <p className="mt-1 text-[10px] text-slate-600">Uses your Tesla tariff rate schedule.</p>
              </div>
            )}

            {/* Hybrid Charge Limit — available with any active strategy */}
            {sched.strategy !== 'off' && (
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50">
                <div className="flex items-center gap-2 mb-3">
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium">Solar Charge Limit</span>
                  <span className="text-[10px] text-slate-500">Optional</span>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  Charge from any source up to the grid limit, then only charge from solar surplus up to the solar limit.
                </p>

                {/* Enable toggle */}
                <label className="flex items-center gap-2 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(sched.grid_charge_limit || 0) > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateScheduleField('grid_charge_limit', 80)
                        setPendingSchedule(prev => ({
                          ...(prev || sched),
                          grid_charge_limit: 80,
                          solar_charge_limit: 100,
                        }))
                      } else {
                        setPendingSchedule(prev => ({
                          ...(prev || sched),
                          grid_charge_limit: 0,
                          solar_charge_limit: 0,
                        }))
                      }
                    }}
                    className="accent-amber-500"
                  />
                  <span className="text-sm text-slate-300">Enable hybrid charge limit</span>
                </label>

                {(sched.grid_charge_limit || 0) > 0 && (
                  <div className="space-y-4">
                    {/* Visual bar showing the two zones */}
                    <div className="relative">
                      <div className="flex h-8 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-slate-700">
                        <div
                          className="bg-gradient-to-r from-violet-600 to-violet-500 flex items-center justify-center text-[10px] font-bold text-white"
                          style={{ width: `${sched.grid_charge_limit}%` }}
                        >
                          Any source to {sched.grid_charge_limit}%
                        </div>
                        <div
                          className="bg-gradient-to-r from-amber-600/60 to-amber-500/60 flex items-center justify-center text-[10px] font-bold text-white"
                          style={{ width: `${(sched.solar_charge_limit || 100) - sched.grid_charge_limit}%` }}
                        >
                          Solar only to {sched.solar_charge_limit || 100}%
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          Grid Charge Limit: {sched.grid_charge_limit}%
                        </label>
                        <input
                          type="range"
                          min={50}
                          max={95}
                          value={sched.grid_charge_limit}
                          onChange={(e) => {
                            const val = Number(e.target.value)
                            const solarVal = Math.max(val + 5, sched.solar_charge_limit || 100)
                            setPendingSchedule(prev => ({
                              ...(prev || sched),
                              grid_charge_limit: val,
                              solar_charge_limit: solarVal,
                            }))
                          }}
                          className="w-full accent-violet-500"
                        />
                        <p className="text-[10px] text-slate-600 mt-1">Charge from any source (grid, solar, battery) up to this level</p>
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          Solar Charge Limit: {sched.solar_charge_limit || 100}%
                        </label>
                        <input
                          type="range"
                          min={Math.max((sched.grid_charge_limit || 80) + 5, 55)}
                          max={100}
                          value={sched.solar_charge_limit || 100}
                          onChange={(e) => updateScheduleField('solar_charge_limit', Number(e.target.value))}
                          className="w-full accent-amber-500"
                        />
                        <p className="text-[10px] text-slate-600 mt-1">Only charge from solar surplus above the grid limit</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Save button */}
            {pendingSchedule && (
              <div className="flex gap-3">
                <button
                  onClick={saveSchedule}
                  disabled={actionLoading}
                  className="btn-primary text-sm"
                >
                  Save Schedule
                </button>
                <button
                  onClick={() => setPendingSchedule(null)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SOC History Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">Battery Level (Last 24h)</div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
               
                formatter={(v: number) => [`${v}%`, 'SOC']}
              />
              <Line type="monotone" dataKey="soc" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Charge Power Chart */}
      {chartData.length > 0 && chartData.some((d: any) => d.power > 0) && (
        <div className="card">
          <div className="card-header">Charge Power (Last 24h)</div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v) => `${v} kW`} />
              <Tooltip
               
                formatter={(v: number) => [`${v.toFixed(1)} kW`, 'Power']}
              />
              <Area type="monotone" dataKey="power" stroke="#10b981" fill="#10b98120" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Vehicle Info */}
      {vehicleStatus && (() => {
        // Decode model from VIN or vehicle_config
        const vin = vehicle?.vin || ''
        const vc = vehicleStatus.vehicle_config
        const carTypeMap: Record<string, string> = {
          modely: 'Model Y', model3: 'Model 3', models: 'Model S',
          modelx: 'Model X', cybertruck: 'Cybertruck',
        }
        // VIN position 4 encodes model: Y, 3, S, X, C (Cybertruck)
        const vinModelMap: Record<string, string> = {
          Y: 'Model Y', '3': 'Model 3', S: 'Model S', X: 'Model X', C: 'Cybertruck',
        }
        const modelName = vc?.car_type
          ? (carTypeMap[vc.car_type] || vc.car_type)
          : vin.length >= 4 ? (vinModelMap[vin[3]] || 'Tesla') : 'Tesla'

        // Decode trim from trim_badging
        const trimMap: Record<string, string> = {
          '74d': 'Long Range AWD', '74': 'Long Range', '50': 'Standard Range',
          p100d: 'Performance', '100d': 'Long Range', '75d': 'AWD',
          '75': 'RWD', '60d': 'AWD 60', '60': 'Standard 60',
        }
        const trimName = vc?.trim_badging
          ? (trimMap[vc.trim_badging.toLowerCase()] || vc.trim_badging)
          : ''
        const isPlaid = vc?.plaid
        const fullModel = `Tesla ${modelName}${isPlaid ? ' Plaid' : trimName ? ` ${trimName}` : ''}`

        // Exterior color formatting
        const colorMap: Record<string, string> = {
          MidnightSilver: 'Midnight Silver', SolidBlack: 'Solid Black',
          DeepBlue: 'Deep Blue', UltraWhite: 'Ultra White', Pearl: 'Pearl White',
          RedMulticoat: 'Red', QuickSilver: 'Quicksilver',
        }
        const colorName = vc?.exterior_color ? (colorMap[vc.exterior_color] || vc.exterior_color) : ''

        return (
        <div className="card">
          <div className="card-header">Vehicle Info</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Vehicle</span>
              <p className="font-medium">{fullModel}</p>
              {vehicle?.display_name && vehicle.display_name !== modelName && (
                <p className="text-xs text-slate-500">"{vehicle.display_name}"</p>
              )}
            </div>
            {colorName && (
              <div>
                <span className="text-slate-500">Color</span>
                <p className="font-medium">{colorName}</p>
              </div>
            )}
            <div>
              <span className="text-slate-500">VIN</span>
              <p className="font-medium font-mono text-xs">{vin || 'N/A'}</p>
            </div>
            <div>
              <span className="text-slate-500">Software</span>
              <p className="font-medium font-mono text-xs">{vehicleStatus.software_version || 'N/A'}</p>
            </div>
            {vehicleStatus.odometer != null && (
              <div>
                <span className="text-slate-500">Odometer</span>
                <p className="font-medium">{Math.round(vehicleStatus.odometer).toLocaleString()} mi</p>
              </div>
            )}
            {vc?.has_air_suspension && (
              <div>
                <span className="text-slate-500">Suspension</span>
                <p className="font-medium">Air Suspension</p>
              </div>
            )}
          </div>
        </div>
        )
      })()}

      {/* Wall Connector */}
      {wallConnector?.connectors?.map((wc: any, i: number) => (
        <div key={wc.din || i} className="card">
          <div className="flex items-center gap-2 mb-3">
            <Plug className="w-4.5 h-4.5 text-teal-500" />
            <span className="card-header mb-0">{wc.part_name}</span>
            {/* State badge */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              wc.state === 'Charging'
                ? 'bg-emerald-500/15 text-emerald-500'
                : wc.state === 'Connected'
                ? 'bg-blue-500/15 text-blue-400'
                : wc.state === 'Idle'
                ? 'bg-slate-500/15 text-slate-400'
                : wc.state === 'Complete'
                ? 'bg-violet-500/15 text-violet-400'
                : 'bg-slate-500/15 text-slate-500'
            }`}>
              {wc.state}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Power output */}
            <div>
              <span className="text-xs text-slate-500">Power Output</span>
              <p className={`text-lg font-bold tabular-nums ${wc.power_w > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                {wc.power_kw > 0 ? `${wc.power_kw} kW` : '0 W'}
              </p>
            </div>

            {/* Status */}
            <div>
              <span className="text-xs text-slate-500">Health</span>
              <div className="flex items-center gap-1.5 mt-1">
                {wc.has_fault ? (
                  <>
                    <CircleAlert className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-medium text-red-400">{wc.fault}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Normal</span>
                  </>
                )}
              </div>
            </div>

            {/* Serial */}
            <div>
              <span className="text-xs text-slate-500">Serial Number</span>
              <p className="text-sm font-medium font-mono">{wc.serial_number || 'N/A'}</p>
            </div>

            {/* Part number */}
            <div>
              <span className="text-xs text-slate-500">Part Number</span>
              <p className="text-sm font-medium font-mono">{wc.part_number || 'N/A'}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
