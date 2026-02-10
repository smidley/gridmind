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
} from 'lucide-react'
import { useApi, apiFetch } from '../hooks/useApi'

export default function SettingsPage() {
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
    }
  }, [setupData])

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
          {authStatus?.authenticated && (
            <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" /> Connected
            </span>
          )}
        </div>

        {authStatus?.authenticated ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="font-medium text-emerald-400">Connected to Tesla</p>
              <p className="text-sm text-slate-500">
                Site ID: {authStatus.energy_site_id || 'Auto-detecting...'}
              </p>
            </div>
          </div>
        ) : setupStatus?.has_credentials ? (
          <div>
            <p className="text-sm text-slate-400 mb-3">
              Credentials are configured. Click below to authorize GridMind with your Tesla account.
            </p>
            {authStatus?.auth_url ? (
              <a href={authStatus.auth_url} className="btn-primary inline-flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Connect Tesla Account
              </a>
            ) : (
              <button onClick={refetchAuth} className="btn-secondary">
                Refresh Auth Status
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-slate-500" />
            </div>
            <p className="text-sm text-slate-500">
              Enter your Tesla API credentials above first.
            </p>
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
          <div className="bg-slate-800 rounded-lg p-4 mb-3">
            <p className="text-sm font-medium text-slate-200 mb-2">{geocodeResult.display_name}</p>
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
          <div className="bg-slate-800/50 rounded-lg p-3 text-sm text-slate-400">
            <p>Current: {setupData.address || `${setupData.latitude.toFixed(4)}, ${setupData.longitude.toFixed(4)}`}</p>
            <p className="text-xs text-slate-600 mt-1">Timezone: {setupData.timezone || 'Auto-detected'}</p>
          </div>
        )}
      </div>

      {/* Manual Controls */}
      {authStatus?.authenticated && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Sliders className="w-4.5 h-4.5 text-blue-400" />
            <h3 className="font-semibold">Manual Control</h3>
          </div>

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
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  Self-Powered
                </button>
                <button
                  onClick={() => handleSetMode('autonomous')}
                  disabled={saving === 'mode'}
                  className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors ${
                    mode === 'autonomous'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
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
              <span className="text-slate-500">Battery Count</span>
              <p className="font-medium">{siteConfig.battery_count || 'N/A'}</p>
            </div>
            <div>
              <span className="text-slate-500">Storm Mode</span>
              <p className="font-medium">{siteConfig.storm_mode_enabled ? 'Enabled' : 'Disabled'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
