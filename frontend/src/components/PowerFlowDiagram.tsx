import { Sun, Home, Zap, Battery } from 'lucide-react'
import type { PowerwallStatus } from '../hooks/useWebSocket'

interface Props {
  status: PowerwallStatus
}

function formatPower(watts: number): string {
  const abs = Math.abs(watts)
  if (abs >= 1000) return `${(abs / 1000).toFixed(1)} kW`
  return `${Math.round(abs)} W`
}

/** Animated dots flowing along a path */
function FlowLine({ active, color, reverse = false, id }: { active: boolean; color: string; reverse?: boolean; id: string }) {
  if (!active) return (
    <line x1="0" y1="0" x2="100" y2="0" stroke="currentColor" strokeWidth="2" className="text-slate-800" />
  )

  return (
    <g>
      <line x1="0" y1="0" x2="100" y2="0" stroke="currentColor" strokeWidth="2" className="text-slate-800" />
      <line
        x1="0" y1="0" x2="100" y2="0"
        stroke={color}
        strokeWidth="2"
        strokeDasharray="6 8"
        strokeLinecap="round"
        opacity="0.8"
      >
        <animate
          attributeName="stroke-dashoffset"
          from={reverse ? "0" : "28"}
          to={reverse ? "28" : "0"}
          dur="1.5s"
          repeatCount="indefinite"
        />
      </line>
      {/* Glow */}
      <line
        x1="0" y1="0" x2="100" y2="0"
        stroke={color}
        strokeWidth="4"
        strokeDasharray="6 8"
        strokeLinecap="round"
        opacity="0.15"
        filter="url(#glow)"
      >
        <animate
          attributeName="stroke-dashoffset"
          from={reverse ? "0" : "28"}
          to={reverse ? "28" : "0"}
          dur="1.5s"
          repeatCount="indefinite"
        />
      </line>
    </g>
  )
}

export default function PowerFlowDiagram({ status }: Props) {
  const solarActive = status.solar_power > 50
  const gridImporting = status.grid_power > 50
  const gridExporting = status.grid_power < -50
  const batteryCharging = status.battery_power > 50
  const batteryDischarging = status.battery_power < -50
  const homeActive = status.home_power > 50

  return (
    <div className="relative w-full max-w-2xl mx-auto py-6 px-4">
      {/* SVG filter for glow effect */}
      <svg className="absolute w-0 h-0">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      <div className="grid grid-cols-3 gap-y-8 items-center">
        {/* Row 1: Solar centered at top */}
        <div className="col-span-3 flex justify-center">
          <div className={`flex flex-col items-center rounded-xl border px-8 py-5 min-w-[140px] transition-all duration-500 ${
            solarActive ? 'border-amber-500/40 bg-amber-500/5 shadow-lg shadow-amber-500/10' : 'border-slate-800 bg-slate-900'
          }`}>
            <Sun className={`w-7 h-7 mb-2 transition-colors ${solarActive ? 'text-amber-400' : 'text-slate-600'}`} />
            <span className={`text-2xl font-bold tabular-nums transition-colors ${solarActive ? 'text-amber-400' : 'text-slate-600'}`}>
              {formatPower(status.solar_power)}
            </span>
            <span className="text-xs text-slate-500 mt-1 font-medium uppercase tracking-wider">Solar</span>
            {solarActive && <span className="text-[10px] text-amber-400/70 mt-0.5">Generating</span>}
          </div>
        </div>

        {/* Row 2: Flow line from Solar down to Home */}
        <div className="col-span-3 flex justify-center -my-3">
          <svg width="4" height="36" className="overflow-visible">
            <g transform="translate(2,0) rotate(90,0,0) scale(0.36,1)">
              <FlowLine active={solarActive} color="#fbbf24" id="solar-home" />
            </g>
          </svg>
        </div>

        {/* Row 3: Grid — Home — Battery */}
        <div className="flex justify-center">
          <div className={`flex flex-col items-center rounded-xl border px-6 py-5 min-w-[130px] transition-all duration-500 ${
            gridImporting ? 'border-red-500/40 bg-red-500/5 shadow-lg shadow-red-500/10'
            : gridExporting ? 'border-emerald-500/40 bg-emerald-500/5 shadow-lg shadow-emerald-500/10'
            : 'border-slate-800 bg-slate-900'
          }`}>
            <Zap className={`w-7 h-7 mb-2 transition-colors ${
              gridImporting ? 'text-red-400' : gridExporting ? 'text-emerald-400' : 'text-slate-600'
            }`} />
            <span className={`text-2xl font-bold tabular-nums transition-colors ${
              gridImporting ? 'text-red-400' : gridExporting ? 'text-emerald-400' : 'text-slate-600'
            }`}>
              {formatPower(status.grid_power)}
            </span>
            <span className="text-xs text-slate-500 mt-1 font-medium uppercase tracking-wider">Grid</span>
            <span className={`text-[10px] mt-0.5 ${
              gridImporting ? 'text-red-400/70' : gridExporting ? 'text-emerald-400/70' : 'text-slate-600'
            }`}>
              {gridImporting ? 'Importing' : gridExporting ? 'Exporting' : 'Idle'}
            </span>
          </div>
        </div>

        {/* Center: Home */}
        <div className="flex justify-center relative">
          {/* Left flow line: Grid <-> Home */}
          <svg className="absolute left-[-48px] top-1/2 -translate-y-1/2 overflow-visible" width="44" height="4">
            <g transform="translate(0,2)scale(0.44,1)">
              <FlowLine
                active={gridImporting || gridExporting}
                color={gridImporting ? '#f87171' : '#34d399'}
                reverse={gridExporting}
                id="grid-home"
              />
            </g>
          </svg>

          {/* Right flow line: Home <-> Battery */}
          <svg className="absolute right-[-48px] top-1/2 -translate-y-1/2 overflow-visible" width="44" height="4">
            <g transform="translate(0,2)scale(0.44,1)">
              <FlowLine
                active={batteryCharging || batteryDischarging}
                color="#60a5fa"
                reverse={batteryDischarging}
                id="home-battery"
              />
            </g>
          </svg>

          <div className={`flex flex-col items-center rounded-xl border px-6 py-5 min-w-[130px] transition-all duration-500 ${
            homeActive ? 'border-cyan-500/40 bg-cyan-500/5 shadow-lg shadow-cyan-500/10' : 'border-slate-800 bg-slate-900'
          }`}>
            <Home className={`w-7 h-7 mb-2 transition-colors ${homeActive ? 'text-cyan-400' : 'text-slate-600'}`} />
            <span className={`text-2xl font-bold tabular-nums transition-colors ${homeActive ? 'text-cyan-400' : 'text-slate-600'}`}>
              {formatPower(status.home_power)}
            </span>
            <span className="text-xs text-slate-500 mt-1 font-medium uppercase tracking-wider">Home</span>
            {homeActive && <span className="text-[10px] text-cyan-400/70 mt-0.5">Consuming</span>}
          </div>
        </div>

        {/* Battery */}
        <div className="flex justify-center">
          <div className={`flex flex-col items-center rounded-xl border px-6 py-5 min-w-[130px] transition-all duration-500 ${
            batteryCharging ? 'border-blue-500/40 bg-blue-500/5 shadow-lg shadow-blue-500/10'
            : batteryDischarging ? 'border-blue-500/40 bg-blue-500/5 shadow-lg shadow-blue-500/10'
            : 'border-slate-800 bg-slate-900'
          }`}>
            <Battery className={`w-7 h-7 mb-2 transition-colors ${
              status.battery_soc > 20 ? 'text-blue-400' : 'text-red-400'
            }`} />
            <span className={`text-2xl font-bold tabular-nums transition-colors ${
              status.battery_soc > 20 ? 'text-blue-400' : 'text-red-400'
            }`}>
              {status.battery_soc.toFixed(0)}%
            </span>
            <span className="text-xs text-slate-500 mt-1 font-medium uppercase tracking-wider">Battery</span>
            <span className={`text-[10px] mt-0.5 ${
              batteryCharging ? 'text-blue-400/70' : batteryDischarging ? 'text-blue-400/70' : 'text-slate-600'
            }`}>
              {batteryCharging ? `Charging ${formatPower(status.battery_power)}` : batteryDischarging ? `Discharging ${formatPower(status.battery_power)}` : 'Idle'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
