import { useEffect, useRef, useMemo, useState } from 'react'
import { Sun, Home, Zap, Battery, Car } from 'lucide-react'
import type { PowerwallStatus } from '../hooks/useWebSocket'

interface TariffInfo {
  configured: boolean
  current_period_display?: string
  current_rate?: number
  currency?: string
}

interface GridMixInfo {
  configured: boolean
  clean_pct?: number
  fossil_pct?: number
}

interface Props {
  status: PowerwallStatus
  tariff?: TariffInfo | null
  gridMix?: GridMixInfo | null
  evChargingWatts?: number  // Vehicle charger power in watts (0 or undefined = no EV / not charging)
  evSoc?: number            // Vehicle battery level 0-100
  evName?: string           // Vehicle display name
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

/** Canvas particle renderer - draws on a canvas overlaying the component.
 *  Uses refs for paths/positions so the animation loop doesn't tear down on every data update.
 */
function ParticleCanvas({ paths, nodePositions }: { paths: FlowPath[]; nodePositions: Record<string, { x: number; y: number }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Map<string, Particle[]>>(new Map())
  const animRef = useRef<number>(0)
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  // Store paths and positions in refs so the animation loop always reads current values
  // without needing to restart the effect
  const pathsRef = useRef(paths)
  pathsRef.current = paths
  const nodePositionsRef = useRef(nodePositions)
  nodePositionsRef.current = nodePositions

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

      const currentPaths = pathsRef.current
      const currentPositions = nodePositionsRef.current

      // Clean stale particle entries
      const activeKeys = new Set(currentPaths.map(p => `${p.fromKey}-${p.toKey}`))
      particlesRef.current.forEach((_, key) => {
        if (!activeKeys.has(key)) particlesRef.current.delete(key)
      })

      // Detect light/dark mode for appropriate line colors
      const isDark = document.documentElement.classList.contains('dark')

      currentPaths.forEach((path) => {
        const fromNode = currentPositions[path.fromKey]
        const toNode = currentPositions[path.toKey]
        if (!fromNode || !toNode) return

        const fromX = fromNode.x * w
        const fromY = fromNode.y * h
        const toX = toNode.x * w
        const toY = toNode.y * h

        const key = `${path.fromKey}-${path.toKey}`

        // Draw track line — fainter in light mode
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        ctx.lineTo(toX, toY)
        if (isDark) {
          ctx.strokeStyle = path.active ? 'rgba(51, 65, 85, 0.4)' : 'rgba(30, 41, 59, 0.3)'
        } else {
          ctx.strokeStyle = path.active ? 'rgba(148, 163, 184, 0.25)' : 'rgba(203, 213, 225, 0.3)'
        }
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Subtle color glow on active paths — reduced in light mode
        if (path.active) {
          const colorMatch = path.color.match(/(\d+),\s*(\d+),\s*(\d+)/)
          if (colorMatch) {
            const cr = colorMatch[1], cg = colorMatch[2], cb = colorMatch[3]
            const wideAlpha = isDark ? 0.08 : 0.04
            const tightAlpha = isDark ? 0.15 : 0.08
            // Soft wide glow
            ctx.beginPath()
            ctx.moveTo(fromX, fromY)
            ctx.lineTo(toX, toY)
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${wideAlpha})`
            ctx.lineWidth = 12
            ctx.stroke()
            // Tighter glow
            ctx.beginPath()
            ctx.moveTo(fromX, fromY)
            ctx.lineTo(toX, toY)
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${tightAlpha})`
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

          // Outer glow — smaller and subtler in light mode
          const glowScale = isDark ? 5 : 3
          const outerAlpha = isDark ? alpha * 0.25 : alpha * 0.12
          const grad1 = ctx.createRadialGradient(x, y, 0, x, y, p.size * glowScale)
          grad1.addColorStop(0, `rgba(${r},${g},${b},${outerAlpha})`)
          grad1.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.beginPath()
          ctx.arc(x, y, p.size * glowScale, 0, Math.PI * 2)
          ctx.fillStyle = grad1
          ctx.fill()

          // Core glow
          const coreAlpha = isDark ? alpha * 0.9 : alpha * 0.7
          const grad2 = ctx.createRadialGradient(x, y, 0, x, y, p.size * 1.8)
          grad2.addColorStop(0, isDark ? `rgba(255,255,255,${alpha * 0.6})` : `rgba(${r},${g},${b},${alpha * 0.8})`)
          grad2.addColorStop(0.3, `rgba(${r},${g},${b},${coreAlpha})`)
          grad2.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.beginPath()
          ctx.arc(x, y, p.size * 1.8, 0, Math.PI * 2)
          ctx.fillStyle = grad2
          ctx.fill()

          // Bright center — white in dark mode, colored in light mode
          ctx.beginPath()
          ctx.arc(x, y, p.size * 0.5, 0, Math.PI * 2)
          ctx.fillStyle = isDark
            ? `rgba(255,255,255,${alpha * 0.95})`
            : `rgba(${r},${g},${b},${alpha * 0.95})`
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
      particlesRef.current.clear()
    }
  }, []) // Runs once — reads current paths/positions from refs

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-0"
    />
  )
}

export default function PowerFlowDiagram({ status, tariff, gridMix, evChargingWatts = 0, evSoc, evName }: Props) {
  const solarActive = status.solar_power > 50
  const gridImporting = status.grid_power > 50
  const gridExporting = status.grid_power < -50
  // Tesla convention: negative battery_power = charging, positive = discharging
  const batteryCharging = status.battery_power < -50
  const batteryDischarging = status.battery_power > 50
  const evCharging = evChargingWatts > 50
  const showEv = evSoc !== undefined || evCharging

  // Tesla's home_power (load_power) includes Wall Connector power.
  // Subtract EV charging watts to show actual home-only consumption.
  const actualHomePower = evCharging
    ? Math.max(status.home_power - evChargingWatts, 0)
    : status.home_power
  const homeActive = actualHomePower > 50

  // Responsive sizing — smaller tiles on mobile to prevent overlap
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Node positions as fractions of the container (0-1)
  // Layout: Solar (top), EV (left-mid), Battery (right-mid), Home (bottom-left), Grid (bottom-right)
  // On mobile, Home and Grid are pushed further apart to reduce overlap with flow lines
  const homeX = isMobile ? 0.10 : 0.22
  const gridX = isMobile ? 0.90 : 0.78
  const nodePositions: Record<string, { x: number; y: number }> = showEv ? {
    solar:   { x: 0.5,   y: 0.10 },
    ev:      { x: 0.12,  y: 0.48 },
    battery: { x: 0.5,   y: 0.48 },
    home:    { x: homeX,  y: 0.88 },
    grid:    { x: gridX,  y: 0.88 },
  } : {
    solar:   { x: 0.5,   y: 0.12 },
    battery: { x: 0.5,   y: 0.52 },
    home:    { x: homeX,  y: 0.84 },
    grid:    { x: gridX,  y: 0.84 },
  }

  // Particle colors match source tile
  const SOLAR_COLOR   = 'rgb(251, 191, 36)'   // amber
  const BATTERY_COLOR = 'rgb(96, 165, 250)'    // blue
  const GRID_COLOR_IMPORT = 'rgb(248, 113, 113)' // red
  const GRID_COLOR_EXPORT = 'rgb(52, 211, 153)'  // emerald
  const EV_COLOR      = 'rgb(167, 139, 250)'    // violet

  const flowPaths: FlowPath[] = [
    // Solar -> Battery
    { fromKey: 'solar', toKey: 'battery', color: SOLAR_COLOR, active: solarActive && batteryCharging, watts: Math.min(status.solar_power, Math.abs(status.battery_power)) },
    // Solar -> Home
    { fromKey: 'solar', toKey: 'home', color: SOLAR_COLOR, active: solarActive && homeActive, watts: Math.min(status.solar_power, actualHomePower) },
    // Solar -> Grid (export)
    { fromKey: 'solar', toKey: 'grid', color: SOLAR_COLOR, active: solarActive && gridExporting, watts: Math.min(status.solar_power, Math.abs(status.grid_power)) },
    // Battery -> Home
    { fromKey: 'battery', toKey: 'home', color: BATTERY_COLOR, active: batteryDischarging && homeActive, watts: Math.min(Math.abs(status.battery_power), actualHomePower) },
    // Battery -> Grid (export from battery)
    { fromKey: 'battery', toKey: 'grid', color: BATTERY_COLOR, active: batteryDischarging && gridExporting, watts: Math.abs(status.battery_power) },
    // Grid -> Home (import)
    { fromKey: 'grid', toKey: 'home', color: GRID_COLOR_IMPORT, active: gridImporting && homeActive, watts: Math.min(status.grid_power, actualHomePower) },
    // Grid -> Battery (grid charges battery)
    { fromKey: 'grid', toKey: 'battery', color: GRID_COLOR_IMPORT, active: gridImporting && batteryCharging, watts: Math.min(status.grid_power, Math.abs(status.battery_power)) },
  ]

  // EV flow paths - power flows from sources to EV when charging
  // EV is part of the home load, so flows come from whichever sources are active
  if (showEv) {
    flowPaths.push(
      // Solar -> EV (solar powers the charger)
      { fromKey: 'solar', toKey: 'ev', color: SOLAR_COLOR, active: solarActive && evCharging, watts: evCharging ? Math.min(status.solar_power, evChargingWatts) : 0 },
      // Battery -> EV (battery powers the charger)
      { fromKey: 'battery', toKey: 'ev', color: BATTERY_COLOR, active: batteryDischarging && evCharging, watts: evCharging ? Math.min(Math.abs(status.battery_power), evChargingWatts) : 0 },
      // Grid -> EV (grid powers the charger)
      { fromKey: 'grid', toKey: 'ev', color: GRID_COLOR_IMPORT, active: gridImporting && evCharging, watts: evCharging ? Math.min(status.grid_power, evChargingWatts) : 0 },
    )
  }

  const diagramHeight = isMobile ? (showEv ? 360 : 330) : (showEv ? 450 : 420)

  return (
    <div className="relative w-full" style={{ height: diagramHeight }}>
      {/* Particle canvas */}
      <ParticleCanvas paths={flowPaths} nodePositions={nodePositions} />

      {/* Shared tile size — smaller on mobile to prevent overlap */}
      {(() => {
        const tileW = isMobile ? 96 : 130
        const tileH = isMobile ? 82 : 110
        const tileBase = `flex flex-col items-center justify-center rounded-xl border transition-all duration-500`
        const tileInactive = 'border-stone-200 bg-stone-50/90 dark:border-slate-800 dark:bg-slate-900/95'
        const tileStyle = { width: tileW, height: tileH }
        const evTileW = isMobile ? 82 : 110
        const evTileH = isMobile ? 74 : 100
        const evTileStyle = { width: evTileW, height: evTileH }

        return (<>
      {/* Solar - top center */}
      <div className="absolute z-10" style={{ left: '50%', top: `${nodePositions.solar.y * 100}%`, transform: 'translate(-50%, -50%)' }}>
        <div className={`${tileBase} ${
          solarActive ? 'border-amber-400/40 bg-amber-50 shadow-lg shadow-amber-500/10 dark:bg-amber-950/80 dark:shadow-amber-500/20' : tileInactive
        }`} style={tileStyle}>
          <Sun className={`${isMobile ? 'w-4 h-4' : 'w-6 h-6'} mb-1 ${solarActive ? 'text-amber-500 dark:text-amber-400' : 'text-stone-400 dark:text-slate-600'}`} />
          <span className={`${isMobile ? 'text-base' : 'text-xl'} font-bold tabular-nums ${solarActive ? 'text-amber-600 dark:text-amber-400' : 'text-stone-400 dark:text-slate-600'}`}>
            {formatPower(status.solar_power)}
          </span>
          <span className={`${isMobile ? 'text-[8px]' : 'text-[10px]'} text-stone-400 dark:text-slate-500 font-medium uppercase tracking-wider mt-0.5`}>Solar</span>
          {solarActive && <span className={`${isMobile ? 'text-[8px]' : 'text-[9px]'} text-amber-500/70 dark:text-amber-400/70`}>Generating</span>}
        </div>
      </div>

      {/* EV - left of battery (only shown when vehicle data available) */}
      {showEv && (
        <div className="absolute z-10" style={{ left: `${nodePositions.ev.x * 100}%`, top: `${nodePositions.ev.y * 100}%`, transform: 'translate(-50%, -50%)' }}>
          <div className={`${tileBase} ${
            evCharging
              ? 'border-violet-400/40 bg-violet-50 shadow-lg shadow-violet-500/10 dark:bg-violet-950/80 dark:shadow-violet-500/20'
              : 'border-violet-400/20 bg-violet-50/50 dark:border-violet-800/30 dark:bg-violet-950/40'
          }`} style={evTileStyle}>
            <Car className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} mb-1 ${evCharging ? 'text-violet-500 dark:text-violet-400' : 'text-violet-400/60 dark:text-violet-500/60'}`} />
            <span className={`${isMobile ? 'text-sm' : 'text-lg'} font-bold tabular-nums ${evCharging ? 'text-violet-600 dark:text-violet-400' : 'text-violet-500/70 dark:text-violet-400/70'}`}>
              {evCharging ? formatPower(evChargingWatts) : evSoc !== undefined ? `${evSoc}%` : '—'}
            </span>
            <span className={`${isMobile ? 'text-[8px]' : 'text-[10px]'} text-violet-400/60 dark:text-violet-500/50 font-medium uppercase tracking-wider mt-0.5`}>
              {evName || 'EV'}
            </span>
            {!isMobile && <span className={`text-[9px] ${evCharging ? 'text-violet-500/70 dark:text-violet-400/70' : 'text-violet-400/50 dark:text-violet-500/40'}`}>
              {evCharging
                ? evSoc !== undefined ? `Charging · ${evSoc}%` : 'Charging'
                : evSoc !== undefined ? `${evSoc}%` : '—'}
            </span>}
          </div>
        </div>
      )}

      {/* Battery - center */}
      <div className="absolute z-10" style={{ left: '50%', top: `${nodePositions.battery.y * 100}%`, transform: 'translate(-50%, -50%)' }}>
        <div className={`${tileBase} ${
          batteryCharging || batteryDischarging ? 'border-blue-400/40 bg-blue-50 shadow-lg shadow-blue-500/10 dark:bg-blue-950/80 dark:shadow-blue-500/20' : tileInactive
        }`} style={tileStyle}>
          <Battery className={`${isMobile ? 'w-4 h-4' : 'w-6 h-6'} mb-1 ${status.battery_soc > 20 ? 'text-blue-500 dark:text-blue-400' : 'text-red-500 dark:text-red-400'}`} />
          <span className={`${isMobile ? 'text-base' : 'text-xl'} font-bold tabular-nums ${status.battery_soc > 20 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
            {formatPower(status.battery_power)}
          </span>
          <span className={`${isMobile ? 'text-[8px]' : 'text-[10px]'} text-stone-400 dark:text-slate-500 font-medium uppercase tracking-wider mt-0.5`}>Battery</span>
          <span className={`${isMobile ? 'text-[8px]' : 'text-[9px]'} ${batteryCharging || batteryDischarging ? 'text-blue-500/70 dark:text-blue-400/70' : 'text-stone-400 dark:text-slate-600'}`}>
            {batteryCharging ? `Charging · ${status.battery_soc.toFixed(0)}%`
              : batteryDischarging ? `Discharging · ${status.battery_soc.toFixed(0)}%`
              : `Idle · ${status.battery_soc.toFixed(0)}%`}
          </span>
        </div>
      </div>

      {/* Home - bottom left */}
      <div className="absolute z-10" style={{ left: `${nodePositions.home.x * 100}%`, top: `${nodePositions.home.y * 100}%`, transform: 'translate(-50%, -50%)' }}>
        <div className={`${tileBase} ${
          homeActive ? 'border-cyan-400/40 bg-cyan-50 shadow-lg shadow-cyan-500/10 dark:bg-cyan-950/80 dark:shadow-cyan-500/20' : tileInactive
        }`} style={tileStyle}>
          <Home className={`${isMobile ? 'w-4 h-4' : 'w-6 h-6'} mb-1 ${homeActive ? 'text-cyan-500 dark:text-cyan-400' : 'text-stone-400 dark:text-slate-600'}`} />
          <span className={`${isMobile ? 'text-base' : 'text-xl'} font-bold tabular-nums ${homeActive ? 'text-cyan-600 dark:text-cyan-400' : 'text-stone-400 dark:text-slate-600'}`}>
            {formatPower(actualHomePower)}
          </span>
          <span className={`${isMobile ? 'text-[8px]' : 'text-[10px]'} text-stone-400 dark:text-slate-500 font-medium uppercase tracking-wider mt-0.5`}>Home</span>
          {homeActive && <span className={`${isMobile ? 'text-[8px]' : 'text-[9px]'} text-cyan-500/70 dark:text-cyan-400/70`}>Consuming</span>}
        </div>
      </div>

      {/* Grid - bottom right */}
      <div className="absolute z-10" style={{ left: `${nodePositions.grid.x * 100}%`, top: `${nodePositions.grid.y * 100}%`, transform: 'translate(-50%, -50%)' }}>
        <div className={`${tileBase} ${
          gridImporting ? 'border-red-400/40 bg-red-50 shadow-lg shadow-red-500/10 dark:bg-red-950/80 dark:shadow-red-500/20'
          : gridExporting ? 'border-emerald-400/40 bg-emerald-50 shadow-lg shadow-emerald-500/10 dark:bg-emerald-950/80 dark:shadow-emerald-500/20'
          : tileInactive
        }`} style={tileStyle}>
          <Zap className={`${isMobile ? 'w-4 h-4' : 'w-6 h-6'} mb-1 ${gridImporting ? 'text-red-500 dark:text-red-400' : gridExporting ? 'text-emerald-500 dark:text-emerald-400' : 'text-stone-400 dark:text-slate-600'}`} />
          <span className={`${isMobile ? 'text-base' : 'text-xl'} font-bold tabular-nums ${
            gridImporting ? 'text-red-600 dark:text-red-400' : gridExporting ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400 dark:text-slate-600'
          }`}>
            {formatPower(status.grid_power)}
          </span>
          <span className={`${isMobile ? 'text-[8px]' : 'text-[10px]'} text-stone-400 dark:text-slate-500 font-medium uppercase tracking-wider mt-0.5`}>Grid</span>
          <span className={`${isMobile ? 'text-[8px]' : 'text-[9px]'} ${
            gridImporting ? 'text-red-500/70 dark:text-red-400/70' : gridExporting ? 'text-emerald-500/70 dark:text-emerald-400/70' : 'text-stone-400 dark:text-slate-600'
          }`}>
            {gridImporting ? 'Importing' : gridExporting ? 'Exporting' : 'Idle'}
          </span>
          {tariff?.configured && tariff.current_period_display && (
            <span className={`${isMobile ? 'text-[7px]' : 'text-[9px]'} mt-0.5 px-1.5 py-0.5 rounded-full font-medium ${
              tariff.current_period_display === 'Peak'
                ? 'bg-red-500/20 text-red-400'
                : tariff.current_period_display === 'Mid-Peak'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}>
              {tariff.current_period_display}
              {tariff.current_rate ? ` · $${tariff.current_rate.toFixed(2)}` : ''}
              {gridImporting && gridMix?.configured && gridMix.clean_pct != null
                ? ` · ${gridMix.clean_pct}% Clean`
                : ''}
            </span>
          )}
          {gridImporting && gridMix?.configured && gridMix.clean_pct != null && !(tariff?.configured && tariff.current_period_display) && (
            <span className={`${isMobile ? 'text-[7px]' : 'text-[9px]'} mt-0.5 px-1.5 py-0.5 rounded-full font-medium ${
              gridMix.clean_pct >= 80 ? 'bg-emerald-500/20 text-emerald-500'
              : gridMix.clean_pct >= 50 ? 'bg-amber-500/20 text-amber-500'
              : 'bg-red-500/20 text-red-400'
            }`}>
              {gridMix.clean_pct}% Clean
            </span>
          )}
        </div>
      </div>
        </>)
      })()}
    </div>
  )
}
