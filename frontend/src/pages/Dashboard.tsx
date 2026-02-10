import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun,
  Zap,
  Home,
  Battery,
  Cloud,
  Wifi,
  WifiOff,
  Shield,
  Settings,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react'
import { useWebSocket, type PowerwallStatus } from '../hooks/useWebSocket'
import { useApi } from '../hooks/useApi'
import PowerFlowDiagram from '../components/PowerFlowDiagram'
import BatteryGauge from '../components/BatteryGauge'

function formatEnergy(kwh: number): string {
  if (kwh >= 100) return `${Math.round(kwh)} kWh`
  if (kwh >= 10) return `${kwh.toFixed(1)} kWh`
  return `${kwh.toFixed(2)} kWh`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { status: liveStatus, connected } = useWebSocket()
  const { data: polledStatus } = useApi<PowerwallStatus>('/status')
  const { data: forecast } = useApi('/history/forecast')
  const { data: setupStatus } = useApi<any>('/settings/setup/status')
  const { data: dailyData } = useApi<any>('/history/daily?days=1')

  // Only use polledStatus if it has actual Powerwall data (not an error response)
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = liveStatus || validPolled

  // Get today's summary (last entry in the daily array)
  const today = dailyData?.summaries?.[dailyData.summaries.length - 1]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-sm text-slate-500">Real-time Powerwall monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Wifi className="w-3.5 h-3.5" /> Live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <WifiOff className="w-3.5 h-3.5" /> Offline
            </span>
          )}
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
            <PowerFlowDiagram status={status} />
          </div>

          {/* Daily Totals + Battery */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Solar Generated Today */}
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <Sun className="w-4 h-4 text-amber-400" />
                <span className="card-header mb-0">Generated</span>
              </div>
              <div className="stat-value text-amber-400">
                {today ? formatEnergy(today.solar_generated_kwh) : '—'}
              </div>
              <div className="stat-label">Solar today</div>
            </div>

            {/* Grid Exported Today */}
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpFromLine className="w-4 h-4 text-emerald-400" />
                <span className="card-header mb-0">Exported</span>
              </div>
              <div className="stat-value text-emerald-400">
                {today ? formatEnergy(today.grid_exported_kwh) : '—'}
              </div>
              <div className="stat-label">To grid today</div>
            </div>

            {/* Home Consumed Today */}
            <div className="card">
              <div className="flex items-center gap-2 mb-2">
                <Home className="w-4 h-4 text-cyan-400" />
                <span className="card-header mb-0">Consumed</span>
              </div>
              <div className="stat-value text-cyan-400">
                {today ? formatEnergy(today.home_consumed_kwh) : '—'}
              </div>
              <div className="stat-label">Home today</div>
            </div>

            {/* Battery */}
            <BatteryGauge
              soc={status.battery_soc}
              power={status.battery_power}
              reserve={status.backup_reserve}
            />
          </div>

          {/* System Status Bar */}
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

              {today && (
                <div className="flex items-center gap-2">
                  <ArrowDownToLine className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-400">Imported:</span>
                  <span className="font-medium">{formatEnergy(today.grid_imported_kwh)}</span>
                </div>
              )}

              {status.storm_mode && (
                <div className="flex items-center gap-2">
                  <Cloud className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-medium text-amber-400">Storm Mode Active</span>
                </div>
              )}
            </div>
          </div>

          {/* Solar Forecast */}
          {forecast?.today && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="card">
                <div className="card-header">Today's Solar Forecast</div>
                <div className="stat-value text-amber-400">
                  {forecast.today.estimated_kwh} kWh
                </div>
                <div className="stat-label">
                  {forecast.today.condition === 'sunny' ? 'Sunny' :
                   forecast.today.condition === 'partly_cloudy' ? 'Partly Cloudy' : 'Cloudy'}
                  {' '} - Peak {(forecast.today.peak_watts / 1000).toFixed(1)} kW
                </div>
              </div>

              {forecast?.tomorrow && (
                <div className="card">
                  <div className="card-header">Tomorrow's Forecast</div>
                  <div className="stat-value text-amber-400">
                    {forecast.tomorrow.estimated_kwh} kWh
                  </div>
                  <div className="stat-label">
                    {forecast.tomorrow.condition === 'sunny' ? 'Sunny' :
                     forecast.tomorrow.condition === 'partly_cloudy' ? 'Partly Cloudy' : 'Cloudy'}
                    {' '} - Peak {(forecast.tomorrow.peak_watts / 1000).toFixed(1)} kW
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
