import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { apiFetch } from '../hooks/useApi'

const TRIGGER_TYPES = [
  { value: 'time', label: 'Time of Day' },
  { value: 'soc', label: 'Battery SOC (%)' },
  { value: 'load', label: 'Home Load (W)' },
  { value: 'solar', label: 'Solar Power (W)' },
  { value: 'grid_power', label: 'Grid Power (W)' },
  { value: 'grid_status', label: 'Grid Status' },
]

const ACTION_TYPES = [
  { value: 'set_mode', label: 'Set Operation Mode' },
  { value: 'set_reserve', label: 'Set Backup Reserve' },
  { value: 'set_storm_mode', label: 'Set Storm Mode' },
  { value: 'set_grid_charging', label: 'Set Grid Charging' },
  { value: 'set_export_rule', label: 'Set Export Rule' },
  { value: 'notify', label: 'Send Notification' },
]

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

interface Props {
  onCreated: () => void
  onCancel: () => void
}

export default function RuleBuilder({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState('time')
  const [triggerConfig, setTriggerConfig] = useState<any>({ time: '08:00', days: [...DAYS] })
  const [actions, setActions] = useState<any[]>([{ type: 'set_mode', value: 'self_consumption' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleTriggerTypeChange = (type: string) => {
    setTriggerType(type)
    switch (type) {
      case 'time':
        setTriggerConfig({ time: '08:00', days: [...DAYS] })
        break
      case 'soc':
        setTriggerConfig({ operator: '<=', value: 20 })
        break
      case 'load':
        setTriggerConfig({ operator: '>=', value: 5000 })
        break
      case 'solar':
        setTriggerConfig({ operator: '>=', value: 1000 })
        break
      case 'grid_power':
        setTriggerConfig({ operator: '>=', value: 3000 })
        break
      case 'grid_status':
        setTriggerConfig({ status: 'islanded' })
        break
    }
  }

  const addAction = () => {
    setActions([...actions, { type: 'notify', message: 'Alert from GridMind' }])
  }

  const removeAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index))
  }

  const updateAction = (index: number, field: string, value: any) => {
    const updated = [...actions]
    updated[index] = { ...updated[index], [field]: value }
    setActions(updated)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Rule name is required')
      return
    }
    setSaving(true)
    setError('')

    try {
      await apiFetch('/rules', {
        method: 'POST',
        body: JSON.stringify({
          name,
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          actions,
          enabled: true,
        }),
      })
      onCreated()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4">New Automation Rule</h3>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Rule Name */}
      <div className="mb-4">
        <label className="block text-sm text-slate-400 mb-1">Rule Name</label>
        <input
          type="text"
          className="input w-full"
          placeholder="e.g., Peak Hours - Self Powered"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* Trigger */}
      <div className="mb-4">
        <label className="block text-sm text-slate-400 mb-1">When (Trigger)</label>
        <select
          className="select w-full mb-2"
          value={triggerType}
          onChange={(e) => handleTriggerTypeChange(e.target.value)}
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {/* Trigger config */}
        {triggerType === 'time' && (
          <div className="flex gap-3 items-center">
            <input
              type="time"
              className="input"
              value={triggerConfig.time || '08:00'}
              onChange={(e) => setTriggerConfig({ ...triggerConfig, time: e.target.value })}
            />
            <div className="flex gap-1">
              {DAYS.map((day) => (
                <button
                  key={day}
                  className={`w-8 h-8 rounded text-xs font-medium ${
                    triggerConfig.days?.includes(day)
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                  onClick={() => {
                    const days = triggerConfig.days || []
                    setTriggerConfig({
                      ...triggerConfig,
                      days: days.includes(day)
                        ? days.filter((d: string) => d !== day)
                        : [...days, day],
                    })
                  }}
                >
                  {day.charAt(0).toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {['soc', 'load', 'solar', 'grid_power'].includes(triggerType) && (
          <div className="flex gap-2 items-center">
            <select
              className="select w-24"
              value={triggerConfig.operator || '>='}
              onChange={(e) => setTriggerConfig({ ...triggerConfig, operator: e.target.value })}
            >
              <option value=">=">{'>='};</option>
              <option value="<=">{'<='}</option>
              <option value=">">{'>'}</option>
              <option value="<">{'<'}</option>
              <option value="==">{'='}</option>
            </select>
            <input
              type="number"
              className="input w-32"
              value={triggerConfig.value || 0}
              onChange={(e) => setTriggerConfig({ ...triggerConfig, value: Number(e.target.value) })}
            />
            <span className="text-sm text-slate-500">
              {triggerType === 'soc' ? '%' : 'W'}
            </span>
          </div>
        )}

        {triggerType === 'grid_status' && (
          <select
            className="select w-full"
            value={triggerConfig.status || 'islanded'}
            onChange={(e) => setTriggerConfig({ status: e.target.value })}
          >
            <option value="islanded">Grid Down (Islanded)</option>
            <option value="connected">Grid Connected</option>
          </select>
        )}
      </div>

      {/* Actions */}
      <div className="mb-4">
        <label className="block text-sm text-slate-400 mb-1">Then (Actions)</label>
        {actions.map((action, i) => (
          <div key={i} className="flex gap-2 items-center mb-2">
            <select
              className="select flex-1"
              value={action.type}
              onChange={(e) => updateAction(i, 'type', e.target.value)}
            >
              {ACTION_TYPES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>

            {action.type === 'set_mode' && (
              <select
                className="select w-44"
                value={action.value || 'self_consumption'}
                onChange={(e) => updateAction(i, 'value', e.target.value)}
              >
                <option value="self_consumption">Self-Powered</option>
                <option value="autonomous">Time-Based Control</option>
              </select>
            )}

            {action.type === 'set_reserve' && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  className="input w-20"
                  min={0}
                  max={100}
                  value={action.value || 20}
                  onChange={(e) => updateAction(i, 'value', Number(e.target.value))}
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
            )}

            {action.type === 'notify' && (
              <input
                type="text"
                className="input flex-1"
                placeholder="Notification message"
                value={action.message || ''}
                onChange={(e) => updateAction(i, 'message', e.target.value)}
              />
            )}

            {action.type === 'set_storm_mode' && (
              <select
                className="select w-28"
                value={action.value ? 'true' : 'false'}
                onChange={(e) => updateAction(i, 'value', e.target.value === 'true')}
              >
                <option value="true">Enable</option>
                <option value="false">Disable</option>
              </select>
            )}

            {action.type === 'set_grid_charging' && (
              <select
                className="select w-28"
                value={action.value ? 'true' : 'false'}
                onChange={(e) => updateAction(i, 'value', e.target.value === 'true')}
              >
                <option value="true">Enable</option>
                <option value="false">Disable</option>
              </select>
            )}

            {action.type === 'set_export_rule' && (
              <select
                className="select w-36"
                value={action.value || 'pv_only'}
                onChange={(e) => updateAction(i, 'value', e.target.value)}
              >
                <option value="pv_only">Solar Only</option>
                <option value="battery_ok">Everything</option>
                <option value="never">No Export</option>
              </select>
            )}

            <button onClick={() => removeAction(i)} className="p-1.5 text-slate-500 hover:text-red-400">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button onClick={addAction} className="btn-secondary text-sm flex items-center gap-1 mt-1">
          <Plus className="w-3.5 h-3.5" /> Add Action
        </button>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Create Rule'}
        </button>
      </div>
    </div>
  )
}
