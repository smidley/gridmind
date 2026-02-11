/** Shared Recharts tooltip/chart styles that work in both light and dark mode */
export function getTooltipStyle() {
  const isDark = document.documentElement.classList.contains('dark')
  return {
    backgroundColor: isDark ? '#0f172a' : '#ffffff',
    border: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
    borderRadius: '8px',
    fontSize: '12px',
    color: isDark ? '#e2e8f0' : '#1e293b',
  }
}

export function getGridColor() {
  return document.documentElement.classList.contains('dark') ? '#1e293b' : '#e2e8f0'
}

export function getAxisColor() {
  return document.documentElement.classList.contains('dark') ? '#475569' : '#94a3b8'
}

export function getCursorStyle() {
  return { fill: document.documentElement.classList.contains('dark') ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }
}
