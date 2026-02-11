import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = '/api'

/**
 * Like useApi but auto-refreshes at a specified interval.
 * Perfect for data that changes frequently (energy totals, value).
 */
export function useAutoRefresh<T = any>(path: string, intervalMs: number = 30000) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path

  const fetchData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const response = await fetch(`${API_BASE}${pathRef.current}`, {
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const result = await response.json()
      setData(result)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchData(true)
  }, [path])

  // Auto-refresh interval
  useEffect(() => {
    const timer = setInterval(() => fetchData(false), intervalMs)
    return () => clearInterval(timer)
  }, [fetchData, intervalMs])

  return { data, loading, error, refetch: () => fetchData(true) }
}
