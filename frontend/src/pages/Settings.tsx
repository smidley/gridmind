import { useState, useEffect } from 'react'
import {
  ExternalLink,
  Check,
  AlertTriangle,
  Shield,
  Sliders,
  MapPin,
  Key,
  Search,
  Loader2,
  Sun,
  Activity,
  Zap,
  Brain,
  Trash2,
  Bell,
  Send,
} from 'lucide-react'
import { useApi, apiFetch } from '../hooks/useApi'

/** Inline component for app authentication configuration */
function AuthConfig() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { data: authStatus, refetch } = useApi<any>('/app-auth/status')

  const saveAuth = async () => {
    setSaving(true); setError(''); setSuccess('')
    try {
      await apiFetch('/app-auth/set-password', { method: 'POST', body: JSON.stringify({ username, password }) })
      setSuccess('Login credentials saved. Authentication is now enabled.')
      setUsername(''); setPassword('')
      refetch()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const disableAuth = async () => {
    setSaving(true); setError(''); setSuccess('')
    try {
      await apiFetch('/app-auth/disable', { method: 'POST' })
      setSuccess('Authentication disabled')
      refetch()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      {authStatus?.auth_enabled ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-emerald-400 font-medium">Authentication enabled</span>
          </div>
          <button onClick={disableAuth} disabled={saving} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
            <Trash2 className="w-3 h-3" /> Disable
          </button>
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-amber-400 font-medium">No authentication</span>
          </div>
          <p className="text-xs text-slate-500">Anyone with access to this URL can view and control your system.</p>
        </div>
      )}

      <p className="text-xs text-slate-500">Set a username and password to require login.</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="off"
          className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="new-password"
          className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
        />
        <button onClick={saveAuth} disabled={saving || !username || !password} className="btn-primary text-sm px-4">
          {saving ? 'Saving...' : authStatus?.auth_enabled ? 'Update' : 'Enable'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}
    </div>
  )
}

/** Inline component for notification configuration */
function NotificationConfig() {
  const { data: config, refetch } = useApi<any>('/settings/notifications')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpFrom, setSmtpFrom] = useState('')
  const [email, setEmail] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (config && !loaded) {
      setSmtpHost(config.smtp_host || '')
      setSmtpPort(String(config.smtp_port || 587))
      setSmtpUser(config.smtp_username || '')
      setSmtpFrom(config.smtp_from || '')
      setEmail(config.email || '')
      setWebhookUrl(config.webhook_url || '')
      setLoaded(true)
    }
  }, [config, loaded])

  const save = async () => {
    setSaving(true); setError(''); setSuccess('')
    try {
      await apiFetch('/settings/notifications', {
        method: 'POST',
        body: JSON.stringify({
          smtp_host: smtpHost, smtp_port: parseInt(smtpPort) || 587,
          smtp_username: smtpUser, smtp_password: smtpPass,
          smtp_from: smtpFrom, email, webhook_url: webhookUrl,
        }),
      })
      setSuccess('Notification settings saved')
      setSmtpPass('')
      refetch()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const test = async () => {
    setTesting(true); setError(''); setSuccess('')
    try {
      const result = await apiFetch('/settings/notifications/test', { method: 'POST' })
      const results = result.results || []
      const summary = results.map((r: any) => `${r.channel}: ${r.success ? 'OK' : 'Failed'}`).join(', ')
      setSuccess(`Test sent! ${summary}`)
    } catch (e: any) { setError(e.message) }
    finally { setTesting(false) }
  }

  return (
    <div className="space-y-4">
      {config?.configured && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <Check className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">Notifications configured</span>
        </div>
      )}

      <div>
        <label className="text-xs text-slate-500 block mb-1">Webhook URL (Slack, Discord, or generic)</label>
        <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://hooks.slack.com/..." className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
        <p className="text-xs text-slate-500 mb-3 font-medium">Email (SMTP)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-500">SMTP Host</label>
            <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">SMTP Port</label>
            <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">Username</label>
            <input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="user@gmail.com" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">Password {config?.smtp_password_set && <span className="text-emerald-400">(set)</span>}</label>
            <input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder={config?.smtp_password_set ? '••••••••' : 'App password'} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">From Email</label>
            <input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="gridmind@yourdomain.com" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">Send To</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving...' : 'Save'}</button>
        {config?.configured && (
          <button onClick={test} disabled={testing} className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-500 hover:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors">
            <Send className="w-3.5 h-3.5" />
            {testing ? 'Sending...' : 'Send Test'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}
    </div>
  )
}

/** Inline component for system cost / break-even tracking */
function SystemCostConfig() {
  const [cost, setCost] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const { data: config, refetch } = useApi<any>('/settings/setup')

  const currentCost = config?.system_cost || 0

  const saveCost = async () => {
    setSaving(true); setSuccess('')
    try {
      await apiFetch('/settings/system-cost', {
        method: 'POST',
        body: JSON.stringify({ system_cost: parseFloat(cost) || 0 }),
      })
      setSuccess('Saved')
      setCost('')
      refetch()
    } catch (e: any) { console.error(e) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      {currentCost > 0 ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <span className="text-sm text-blue-400 font-medium">
            System cost: ${currentCost.toLocaleString()}
          </span>
          <button
            onClick={() => { setCost(String(currentCost)) }}
            className="text-xs text-slate-400 hover:text-slate-300"
          >
            Edit
          </button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
          <input
            type="number"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder={currentCost > 0 ? String(currentCost) : 'Total system cost'}
            className="w-full pl-7 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button onClick={saveCost} disabled={saving || !cost} className="btn-primary text-sm px-4">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {success && <p className="text-xs text-emerald-400">{success}</p>}
    </div>
  )
}


/** Inline component for EIA Grid Mix API configuration */
function EIAConfig() {
  const [key, setKey] = useState('')
  const [ba, setBa] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { data: config, refetch } = useApi<any>('/settings/grid-mix/config')

  const saveConfig = async () => {
    setSaving(true); setError(''); setSuccess('')
    try {
      const body: any = {}
      if (key) body.eia_api_key = key
      if (ba !== undefined) body.balancing_authority = ba
      await apiFetch('/settings/grid-mix/config', { method: 'POST', body: JSON.stringify(body) })
      setSuccess('Saved')
      setKey('')
      refetch()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const removeKey = async () => {
    setSaving(true); setError(''); setSuccess('')
    try {
      await apiFetch('/settings/grid-mix/config', { method: 'POST', body: JSON.stringify({ eia_api_key: '' }) })
      setSuccess('API key removed')
      refetch()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      {config?.eia_api_key_configured ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-emerald-400 font-medium">EIA API key configured</span>
            <span className="text-xs text-slate-500">
              · Region: {config.balancing_authority || config.detected_balancing_authority || 'not detected'}
            </span>
          </div>
          <button onClick={removeKey} disabled={saving} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="EIA API key"
              className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
            <button onClick={saveConfig} disabled={saving || !key} className="btn-primary text-sm px-4">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <p className="text-[10px] text-slate-500">
            Get a free key at{' '}
            <a href="https://www.eia.gov/opendata/register.php" target="_blank" rel="noreferrer" className="underline hover:text-slate-400">
              eia.gov/opendata
            </a>
          </p>
        </div>
      )}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={ba || config?.balancing_authority || ''}
          onChange={(e) => setBa(e.target.value.toUpperCase())}
          placeholder="Auto-detect from location"
          className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
        />
        <span className="text-[10px] text-slate-500 shrink-0">Region override (e.g. BPA, CISO, ERCO)</span>
      </div>
      {ba && ba !== (config?.balancing_authority || '') && (
        <button onClick={saveConfig} disabled={saving} className="btn-secondary text-sm px-4">
          {saving ? 'Saving...' : 'Save Region'}
        </button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}
    </div>
  )
}


/** Inline component for OpenAI API key configuration */
function AIKeyConfig() {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { data: aiStatus, refetch } = useApi<any>('/ai/status')

  const saveKey = async () => {
    setSaving(true); setError(''); setSuccess('')
    try {
      await apiFetch('/ai/configure', { method: 'POST', body: JSON.stringify({ api_key: key }) })
      setSuccess('API key saved')
      setKey('')
      refetch()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const removeKey = async () => {
    setSaving(true); setError(''); setSuccess('')
    try {
      await apiFetch('/ai/configure', { method: 'DELETE' })
      setSuccess('API key removed')
      refetch()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      {aiStatus?.configured ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-emerald-400 font-medium">OpenAI configured</span>
          </div>
          <button onClick={removeKey} disabled={saving} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-..."
            className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={saveKey} disabled={saving || !key} className="btn-primary text-sm px-4">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}
    </div>
  )
}

export default function SettingsPage() {
  const { data: modeStatus } = useApi<any>('/mode-status')
  const { data: setupStatus, refetch: refetchSetup } = useApi<any>('/settings/setup/status')
  const { data: setupData, refetch: refetchSetupData } = useApi<any>('/settings/setup')
  const { data: authStatus, refetch: refetchAuth } = useApi<any>('/auth/status')
  const { data: siteConfig, refetch: refetchConfig } = useApi<any>('/site/config')

  // Credential form
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState('http://localhost:8080/auth/callback')
  const [credsSaving, setCredsSaving] = useState(false)
  const [credsError, setCredsError] = useState('')
  const [credsSuccess, setCredsSuccess] = useState('')

  // Location form
  const [address, setAddress] = useState('')
  const [geocodeResult, setGeocodeResult] = useState<any>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [locationSuccess, setLocationSuccess] = useState('')

  // Solar configuration
  const { data: solarConfig, refetch: refetchSolar } = useApi<any>('/settings/setup/solar')
  const [solarCapacity, setSolarCapacity] = useState(0)
  const [solarTilt, setSolarTilt] = useState(30)
  const [solarAzimuth, setSolarAzimuth] = useState(0)
  const [solarDcAc, setSolarDcAc] = useState(1.2)
  const [solarInverterEff, setSolarInverterEff] = useState(0.96)
  const [solarLosses, setSolarLosses] = useState(14)
  const [solarSaving, setSolarSaving] = useState(false)
  const [solarSuccess, setSolarSuccess] = useState('')
  const [solarError, setSolarError] = useState('')

  // Tesla registration + site discovery
  const [connectLoading, setConnectLoading] = useState('')
  const [connectError, setConnectError] = useState('')
  const [connectSuccess, setConnectSuccess] = useState('')
  const [regDomain, setRegDomain] = useState(setupData?.fleet_api_domain || '')
  const [publicKey, setPublicKey] = useState('')

  // GridMind Optimize
  const { data: optimizeStatus, refetch: refetchOptimize } = useApi<any>('/settings/optimize/status')
  const [optimizeEnabled, setOptimizeEnabled] = useState(false)
  const [optimizePeakStart, setOptimizePeakStart] = useState(17)
  const [optimizePeakEnd, setOptimizePeakEnd] = useState(21)
  const [optimizeBuffer, setOptimizeBuffer] = useState(15)
  const [optimizeMinReserve, setOptimizeMinReserve] = useState(5)

  // Off-grid mode
  const { data: offgridStatus } = useApi<any>('/settings/offgrid/status')
  const [offgridActive, setOffgridActive] = useState(false)

  // Manual controls
  const [reserve, setReserve] = useState(20)
  const [mode, setMode] = useState('self_consumption')
  const [saving, setSaving] = useState('')

  // Load existing setup data into forms
  useEffect(() => {
    if (setupData) {
      if (setupData.tesla_client_id) setClientId(setupData.tesla_client_id)
      if (setupData.tesla_redirect_uri) setRedirectUri(setupData.tesla_redirect_uri)
      if (setupData.address) setAddress(setupData.address)
      if (setupData.fleet_api_domain) setRegDomain(setupData.fleet_api_domain)
    }
  }, [setupData])

  // Try to load existing public key on mount
  useEffect(() => {
    apiFetch('/settings/setup/public-key').then(data => {
      if (data?.public_key) setPublicKey(data.public_key)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (optimizeStatus) {
      setOptimizeEnabled(optimizeStatus.enabled)
      if (optimizeStatus.peak_start_hour) setOptimizePeakStart(optimizeStatus.peak_start_hour)
      if (optimizeStatus.peak_end_hour) setOptimizePeakEnd(optimizeStatus.peak_end_hour)
      if (optimizeStatus.buffer_minutes) setOptimizeBuffer(optimizeStatus.buffer_minutes)
      if (optimizeStatus.min_reserve_pct) setOptimizeMinReserve(optimizeStatus.min_reserve_pct)
    }
  }, [optimizeStatus])

  useEffect(() => {
    if (offgridStatus) setOffgridActive(offgridStatus.active)
  }, [offgridStatus])

  useEffect(() => {
    if (solarConfig?.configured) {
      setSolarCapacity(solarConfig.capacity_kw)
      setSolarTilt(solarConfig.tilt)
      setSolarAzimuth(solarConfig.azimuth)
      setSolarDcAc(solarConfig.dc_ac_ratio)
      setSolarInverterEff(solarConfig.inverter_efficiency)
      setSolarLosses(solarConfig.system_losses)
    }
  }, [solarConfig])

  useEffect(() => {
    if (siteConfig) {
      setReserve(siteConfig.backup_reserve_percent || 20)
      setMode(siteConfig.operation_mode || 'self_consumption')
    }
  }, [siteConfig])

  // --- Handlers ---

  const handleSaveCredentials = async () => {
    setCredsSaving(true)
    setCredsError('')
    setCredsSuccess('')
    try {
      const result = await apiFetch('/settings/setup/credentials', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
      })
      setCredsSuccess('Credentials saved successfully!')
      setClientSecret('') // Clear secret from form
      refetchSetup()
      refetchAuth()
    } catch (e: any) {
      setCredsError(e.message)
    }
    setCredsSaving(false)
  }

  const handleGeocode = async () => {
    setGeocoding(true)
    setLocationError('')
    setGeocodeResult(null)
    try {
      const result = await apiFetch('/settings/setup/location/geocode', {
        method: 'POST',
        body: JSON.stringify({ address }),
      })
      setGeocodeResult(result)
    } catch (e: any) {
      setLocationError(e.message)
    }
    setGeocoding(false)
  }

  const handleSaveLocation = async () => {
    if (!geocodeResult) return
    setLocationSaving(true)
    setLocationError('')
    setLocationSuccess('')
    try {
      await apiFetch('/settings/setup/location', {
        method: 'POST',
        body: JSON.stringify({
          latitude: geocodeResult.latitude,
          longitude: geocodeResult.longitude,
          timezone: geocodeResult.timezone,
          address: address,
        }),
      })
      setLocationSuccess('Location saved!')
      refetchSetup()
    } catch (e: any) {
      setLocationError(e.message)
    }
    setLocationSaving(false)
  }

  const handleGenerateKeys = async () => {
    setConnectLoading('keygen')
    setConnectError('')
    setConnectSuccess('')
    try {
      const result = await apiFetch('/settings/setup/generate-keys', { method: 'POST' })
      setPublicKey(result.public_key)
      setConnectSuccess(result.message)
    } catch (e: any) {
      setConnectError(e.message)
    }
    setConnectLoading('')
  }

  const handleRegister = async () => {
    if (!regDomain.trim()) {
      setConnectError('Enter the domain where your public key is hosted.')
      return
    }
    setConnectLoading('register')
    setConnectError('')
    setConnectSuccess('')
    try {
      const result = await apiFetch('/settings/setup/register', {
        method: 'POST',
        body: JSON.stringify({ domain: regDomain.trim() }),
      })
      setConnectSuccess(result.message || 'App registered! Now click "Discover Site".')
    } catch (e: any) {
      setConnectError(e.message)
    }
    setConnectLoading('')
  }

  const handleDiscoverSite = async () => {
    setConnectLoading('discover')
    setConnectError('')
    setConnectSuccess('')
    try {
      const result = await apiFetch('/settings/setup/discover-site', { method: 'POST' })
      setConnectSuccess(`Site discovered! ID: ${result.energy_site_id}`)
      refetchAuth()
      refetchConfig()
    } catch (e: any) {
      setConnectError(e.message)
    }
    setConnectLoading('')
  }

  const handleToggleOptimize = async () => {
    setSaving('optimize')
    try {
      const result = await apiFetch('/settings/optimize', {
        method: 'POST',
        body: JSON.stringify({
          enabled: !optimizeEnabled,
          peak_start: optimizePeakStart,
          peak_end: optimizePeakEnd,
          buffer_minutes: optimizeBuffer,
          min_reserve: optimizeMinReserve,
        }),
      })
      setOptimizeEnabled(result.enabled)
      refetchOptimize()
    } catch (e: any) {
      alert(`Failed: ${e.message}`)
    }
    setSaving('')
  }

  const handleToggleOffgrid = async () => {
    setSaving('offgrid')
    try {
      const result = await apiFetch('/settings/offgrid', {
        method: 'POST',
        body: JSON.stringify({ enabled: !offgridActive }),
      })
      setOffgridActive(result.offgrid)
    } catch (e: any) {
      alert(`Failed: ${e.message}`)
    }
    setSaving('')
  }

  const handleSaveSolar = async () => {
    setSolarSaving(true)
    setSolarError('')
    setSolarSuccess('')
    try {
      await apiFetch('/settings/setup/solar', {
        method: 'POST',
        body: JSON.stringify({
          capacity_kw: solarCapacity,
          tilt: solarTilt,
          azimuth: solarAzimuth,
          dc_ac_ratio: solarDcAc,
          inverter_efficiency: solarInverterEff,
          system_losses: solarLosses,
        }),
      })
      // Refresh forecast with new config
      await apiFetch('/history/forecast/refresh', { method: 'POST' })
      setSolarSuccess('Solar configuration saved! Forecast updated.')
      refetchSolar()
    } catch (e: any) {
      setSolarError(e.message)
    }
    setSolarSaving(false)
  }

  const handleSetMode = async (newMode: string) => {
    setSaving('mode')
    try {
      await apiFetch('/settings/powerwall/mode', {
        method: 'POST',
        body: JSON.stringify({ mode: newMode }),
      })
      setMode(newMode)
      refetchConfig()
    } catch (e) {
      alert(`Failed: ${e}`)
    }
    setSaving('')
  }

  const handleSetReserve = async () => {
    setSaving('reserve')
    try {
      await apiFetch('/settings/powerwall/reserve', {
        method: 'POST',
        body: JSON.stringify({ reserve_percent: reserve }),
      })
      refetchConfig()
    } catch (e) {
      alert(`Failed: ${e}`)
    }
    setSaving('')
  }

  // Determine if we need to show the setup wizard
  const needsSetup = setupStatus && !setupStatus.setup_complete

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-slate-500">
          {needsSetup ? 'Complete the setup to get started' : 'Tesla connection and Powerwall configuration'}
        </p>
      </div>

      {/* App Authentication */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4 text-blue-400" />
          <span className="card-header mb-0">App Authentication</span>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Require login to access GridMind. Recommended when exposing to the network.
        </p>
        <AuthConfig />
      </div>

      {/* Step 1: Tesla API Credentials */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-4.5 h-4.5 text-blue-400" />
          <h3 className="font-semibold">Tesla Fleet API Credentials</h3>
          {setupStatus?.has_credentials && (
            <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" /> Configured
            </span>
          )}
        </div>

        <p className="text-sm text-slate-400 mb-4">
          Enter your Client ID and Secret from{' '}
          <a href="https://developer.tesla.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
            developer.tesla.com
          </a>
        </p>

        {credsError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 text-sm text-red-400">
            {credsError}
          </div>
        )}
        {credsSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-3 text-sm text-emerald-400">
            {credsSuccess}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Client ID</label>
            <input
              type="text"
              className="input w-full"
              placeholder="Enter your Tesla Fleet API Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Client Secret</label>
            <input
              type="password"
              className="input w-full"
              placeholder={setupStatus?.has_credentials ? '(unchanged - enter new value to update)' : 'Enter your Tesla Fleet API Client Secret'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
            {setupData?.tesla_client_secret_masked && !clientSecret && (
              <p className="text-xs text-slate-600 mt-1">Current: {setupData.tesla_client_secret_masked}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Redirect URI</label>
            <input
              type="text"
              className="input w-full"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
            />
          </div>
          <button
            onClick={handleSaveCredentials}
            disabled={credsSaving || !clientId.trim() || (!clientSecret.trim() && !setupStatus?.has_credentials)}
            className="btn-primary"
          >
            {credsSaving ? 'Saving...' : 'Save Credentials'}
          </button>
        </div>
      </div>

      {/* Step 2: Connect Tesla Account */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4.5 h-4.5 text-blue-400" />
          <h3 className="font-semibold">Tesla Connection</h3>
          {authStatus?.authenticated && authStatus?.energy_site_id && (
            <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" /> Connected
            </span>
          )}
        </div>

        {connectError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 text-sm text-red-400">
            {connectError}
          </div>
        )}
        {connectSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-3 text-sm text-emerald-400">
            {connectSuccess}
          </div>
        )}

        {/* Fully connected */}
        {authStatus?.authenticated && authStatus?.energy_site_id ? (
          <div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Check className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-emerald-400">Connected to Tesla</p>
                <p className="text-sm text-slate-500">Site ID: {authStatus.energy_site_id}</p>
              </div>
              {authStatus.auth_url && (
                <a
                  href={authStatus.auth_url}
                  className="text-xs text-slate-500 hover:text-blue-400 transition-colors underline underline-offset-2"
                >
                  Re-authenticate
                </a>
              )}
            </div>
          </div>
        ) : !setupStatus?.has_credentials ? (
          /* No credentials yet */
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-300 dark:bg-slate-800 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-slate-500" />
            </div>
            <p className="text-sm text-slate-500">Enter your Tesla API credentials above first.</p>
          </div>
        ) : (
          /* Step-by-step setup */
          <div className="space-y-4">

            {/* Step A: Generate Keys */}
            <div className={`rounded-lg border p-4 ${publicKey ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-slate-300/60 bg-slate-200/30 dark:border-slate-700 dark:bg-slate-800/50'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${publicKey ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'}`}>
                  {publicKey ? <Check className="w-3.5 h-3.5" /> : '1'}
                </div>
                <h4 className="text-sm font-semibold">Generate Key Pair</h4>
              </div>
              {!publicKey ? (
                <div>
                  <p className="text-xs text-slate-400 mb-2">Tesla requires an EC key pair. GridMind will generate one for you.</p>
                  <button onClick={handleGenerateKeys} disabled={!!connectLoading} className="btn-primary text-sm">
                    {connectLoading === 'keygen' ? 'Generating...' : 'Generate Keys'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-emerald-400">Key pair ready.</p>
              )}
            </div>

            {/* Step B: Host Public Key */}
            {publicKey && (
              <div className={`rounded-lg border p-4 ${authStatus?.authenticated ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-slate-300/60 bg-slate-200/30 dark:border-slate-700 dark:bg-slate-800/50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${authStatus?.authenticated ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {authStatus?.authenticated ? <Check className="w-3.5 h-3.5" /> : '2'}
                  </div>
                  <h4 className="text-sm font-semibold">Host Public Key</h4>
                </div>
                {!authStatus?.authenticated ? (
                  <div>
                    <p className="text-xs text-slate-400 mb-2">
                      Copy the public key below and host it on a GitHub Pages site (or any HTTPS domain) at:
                    </p>
                    <code className="block bg-slate-900 p-2 rounded text-xs text-blue-400 mb-2 break-all">
                      https://YOUR-DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem
                    </code>
                    <details className="mb-3">
                      <summary className="text-xs text-blue-400 cursor-pointer hover:underline">Quick guide: GitHub Pages (free, 2 minutes)</summary>
                      <ol className="text-xs text-slate-400 mt-2 ml-4 space-y-1 list-decimal">
                        <li>Go to your GitHub Pages repo (e.g., <code className="text-slate-600 dark:text-slate-300">username.github.io</code>)</li>
                        <li>Create a file at <code className="text-slate-600 dark:text-slate-300">.well-known/appspecific/com.tesla.3p.public-key.pem</code></li>
                        <li>Paste the public key content below into that file</li>
                        <li>Add an empty <code className="text-slate-600 dark:text-slate-300">.nojekyll</code> file in the repo root (so GitHub serves dotfiles)</li>
                        <li>Verify it's live at <code className="text-slate-600 dark:text-slate-300">https://username.github.io/.well-known/appspecific/com.tesla.3p.public-key.pem</code></li>
                      </ol>
                    </details>
                    <div className="relative">
                      <pre className="bg-slate-100 dark:bg-slate-900 p-3 rounded text-xs text-slate-700 dark:text-slate-300 font-mono overflow-x-auto">{publicKey}</pre>
                      <button
                        onClick={() => { navigator.clipboard.writeText(publicKey); setConnectSuccess('Public key copied to clipboard!'); setTimeout(() => setConnectSuccess(''), 2000) }}
                        className="absolute top-2 right-2 text-xs bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 px-2 py-1 rounded text-slate-600 dark:text-slate-300"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-400">Public key hosted.</p>
                )}
              </div>
            )}

            {/* Step C: Register with Fleet API */}
            {publicKey && (
              <div className={`rounded-lg border p-4 ${connectSuccess.includes('registered') || connectSuccess.includes('Registered') ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-slate-300/60 bg-slate-200/30 dark:border-slate-700 dark:bg-slate-800/50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500/20 text-blue-400">3</div>
                  <h4 className="text-sm font-semibold">Register with Tesla Fleet API</h4>
                </div>
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">Enter the domain hosting your public key and register. You can re-register at any time.</p>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      className="input flex-1 text-sm"
                      placeholder="e.g., username.github.io"
                      value={regDomain}
                      onChange={(e) => setRegDomain(e.target.value)}
                    />
                    <button onClick={handleRegister} disabled={!!connectLoading || !regDomain.trim()} className="btn-primary text-sm">
                      {connectLoading === 'register' ? 'Registering...' : 'Register'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step D: Authenticate */}
            {publicKey && (
              <div className={`rounded-lg border p-4 ${authStatus?.authenticated ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-slate-300/60 bg-slate-200/30 dark:border-slate-700 dark:bg-slate-800/50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${authStatus?.authenticated ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {authStatus?.authenticated ? <Check className="w-3.5 h-3.5" /> : '4'}
                  </div>
                  <h4 className="text-sm font-semibold">Authenticate with Tesla</h4>
                </div>
                {!authStatus?.authenticated ? (
                  <div>
                    <p className="text-xs text-slate-400 mb-2">Complete registration above first, then authenticate.</p>
                    {authStatus?.auth_url && (
                      <a href={authStatus.auth_url} className="btn-success text-sm inline-flex items-center gap-2">
                        <ExternalLink className="w-4 h-4" /> Authenticate with Tesla
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-emerald-400">Authenticated with Tesla.</p>
                )}
              </div>
            )}

            {/* Step E: Discover Site */}
            {authStatus?.authenticated && !authStatus?.energy_site_id && (
              <div className="rounded-lg border border-slate-300/60 bg-slate-200/30 dark:border-slate-700 dark:bg-slate-800/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500/20 text-blue-400">5</div>
                  <h4 className="text-sm font-semibold">Discover Powerwall</h4>
                </div>
                <p className="text-xs text-slate-400 mb-2">Find your Powerwall energy site on your Tesla account.</p>
                <button onClick={handleDiscoverSite} disabled={!!connectLoading} className="btn-primary text-sm">
                  {connectLoading === 'discover' ? 'Discovering...' : 'Discover Site'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 3: Location */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-4.5 h-4.5 text-blue-400" />
          <h3 className="font-semibold">Location</h3>
          {setupStatus?.has_location && (
            <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" /> Set
            </span>
          )}
        </div>

        <p className="text-sm text-slate-400 mb-4">
          Your location is used for solar generation forecasts and sunrise/sunset timing.
        </p>

        {locationError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 text-sm text-red-400">
            {locationError}
          </div>
        )}
        {locationSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-3 text-sm text-emerald-400">
            {locationSuccess}
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            className="input flex-1"
            placeholder="Enter your address (e.g., 123 Main St, Austin, TX)"
            value={address}
            onChange={(e) => { setAddress(e.target.value); setGeocodeResult(null); setLocationSuccess('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleGeocode() }}
          />
          <button
            onClick={handleGeocode}
            disabled={geocoding || !address.trim()}
            className="btn-primary flex items-center gap-2"
          >
            {geocoding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Look Up
          </button>
        </div>

        {geocodeResult && (
          <div className="bg-slate-200/50 dark:bg-slate-800 rounded-lg p-4 mb-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">{geocodeResult.display_name}</p>
            <div className="flex gap-6 text-sm text-slate-400 mb-3">
              <span>Lat: {geocodeResult.latitude.toFixed(4)}</span>
              <span>Lon: {geocodeResult.longitude.toFixed(4)}</span>
              <span>Timezone: {geocodeResult.timezone}</span>
            </div>
            <button
              onClick={handleSaveLocation}
              disabled={locationSaving}
              className="btn-success text-sm"
            >
              {locationSaving ? 'Saving...' : 'Use This Location'}
            </button>
          </div>
        )}

        {/* Show current location if set */}
        {setupData?.latitude && setupData.latitude !== 0 && !geocodeResult && (
          <div className="bg-slate-200/50 dark:bg-slate-800/50 rounded-lg p-3 text-sm text-slate-500 dark:text-slate-400">
            <p>Current: {setupData.address || `${setupData.latitude.toFixed(4)}, ${setupData.longitude.toFixed(4)}`}</p>
            <p className="text-xs text-slate-600 mt-1">Timezone: {setupData.timezone || 'Auto-detected'}</p>
          </div>
        )}
      </div>

      {/* Solar Configuration */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Sun className="w-4.5 h-4.5 text-amber-400" />
          <h3 className="font-semibold">Solar Panel Configuration</h3>
          {solarConfig?.configured && (
            <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" /> Configured
            </span>
          )}
        </div>

        <p className="text-sm text-slate-400 mb-4">
          Configure your solar array for accurate generation forecasts. Check your installation documents or Tesla app for these values.
        </p>

        {solarError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 text-sm text-red-400">{solarError}</div>
        )}
        {solarSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-3 text-sm text-emerald-400">{solarSuccess}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">
              Array Size (kW DC)
              <span className="text-slate-600 ml-1">- total panel capacity</span>
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              className="input w-full"
              placeholder="e.g., 11.5"
              value={solarCapacity || ''}
              onChange={(e) => setSolarCapacity(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">
              Panel Tilt (degrees)
              <span className="text-slate-600 ml-1">- 0=flat, 90=vertical</span>
            </label>
            <input
              type="number"
              step="1"
              min="0"
              max="90"
              className="input w-full"
              value={solarTilt}
              onChange={(e) => setSolarTilt(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">
              Panel Azimuth (degrees)
            </label>
            <select
              className="select w-full"
              value={solarAzimuth}
              onChange={(e) => setSolarAzimuth(Number(e.target.value))}
            >
              <option value="0">South (0°) - most common</option>
              <option value="-45">South-East (-45°)</option>
              <option value="45">South-West (45°)</option>
              <option value="-90">East (-90°)</option>
              <option value="90">West (90°)</option>
              <option value="-135">North-East (-135°)</option>
              <option value="135">North-West (135°)</option>
              <option value="180">North (180°)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">
              DC/AC Ratio
              <span className="text-slate-600 ml-1">- panels to inverter ratio</span>
            </label>
            <input
              type="number"
              step="0.05"
              min="0.5"
              max="2.0"
              className="input w-full"
              value={solarDcAc}
              onChange={(e) => setSolarDcAc(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">
              Inverter Efficiency
              <span className="text-slate-600 ml-1">- typically 0.95-0.98</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0.8"
              max="1.0"
              className="input w-full"
              value={solarInverterEff}
              onChange={(e) => setSolarInverterEff(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">
              System Losses (%)
              <span className="text-slate-600 ml-1">- wiring, soiling, shading</span>
            </label>
            <input
              type="number"
              step="1"
              min="0"
              max="50"
              className="input w-full"
              value={solarLosses}
              onChange={(e) => setSolarLosses(Number(e.target.value))}
            />
          </div>
        </div>

        <button
          onClick={handleSaveSolar}
          disabled={solarSaving || !solarCapacity}
          className="btn-primary mt-4"
        >
          {solarSaving ? 'Saving & Refreshing Forecast...' : 'Save Solar Configuration'}
        </button>
      </div>

      {/* GridMind Optimize */}
      {authStatus?.authenticated && (
        <div className={`card transition-all ${
          optimizeEnabled
            ? 'border-emerald-500/50 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-500/40 ring-1 ring-emerald-500/20'
            : ''
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className={`w-4.5 h-4.5 ${optimizeEnabled ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`} />
              <h3 className="font-semibold">GridMind Optimize</h3>
              {!optimizeEnabled && (
                <span className="text-[10px] bg-slate-200/60 text-slate-500 dark:bg-slate-800 dark:text-slate-500 px-1.5 py-0.5 rounded font-medium">OFF</span>
              )}
            </div>
            {optimizeEnabled && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                optimizeStatus?.phase === 'dumping'
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 animate-pulse'
                  : optimizeStatus?.phase === 'peak_hold'
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                  : optimizeStatus?.phase === 'complete'
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              }`}>
                {optimizeStatus?.phase === 'dumping' ? 'Dumping to Grid' :
                 optimizeStatus?.phase === 'peak_hold' ? 'Holding Battery' :
                 optimizeStatus?.phase === 'complete' ? 'Peak Complete' : 'Enabled — Waiting for Peak'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Smart peak export strategy. Holds battery during peak hours, then intelligently dumps to grid
            for maximum export credits before peak ends. Timing adapts daily based on battery level, home
            load, and time remaining.
          </p>

          {optimizeEnabled && optimizeStatus?.last_calculation && (
            <div className="bg-emerald-50/50 dark:bg-slate-800/50 border border-emerald-200/30 dark:border-slate-700/50 rounded-lg p-3 mb-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Phase</span>
                <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">{optimizeStatus.phase}</span>
              </div>
              {optimizeStatus.last_calculation.available_kwh !== undefined && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Available to dump</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{optimizeStatus.last_calculation.available_kwh} kWh</span>
                </div>
              )}
              {optimizeStatus.last_calculation.minutes_needed !== undefined && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Time needed</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{optimizeStatus.last_calculation.minutes_needed} min</span>
                </div>
              )}
              {optimizeStatus.last_calculation.minutes_remaining !== undefined && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Peak time remaining</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{optimizeStatus.last_calculation.minutes_remaining} min</span>
                </div>
              )}
              {optimizeStatus.estimated_finish && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Estimated dump finish</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{optimizeStatus.estimated_finish}</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Peak Start</label>
              <select className="select w-full text-sm" value={optimizePeakStart}
                onChange={(e) => setOptimizePeakStart(Number(e.target.value))} disabled={optimizeEnabled}>
                {Array.from({length: 24}, (_, i) => (
                  <option key={i} value={i}>{i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i-12}:00 PM`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Peak End</label>
              <select className="select w-full text-sm" value={optimizePeakEnd}
                onChange={(e) => setOptimizePeakEnd(Number(e.target.value))} disabled={optimizeEnabled}>
                {Array.from({length: 24}, (_, i) => (
                  <option key={i} value={i}>{i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i-12}:00 PM`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Buffer (min)</label>
              <input type="number" className="input w-full text-sm" value={optimizeBuffer} min={5} max={60}
                onChange={(e) => setOptimizeBuffer(Number(e.target.value))} disabled={optimizeEnabled} />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Min Reserve %</label>
              <input type="number" className="input w-full text-sm" value={optimizeMinReserve} min={0} max={50}
                onChange={(e) => setOptimizeMinReserve(Number(e.target.value))} disabled={optimizeEnabled} />
            </div>
          </div>

          <button
            onClick={handleToggleOptimize}
            disabled={saving === 'optimize'}
            className={`w-full ${optimizeEnabled
              ? 'btn bg-slate-200/80 hover:bg-slate-300/80 text-slate-600 border border-slate-300/40 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-300 dark:border-transparent'
              : 'btn bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500'
            }`}
          >
            {saving === 'optimize' ? 'Switching...' :
              optimizeEnabled ? 'Disable GridMind Optimize' :
              <span className="flex items-center justify-center gap-2"><Zap className="w-4 h-4" /> Enable GridMind Optimize</span>}
          </button>
        </div>
      )}

      {/* Off-Grid Mode */}
      {authStatus?.authenticated && (
        <div className={`card ${
          offgridActive
            ? 'border-red-500/50 bg-red-50/50 dark:bg-red-950/30 dark:border-red-500/40'
            : 'border-red-300/30 dark:border-red-900/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4.5 h-4.5 text-red-500" />
              <h3 className="font-semibold text-red-700 dark:text-red-400">Off-Grid Mode</h3>
            </div>
            {offgridActive && (
              <span className="text-xs bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full font-medium animate-pulse">Active</span>
            )}
          </div>
          <p className="text-xs text-red-600/70 dark:text-red-400/60 mb-3">
            Disconnects from the grid. Solar and battery power your home exclusively. Use with caution.
          </p>
          <button
            onClick={handleToggleOffgrid}
            disabled={saving === 'offgrid'}
            className={`w-full ${offgridActive
              ? 'btn bg-red-600 hover:bg-red-700 text-white'
              : 'btn bg-red-100 hover:bg-red-200 text-red-700 border border-red-300/50 dark:bg-red-600/20 dark:hover:bg-red-600/30 dark:text-red-400 dark:border-red-600/30'
            }`}
          >
            {saving === 'offgrid' ? 'Switching...' : offgridActive ? 'Disable Off-Grid Mode' : 'Enable Off-Grid Mode'}
          </button>
        </div>
      )}

      {/* Manual Controls */}
      {authStatus?.authenticated && (
        <div className={`card ${modeStatus && !modeStatus.manual_allowed ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-2 mb-4">
            <Sliders className="w-4.5 h-4.5 text-blue-400" />
            <h3 className="font-semibold">Manual Control</h3>
          </div>

          {modeStatus && !modeStatus.manual_allowed && (
            <div className="bg-amber-100/80 dark:bg-amber-500/10 border border-amber-300/50 dark:border-amber-500/30 rounded-lg p-3 mb-4 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Manual controls locked: {modeStatus.block_reason}. Disable the active mode to make changes.</span>
            </div>
          )}

          <div className="space-y-4">
            {/* Operation Mode */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Operation Mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSetMode('self_consumption')}
                  disabled={saving === 'mode'}
                  className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors ${
                    mode === 'self_consumption'
                      ? 'bg-slate-700 text-white dark:bg-blue-600'
                      : 'bg-slate-200/80 text-slate-500 hover:bg-slate-300/80 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                  }`}
                >
                  Self-Powered
                </button>
                <button
                  onClick={() => handleSetMode('autonomous')}
                  disabled={saving === 'mode'}
                  className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors ${
                    mode === 'autonomous'
                      ? 'bg-slate-700 text-white dark:bg-blue-600'
                      : 'bg-slate-200/80 text-slate-500 hover:bg-slate-300/80 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                  }`}
                >
                  Time-Based Control
                </button>
              </div>
            </div>

            {/* Backup Reserve */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">
                Backup Reserve: <span className="font-bold text-white">{reserve}%</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={reserve}
                  onChange={(e) => setReserve(Number(e.target.value))}
                  className="flex-1 accent-blue-500"
                />
                <button
                  onClick={handleSetReserve}
                  disabled={saving === 'reserve'}
                  className="btn-primary text-sm"
                >
                  {saving === 'reserve' ? 'Saving...' : 'Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-4 h-4 text-blue-400" />
          <span className="card-header mb-0">Notifications</span>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Get notified about grid outages, optimizer activity, and automation events via email or webhooks (Slack/Discord).
        </p>
        <NotificationConfig />
      </div>

      {/* System Investment */}
      <div className="card">
        <div className="card-header">System Investment</div>
        <p className="text-xs text-slate-500 mb-4">
          Enter the total cost of your solar + battery system to track break-even progress on the Value page.
        </p>
        <SystemCostConfig />
      </div>

      {/* OpenAI Configuration */}
      <div className="card">
        <div className="card-header">AI Insights (OpenAI)</div>
        <p className="text-xs text-slate-500 mb-4">
          Add your OpenAI API key to enable AI-powered energy insights and anomaly detection on the dashboard.
        </p>
        <AIKeyConfig />
      </div>

      {/* EIA Grid Mix Configuration */}
      <div className="card">
        <div className="card-header">Grid Energy Sources (EIA)</div>
        <p className="text-xs text-slate-500 mb-4">
          Add a free EIA API key to see real-time grid fuel mix (hydro, wind, solar, gas, etc.) on the Dashboard and Grid page.
          Your balancing authority region is auto-detected from your location, or you can override it manually.
        </p>
        <EIAConfig />
      </div>

      {/* Site Info */}
      {siteConfig && (
        <div className="card">
          <div className="card-header">Site Information</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Site Name</span>
              <p className="font-medium">{siteConfig.site_name || 'N/A'}</p>
            </div>
            <div>
              <span className="text-slate-500">Battery</span>
              <p className="font-medium">{siteConfig.battery_description || `${siteConfig.battery_count} units`}</p>
            </div>
            <div>
              <span className="text-slate-500">Storage Capacity</span>
              <p className="font-medium">{siteConfig.total_capacity_kwh ? `${siteConfig.total_capacity_kwh} kWh` : 'N/A'}</p>
            </div>
            <div>
              <span className="text-slate-500">Max Power Output</span>
              <p className="font-medium">{siteConfig.nameplate_power_kw ? `${siteConfig.nameplate_power_kw} kW` : 'N/A'}</p>
            </div>
            <div>
              <span className="text-slate-500">Storm Watch Mode</span>
              <p className="font-medium">{siteConfig.storm_mode_enabled ? 'Enabled' : 'Disabled'}</p>
            </div>
            {siteConfig.firmware_version && (
              <div>
                <span className="text-slate-500">Powerwall Firmware</span>
                <p className="font-medium font-mono text-xs mt-0.5">{siteConfig.firmware_version}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Support */}
      <div className="card text-center py-6">
        <p className="text-sm text-slate-500 mb-3">Enjoying GridMind? Consider supporting the project.</p>
        <a
          href="https://buymeacoffee.com/smidley"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-400 hover:bg-amber-500 text-slate-900 font-medium text-sm rounded-lg transition-colors"
        >
          <span>☕</span>
          Buy Me a Coffee
        </a>
      </div>
    </div>
  )
}
