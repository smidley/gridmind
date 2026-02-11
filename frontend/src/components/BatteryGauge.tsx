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

  // Gradient bar: color transitions smoothly based on SOC using a multi-stop gradient
  // Red (0%) -> Orange (15%) -> Amber (30%) -> Yellow-Green (50%) -> Green (70%) -> Emerald (100%)
  const getBarGradient = () => {
    // Fill the bar with a gradient that shows the full spectrum,
    // clipped to the current SOC width
    return 'linear-gradient(90deg, #ef4444 0%, #f97316 15%, #f59e0b 30%, #84cc16 55%, #22c55e 75%, #10b981 100%)'
  }

  // Shimmer speed based on power level
  const maxP = (maxPowerKw || 11.5) * 1000
  const intensity = Math.min(Math.abs(power) / maxP, 1)
  const shimmerDuration = `${2.5 - intensity * 1.5}s`

  // Calculate available energy
  const availableKwh = capacityKwh ? (soc / 100) * capacityKwh : null
  const usableKwh = capacityKwh ? (Math.max(soc - reserve, 0) / 100) * capacityKwh : null

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

        {/* Reserve zone background - subtle dark tint with soft pattern */}
        {reserve > 0 && (
          <div
            className="absolute top-0 bottom-0 left-0"
            style={{ width: `${reserve}%` }}
          >
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-slate-900/40" />
            {/* Subtle diagonal lines */}
            <svg className="absolute inset-0 w-full h-full opacity-30">
              <defs>
                <pattern id="reservePattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(148,163,184,0.3)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#reservePattern)" />
            </svg>
          </div>
        )}

        {/* Fill bar with spectrum gradient */}
        <div
          className="absolute top-0 bottom-0 left-0 transition-all duration-1000 rounded-r-sm"
          style={{
            width: `${soc}%`,
            background: getBarGradient(),
            backgroundSize: `${10000 / soc}% 100%`,
          }}
        />

        {/* Shimmer animation when active */}
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

        {/* Reserve boundary line */}
        {reserve > 0 && (
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${reserve}%`, width: '2px' }}
          >
            <div className="w-full h-full bg-gradient-to-b from-slate-500/60 via-slate-400/40 to-slate-500/60" />
          </div>
        )}

        {/* Reserve label - small text inside the reserve zone */}
        {reserve > 5 && (
          <div
            className="absolute top-0 bottom-0 left-0 flex items-center justify-center"
            style={{ width: `${reserve}%` }}
          >
            <span className="text-[8px] text-slate-500/60 font-medium uppercase tracking-wider">RSV</span>
          </div>
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
