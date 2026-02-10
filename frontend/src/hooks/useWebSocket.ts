import { useEffect, useRef, useState, useCallback } from 'react'

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
}

export function useWebSocket() {
  const [status, setStatus] = useState<PowerwallStatus | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number>()

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        console.log('WebSocket connected')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          setStatus(data)
        } catch (e) {
          // Ignore non-JSON messages (like pong)
        }
      }

      ws.onclose = () => {
        setConnected(false)
        // Reconnect after 3 seconds
        reconnectTimer.current = window.setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch (e) {
      // Reconnect on error
      reconnectTimer.current = window.setTimeout(connect, 5000)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [connect])

  return { status, connected }
}
