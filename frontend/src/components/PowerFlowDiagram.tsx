import { useEffect, useRef } from 'react'
import { Sun, Home, Zap, Battery } from 'lucide-react'
import type { PowerwallStatus } from '../hooks/useWebSocket'

interface TariffInfo {
  configured: boolean
  current_period_display?: string
  current_rate?: number
  currency?: string
}

interface Props {
  status: PowerwallStatus
  tariff?: TariffInfo | null
}

function formatPower(watts: number): string {
  const abs = Math.abs(watts)
  if (abs >= 1000) return `${(abs / 1000).toFixed(1)} kW`
  return `${Math.round(abs)} W`
}

interface Particle {
  progress: number
  speed: number
  size: number
  opacity: number
}

interface FlowPath {
  fromKey: string
  toKey: string
  color: string
  active: boolean
  watts: number
}

/** Canvas particle renderer - draws on a canvas overlaying the component */
function ParticleCanvas({ paths, nodePositions }: { paths: FlowPath[]; nodePositions: Record<string, { x: number; y: number }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Map<string, Particle[]>>(new Map())
  const animRef = useRef<number>(0)
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function resize() {
      if (!canvas || !parent || !ctx) return
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      sizeRef.current = { w: rect.width, h: rect.height }
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    window.addEventListener('resize', resize)

    function animate() {
      if (!ctx) return
      const { w, h } = sizeRef.current
      ctx.clearRect(0, 0, w, h)

      paths.forEach((path) => {
        const fromNode = nodePositions[path.fromKey]
        const toNode = nodePositions[path.toKey]
        if (!fromNode || !toNode) return

        const fromX = fromNode.x * w
        const fromY = fromNode.y * h
        const toX = toNode.x * w
        const toY = toNode.y * h

        const key = `${path.fromKey}-${path.toKey}`

        // Draw faint track
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        ctx.lineTo(toX, toY)
        ctx.strokeStyle = path.active ? 'rgba(51, 65, 85, 0.4)' : 'rgba(30, 41, 59, 0.3)'
        ctx.lineWidth = 1.5
        ctx.stroke()

        if (!path.active) {
          particlesRef.current.set(key, [])
          return
        }

        let particles = particlesRef.current.get(key) || []

        // Scale particles based on power level:
        //   < 100W  ->  2 particles (barely visible trickle)
        //   500W    ->  4 particles
        //   1000W   ->  7 particles
        //   2000W   -> 10 particles
        //   3000W   -> 13 particles
        //   5000W   -> 18 particles
        //   8000W+  -> 25 particles (max, strong flow)
        const watts = Math.abs(path.watts)
        const targetCount = Math.min(Math.max(Math.round(2 + Math.sqrt(watts) * 0.26), 2), 25)

        // Speed also scales: low power = slower drift, high power = faster rush
        const baseSpeed = 0.004 + Math.min(watts / 15000, 0.008)

        // Particle size: slightly larger at higher power
        const baseSize = 1.5 + Math.min(watts / 3000, 2)

        while (particles.length < targetCount) {
          particles.push({
            progress: Math.random(),
            speed: baseSpeed + Math.random() * baseSpeed * 0.8,
            size: baseSize + Math.random() * baseSize * 0.5,
            opacity: 0.4 + Math.random() * 0.6,
          })
        }
        // Trim excess smoothly
        if (particles.length > targetCount + 2) {
          particles = particles.slice(0, targetCount)
        }

        const dx = toX - fromX
        const dy = toY - fromY

        // Parse color
        const colorMatch = path.color.match(/(\d+),\s*(\d+),\s*(\d+)/)
        const r = colorMatch ? parseInt(colorMatch[1]) : 255
        const g = colorMatch ? parseInt(colorMatch[2]) : 255
        const b = colorMatch ? parseInt(colorMatch[3]) : 255

        particles.forEach(p => {
          p.progress += p.speed
          if (p.progress > 1) {
            p.progress -= 1
            p.speed = 0.006 + Math.random() * 0.008
            p.size = 2 + Math.random() * 2.5
            p.opacity = 0.5 + Math.random() * 0.5
          }

          const t = p.progress
          const x = fromX + dx * t
          const y = fromY + dy * t

          // Fade at edges
          const edgeFade = Math.min(t * 4, (1 - t) * 4, 1)
          const alpha = p.opacity * edgeFade

          // Outer glow
          const grad1 = ctx.createRadialGradient(x, y, 0, x, y, p.size * 5)
          grad1.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.25})`)
          grad1.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.beginPath()
          ctx.arc(x, y, p.size * 5, 0, Math.PI * 2)
          ctx.fillStyle = grad1
          ctx.fill()

          // Core glow
          const grad2 = ctx.createRadialGradient(x, y, 0, x, y, p.size * 1.8)
          grad2.addColorStop(0, `rgba(255,255,255,${alpha * 0.6})`)
          grad2.addColorStop(0.3, `rgba(${r},${g},${b},${alpha * 0.9})`)
          grad2.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.beginPath()
          ctx.arc(x, y, p.size * 1.8, 0, Math.PI * 2)
          ctx.fillStyle = grad2
          ctx.fill()

          // Bright center
          ctx.beginPath()
          ctx.arc(x, y, p.size * 0.5, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,255,255,${alpha * 0.95})`
          ctx.fill()
        })

        particlesRef.current.set(key, particles)
      })

      animRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [paths, nodePositions])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-0"
    />
  )
}

export default function PowerFlowDiagram({ status, tariff }: Props) {
  const solarActive = status.solar_power > 50
  const gridImporting = status.grid_power > 50
  const gridExporting = status.grid_power < -50
  const batteryCharging = status.battery_power > 50
  const batteryDischarging = status.battery_power < -50
  const homeActive = status.home_power > 50

  // Node positions as fractions of the container (0-1)
  const nodePositions: Record<string, { x: number; y: number }> = {
    solar:   { x: 0.5,  y: 0.12 },
    battery: { x: 0.5,  y: 0.50 },
    home:    { x: 0.15, y: 0.88 },
    grid:    { x: 0.85, y: 0.88 },
  }

  // Particle colors match source tile
  const SOLAR_COLOR   = 'rgb(251, 191, 36)'   // amber
  const BATTERY_COLOR = 'rgb(96, 165, 250)'    // blue
  const GRID_COLOR_IMPORT = 'rgb(248, 113, 113)' // red
  const GRID_COLOR_EXPORT = 'rgb(52, 211, 153)'  // emerald

  const flowPaths: FlowPath[] = [
    // Solar -> Battery
    { fromKey: 'solar', toKey: 'battery', color: SOLAR_COLOR, active: solarActive && batteryCharging, watts: Math.min(status.solar_power, Math.abs(status.battery_power)) },
    // Solar -> Home
    { fromKey: 'solar', toKey: 'home', color: SOLAR_COLOR, active: solarActive && homeActive, watts: Math.min(status.solar_power, status.home_power) },
    // Solar -> Grid (export)
    { fromKey: 'solar', toKey: 'grid', color: SOLAR_COLOR, active: solarActive && gridExporting, watts: Math.min(status.solar_power, Math.abs(status.grid_power)) },
    // Battery -> Home
    { fromKey: 'battery', toKey: 'home', color: BATTERY_COLOR, active: batteryDischarging && homeActive, watts: Math.min(Math.abs(status.battery_power), status.home_power) },
    // Battery -> Grid (export from battery)
    { fromKey: 'battery', toKey: 'grid', color: BATTERY_COLOR, active: batteryDischarging && gridExporting, watts: Math.abs(status.battery_power) },
    // Grid -> Home (import)
    { fromKey: 'grid', toKey: 'home', color: GRID_COLOR_IMPORT, active: gridImporting && homeActive, watts: Math.min(status.grid_power, status.home_power) },
    // Grid -> Battery (grid charges battery)
    { fromKey: 'grid', toKey: 'battery', color: GRID_COLOR_IMPORT, active: gridImporting && batteryCharging, watts: Math.min(status.grid_power, Math.abs(status.battery_power)) },
  ]

  return (
    <div className="relative w-full" style={{ height: 400 }}>
      {/* Particle canvas */}
      <ParticleCanvas paths={flowPaths} nodePositions={nodePositions} />

      {/* Solar - top center */}
      <div className="absolute z-10" style={{ left: '50%', top: '12%', transform: 'translate(-50%, -50%)' }}>
        <div className={`flex flex-col items-center rounded-xl border px-8 py-4 min-w-[120px] transition-all duration-500 ${
          solarActive ? 'border-amber-500/40 bg-amber-950/80 shadow-lg shadow-amber-500/20' : 'border-slate-800 bg-slate-900/95'
        }`}>
          <Sun className={`w-6 h-6 mb-1 ${solarActive ? 'text-amber-400' : 'text-slate-600'}`} />
          <span className={`text-xl font-bold tabular-nums ${solarActive ? 'text-amber-400' : 'text-slate-600'}`}>
            {formatPower(status.solar_power)}
          </span>
          <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-0.5">Solar</span>
          {solarActive && <span className="text-[9px] text-amber-400/70">Generating</span>}
        </div>
      </div>

      {/* Battery - center */}
      <div className="absolute z-10" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
        <div className={`flex flex-col items-center rounded-xl border px-8 py-4 min-w-[120px] transition-all duration-500 ${
          batteryCharging || batteryDischarging ? 'border-blue-500/40 bg-blue-950/80 shadow-lg shadow-blue-500/20' : 'border-slate-800 bg-slate-900/95'
        }`}>
          <Battery className={`w-6 h-6 mb-1 ${status.battery_soc > 20 ? 'text-blue-400' : 'text-red-400'}`} />
          <span className={`text-xl font-bold tabular-nums ${status.battery_soc > 20 ? 'text-blue-400' : 'text-red-400'}`}>
            {status.battery_soc.toFixed(0)}%
          </span>
          <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-0.5">Battery</span>
          <span className={`text-[9px] ${batteryCharging || batteryDischarging ? 'text-blue-400/70' : 'text-slate-600'}`}>
            {batteryCharging ? `Charging ${formatPower(status.battery_power)}`
              : batteryDischarging ? `Discharging ${formatPower(status.battery_power)}`
              : 'Idle'}
          </span>
        </div>
      </div>

      {/* Home - bottom left */}
      <div className="absolute z-10" style={{ left: '15%', top: '88%', transform: 'translate(-50%, -50%)' }}>
        <div className={`flex flex-col items-center rounded-xl border px-8 py-4 min-w-[120px] transition-all duration-500 ${
          homeActive ? 'border-cyan-500/40 bg-cyan-950/80 shadow-lg shadow-cyan-500/20' : 'border-slate-800 bg-slate-900/95'
        }`}>
          <Home className={`w-6 h-6 mb-1 ${homeActive ? 'text-cyan-400' : 'text-slate-600'}`} />
          <span className={`text-xl font-bold tabular-nums ${homeActive ? 'text-cyan-400' : 'text-slate-600'}`}>
            {formatPower(status.home_power)}
          </span>
          <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-0.5">Home</span>
          {homeActive && <span className="text-[9px] text-cyan-400/70">Consuming</span>}
        </div>
      </div>

      {/* Grid - bottom right */}
      <div className="absolute z-10" style={{ left: '85%', top: '88%', transform: 'translate(-50%, -50%)' }}>
        <div className={`flex flex-col items-center rounded-xl border px-8 py-4 min-w-[120px] transition-all duration-500 ${
          gridImporting ? 'border-red-500/40 bg-red-950/80 shadow-lg shadow-red-500/20'
          : gridExporting ? 'border-emerald-500/40 bg-emerald-950/80 shadow-lg shadow-emerald-500/20'
          : 'border-slate-800 bg-slate-900/95'
        }`}>
          <Zap className={`w-6 h-6 mb-1 ${gridImporting ? 'text-red-400' : gridExporting ? 'text-emerald-400' : 'text-slate-600'}`} />
          <span className={`text-xl font-bold tabular-nums ${
            gridImporting ? 'text-red-400' : gridExporting ? 'text-emerald-400' : 'text-slate-600'
          }`}>
            {formatPower(status.grid_power)}
          </span>
          <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-0.5">Grid</span>
          <span className={`text-[9px] ${
            gridImporting ? 'text-red-400/70' : gridExporting ? 'text-emerald-400/70' : 'text-slate-600'
          }`}>
            {gridImporting ? 'Importing' : gridExporting ? 'Exporting' : 'Idle'}
          </span>
          {tariff?.configured && tariff.current_period_display && (
            <span className={`text-[9px] mt-0.5 px-1.5 py-0.5 rounded-full font-medium ${
              tariff.current_period_display === 'Peak'
                ? 'bg-red-500/20 text-red-400'
                : tariff.current_period_display === 'Mid-Peak'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}>
              {tariff.current_period_display}
              {tariff.current_rate ? ` · $${tariff.current_rate.toFixed(2)}` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
