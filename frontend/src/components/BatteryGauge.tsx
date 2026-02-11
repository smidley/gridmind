interface Props {
  soc: number
  power: number
  reserve: number
  description?: string
  capacityKwh?: number
  maxPowerKw?: number
}

export default function BatteryGauge({ soc, power, reserve, description, capacityKwh, maxPowerKw }: Props) {
  const charging = power > 50
  const discharging = power < -50
  const active = charging || discharging

  const getColor = () => {
    if (soc <= 10) return 'bg-red-500'
    if (soc <= 20) return 'bg-orange-500'
    if (soc <= 50) return 'bg-amber-500'
    return 'bg-emerald-500'
  }

  const getFlowColor = () => {
    if (charging) return '#34d399'   // emerald for charging
    if (discharging) return '#60a5fa' // blue for discharging
    return 'transparent'
  }

  // Calculate available energy
  const availableKwh = capacityKwh ? (soc / 100) * capacityKwh : null
  const usableKwh = capacityKwh ? ((soc - reserve) / 100) * capacityKwh : null

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <div className="card-header mb-0">Battery</div>
        {description && (
          <span className="text-[10px] text-slate-600 font-medium">{description}</span>
        )}
      </div>

      {/* Battery visual */}
      <div className="relative w-full h-10 bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
        {/* Animated flow CSS */}
        {active && (
          <style>{`
            @keyframes batteryFlowRight {
              0% { background-position: 0% 0; }
              100% { background-position: 200% 0; }
            }
            @keyframes batteryFlowLeft {
              0% { background-position: 200% 0; }
              100% { background-position: 0% 0; }
            }
          `}</style>
        )}

        {/* Fill bar */}
        <div
          className={`absolute top-0 bottom-0 left-0 transition-all duration-1000 ${getColor()}`}
          style={{ width: `${soc}%` }}
        />

        {/* Animated flow overlay on the fill area */}
        {active && (
          <div
            className="absolute top-0 bottom-0 left-0"
            style={{
              width: `${soc}%`,
              background: `repeating-linear-gradient(${charging ? '90deg' : '270deg'}, transparent, transparent 10px, ${getFlowColor()}44 10px, ${getFlowColor()}44 20px, transparent 20px, transparent 30px)`,
              backgroundSize: '200% 100%',
              animation: `${charging ? 'batteryFlowRight' : 'batteryFlowLeft'} 1.2s linear infinite`,
            }}
          />
        )}

        {/* Reserve hatched overlay */}
        {reserve > 0 && (
          <svg
            className="absolute top-0 left-0 h-full"
            style={{ width: `${reserve}%` }}
            preserveAspectRatio="none"
          >
            <defs>
              <pattern id="reserveHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="rgba(0,0,0,0.35)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(239,68,68,0.5)" strokeWidth="3" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#reserveHatch)" />
          </svg>
        )}

        {/* Reserve boundary line */}
        {reserve > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-400/70"
            style={{ left: `${reserve}%` }}
          />
        )}

        {/* SOC label */}
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white drop-shadow-lg">
          {soc.toFixed(1)}%
        </div>
      </div>

      <div className="flex justify-between mt-3 text-sm">
        <span className="text-slate-400">
          {charging ? 'Charging' : discharging ? 'Discharging' : 'Idle'}
        </span>
        <span className={`font-medium ${
          charging ? 'text-emerald-400' : discharging ? 'text-blue-400' : 'text-slate-500'
        }`}>
          {Math.abs(power) >= 1000
            ? `${(Math.abs(power) / 1000).toFixed(1)} kW`
            : `${Math.round(Math.abs(power))} W`}
        </span>
      </div>

      <div className="flex justify-between mt-1 text-xs text-slate-500">
        <span>Reserve: {reserve}%</span>
        {capacityKwh ? (
          <span>
            {availableKwh !== null ? `${availableKwh.toFixed(1)}` : '—'} / {capacityKwh} kWh
            {usableKwh !== null && usableKwh > 0 && (
              <span className="text-slate-600"> ({usableKwh.toFixed(1)} usable)</span>
            )}
          </span>
        ) : null}
      </div>
      {maxPowerKw ? (
        <div className="text-xs text-slate-600 mt-0.5">
          Max output: {maxPowerKw} kW
        </div>
      ) : null}
    </div>
  )
}
