import { useState } from 'react'
import {
  Clock, Battery, Zap, Sun, Shield, AlertTriangle,
  DollarSign, CloudRain, Plug, ChevronDown, ChevronUp,
} from 'lucide-react'
import { apiFetch } from '../hooks/useApi'

interface Preset {
  id: string
  name: string
  description: string
  category: string
  icon: typeof Clock
  rules: {
    name: string
    description: string
    trigger_type: string
    trigger_config: any
    conditions?: any[]
    actions: any[]
    priority?: number
  }[]
}

const PRESETS: Preset[] = [
  {
    id: 'tou-optimizer',
    name: 'TOU Rate Optimizer',
    description: 'Maximize savings by switching to self-powered during peak rates and allowing grid charging during off-peak.',
    category: 'Cost Savings',
    icon: DollarSign,
    rules: [
      {
        name: 'Peak Hours - Self Powered',
        description: 'Switch to self-powered mode during peak pricing to avoid expensive grid imports',
        trigger_type: 'time',
        trigger_config: { time: '17:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        actions: [
          { type: 'set_mode', value: 'self_consumption' },
          { type: 'set_reserve', value: 20 },
          { type: 'notify', title: 'Peak Hours', message: 'Switched to self-powered for peak pricing' },
        ],
        priority: 10,
      },
      {
        name: 'Off-Peak - Time Based Control',
        description: 'Return to time-based control during off-peak for optimal grid interaction',
        trigger_type: 'time',
        trigger_config: { time: '21:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        actions: [
          { type: 'set_mode', value: 'autonomous' },
          { type: 'notify', title: 'Off-Peak', message: 'Switched to time-based control for off-peak' },
        ],
        priority: 10,
      },
    ],
  },
  {
    id: 'max-self-power',
    name: 'Maximum Self-Powered',
    description: 'Stay in self-powered mode 24/7, using solar and battery before grid. Best for maximizing solar self-consumption.',
    category: 'Self Sufficiency',
    icon: Sun,
    rules: [
      {
        name: 'Always Self Powered',
        description: 'Keep the system in self-powered mode at all times',
        trigger_type: 'time',
        trigger_config: { time: '00:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        actions: [
          { type: 'set_mode', value: 'self_consumption' },
        ],
        priority: 5,
      },
    ],
  },
  {
    id: 'low-battery-protection',
    name: 'Low Battery Protection',
    description: 'Get notified and switch to grid when battery drops too low. Prevents deep discharge.',
    category: 'Battery Health',
    icon: Battery,
    rules: [
      {
        name: 'Low Battery Warning',
        description: 'Notify when battery drops to 15%',
        trigger_type: 'soc',
        trigger_config: { operator: '<=', value: 15 },
        actions: [
          { type: 'notify', title: 'Low Battery', message: 'Battery at 15% - consider enabling grid charging', level: 'warning' },
        ],
        priority: 20,
      },
      {
        name: 'Critical Battery - Grid Charge',
        description: 'Enable grid charging when battery drops to 10%',
        trigger_type: 'soc',
        trigger_config: { operator: '<=', value: 10 },
        actions: [
          { type: 'set_grid_charging', value: true },
          { type: 'notify', title: 'Critical Battery', message: 'Battery at 10% - grid charging enabled', level: 'critical' },
        ],
        priority: 25,
      },
    ],
  },
  {
    id: 'grid-outage-alert',
    name: 'Grid Outage Alert',
    description: 'Get notified immediately when the grid goes down or comes back online.',
    category: 'Monitoring',
    icon: AlertTriangle,
    rules: [
      {
        name: 'Grid Down Alert',
        description: 'Notify when the grid goes offline (islanded mode)',
        trigger_type: 'grid_status',
        trigger_config: { status: 'islanded' },
        actions: [
          { type: 'notify', title: 'Grid Outage', message: 'Grid power lost - running on battery and solar', level: 'critical' },
        ],
        priority: 30,
      },
      {
        name: 'Grid Restored Alert',
        description: 'Notify when the grid comes back online',
        trigger_type: 'grid_status',
        trigger_config: { status: 'connected' },
        actions: [
          { type: 'notify', title: 'Grid Restored', message: 'Grid power has been restored', level: 'info' },
        ],
        priority: 30,
      },
    ],
  },
  {
    id: 'high-load-alert',
    name: 'High Load Alert',
    description: 'Get notified when home consumption exceeds a threshold. Helps catch unusual power usage.',
    category: 'Monitoring',
    icon: Zap,
    rules: [
      {
        name: 'High Home Load',
        description: 'Notify when home consumption exceeds 8kW',
        trigger_type: 'load',
        trigger_config: { operator: '>=', value: 8000 },
        actions: [
          { type: 'notify', title: 'High Load', message: 'Home consumption exceeded 8kW', level: 'warning' },
        ],
        priority: 15,
      },
    ],
  },
  {
    id: 'storm-prep',
    name: 'Storm Preparation',
    description: 'When battery is full and storm mode activates, maximize reserve for backup power.',
    category: 'Weather',
    icon: CloudRain,
    rules: [
      {
        name: 'Full Battery - Max Reserve',
        description: 'Set reserve to 100% when battery is fully charged to prepare for storms',
        trigger_type: 'soc',
        trigger_config: { operator: '>=', value: 98 },
        actions: [
          { type: 'set_reserve', value: 100 },
          { type: 'notify', title: 'Storm Ready', message: 'Battery full - reserve set to 100% for backup' },
        ],
        priority: 5,
      },
    ],
  },
  {
    id: 'peak-export-max',
    name: 'Peak Export Maximizer',
    description: 'During peak TOU hours, switch to export everything to maximize grid credits at the highest rate.',
    category: 'Cost Savings',
    icon: DollarSign,
    rules: [
      {
        name: 'Peak Start - Export Everything',
        description: 'Allow battery export during peak hours for maximum credits',
        trigger_type: 'time',
        trigger_config: { time: '17:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        actions: [
          { type: 'set_export_rule', value: 'battery_ok' },
          { type: 'set_reserve', value: 10 },
          { type: 'notify', title: 'Peak Export', message: 'Exporting everything during peak rates' },
        ],
        priority: 15,
      },
      {
        name: 'Peak End - Solar Only Export',
        description: 'Return to solar-only export after peak hours',
        trigger_type: 'time',
        trigger_config: { time: '21:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        actions: [
          { type: 'set_export_rule', value: 'pv_only' },
          { type: 'set_reserve', value: 20 },
        ],
        priority: 15,
      },
    ],
  },
]

const CATEGORIES = [...new Set(PRESETS.map(p => p.category))]

interface Props {
  onInstalled: () => void
}

export default function AutomationPresets({ onInstalled }: Props) {
  const [installing, setInstalling] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const installPreset = async (preset: Preset) => {
    setInstalling(preset.id)
    setError('')
    setSuccess('')

    try {
      for (const rule of preset.rules) {
        await apiFetch('/rules', {
          method: 'POST',
          body: JSON.stringify({
            name: rule.name,
            description: rule.description,
            trigger_type: rule.trigger_type,
            trigger_config: rule.trigger_config,
            conditions: rule.conditions || null,
            actions: rule.actions,
            enabled: true,
            priority: rule.priority || 0,
          }),
        })
      }
      setSuccess(`Installed "${preset.name}" (${preset.rules.length} rule${preset.rules.length > 1 ? 's' : ''})`)
      onInstalled()
    } catch (e: any) {
      setError(e.message)
    }
    setInstalling('')
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Automation Presets</h3>
        <p className="text-sm text-slate-500 mt-1">One-click templates for common Powerwall strategies. Install a preset to automatically create the rules.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-sm text-emerald-600 dark:text-emerald-400">{success}</div>
      )}

      {CATEGORIES.map(cat => (
        <div key={cat}>
          <h4 className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">{cat}</h4>
          <div className="space-y-2">
            {PRESETS.filter(p => p.category === cat).map(preset => {
              const Icon = preset.icon
              const isExpanded = expanded === preset.id
              return (
                <div key={preset.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : preset.id)}
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{preset.name}</p>
                      <p className="text-xs text-slate-500 truncate">{preset.description}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">{preset.rules.length} rule{preset.rules.length > 1 ? 's' : ''}</span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800">
                      <p className="text-xs text-slate-500 mt-3 mb-3">{preset.description}</p>
                      <div className="space-y-2 mb-3">
                        {preset.rules.map((rule, i) => (
                          <div key={i} className="text-xs bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5">
                            <p className="font-medium text-slate-700 dark:text-slate-300">{rule.name}</p>
                            <p className="text-slate-500 mt-0.5">{rule.description}</p>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {rule.actions.map((a: any, j: number) => (
                                <span key={j} className="px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 text-[10px]">
                                  {a.type === 'set_mode' ? (a.value === 'self_consumption' ? 'Self-Powered' : 'Time-Based') :
                                   a.type === 'set_reserve' ? `Reserve ${a.value}%` :
                                   a.type === 'set_export_rule' ? `Export: ${a.value}` :
                                   a.type === 'set_grid_charging' ? (a.value ? 'Grid Charge On' : 'Grid Charge Off') :
                                   a.type === 'notify' ? `Notify` : a.type}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); installPreset(preset) }}
                        disabled={!!installing}
                        className="btn-primary text-sm w-full"
                      >
                        {installing === preset.id ? 'Installing...' : `Install ${preset.rules.length} Rule${preset.rules.length > 1 ? 's' : ''}`}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
