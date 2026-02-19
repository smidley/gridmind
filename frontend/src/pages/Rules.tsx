import { useState } from 'react'
import { Plus, Power, PowerOff, Clock, Battery, Zap, Wifi, Sun, Trash2, BookOpen, Activity, Car, Timer } from 'lucide-react'
import { useApi, apiFetch } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import RuleBuilder from '../components/RuleBuilder'
import AutomationPresets from '../components/AutomationPresets'

interface Rule {
  id: number
  name: string
  description: string | null
  enabled: boolean
  priority: number
  trigger_type: string
  trigger_config: any
  actions: any[]
  one_shot: boolean
  last_triggered: string | null
  trigger_count: number
  created_at: string
}

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  time: Clock,
  soc: Battery,
  load: Zap,
  solar: Sun,
  grid_power: Zap,
  grid_status: Wifi,
  battery_power: Battery,
}

function formatTrigger(type: string, config: any): string {
  switch (type) {
    case 'time':
      const days = config.days?.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')
      return `At ${config.time}${days ? ` on ${days}` : ''}`
    case 'soc':
      return `Battery SOC ${config.operator} ${config.value}%`
    case 'load':
      return `Home load ${config.operator} ${config.value}W`
    case 'solar':
      return `Solar power ${config.operator} ${config.value}W`
    case 'grid_power':
      return `Grid power ${config.operator} ${config.value}W`
    case 'grid_status':
      return `Grid ${config.status === 'islanded' ? 'goes down' : 'reconnects'}`
    default:
      return type
  }
}

function formatAction(action: any): string {
  switch (action.type) {
    case 'set_mode':
      return action.value === 'self_consumption' ? 'Set Self-Powered' : 'Set Time-Based'
    case 'set_reserve':
      return `Set reserve to ${action.value}%`
    case 'set_storm_mode':
      return `${action.value ? 'Enable' : 'Disable'} storm mode`
    case 'set_grid_charging':
      return `${action.value ? 'Enable' : 'Disable'} grid charging`
    case 'set_export_rule':
      return `Export: ${action.value}`
    case 'notify':
      return `Notify: ${action.message || 'Alert'}`
    default:
      return action.type
  }
}

function PeakEventsConfig() {
  const { data: eventsData, refetch } = useApi<any>('/events')
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('VPP Peak Event')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('17:00')
  const [endTime, setEndTime] = useState('19:00')
  const [rate, setRate] = useState('2.50')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const events = eventsData?.events || []
  const upcoming = events.filter((e: any) => e.status === 'scheduled')
  const completed = events.filter((e: any) => e.status === 'completed')

  const createEvent = async () => {
    setSaving(true); setError('')
    try {
      await apiFetch('/events', {
        method: 'POST',
        body: JSON.stringify({ name, date, start_time: startTime, end_time: endTime, rate_per_kwh: parseFloat(rate) || 0 }),
      })
      setShowForm(false); setDate(''); refetch()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const deleteEvent = async (id: string) => {
    try { await apiFetch(`/events/${id}`, { method: 'DELETE' }); refetch() }
    catch (e: any) { setError(e.message) }
  }

  return (
    <div className="card border-violet-500/20">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-violet-500" />
          <span className="card-header mb-0">VPP Peak Events</span>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-500 hover:bg-violet-500/25 transition-colors">
          <Plus className="w-3 h-3" /> Schedule Event
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Schedule utility demand response events for premium export rates. The optimizer will dump the battery at maximum rate during the event.
      </p>

      {showForm && (
        <div className="mb-4 p-3 rounded-lg bg-violet-500/5 border border-violet-500/20 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Event Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Rate ($/kWh)</label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                <input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)}
                  className="w-full pl-7 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Start Time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">End Time</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createEvent} disabled={saving || !date || !rate} className="btn-primary text-sm px-4 py-2">
              {saving ? 'Scheduling...' : 'Schedule Event'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-slate-500 hover:text-slate-300 px-3">Cancel</button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-2 mb-3">
          <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Upcoming</div>
          {upcoming.map((evt: any) => (
            <div key={evt.id} className="flex items-center justify-between p-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
              <div>
                <span className="text-sm font-medium text-violet-400">{evt.name}</span>
                <p className="text-xs text-slate-500">{evt.date} · {evt.start_time} – {evt.end_time} · <span className="text-violet-400 font-medium">${evt.rate_per_kwh}/kWh</span></p>
              </div>
              <button onClick={() => deleteEvent(evt.id)} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                <Trash2 className="w-3 h-3" /> Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Completed</div>
          {completed.slice(0, 5).map((evt: any) => (
            <div key={evt.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/30">
              <div>
                <span className="text-sm text-slate-600 dark:text-slate-300">{evt.name}</span>
                <p className="text-xs text-slate-500">{evt.date} · {evt.start_time} – {evt.end_time}</p>
              </div>
              {evt.result && (
                <div className="text-right">
                  <span className="text-sm font-bold text-violet-400">${evt.result.earnings.toFixed(2)}</span>
                  <p className="text-[10px] text-slate-500">{evt.result.exported_kwh} kWh</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {events.length === 0 && !showForm && (
        <p className="text-xs text-slate-500 text-center py-4">No events scheduled. Click "Schedule Event" to add a VPP peak event.</p>
      )}
    </div>
  )
}


export default function Rules() {
  const { data: rules, loading, refetch } = useApi<Rule[]>('/rules')
  const { data: logs } = useApi<any[]>('/rules/log/recent')
  const { data: optimizeStatus } = useAutoRefresh<any>('/settings/optimize/status', 60000)
  const { data: evSchedule } = useApi<any>('/vehicle/schedule')
  const [showBuilder, setShowBuilder] = useState(false)
  const [showPresets, setShowPresets] = useState(false)

  const toggleRule = async (id: number) => {
    await apiFetch(`/rules/${id}/toggle`, { method: 'POST' })
    refetch()
  }

  const deleteRule = async (id: number) => {
    if (!confirm('Delete this rule?')) return
    await apiFetch(`/rules/${id}`, { method: 'DELETE' })
    refetch()
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Automation Rules</h2>
          <p className="text-sm text-slate-500">Configure triggers and actions for your Powerwall</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowPresets(!showPresets); setShowBuilder(false) }} className="btn-secondary flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Presets
          </button>
          <button onClick={() => { setShowBuilder(true); setShowPresets(false) }} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Rule
          </button>
        </div>
      </div>

      {showPresets && (
        <div className="card">
          <AutomationPresets onInstalled={() => { setShowPresets(false); refetch() }} />
        </div>
      )}

      {showBuilder && (
        <RuleBuilder
          onCreated={() => { setShowBuilder(false); refetch() }}
          onCancel={() => setShowBuilder(false)}
        />
      )}

      {/* Active Automations Status */}
      {(optimizeStatus?.enabled || (evSchedule && evSchedule.strategy !== 'off')) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* GridMind Optimize */}
          {optimizeStatus?.enabled && (
            <div className="card border-emerald-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                  <Activity className={`w-5 h-5 ${
                    optimizeStatus.phase === 'dumping' ? 'text-amber-500' :
                    optimizeStatus.phase === 'peak_hold' ? 'text-blue-500' :
                    'text-emerald-500'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">GridMind Optimize</span>
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">Active</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Peak: {optimizeStatus.peak_start_hour > 12 ? optimizeStatus.peak_start_hour - 12 : optimizeStatus.peak_start_hour}:00
                    {optimizeStatus.peak_start_hour >= 12 ? ' PM' : ' AM'} –{' '}
                    {optimizeStatus.peak_end_hour > 12 ? optimizeStatus.peak_end_hour - 12 : optimizeStatus.peak_end_hour}:00
                    {optimizeStatus.peak_end_hour >= 12 ? ' PM' : ' AM'}
                    {' · '}
                    {optimizeStatus.phase === 'dumping' ? 'Exporting' :
                     optimizeStatus.phase === 'peak_hold' ? 'Holding' :
                     optimizeStatus.phase === 'complete' ? 'Complete' :
                     'Waiting for peak'}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-lg text-xs font-bold uppercase ${
                  optimizeStatus.phase === 'dumping' ? 'bg-amber-500/15 text-amber-500' :
                  optimizeStatus.phase === 'peak_hold' ? 'bg-blue-500/15 text-blue-500' :
                  optimizeStatus.phase === 'complete' ? 'bg-emerald-500/15 text-emerald-500' :
                  'bg-emerald-500/10 text-emerald-500'
                }`}>
                  {optimizeStatus.phase === 'dumping' ? 'Exporting' :
                   optimizeStatus.phase === 'peak_hold' ? 'Holding' :
                   optimizeStatus.phase === 'complete' ? 'Complete' :
                   'Waiting'}
                </span>
              </div>
            </div>
          )}

          {/* EV Smart Schedule */}
          {evSchedule && evSchedule.strategy !== 'off' && (
            <div className="card border-orange-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
                  <Car className="w-5 h-5 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">EV Smart Schedule</span>
                    <span className="text-[10px] bg-orange-500/15 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded font-medium">Active</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {evSchedule.strategy === 'tou_aware' ? 'TOU-Aware: charge off-peak only' :
                     evSchedule.strategy === 'solar_surplus' ? `Solar Surplus: threshold ${evSchedule.solar_surplus_threshold_kw} kW` :
                     evSchedule.strategy === 'departure' ? `Departure: ${evSchedule.departure_time}, target ${evSchedule.departure_target_soc}%` :
                     evSchedule.strategy}
                  </p>
                </div>
                <span className="px-3 py-1 rounded-lg text-xs font-bold uppercase bg-orange-500/10 text-orange-500">
                  {evSchedule.strategy === 'tou_aware' ? 'TOU' :
                   evSchedule.strategy === 'solar_surplus' ? 'Solar' :
                   evSchedule.strategy === 'departure' ? 'Depart' :
                   evSchedule.strategy}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VPP Peak Events */}
      <PeakEventsConfig />

      {/* Rules List */}
      {loading ? (
        <div className="card text-center py-8 text-slate-500">Loading rules...</div>
      ) : !rules?.length ? (
        <div className="card text-center py-12">
          <Zap className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-400 mb-1">No Rules Yet</h3>
          <p className="text-sm text-slate-500 mb-3">Get started with a preset or create a custom rule.</p>
          <button onClick={() => setShowPresets(true)} className="btn-secondary text-sm inline-flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Browse Presets
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => {
            const TriggerIcon = TRIGGER_ICONS[rule.trigger_type] || Zap
            return (
              <div key={rule.id} className={`card flex items-start gap-4 ${!rule.enabled ? 'opacity-60' : ''}`}>
                <div className={`mt-1 w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  rule.enabled ? 'bg-blue-500/20' : 'bg-slate-800'
                }`}>
                  <TriggerIcon className={`w-4.5 h-4.5 ${rule.enabled ? 'text-blue-400' : 'text-slate-600'}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold truncate">{rule.name}</h4>
                    {rule.one_shot && (
                      <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
                        One-shot
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 mb-2">{formatTrigger(rule.trigger_type, rule.trigger_config)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {rule.actions.map((action: any, i: number) => (
                      <span key={i} className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                        {formatAction(action)}
                      </span>
                    ))}
                  </div>
                  {rule.last_triggered && (
                    <p className="text-xs text-slate-600 mt-2">
                      Last triggered: {new Date(rule.last_triggered).toLocaleString()} ({rule.trigger_count}x)
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className={`p-2 rounded-lg ${
                      rule.enabled
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                    }`}
                    title={rule.enabled ? 'Disable' : 'Enable'}
                  >
                    {rule.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="p-2 rounded-lg bg-slate-800 text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recent Execution Log */}
      {logs && logs.length > 0 && (
        <div className="card">
          <div className="card-header">Recent Activity</div>
          <div className="space-y-2">
            {logs.slice(0, 10).map((log: any) => (
              <div key={log.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-slate-800 last:border-0">
                <div className={`w-2 h-2 rounded-full ${log.success ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-slate-400 w-36 shrink-0">
                  {new Date(log.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="font-medium truncate">{log.rule_name}</span>
                {log.error_message && (
                  <span className="text-xs text-red-400 truncate">{log.error_message}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
