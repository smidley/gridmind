import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = '/api'

/** Read the CSRF token from the cookie for state-changing requests. */
function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)gridmind_csrf_token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export async function apiFetch<T = any>(
  path: string,
  options?: RequestInit
): Promise<T> {
  // Include CSRF token header for state-changing methods
  const method = options?.method?.toUpperCase() || 'GET'
  const csrfHeaders: Record<string, string> = {}
  if (method !== 'GET' && method !== 'HEAD') {
    const token = getCsrfToken()
    if (token) csrfHeaders['X-CSRF-Token'] = token
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders,
      ...options?.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(error.detail || `API error: ${response.status}`)
  }

  return response.json()
}

export function useApi<T = any>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<T>(pathRef.current)
      setData(result)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Refetch whenever path changes
  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)
    apiFetch<T>(path)
      .then(result => { if (!cancelled) setData(result) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [path])

  return { data, loading, error, refetch }
}
