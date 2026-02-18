import { useEffect, useRef, useState } from 'react'

interface Props {
  value: number
  format?: (v: number) => string
  duration?: number // ms, default 1500
  className?: string
}

/**
 * Smoothly animates between numeric values using requestAnimationFrame.
 * When the value prop changes, the displayed number counts up/down with easing.
 */
export default function AnimatedValue({ value, format, duration = 1500, className = '' }: Props) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef<number>(0)
  const startRef = useRef(0)
  const initialRef = useRef(true)

  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return

    cancelAnimationFrame(rafRef.current)
    startRef.current = performance.now()

    // Count up faster on initial page load (800ms), slower on subsequent updates
    const animDuration = initialRef.current ? 800 : duration
    initialRef.current = false

    const animate = (now: number) => {
      const elapsed = now - startRef.current
      const progress = Math.min(elapsed / animDuration, 1)
      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = from + (to - from) * eased
      setDisplay(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        fromRef.current = to
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  const text = format ? format(display) : display.toFixed(1)

  return (
    <span className={`tabular-nums ${className}`}>
      {text}
    </span>
  )
}
