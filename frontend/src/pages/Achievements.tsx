import {
  Trophy,
  Sun,
  Battery,
  Shield,
  Zap,
  DollarSign,
  Car,
  Settings,
  Clock,
  Lock,
  Brain,
  Leaf,
  Flame,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  solar: { label: 'Solar Milestones', color: 'amber' },
  battery: { label: 'Battery Milestones', color: 'blue' },
  grid: { label: 'Grid Independence', color: 'emerald' },
  optimize: { label: 'GridMind Optimize', color: 'cyan' },
  clean_energy: { label: 'Clean Energy', color: 'teal' },
  financial: { label: 'Financial', color: 'green' },
  ev: { label: 'EV / Vehicle', color: 'orange' },
  vpp: { label: 'VPP Events', color: 'violet' },
  system: { label: 'System', color: 'slate' },
}

const ICON_MAP: Record<string, any> = {
  sun: Sun,
  battery: Battery,
  shield: Shield,
  zap: Zap,
  dollar: DollarSign,
  car: Car,
  settings: Settings,
  clock: Clock,
  brain: Brain,
  leaf: Leaf,
  flame: Flame,
}

const COLOR_CLASSES: Record<string, { earned: string; glow: string; icon: string; text: string; bg: string; border: string }> = {
  amber:   { earned: 'border-amber-500/40',   glow: 'shadow-amber-500/20',   icon: 'text-amber-400',   text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  blue:    { earned: 'border-blue-500/40',    glow: 'shadow-blue-500/20',    icon: 'text-blue-400',    text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  cyan:    { earned: 'border-cyan-500/40',    glow: 'shadow-cyan-500/20',    icon: 'text-cyan-400',    text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20' },
  teal:    { earned: 'border-teal-500/40',    glow: 'shadow-teal-500/20',    icon: 'text-teal-400',    text: 'text-teal-400',    bg: 'bg-teal-500/10',    border: 'border-teal-500/20' },
  emerald: { earned: 'border-emerald-500/40', glow: 'shadow-emerald-500/20', icon: 'text-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  green:   { earned: 'border-green-500/40',   glow: 'shadow-green-500/20',   icon: 'text-green-400',   text: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/20' },
  orange:  { earned: 'border-orange-500/40',  glow: 'shadow-orange-500/20',  icon: 'text-orange-400',  text: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/20' },
  violet:  { earned: 'border-violet-500/40',  glow: 'shadow-violet-500/20',  icon: 'text-violet-400',  text: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/20' },
  slate:   { earned: 'border-slate-500/40',   glow: 'shadow-slate-500/20',   icon: 'text-slate-400',   text: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20' },
}

export default function Achievements() {
  const { data, loading } = useApi<any>('/achievements')

  const achievements = data?.achievements || []
  const earnedCount = data?.earned_count || 0
  const totalCount = data?.total_count || 0
  const pct = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0

  // Group by category
  const categories = new Map<string, any[]>()
  for (const a of achievements) {
    const list = categories.get(a.category) || []
    list.push(a)
    categories.set(a.category, list)
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Trophy className="w-6 h-6 text-amber-400" />
          <h2 className="text-2xl font-bold">Achievements</h2>
        </div>
        <p className="text-sm text-slate-500">
          {loading ? 'Loading...' : `${earnedCount} of ${totalCount} earned`}
        </p>
      </div>

      {/* Progress bar */}
      {!loading && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{pct}% Complete</span>
            <span className="text-xs text-slate-500">{earnedCount} / {totalCount}</span>
          </div>
          <div className="w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-1000"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Badge grid by category */}
      {[...categories.entries()].map(([category, items]) => {
        const meta = CATEGORY_META[category] || { label: category, color: 'slate' }
        const colors = COLOR_CLASSES[meta.color] || COLOR_CLASSES.slate

        return (
          <div key={category}>
            <h3 className={`text-sm font-bold uppercase tracking-wider mb-3 ${colors.text}`}>
              {meta.label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((a: any) => {
                const Icon = ICON_MAP[a.icon] || Trophy
                const earned = a.earned

                return (
                  <div
                    key={a.id}
                    className={`relative p-4 rounded-xl border transition-all ${
                      earned
                        ? `${colors.earned} ${colors.bg} shadow-lg ${colors.glow}`
                        : 'border-slate-300/50 bg-slate-200/50 dark:border-slate-700/50 dark:bg-slate-800/20 opacity-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Badge icon */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        earned ? colors.bg : 'bg-slate-200 dark:bg-slate-800'
                      }`}>
                        {earned ? (
                          <Icon className={`w-5 h-5 ${colors.icon}`} />
                        ) : (
                          <Lock className="w-4 h-4 text-slate-600" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="min-w-0">
                        <p className={`text-sm font-bold ${earned ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
                          {a.title}
                        </p>
                        <p className={`text-xs mt-0.5 ${earned ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-600'}`}>
                          {a.description}
                        </p>
                        {earned && (a.earned_value || a.earned_date) && (
                          <div className="mt-1.5 flex items-center gap-2">
                            {a.earned_value && (
                              <span className={`text-[10px] font-medium ${colors.text}`}>{a.earned_value}</span>
                            )}
                            {a.earned_date && (
                              <span className="text-[10px] text-slate-500">
                                {new Date(a.earned_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Earned checkmark */}
                    {earned && (
                      <div className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center ${colors.bg} ${colors.border} border`}>
                        <Trophy className={`w-3 h-3 ${colors.icon}`} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Empty state */}
      {!loading && achievements.length === 0 && (
        <div className="card text-center py-12">
          <Trophy className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-400 mb-2">No Achievements Yet</h3>
          <p className="text-sm text-slate-500">Start generating solar energy to earn your first badge!</p>
        </div>
      )}
    </div>
  )
}
