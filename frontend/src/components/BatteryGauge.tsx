import { useEffect, useRef } from 'react'

interface Props {
  soc: number
  power: number
  reserve: number
  description?: string
  capacityKwh?: number
  maxPowerKw?: number
}

export default function BatteryGauge({ soc, power, reserve, description, capacityKwh, maxPowerKw }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const particlesRef = useRef<{ x: number; speed: number; size: number; opacity: number }[]>([])

  // Tesla convention: negative = charging (into battery), positive = discharging (out of battery)
  const charging = power < -50
  const discharging = power > 50
  const active = charging || discharging

  // Color based on SOC level
  const getBarHex = () => {
    if (soc <= 10) return '#ef4444'   // red
    if (soc <= 20) return '#f97316'   // orange
    if (soc <= 40) return '#f59e0b'   // amber
    if (soc <= 60) return '#eab308'   // yellow
    if (soc <= 80) return '#84cc16'   // lime
    return '#10b981'                   // emerald
  }

  const getBarClass = () => {
    if (soc <= 10) return 'bg-red-500'
    if (soc <= 20) return 'bg-orange-500'
    if (soc <= 40) return 'bg-amber-500'
    if (soc <= 60) return 'bg-yellow-500'
    if (soc <= 80) return 'bg-lime-500'
    return 'bg-emerald-500'
  }

  const barHex = getBarHex()

  // Particle animation on the battery bar
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect) return

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const w = rect.width
    const h = rect.height
    const fillWidth = (soc / 100) * w

    const maxP = (maxPowerKw || 11.5) * 1000
    const intensity = Math.min(Math.abs(power) / maxP, 1)
    const targetCount = active ? Math.max(Math.round(3 + intensity * 12), 4) : 0

    function animate() {
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)

      if (!active) {
        animRef.current = requestAnimationFrame(animate)
        return
      }

      let particles = particlesRef.current

      // Spawn particles
      while (particles.length < targetCount) {
        particles.push({
          x: charging ? fillWidth + Math.random() * 10 : Math.random() * 10 - 10,
          speed: (1.5 + Math.random() * 2 + intensity * 3) * (charging ? -1 : 1),
          size: 3 + Math.random() * 3 + intensity * 2,
          opacity: 0.5 + Math.random() * 0.5,
        })
      }

      // Trim
      if (particles.length > targetCount + 2) {
        particles = particles.slice(0, targetCount)
      }

      // Parse bar color
      const hex = barHex
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)

      particles = particles.filter(p => {
        p.x += p.speed

        // Remove if out of bounds
        if (charging && p.x < -10) return false
        if (discharging && p.x > fillWidth + 10) return false

        // Only draw within the fill area
        if (p.x < 0 || p.x > fillWidth) return true

        const alpha = p.opacity * Math.min(
          p.x / 20,
          (fillWidth - p.x) / 20,
          1
        )

        // Outer glow
        const grad1 = ctx.createRadialGradient(p.x, h / 2, 0, p.x, h / 2, p.size * 3)
        grad1.addColorStop(0, `rgba(255,255,255,${alpha * 0.4})`)
        grad1.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.3})`)
        grad1.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(p.x, h / 2, p.size * 3, 0, Math.PI * 2)
        ctx.fillStyle = grad1
        ctx.fill()

        // Bright core
        const grad2 = ctx.createRadialGradient(p.x, h / 2, 0, p.x, h / 2, p.size)
        grad2.addColorStop(0, `rgba(255,255,255,${alpha * 0.9})`)
        grad2.addColorStop(0.6, `rgba(${r},${g},${b},${alpha * 0.6})`)
        grad2.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(p.x, h / 2, p.size, 0, Math.PI * 2)
        ctx.fillStyle = grad2
        ctx.fill()

        return true
      })

      particlesRef.current = particles
      animRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => cancelAnimationFrame(animRef.current)
  }, [soc, power, active, charging, discharging, barHex, maxPowerKw])

  // Calculate available energy
  const availableKwh = capacityKwh ? (soc / 100) * capacityKwh : null
  const usableKwh = capacityKwh ? ((soc - reserve) / 100) * capacityKwh : null

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <div className="card-header mb-0">Battery</div>
        {description && (
          <span className="text-[10px] text-slate-600 font-medium">{description}</span>
        )}
      </div>

      {/* Battery visual */}
      <div className="relative w-full h-10 bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
        {/* Fill bar */}
        <div
          className={`absolute top-0 bottom-0 left-0 transition-all duration-1000 ${getBarClass()}`}
          style={{ width: `${soc}%` }}
        />

        {/* Particle canvas overlay */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none"
        />

        {/* Reserve hatched overlay */}
        {reserve > 0 && (
          <svg
            className="absolute top-0 left-0 h-full"
            style={{ width: `${reserve}%` }}
            preserveAspectRatio="none"
          >
            <defs>
              <pattern id="reserveHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="rgba(0,0,0,0.35)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(239,68,68,0.5)" strokeWidth="3" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#reserveHatch)" />
          </svg>
        )}

        {/* Reserve boundary line */}
        {reserve > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-400/70"
            style={{ left: `${reserve}%` }}
          />
        )}

        {/* SOC label */}
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white drop-shadow-lg">
          {soc.toFixed(1)}%
        </div>
      </div>

      <div className="flex justify-between mt-3 text-sm">
        <span className={
          charging ? 'text-emerald-400' : discharging ? 'text-blue-400' : 'text-slate-400'
        }>
          {charging ? 'Charging' : discharging ? 'Discharging' : 'Idle'}
        </span>
        <span className={`font-medium ${
          charging ? 'text-emerald-400' : discharging ? 'text-blue-400' : 'text-slate-500'
        }`}>
          {Math.abs(power) >= 1000
            ? `${(Math.abs(power) / 1000).toFixed(1)} kW`
            : `${Math.round(Math.abs(power))} W`}
        </span>
      </div>

      <div className="flex justify-between mt-1 text-xs text-slate-500">
        <span>Reserve: {reserve}%</span>
        {capacityKwh ? (
          <span>
            {availableKwh !== null ? `${availableKwh.toFixed(1)}` : '—'} / {capacityKwh} kWh
            {usableKwh !== null && usableKwh > 0 && (
              <span className="text-slate-600"> ({usableKwh.toFixed(1)} usable)</span>
            )}
          </span>
        ) : null}
      </div>
      {maxPowerKw ? (
        <div className="text-xs text-slate-600 mt-0.5">
          Max output: {maxPowerKw} kW
        </div>
      ) : null}
    </div>
  )
}
