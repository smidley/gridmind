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

        // Draw track line
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        ctx.lineTo(toX, toY)
        ctx.strokeStyle = path.active ? 'rgba(51, 65, 85, 0.4)' : 'rgba(30, 41, 59, 0.3)'
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Subtle color glow on active paths
        if (path.active) {
          const colorMatch = path.color.match(/(\d+),\s*(\d+),\s*(\d+)/)
          if (colorMatch) {
            const cr = colorMatch[1], cg = colorMatch[2], cb = colorMatch[3]
            // Soft wide glow
            ctx.beginPath()
            ctx.moveTo(fromX, fromY)
            ctx.lineTo(toX, toY)
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.08)`
            ctx.lineWidth = 12
            ctx.stroke()
            // Tighter glow
            ctx.beginPath()
            ctx.moveTo(fromX, fromY)
            ctx.lineTo(toX, toY)
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.15)`
            ctx.lineWidth = 4
            ctx.stroke()
          }
        }

        if (!path.active) {
          particlesRef.current.set(key, [])
          return
        }

        let particles = particlesRef.current.get(key) || []

        // Scale particles based on power level (power curve):
        //   < 200W  ->  1 particle (trickle)
        //   500W    ->  3 particles
        //   1000W   ->  5 particles
        //   2000W   ->  7 particles
        //   5000W   -> 12 particles
        //   10000W  -> 17 particles
        //   20000W  -> 25 particles (max heavy flow)
        const watts = Math.abs(path.watts)
        const targetCount = watts < 200 ? 1 : Math.min(Math.max(Math.round(Math.pow(watts / 20000, 0.55) * 25), 2), 25)

        // Speed and size based on amps (watts / 240V) for physical feel
        const amps = watts / 240
        const baseSpeed = 0.003 + Math.min(amps / 80, 1) * 0.012
        const baseSize = 1.5 + Math.min(amps / 20, 3.5)

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
  // Tesla convention: negative battery_power = charging, positive = discharging
  const batteryCharging = status.battery_power < -50
  const batteryDischarging = status.battery_power > 50
  const homeActive = status.home_power > 50

  // Node positions as fractions of the container (0-1)
  const nodePositions: Record<string, { x: number; y: number }> = {
    solar:   { x: 0.5,  y: 0.12 },
    battery: { x: 0.5,  y: 0.48 },
    home:    { x: 0.22, y: 0.84 },
    grid:    { x: 0.78, y: 0.84 },
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
    <div className="relative w-full" style={{ height: 420 }}>
      {/* Particle canvas */}
      <ParticleCanvas paths={flowPaths} nodePositions={nodePositions} />

      {/* Shared tile size */}
      {(() => {
        const tileW = 130
        const tileH = 110
        const tileBase = `flex flex-col items-center justify-center rounded-xl border transition-all duration-500`
        const tileInactive = 'border-slate-200 bg-white/90 dark:border-slate-800 dark:bg-slate-900/95'
        const tileStyle = { width: tileW, height: tileH }

        return (<>
      {/* Solar - top center */}
      <div className="absolute z-10" style={{ left: '50%', top: '12%', transform: 'translate(-50%, -50%)' }}>
        <div className={`${tileBase} ${
          solarActive ? 'border-amber-400/40 bg-amber-50 shadow-lg shadow-amber-500/10 dark:bg-amber-950/80 dark:shadow-amber-500/20' : tileInactive
        }`} style={tileStyle}>
          <Sun className={`w-6 h-6 mb-1 ${solarActive ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-600'}`} />
          <span className={`text-xl font-bold tabular-nums ${solarActive ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-600'}`}>
            {formatPower(status.solar_power)}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wider mt-0.5">Solar</span>
          {solarActive && <span className="text-[9px] text-amber-500/70 dark:text-amber-400/70">Generating</span>}
        </div>
      </div>

      {/* Battery - center */}
      <div className="absolute z-10" style={{ left: '50%', top: '48%', transform: 'translate(-50%, -50%)' }}>
        <div className={`${tileBase} ${
          batteryCharging || batteryDischarging ? 'border-blue-400/40 bg-blue-50 shadow-lg shadow-blue-500/10 dark:bg-blue-950/80 dark:shadow-blue-500/20' : tileInactive
        }`} style={tileStyle}>
          <Battery className={`w-6 h-6 mb-1 ${status.battery_soc > 20 ? 'text-blue-500 dark:text-blue-400' : 'text-red-500 dark:text-red-400'}`} />
          <span className={`text-xl font-bold tabular-nums ${status.battery_soc > 20 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
            {formatPower(status.battery_power)}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wider mt-0.5">Battery</span>
          <span className={`text-[9px] ${batteryCharging || batteryDischarging ? 'text-blue-500/70 dark:text-blue-400/70' : 'text-slate-400 dark:text-slate-600'}`}>
            {batteryCharging ? `Charging · ${status.battery_soc.toFixed(0)}%`
              : batteryDischarging ? `Discharging · ${status.battery_soc.toFixed(0)}%`
              : `Idle · ${status.battery_soc.toFixed(0)}%`}
          </span>
        </div>
      </div>

      {/* Home - bottom left */}
      <div className="absolute z-10" style={{ left: '22%', top: '84%', transform: 'translate(-50%, -50%)' }}>
        <div className={`${tileBase} ${
          homeActive ? 'border-cyan-400/40 bg-cyan-50 shadow-lg shadow-cyan-500/10 dark:bg-cyan-950/80 dark:shadow-cyan-500/20' : tileInactive
        }`} style={tileStyle}>
          <Home className={`w-6 h-6 mb-1 ${homeActive ? 'text-cyan-500 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-600'}`} />
          <span className={`text-xl font-bold tabular-nums ${homeActive ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-600'}`}>
            {formatPower(status.home_power)}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wider mt-0.5">Home</span>
          {homeActive && <span className="text-[9px] text-cyan-500/70 dark:text-cyan-400/70">Consuming</span>}
        </div>
      </div>

      {/* Grid - bottom right */}
      <div className="absolute z-10" style={{ left: '78%', top: '84%', transform: 'translate(-50%, -50%)' }}>
        <div className={`${tileBase} ${
          gridImporting ? 'border-red-400/40 bg-red-50 shadow-lg shadow-red-500/10 dark:bg-red-950/80 dark:shadow-red-500/20'
          : gridExporting ? 'border-emerald-400/40 bg-emerald-50 shadow-lg shadow-emerald-500/10 dark:bg-emerald-950/80 dark:shadow-emerald-500/20'
          : tileInactive
        }`} style={tileStyle}>
          <Zap className={`w-6 h-6 mb-1 ${gridImporting ? 'text-red-500 dark:text-red-400' : gridExporting ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-600'}`} />
          <span className={`text-xl font-bold tabular-nums ${
            gridImporting ? 'text-red-600 dark:text-red-400' : gridExporting ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-600'
          }`}>
            {formatPower(status.grid_power)}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wider mt-0.5">Grid</span>
          <span className={`text-[9px] ${
            gridImporting ? 'text-red-500/70 dark:text-red-400/70' : gridExporting ? 'text-emerald-500/70 dark:text-emerald-400/70' : 'text-slate-400 dark:text-slate-600'
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
        </>)
      })()}
    </div>
  )
}
