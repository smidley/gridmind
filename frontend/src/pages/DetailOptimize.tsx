import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Activity, Battery, Sun, Home, Zap, Clock, Shield, Leaf, Settings } from 'lucide-react'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { useWebSocket } from '../hooks/useWebSocket'

function formatPower(w: number) {
  const abs = Math.abs(w)
  return abs >= 1000 ? `${(abs / 1000).toFixed(1)} kW` : `${Math.round(abs)} W`
}

function formatHour(h: number) {
  if (h === 0 || h === 24) return '12:00 AM'
  if (h === 12) return '12:00 PM'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}

export default function DetailOptimize() {
  const navigate = useNavigate()
  const { status: wsStatus } = useWebSocket()
  const { data: polledStatus } = useAutoRefresh<any>('/status', 5000)
  const validPolled = polledStatus && 'battery_soc' in polledStatus ? polledStatus : null
  const status = wsStatus || validPolled

  const { data: opt } = useAutoRefresh<any>('/settings/optimize/status', 5000)

  const phase = opt?.phase || 'idle'
  const enabled = opt?.enabled || false
  const verbose = opt?.verbose || {}
  const inputs = verbose.current_inputs || {}
  const tou = verbose.tou_context || {}
  const cleanGrid = verbose.clean_grid || {}
  const settings = verbose.settings || {}
  const thoughts = verbose.thoughts || []

  const phaseColors: Record<string, string> = {
    idle: 'text-emerald-400',
    peak_hold: 'text-blue-400',
    dumping: 'text-amber-400',
    complete: 'text-emerald-400',
  }

  const phaseBgColors: Record<string, string> = {
    idle: 'bg-emerald-500/15 text-emerald-500',
    peak_hold: 'bg-blue-500/15 text-blue-500',
    dumping: 'bg-amber-500/15 text-amber-500',
    complete: 'bg-emerald-500/15 text-emerald-500',
  }

  const phaseLabels: Record<string, string> = {
    idle: 'Idle',
    peak_hold: 'Holding',
    dumping: 'Dumping',
    complete: 'Complete',
  }

  const phases = ['idle', 'peak_hold', 'dumping', 'complete']

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-500" />
        </button>
        <div className="flex items-center gap-3">
          <Activity className={`w-6 h-6 ${phaseColors[phase] || 'text-slate-400'}`} />
          <div>
            <h1 className="text-lg font-bold text-stone-800 dark:text-slate-100">GridMind Optimize</h1>
            <p className="text-xs text-slate-500">Verbose decision engine view</p>
          </div>
        </div>
        <div className="ml-auto">
          <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${
            enabled ? phaseBgColors[phase] || 'bg-slate-500/15 text-slate-400' : 'bg-slate-200/60 text-slate-400 dark:bg-slate-800'
          }`}>
            {enabled ? phaseLabels[phase] || phase : 'Disabled'}
          </span>
        </div>
      </div>

      {!enabled ? (
        <div className="card text-center py-12">
          <Activity className="w-10 h-10 text-slate-400 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500">GridMind Optimize is not enabled.</p>
          <p className="text-xs text-slate-400 mt-1">Enable it in Settings to see the decision engine.</p>
        </div>
      ) : (
        <>
          {/* Thinking Feed — terminal style */}
          <div className="card p-0 overflow-hidden">
            <div
              className="bg-slate-950 rounded-xl p-4 overflow-hidden"
              style={{
                height: 220,
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 20%, black 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 20%, black 100%)',
              }}
            >
              <div className="flex flex-col justify-end h-full gap-1">
                {thoughts.length === 0 ? (
                  <span className="font-mono text-xs text-emerald-500/40">Waiting for next evaluation cycle...</span>
                ) : (
                  thoughts.map((thought: string, i: number) => {
                    const isNewest = i === thoughts.length - 1
                    const opacity = 0.3 + (i / Math.max(thoughts.length - 1, 1)) * 0.7
                    return (
                      <div key={i} className="font-mono text-xs leading-relaxed" style={{ opacity }}>
                        <span className={isNewest ? 'text-emerald-400' : 'text-emerald-500/70'}>
                          {thought}
                        </span>
                        {isNewest && (
                          <span className="text-emerald-400 animate-pulse ml-0.5">_</span>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Phase State Machine */}
          <div className="card">
            <div className="card-header">Decision Engine</div>
            <div className="flex items-center justify-between gap-2 mt-2">
              {phases.map((p, i) => (
                <div key={p} className="flex items-center gap-2 flex-1">
                  <div className={`flex-1 text-center py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                    p === phase
                      ? `${phaseBgColors[p]} ring-2 ring-current/30`
                      : 'bg-slate-200/40 dark:bg-slate-800/60 text-slate-400 dark:text-slate-600'
                  }`}>
                    {phaseLabels[p]}
                  </div>
                  {i < phases.length - 1 && (
                    <span className="text-slate-600 text-xs shrink-0">&rarr;</span>
                  )}
                </div>
              ))}
            </div>
            {verbose.last_evaluate_at && (
              <p className="text-[10px] text-slate-500 mt-2">
                Last evaluated: {new Date(verbose.last_evaluate_at).toLocaleTimeString()}
              </p>
            )}
          </div>

          {/* Live Inputs */}
          <div className="card">
            <div className="card-header">Live Inputs</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2 text-xs">
              <div className="flex items-center gap-2">
                <Battery className="w-4 h-4 text-blue-400" />
                <div>
                  <span className="text-slate-500">Battery</span>
                  <p className="font-bold text-blue-400">{inputs.battery_soc ?? '—'}%</p>
                  <p className="text-[10px] text-slate-600">{inputs.battery_power != null ? formatPower(inputs.battery_power) : '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-amber-400" />
                <div>
                  <span className="text-slate-500">Solar</span>
                  <p className="font-bold text-amber-400">{inputs.solar_power != null ? formatPower(inputs.solar_power) : '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Home className="w-4 h-4 text-cyan-400" />
                <div>
                  <span className="text-slate-500">Home</span>
                  <p className="font-bold text-cyan-400">{inputs.home_power != null ? formatPower(inputs.home_power) : '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-red-400" />
                <div>
                  <span className="text-slate-500">Grid</span>
                  <p className={`font-bold ${(inputs.grid_power || 0) > 50 ? 'text-red-400' : (inputs.grid_power || 0) < -50 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {inputs.grid_power != null ? formatPower(inputs.grid_power) : '—'}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200/30 dark:border-slate-800/50 flex gap-6 text-xs text-slate-500">
              <span>Mode: <span className="text-slate-300 font-medium">{inputs.operation_mode || '—'}</span></span>
              <span>Reserve: <span className="text-slate-300 font-medium">{inputs.backup_reserve ?? '—'}%</span></span>
            </div>
          </div>

          {/* TOU Context */}
          <div className="card">
            <div className="card-header">TOU Context</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2 text-xs">
              <div>
                <div className="flex items-center gap-1.5 text-slate-500">
                  <Clock className="w-3.5 h-3.5" />
                  Current Period
                </div>
                <p className={`font-bold mt-0.5 ${
                  tou.period_name === 'Peak' ? 'text-red-400'
                  : tou.period_name === 'Mid-Peak' ? 'text-amber-400'
                  : 'text-emerald-400'
                }`}>
                  {tou.period_name || '—'}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Until Peak</span>
                <p className="font-bold text-slate-300 mt-0.5">
                  {tou.minutes_until_peak != null
                    ? tou.minutes_until_peak > 60
                      ? `${Math.floor(tou.minutes_until_peak / 60)}h ${tou.minutes_until_peak % 60}m`
                      : `${tou.minutes_until_peak}m`
                    : tou.in_peak ? 'In peak now' : '—'}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Schedule</span>
                <p className="font-bold text-slate-300 mt-0.5">
                  {tou.peak_start_hour != null ? `${formatHour(tou.peak_start_hour)} – ${formatHour(tou.peak_end_hour || 21)}` : '—'}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Day Type</span>
                <p className="font-bold text-slate-300 mt-0.5">{tou.is_weekday ? 'Weekday' : 'Weekend'}</p>
              </div>
              <div>
                <span className="text-slate-500">Data Source</span>
                <p className="font-bold text-slate-300 mt-0.5">{tou.source === 'tou' ? 'Tesla TOU' : 'Manual'}</p>
              </div>
            </div>
          </div>

          {/* Clean Grid + Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <div className="card-header flex items-center gap-1.5">
                <Leaf className="w-3.5 h-3.5" />
                Clean Grid Preference
              </div>
              <div className="mt-2 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Enabled</span>
                  <span className={cleanGrid.enabled ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                    {cleanGrid.enabled ? 'Yes' : 'No'}
                  </span>
                </div>
                {cleanGrid.enabled && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Active</span>
                      <span className={cleanGrid.active ? 'text-amber-400 font-medium' : 'text-slate-400'}>
                        {cleanGrid.active ? 'Avoiding dirty grid' : 'Normal'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Grid Fossil %</span>
                      <span className={`font-medium ${
                        (cleanGrid.fossil_pct || 0) > cleanGrid.threshold ? 'text-red-400' : 'text-emerald-400'
                      }`}>
                        {cleanGrid.fossil_pct != null ? `${cleanGrid.fossil_pct}%` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Threshold</span>
                      <span className="text-slate-300">{cleanGrid.threshold}%</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" />
                Optimizer Settings
              </div>
              <div className="mt-2 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Buffer</span>
                  <span className="text-slate-300">{settings.buffer_minutes || 15}m safety margin</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Min Reserve</span>
                  <span className="text-slate-300">{settings.min_reserve_pct || 5}% (dump floor)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Saved Mode</span>
                  <span className="text-slate-300">{settings.pre_optimize_mode || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Saved Reserve</span>
                  <span className="text-slate-300">{settings.pre_optimize_reserve != null ? `${settings.pre_optimize_reserve}%` : '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
