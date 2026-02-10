import { Sun, Home, Zap, Battery, ArrowRight, ArrowLeft, ArrowDown, ArrowUp } from 'lucide-react'
import type { PowerwallStatus } from '../hooks/useWebSocket'

interface Props {
  status: PowerwallStatus
}

function formatPower(watts: number): string {
  const abs = Math.abs(watts)
  if (abs >= 1000) return `${(abs / 1000).toFixed(1)} kW`
  return `${Math.round(abs)} W`
}

export default function PowerFlowDiagram({ status }: Props) {
  const solarActive = status.solar_power > 50
  const gridImporting = status.grid_power > 50
  const gridExporting = status.grid_power < -50
  const batteryCharging = status.battery_power > 50
  const batteryDischarging = status.battery_power < -50
  const homeActive = status.home_power > 50

  return (
    <div className="relative w-full max-w-lg mx-auto py-4">
      {/* Solar - Top */}
      <div className="flex justify-center mb-8">
        <div className={`card flex flex-col items-center px-8 py-4 ${solarActive ? 'border-amber-500/50' : ''}`}>
          <Sun className={`w-8 h-8 mb-2 ${solarActive ? 'text-amber-400' : 'text-slate-600'}`} />
          <span className={`stat-value text-2xl ${solarActive ? 'text-amber-400' : 'text-slate-600'}`}>
            {formatPower(status.solar_power)}
          </span>
          <span className="stat-label">Solar</span>
        </div>
      </div>

      {/* Arrow from solar down */}
      {solarActive && (
        <div className="flex justify-center -mt-4 mb-2">
          <ArrowDown className="w-5 h-5 text-amber-400 animate-pulse" />
        </div>
      )}

      {/* Middle Row: Grid - Home - Battery */}
      <div className="flex items-center justify-between gap-4">
        {/* Grid */}
        <div className={`card flex flex-col items-center px-6 py-4 flex-1 ${
          gridImporting ? 'border-red-500/50' : gridExporting ? 'border-green-500/50' : ''
        }`}>
          <Zap className={`w-8 h-8 mb-2 ${
            gridImporting ? 'text-red-400' : gridExporting ? 'text-green-400' : 'text-slate-600'
          }`} />
          <span className={`stat-value text-2xl ${
            gridImporting ? 'text-red-400' : gridExporting ? 'text-green-400' : 'text-slate-600'
          }`}>
            {formatPower(status.grid_power)}
          </span>
          <span className="stat-label">
            {gridImporting ? 'Importing' : gridExporting ? 'Exporting' : 'Grid'}
          </span>
        </div>

        {/* Arrows */}
        <div className="flex flex-col items-center gap-1">
          {gridImporting && <ArrowRight className="w-5 h-5 text-red-400 animate-pulse" />}
          {gridExporting && <ArrowLeft className="w-5 h-5 text-green-400 animate-pulse" />}
          {!gridImporting && !gridExporting && <ArrowRight className="w-5 h-5 text-slate-700" />}
        </div>

        {/* Home */}
        <div className={`card flex flex-col items-center px-6 py-4 flex-1 ${homeActive ? 'border-cyan-500/50' : ''}`}>
          <Home className={`w-8 h-8 mb-2 ${homeActive ? 'text-cyan-400' : 'text-slate-600'}`} />
          <span className={`stat-value text-2xl ${homeActive ? 'text-cyan-400' : 'text-slate-600'}`}>
            {formatPower(status.home_power)}
          </span>
          <span className="stat-label">Home</span>
        </div>

        {/* Arrows */}
        <div className="flex flex-col items-center gap-1">
          {batteryDischarging && <ArrowLeft className="w-5 h-5 text-blue-400 animate-pulse" />}
          {batteryCharging && <ArrowRight className="w-5 h-5 text-blue-400 animate-pulse" />}
          {!batteryCharging && !batteryDischarging && <ArrowRight className="w-5 h-5 text-slate-700" />}
        </div>

        {/* Battery */}
        <div className={`card flex flex-col items-center px-6 py-4 flex-1 ${
          batteryCharging ? 'border-blue-500/50' : batteryDischarging ? 'border-blue-500/50' : ''
        }`}>
          <Battery className={`w-8 h-8 mb-2 ${
            status.battery_soc > 20 ? 'text-blue-400' : 'text-red-400'
          }`} />
          <span className={`stat-value text-2xl ${
            status.battery_soc > 20 ? 'text-blue-400' : 'text-red-400'
          }`}>
            {status.battery_soc.toFixed(0)}%
          </span>
          <span className="stat-label">
            {batteryCharging ? 'Charging' : batteryDischarging ? 'Discharging' : 'Battery'}
          </span>
          <span className="text-xs text-slate-500 mt-1">{formatPower(status.battery_power)}</span>
        </div>
      </div>
    </div>
  )
}
