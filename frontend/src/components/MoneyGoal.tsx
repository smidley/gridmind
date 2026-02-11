interface Props {
  actual: number     // $ earned so far
  target: number     // $ target for the day
  label?: string
}

export default function MoneyGoal({ actual, target, label = "Value Goal" }: Props) {
  if (target <= 0) return null

  const pct = Math.min((actual / target) * 100, 150)
  const achieved = pct >= 100
  const diff = actual - target

  // SVG circular progress
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const strokePct = Math.min(pct, 100) / 100
  const offset = circumference * (1 - strokePct)

  const getColor = () => {
    if (pct >= 100) return { stroke: '#10b981', text: 'text-emerald-600 dark:text-emerald-400' }
    if (pct >= 80) return { stroke: '#84cc16', text: 'text-lime-600 dark:text-lime-400' }
    if (pct >= 60) return { stroke: '#eab308', text: 'text-yellow-600 dark:text-yellow-400' }
    if (pct >= 40) return { stroke: '#f59e0b', text: 'text-amber-600 dark:text-amber-400' }
    return { stroke: '#f97316', text: 'text-orange-600 dark:text-orange-400' }
  }

  const color = getColor()

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
        <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-200 dark:text-slate-800" />
          <circle
            cx="60" cy="60" r={radius}
            fill="none" stroke={color.stroke} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-bold tabular-nums ${color.text}`}>
            {pct.toFixed(0)}%
          </span>
          <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            {achieved ? 'Exceeded' : 'of goal'}
          </span>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-200">
          ${actual.toFixed(2)} <span className="text-sm text-slate-400 dark:text-slate-500 font-normal">/ ${target.toFixed(2)}</span>
        </p>
        <p className={`text-sm font-medium mt-1 ${diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(2)} {diff >= 0 ? 'ahead' : 'behind'} target
        </p>
      </div>
    </div>
  )
}
