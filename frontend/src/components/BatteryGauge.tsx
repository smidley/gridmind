interface Props {
  soc: number
  power: number
  reserve: number
  description?: string
  capacityKwh?: number
  maxPowerKw?: number
}

export default function BatteryGauge({ soc, power, reserve, description, capacityKwh, maxPowerKw }: Props) {
  // Tesla convention: negative = charging (into battery), positive = discharging (out of battery)
  const charging = power < -50
  const discharging = power > 50
  const active = charging || discharging

  const getBarColor = () => {
    if (soc <= 10) return { bg: 'bg-red-500', hex: '#ef4444' }
    if (soc <= 20) return { bg: 'bg-orange-500', hex: '#f97316' }
    if (soc <= 50) return { bg: 'bg-amber-500', hex: '#f59e0b' }
    return { bg: 'bg-emerald-500', hex: '#10b981' }
  }

  const barColor = getBarColor()

  // Calculate available energy
  const availableKwh = capacityKwh ? (soc / 100) * capacityKwh : null
  const usableKwh = capacityKwh ? ((soc - reserve) / 100) * capacityKwh : null

  // Flow intensity based on power (0-1 scale)
  const maxPower = (maxPowerKw || 11.5) * 1000
  const intensity = Math.min(Math.abs(power) / maxPower, 1)

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
        <style>{`
          @keyframes flowRight {
            0% { transform: translateX(-50%); }
            100% { transform: translateX(0%); }
          }
          @keyframes flowLeft {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-50%); }
          }
          @keyframes pulseGlow {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 0.6; }
          }
        `}</style>

        {/* Fill bar */}
        <div
          className={`absolute top-0 bottom-0 left-0 transition-all duration-1000 ${barColor.bg}`}
          style={{ width: `${soc}%` }}
        />

        {/* Fluid wave animation overlay */}
        {active && (
          <div
            className="absolute top-0 bottom-0 left-0 overflow-hidden"
            style={{ width: `${soc}%` }}
          >
            {/* Moving wave layer */}
            <div
              className="absolute top-0 bottom-0"
              style={{
                width: '200%',
                left: 0,
                animation: `${charging ? 'flowRight' : 'flowLeft'} ${1.5 - intensity * 0.7}s linear infinite`,
                background: `linear-gradient(90deg, 
                  transparent 0%, 
                  rgba(255,255,255,${0.08 + intensity * 0.12}) 15%, 
                  rgba(255,255,255,${0.15 + intensity * 0.2}) 25%, 
                  transparent 40%, 
                  transparent 50%, 
                  rgba(255,255,255,${0.08 + intensity * 0.12}) 65%, 
                  rgba(255,255,255,${0.15 + intensity * 0.2}) 75%, 
                  transparent 90%, 
                  transparent 100%
                )`,
              }}
            />
            {/* Soft glow pulse at the leading edge */}
            <div
              className="absolute top-0 bottom-0"
              style={{
                width: '30%',
                ...(charging
                  ? { right: 0, background: `linear-gradient(90deg, transparent, ${barColor.hex}60)` }
                  : { left: 0, background: `linear-gradient(270deg, transparent, ${barColor.hex}60)` }
                ),
                animation: `pulseGlow ${2 - intensity}s ease-in-out infinite`,
              }}
            />
          </div>
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
        <span className={
          charging ? 'text-emerald-400' : discharging ? 'text-blue-400' : 'text-slate-400'
        }>
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
