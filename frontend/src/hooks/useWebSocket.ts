import { useEffect, useSyncExternalStore, useCallback } from 'react'

export interface PowerwallStatus {
  timestamp: string
  battery_soc: number
  battery_power: number
  solar_power: number
  grid_power: number
  home_power: number
  grid_status: string
  operation_mode: string
  backup_reserve: number
  storm_mode: boolean
  wall_connector_power: number  // Watts drawn by Wall Connector (from Powerwall live_status)
  wall_connector_state: number  // WC state code (0-1=idle, 2=online, 4+=car connected)
}

export interface VehicleChargeState {
  battery_level: number
  battery_range: number
  charging_state: string
  charge_limit_soc: number
  charge_rate: number
  charger_power: number
  charger_voltage: number
  charger_actual_current: number
  time_to_full_charge: number
  charge_energy_added: number
  charge_miles_added_rated: number
  conn_charge_cable: string
  fast_charger_present: boolean
  charge_current_request: number
  charge_current_request_max: number
  charger_phases: number | null
}

export interface VehicleStatus {
  timestamp: string
  vehicle: {
    id: string
    vehicle_id: string
    display_name: string
    state: string
    vin: string
  }
  charge_state: VehicleChargeState
}

/**
 * Singleton WebSocket manager.
 * One connection shared across all components. No duplicate sockets,
 * no reconnection leaks on unmount.
 *
 * Reliability features:
 *  - Heartbeat: sends "ping" every 15s, force-reconnects if no data for 20s
 *  - Immediate fetch: grabs /api/status on reconnect to bridge the gap
 *  - Visibility-aware: reconnects when the tab/PWA becomes visible
 *  - lastDataTime: tracks when data was last received (for staleness UI)
 */
class WebSocketManager {
  private ws: WebSocket | null = null
  private reconnectTimer: number | undefined
  private pingTimer: number | undefined
  private disposed = false
  private refCount = 0
  private lastMessageAt = 0  // epoch ms of last received WS message or API fetch

  status: PowerwallStatus | null = null
  vehicleStatus: VehicleStatus | null = null
  connected = false
  lastDataTime = 0  // exposed for freshness indicator

  private listeners = new Set<() => void>()

  constructor() {
    // Reconnect when page becomes visible (phone unlock, tab switch)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.refCount > 0) {
        // Check if WS is still alive, reconnect if not
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
          this.connect()
        } else if (Date.now() - this.lastMessageAt > 20_000) {
          // WS appears open but no data received recently — likely a zombie connection
          this.ws.close()
          // onclose handler will trigger reconnect
        } else {
          // WS is alive — fetch latest status to refresh immediately
          this.fetchLatestStatus()
        }
      }
    })
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    this.refCount++
    if (this.refCount === 1) this.connect()
    return () => {
      this.listeners.delete(listener)
      this.refCount--
      if (this.refCount <= 0) {
        this.refCount = 0
        // Delay disconnect so navigating between pages doesn't flicker
        setTimeout(() => {
          if (this.refCount <= 0) this.disconnect()
        }, 2000)
      }
    }
  }

  private notify() {
    this.listeners.forEach(l => l())
  }

  /** Fetch Powerwall status via HTTP to bridge gaps. Safe to call freely (no car wake). */
  private async fetchLatestStatus() {
    try {
      const resp = await fetch('/api/status', { credentials: 'include' })
      if (resp.ok) {
        const data = await resp.json()
        if (data && 'battery_soc' in data) {
          this.status = data
          this.lastDataTime = Date.now()
          this.lastMessageAt = Date.now()
          this.notify()
        }
      }
    } catch {
      // Silently fail — WS will deliver data when it reconnects
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    // Send ping every 15 seconds
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.send('ping') } catch { /* ignore */ }

        // If no message received for 20 seconds, the connection is likely dead
        if (Date.now() - this.lastMessageAt > 20_000) {
          this.ws?.close()  // Triggers onclose → reconnect
        }
      }
    }, 15_000)
  }

  private stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = undefined
    }
  }

  private connect = () => {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.disposed = false

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    try {
      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.onopen = () => {
        this.connected = true
        this.lastMessageAt = Date.now()
        this.startHeartbeat()
        this.notify()
        // Immediately fetch latest Powerwall status to bridge the gap
        // (next WS push may be up to 30s away)
        this.fetchLatestStatus()
      }

      ws.onmessage = (event) => {
        this.lastMessageAt = Date.now()
        try {
          const data = JSON.parse(event.data)
          if (data._type === 'vehicle') {
            this.vehicleStatus = data
          } else {
            this.status = data
            this.lastDataTime = Date.now()
          }
          this.notify()
        } catch {
          // Non-JSON (pong) — still counts as activity for heartbeat
        }
      }

      ws.onclose = () => {
        this.connected = false
        this.stopHeartbeat()
        this.notify()
        // Only reconnect if not disposed and still have subscribers
        if (!this.disposed && this.refCount > 0) {
          this.reconnectTimer = window.setTimeout(this.connect, 3000)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      if (!this.disposed && this.refCount > 0) {
        this.reconnectTimer = window.setTimeout(this.connect, 5000)
      }
    }
  }

  private disconnect() {
    this.disposed = true
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    if (this.ws) {
      this.ws.onclose = null // Prevent reconnection from onclose
      this.ws.close()
      this.ws = null
    }
    this.connected = false
  }

  getSnapshot = () => ({
    status: this.status,
    vehicleStatus: this.vehicleStatus,
    connected: this.connected,
    lastDataTime: this.lastDataTime,
  })
}

// Single global instance
const wsManager = new WebSocketManager()

// Stable snapshot reference — only changes when data changes
let cachedSnapshot = wsManager.getSnapshot()
function getSnapshot() {
  const next = wsManager.getSnapshot()
  if (
    next.status !== cachedSnapshot.status ||
    next.vehicleStatus !== cachedSnapshot.vehicleStatus ||
    next.connected !== cachedSnapshot.connected ||
    next.lastDataTime !== cachedSnapshot.lastDataTime
  ) {
    cachedSnapshot = next
  }
  return cachedSnapshot
}

export function useWebSocket() {
  const snapshot = useSyncExternalStore(wsManager.subscribe, getSnapshot)
  return snapshot
}
