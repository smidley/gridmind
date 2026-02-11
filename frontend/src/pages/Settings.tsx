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
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-slate-500" />
            </div>
            <p className="text-sm text-slate-500">Enter your Tesla API credentials above first.</p>
          </div>
        ) : (
          /* Step-by-step setup */
          <div className="space-y-4">

            {/* Step A: Generate Keys */}
            <div className={`rounded-lg border p-4 ${publicKey ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-slate-700 bg-slate-800/50'}`}>
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
              <div className={`rounded-lg border p-4 ${authStatus?.authenticated ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-slate-700 bg-slate-800/50'}`}>
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
                        <li>Go to your GitHub Pages repo (e.g., <code className="text-slate-300">username.github.io</code>)</li>
                        <li>Create a file at <code className="text-slate-300">.well-known/appspecific/com.tesla.3p.public-key.pem</code></li>
                        <li>Paste the public key content below into that file</li>
                        <li>Add an empty <code className="text-slate-300">.nojekyll</code> file in the repo root (so GitHub serves dotfiles)</li>
                        <li>Verify it's live at <code className="text-slate-300">https://username.github.io/.well-known/appspecific/com.tesla.3p.public-key.pem</code></li>
                      </ol>
                    </details>
                    <div className="relative">
                      <pre className="bg-slate-900 p-3 rounded text-xs text-slate-300 font-mono overflow-x-auto">{publicKey}</pre>
                      <button
                        onClick={() => { navigator.clipboard.writeText(publicKey); setConnectSuccess('Public key copied to clipboard!'); setTimeout(() => setConnectSuccess(''), 2000) }}
                        className="absolute top-2 right-2 text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-slate-300"
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
              <div className={`rounded-lg border p-4 ${connectSuccess.includes('registered') || connectSuccess.includes('Registered') ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-slate-700 bg-slate-800/50'}`}>
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
              <div className={`rounded-lg border p-4 ${authStatus?.authenticated ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-slate-700 bg-slate-800/50'}`}>
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
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
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
              <span className="text-slate-500">Battery</span>
              <p className="font-medium">{siteConfig.battery_description || `${siteConfig.battery_count} units`}</p>
            </div>
            <div>
              <span className="text-slate-500">Capacity</span>
              <p className="font-medium">{siteConfig.total_capacity_kwh ? `${siteConfig.total_capacity_kwh} kWh / ${siteConfig.nameplate_power_kw} kW` : 'N/A'}</p>
            </div>
            <div>
              <span className="text-slate-500">Storm Mode</span>
              <p className="font-medium">{siteConfig.storm_mode_enabled ? 'Enabled' : 'Disabled'}</p>
            </div>
            {siteConfig.firmware_version && (
              <div>
                <span className="text-slate-500">Firmware</span>
                <p className="font-medium font-mono text-xs mt-0.5">{siteConfig.firmware_version}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
