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
 */
class WebSocketManager {
  private ws: WebSocket | null = null
  private reconnectTimer: number | undefined
  private disposed = false
  private refCount = 0

  status: PowerwallStatus | null = null
  vehicleStatus: VehicleStatus | null = null
  connected = false

  private listeners = new Set<() => void>()

  constructor() {
    // Reconnect when page becomes visible (phone unlock, tab switch)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.refCount > 0) {
        // Check if WS is still alive, reconnect if not
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
          this.connect()
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
        this.notify()
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data._type === 'vehicle') {
            this.vehicleStatus = data
          } else {
            this.status = data
          }
          this.notify()
        } catch {
          // Ignore non-JSON (pong)
        }
      }

      ws.onclose = () => {
        this.connected = false
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
    next.connected !== cachedSnapshot.connected
  ) {
    cachedSnapshot = next
  }
  return cachedSnapshot
}

export function useWebSocket() {
  const snapshot = useSyncExternalStore(wsManager.subscribe, getSnapshot)
  return snapshot
}
