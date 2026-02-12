interface Props {
  soc: number
  chargeLimit: number
  chargingState: string
  power: number
  range: number
  displayName?: string
}

function getBarColor(soc: number): { class: string; hex: string } {
  if (soc <= 10) return { class: 'bg-red-500', hex: '#ef4444' }
  if (soc <= 20) return { class: 'bg-orange-500', hex: '#f97316' }
  if (soc <= 50) return { class: 'bg-yellow-500', hex: '#eab308' }
  if (soc <= 70) return { class: 'bg-lime-500', hex: '#84cc16' }
  if (soc <= 90) return { class: 'bg-emerald-500', hex: '#10b981' }
  return { class: 'bg-blue-500', hex: '#3b82f6' }
}

function getStateLabel(state: string): { label: string; color: string } {
  switch (state) {
    case 'Charging': return { label: 'Charging', color: 'text-emerald-400' }
    case 'Complete': return { label: 'Complete', color: 'text-blue-400' }
    case 'Stopped': return { label: 'Plugged In', color: 'text-amber-400' }
    case 'Disconnected': return { label: 'Disconnected', color: 'text-slate-500' }
    case 'NoPower': return { label: 'No Power', color: 'text-red-400' }
    default: return { label: state || 'Unknown', color: 'text-slate-500' }
  }
}

export default function ChargeGauge({ soc, chargeLimit, chargingState, power, range: rangeVal, displayName }: Props) {
  const charging = chargingState === 'Charging'
  const barColor = getBarColor(soc)
  const stateInfo = getStateLabel(chargingState)

  // Shimmer when charging
  const shimmerDuration = charging ? `${Math.max(1.5, 3 - (power / 15) * 1.5)}s` : '0s'

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <div className="card-header mb-0">Vehicle</div>
        {displayName && (
          <span className="text-[10px] text-slate-600 font-medium">{displayName}</span>
        )}
      </div>

      {/* Charge bar */}
      <div className="relative w-full h-10 bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
        <style>{`
          @keyframes evShimmer {
            0% { left: -100%; }
            100% { left: 100%; }
          }
        `}</style>

        {/* Fill bar */}
        <div
          className={`absolute top-0 bottom-0 left-0 transition-all duration-1000 ${barColor.class}`}
          style={{ width: `${soc}%` }}
        />

        {/* Charge limit marker */}
        {chargeLimit > 0 && chargeLimit < 100 && (
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${chargeLimit}%`, width: '2px', backgroundColor: '#ffffff60' }}
          />
        )}

        {/* Shimmer when charging */}
        {charging && (
          <div
            className="absolute top-0 bottom-0 left-0 overflow-hidden"
            style={{ width: `${soc}%` }}
          >
            <div
              className="absolute top-0 bottom-0"
              style={{
                width: '60%',
                background: `linear-gradient(105deg, transparent 0%, transparent 30%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.18) 55%, transparent 70%, transparent 100%)`,
                animation: `evShimmer ${shimmerDuration} ease-in-out infinite`,
              }}
            />
          </div>
        )}

        {/* SOC label */}
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white drop-shadow-lg">
          {soc}%
        </div>
      </div>

      {/* Charge limit indicator */}
      {chargeLimit > 0 && chargeLimit < 100 && (
        <div className="relative w-full h-4 mt-0.5">
          <div
            className="absolute top-0 flex justify-center"
            style={{ left: `${Math.max(chargeLimit - 5, 0)}%`, width: '10%' }}
          >
            <span className="text-[9px] text-slate-500 leading-none whitespace-nowrap">
              Limit {chargeLimit}%
            </span>
          </div>
        </div>
      )}

      {/* Status row */}
      <div className={`flex justify-between ${chargeLimit > 0 && chargeLimit < 100 ? 'mt-1' : 'mt-3'} text-sm`}>
        <span className={stateInfo.color}>{stateInfo.label}</span>
        {charging ? (
          <span className="font-medium text-emerald-400">
            {power >= 1 ? `${power.toFixed(1)} kW` : `${Math.round(power * 1000)} W`}
          </span>
        ) : (
          <span className="font-medium text-slate-500">
            {Math.round(rangeVal)} mi
          </span>
        )}
      </div>

      {/* Range */}
      <div className="text-xs text-slate-500 mt-1">
        {Math.round(rangeVal)} mi range
        {charging && power > 0 && (
          <span className="text-slate-600"> &middot; {power.toFixed(1)} kW</span>
        )}
      </div>
    </div>
  )
}
