interface Props {
  soc: number
  power: number
  reserve: number
}

export default function BatteryGauge({ soc, power, reserve }: Props) {
  const charging = power > 50
  const discharging = power < -50

  const getColor = () => {
    if (soc <= 10) return 'bg-red-500'
    if (soc <= 20) return 'bg-orange-500'
    if (soc <= 50) return 'bg-amber-500'
    return 'bg-emerald-500'
  }

  return (
    <div className="card">
      <div className="card-header">Battery</div>

      {/* Battery visual */}
      <div className="relative w-full h-10 bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
        {/* SVG pattern for reserve hatching */}
        <svg className="absolute w-0 h-0">
          <defs>
            <pattern id="reserveHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(239,68,68,0.3)" strokeWidth="2" />
            </pattern>
          </defs>
        </svg>

        {/* Reserve hatched area */}
        {reserve > 0 && (
          <div
            className="absolute top-0 bottom-0 left-0 z-[1]"
            style={{ width: `${reserve}%` }}
          >
            <svg className="w-full h-full">
              <rect width="100%" height="100%" fill="url(#reserveHatch)" />
            </svg>
          </div>
        )}

        {/* Reserve boundary line */}
        {reserve > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/50 z-[3]"
            style={{ left: `${reserve}%` }}
            title={`Reserve: ${reserve}%`}
          />
        )}

        {/* Fill */}
        <div
          className={`h-full transition-all duration-1000 z-[2] relative ${getColor()}`}
          style={{ width: `${soc}%` }}
        />

        {/* SOC label */}
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white drop-shadow z-[4]">
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

      <div className="text-xs text-slate-500 mt-1">
        Reserve: {reserve}%
      </div>
    </div>
  )
}
