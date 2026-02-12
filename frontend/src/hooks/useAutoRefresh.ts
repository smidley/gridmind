import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = '/api'

/**
 * Like useApi but auto-refreshes at a specified interval.
 * Perfect for data that changes frequently (energy totals, value).
 * Uses AbortController to cancel in-flight requests on unmount.
 */
export function useAutoRefresh<T = any>(path: string, intervalMs: number = 30000) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async (showLoading = false) => {
    // Cancel any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (showLoading) setLoading(true)
    try {
      const response = await fetch(`${API_BASE}${pathRef.current}`, {
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

  // Initial fetch + cleanup
  useEffect(() => {
    mountedRef.current = true
    fetchData(true)
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [path])

  // Auto-refresh interval
  useEffect(() => {
    const timer = setInterval(() => fetchData(false), intervalMs)
    return () => clearInterval(timer)
  }, [fetchData, intervalMs])

  return { data, loading, error, refetch: () => fetchData(true) }
}
