import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = '/api'

/**
 * Like useApi but auto-refreshes at a specified interval.
 * Perfect for data that changes frequently (energy totals, value).
 *
 * Reliability features:
 *  - Pauses the interval when the tab is hidden (saves requests)
 *  - Immediately fetches + restarts the interval when the tab becomes visible
 *  - Uses AbortController to cancel in-flight requests on unmount
 */
export function useAutoRefresh<T = any>(path: string, intervalMs: number = 30000) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const intervalRef = useRef<number | undefined>(undefined)
  const intervalMsRef = useRef(intervalMs)
  intervalMsRef.current = intervalMs

  const fetchData = useCallback(async (showLoading = false) => {
    // Cancel any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (showLoading) setLoading(true)
    try {
      const response = await fetch(`${API_BASE}${pathRef.current}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const result = await response.json()
      if (mountedRef.current) {
        setData(result)
        setError(null)
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return // Cancelled, ignore
      if (mountedRef.current) setError(e.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = window.setInterval(() => fetchData(false), intervalMsRef.current)
  }, [fetchData])

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = undefined
    }
  }, [])

  // Initial fetch + cleanup
  useEffect(() => {
    mountedRef.current = true
    fetchData(true)
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      stopInterval()
    }
  }, [path])

  // Start the auto-refresh interval
  useEffect(() => {
    startInterval()
    return () => stopInterval()
  }, [startInterval, stopInterval])

  // Pause when hidden, resume + fetch when visible
  useEffect(() => {
    const onVisibility = () => {
      if (!mountedRef.current) return
      if (document.visibilityState === 'visible') {
        // Tab is back — fetch immediately and restart the interval on a fresh cadence
        fetchData(false)
        startInterval()
      } else {
        // Tab hidden — stop polling to save requests
        stopInterval()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [fetchData, startInterval, stopInterval])

  return { data, loading, error, refetch: () => fetchData(true) }
}
