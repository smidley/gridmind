interface Props {
  soc: number
  power: number
  reserve: number
  description?: string
  capacityKwh?: number
  maxPowerKw?: number
}

function getBarColor(soc: number): { class: string; hex: string } {
  if (soc <= 10) return { class: 'bg-red-500', hex: '#ef4444' }
  if (soc <= 20) return { class: 'bg-orange-500', hex: '#f97316' }
  if (soc <= 50) return { class: 'bg-yellow-500', hex: '#eab308' }
  if (soc <= 70) return { class: 'bg-lime-500', hex: '#84cc16' }
  if (soc <= 90) return { class: 'bg-emerald-500', hex: '#10b981' }
  return { class: 'bg-blue-500', hex: '#3b82f6' }
}

export default function BatteryGauge({ soc, power, reserve, description, capacityKwh, maxPowerKw }: Props) {
  // Tesla convention: negative = charging (into battery), positive = discharging (out of battery)
  const charging = power < -50
  const discharging = power > 50
  const active = charging || discharging

  const barColor = getBarColor(soc)

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

        {/* Fill bar - solid color based on SOC tier */}
        <div
          className={`absolute top-0 bottom-0 left-0 transition-all duration-1000 ${barColor.class}`}
          style={{ width: `${soc}%` }}
        />

        {/* Reserve zone: diagonal lines colored by their position in the reserve range */}
        {reserve > 0 && soc > 0 && (() => {
          // Build reserve segments with colors matching their SOC range
          const segments: { start: number; end: number; color: string }[] = []
          const tiers = [
            { max: 10, color: '#ef4444' },  // red
            { max: 20, color: '#f97316' },  // orange
            { max: 50, color: '#eab308' },  // yellow
            { max: 70, color: '#84cc16' },  // lime
            { max: 90, color: '#10b981' },  // emerald
            { max: 100, color: '#3b82f6' }, // blue
          ]
          let pos = 0
          for (const tier of tiers) {
            if (pos >= reserve) break
            const segEnd = Math.min(tier.max, reserve)
            if (segEnd > pos) {
              segments.push({ start: pos, end: segEnd, color: tier.color })
            }
            pos = segEnd
          }

          const cappedReserve = Math.min(reserve, soc)
          return (
            <div
              className="absolute top-0 bottom-0 left-0 overflow-hidden"
              style={{ width: `${cappedReserve}%` }}
            >
              <div className="absolute inset-0 bg-black/40" />
              <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                <defs>
                  {segments.map((seg, i) => (
                    <pattern key={i} id={`reserveTilt${i}`} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
                      <line x1="0" y1="0" x2="0" y2="7" stroke={seg.color} strokeWidth="2" strokeOpacity="0.55" />
                    </pattern>
                  ))}
                </defs>
                {segments.map((seg, i) => {
                  const xStart = (seg.start / cappedReserve) * 100
                  const xWidth = ((seg.end - seg.start) / cappedReserve) * 100
                  return (
                    <rect
                      key={i}
                      x={`${xStart}%`}
                      y="0"
                      width={`${xWidth}%`}
                      height="100%"
                      fill={`url(#reserveTilt${i})`}
                    />
                  )
                })}
              </svg>
            </div>
          )
        })()}

        {/* Reserve boundary */}
        {reserve > 0 && (
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${reserve}%`, width: '1.5px', backgroundColor: `${barColor.hex}80` }}
          />
        )}

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

        {/* SOC label */}
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white drop-shadow-lg">
          {soc.toFixed(1)}%
        </div>
      </div>

      {/* Reserve indicator below bar */}
      {reserve > 0 && (
        <div className="relative w-full h-5 mt-1">
          {/* Bracket line from 0 to reserve% */}
          <div
            className="absolute top-0 h-1.5 border-l border-r border-b border-slate-500/50 rounded-b-sm"
            style={{ left: 0, width: `${reserve}%` }}
          />
          {/* Label */}
          <div
            className="absolute top-2.5 flex justify-center"
            style={{ left: 0, width: `${reserve}%` }}
          >
            <span className="text-[9px] text-slate-500 leading-none">
              Reserve {reserve}%
            </span>
          </div>
        </div>
      )}

      <div className={`flex justify-between ${reserve > 0 ? 'mt-2' : 'mt-3'} text-sm`}>
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

      {capacityKwh ? (
        <div className="text-xs text-slate-500 mt-1.5">
          {availableKwh !== null ? `${availableKwh.toFixed(1)}` : '—'} / {capacityKwh} kWh
          {usableKwh !== null && usableKwh > 0 && (
            <span className="text-slate-600"> ({usableKwh.toFixed(1)} usable)</span>
          )}
        </div>
      ) : null}
      {maxPowerKw ? (
        <div className="text-xs text-slate-600 mt-1">
          Max output: {maxPowerKw} kW
        </div>
      ) : null}
    </div>
  )
}
