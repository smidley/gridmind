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

  const getBarClass = () => {
    if (soc <= 10) return 'from-red-600 to-red-500'
    if (soc <= 20) return 'from-orange-600 to-orange-500'
    if (soc <= 40) return 'from-amber-600 to-amber-500'
    if (soc <= 60) return 'from-yellow-600 to-yellow-500'
    if (soc <= 80) return 'from-lime-600 to-lime-500'
    return 'from-emerald-600 to-emerald-500'
  }

  // Shimmer speed based on power level
  const maxP = (maxPowerKw || 11.5) * 1000
  const intensity = Math.min(Math.abs(power) / maxP, 1)
  const shimmerDuration = `${2.5 - intensity * 1.5}s` // 2.5s slow -> 1s fast

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
        <style>{`
          @keyframes shimmerRight {
            0% { left: -100%; }
            100% { left: 100%; }
          }
          @keyframes shimmerLeft {
            0% { left: 100%; }
            100% { left: -100%; }
          }
        `}</style>

        {/* Fill bar with gradient */}
        <div
          className={`absolute top-0 bottom-0 left-0 bg-gradient-to-r ${getBarClass()} transition-all duration-1000`}
          style={{ width: `${soc}%` }}
        />

        {/* Elegant shimmer sweep */}
        {active && (
          <div
            className="absolute top-0 bottom-0 left-0 overflow-hidden"
            style={{ width: `${soc}%` }}
          >
            <div
              className="absolute top-0 bottom-0"
              style={{
                width: '60%',
                background: `linear-gradient(${charging ? '105deg' : '75deg'}, transparent 0%, transparent 30%, rgba(255,255,255,${0.12 + intensity * 0.18}) 45%, rgba(255,255,255,${0.25 + intensity * 0.2}) 50%, rgba(255,255,255,${0.12 + intensity * 0.18}) 55%, transparent 70%, transparent 100%)`,
                animation: `${charging ? 'shimmerRight' : 'shimmerLeft'} ${shimmerDuration} ease-in-out infinite`,
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
