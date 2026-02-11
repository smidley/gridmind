import { useState } from 'react'
import { Plus, Power, PowerOff, Clock, Battery, Zap, Wifi, Sun, Trash2, BookOpen } from 'lucide-react'
import { useApi, apiFetch } from '../hooks/useApi'
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

export default function Rules() {
  const { data: rules, loading, refetch } = useApi<Rule[]>('/rules')
  const { data: logs } = useApi<any[]>('/rules/log/recent')
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
