/**
 * Background3D — ultra-lightweight (~2 KB) HTML5 2D Canvas backdrop
 * replacing the previous 533 KB Three.js WebGL bundle.
 *
 * Renders the same calm, quiet floating particles and slow-rotating
 * geometric wireframes in the brand blue/teal palette at low opacity
 * behind the workspace (`pointer-events: none`), with zero WebGL GPU
 * overhead and dramatically faster load/offline caching.
 *
 * Motion behaviour:
 * - `prefers-reduced-motion`: renders one static frame, no loop.
 * - `document.hidden`: pauses automatically when tab is hidden.
 * - Unmount cancels animation frame and removes listeners cleanly.
 */
import { useEffect, useRef } from 'react'

interface Dot {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  color: string
  alpha: number
}

interface Poly {
  x: number
  y: number
  radius: number
  sides: number
  angle: number
  speed: number
  phase: number
  color: string
}

export default function Background3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    let width = window.innerWidth
    let height = window.innerHeight
    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Deterministic-feeling sparse particles
    const dots: Dot[] = Array.from({ length: 64 }, (_, i) => ({
      x: ((i * 197.3) % 1) * width,
      y: ((i * 311.7) % 1) * height,
      r: 1.4 + (i % 3) * 0.7,
      vx: ((i % 2 === 0 ? 1 : -1) * (0.08 + (i % 5) * 0.03)),
      vy: ((i % 3 === 0 ? -1 : 1) * (0.06 + (i % 4) * 0.025)),
      color: i % 2 === 0 ? '#3157D5' : '#0d9488',
      alpha: 0.14 + (i % 3) * 0.04,
    }))

    const polys: Poly[] = [
      { x: 0.14, y: 0.24, radius: 52, sides: 6, angle: 0.3, speed: 0.00018, phase: 0, color: '#3157D5' },
      { x: 0.84, y: 0.2, radius: 44, sides: 5, angle: 1.1, speed: -0.00015, phase: 1.8, color: '#0d9488' },
      { x: 0.78, y: 0.78, radius: 58, sides: 6, angle: 2.0, speed: 0.00014, phase: 3.1, color: '#3157D5' },
      { x: 0.2, y: 0.8, radius: 40, sides: 5, angle: 0.7, speed: -0.0002, phase: 4.5, color: '#0d9488' },
    ]

    let rafId = 0
    let lastTime = performance.now()

    const drawFrame = (now: number, animate: boolean) => {
      const dt = Math.min(now - lastTime, 64)
      lastTime = now
      ctx.clearRect(0, 0, width, height)

      // Subtle floating particles
      for (const d of dots) {
        if (animate) {
          d.x += d.vx * (dt * 0.06)
          d.y += d.vy * (dt * 0.06)
          if (d.x < -10) d.x = width + 10
          if (d.x > width + 10) d.x = -10
          if (d.y < -10) d.y = height + 10
          if (d.y > height + 10) d.y = -10
        }
        ctx.globalAlpha = d.alpha
        ctx.fillStyle = d.color
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Quiet wireframe polygons
      ctx.lineWidth = 1
      for (const p of polys) {
        if (animate) p.angle += p.speed * dt
        const cx = p.x * width
        const cy = p.y * height + (animate ? Math.sin(now * 0.0004 + p.phase) * 8 : 0)
        ctx.globalAlpha = 0.08
        ctx.strokeStyle = p.color
        ctx.beginPath()
        for (let s = 0; s <= p.sides; s++) {
          const theta = p.angle + (s * Math.PI * 2) / p.sides
          const px = cx + Math.cos(theta) * p.radius
          const py = cy + Math.sin(theta) * p.radius
          if (s === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    const tick = (now: number) => {
      drawFrame(now, true)
      rafId = window.requestAnimationFrame(tick)
    }

    const onVisibility = () => {
      if (reducedMotion) return
      if (document.hidden) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      } else if (!rafId) {
        lastTime = performance.now()
        rafId = window.requestAnimationFrame(tick)
      }
    }

    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)

    if (reducedMotion) {
      drawFrame(performance.now(), false)
    } else {
      rafId = window.requestAnimationFrame(tick)
    }

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  )
}
