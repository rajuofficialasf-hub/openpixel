/**
 * Background3D — a calm, quiet Three.js backdrop.
 *
 * Plain `three` (no react-three-fiber): slow-floating geometric
 * particles and wireframe shapes in the brand blue/teal palette,
 * at LOW opacity, rendered on a fixed transparent canvas behind
 * the app. It is decoration only — `pointer-events: none` so it
 * never intercepts clicks, and it is lazy-loaded from `App.tsx`
 * so it never blocks first paint.
 *
 * Design rule (docs/DESIGN_NOTES.md): the backdrop must never
 * compete with the workspace. Particles are sparse and dim,
 * shapes are small, few, and slow, and the whole scene sits
 * further back (camera z 9.5). If it is ever noticeable before
 * the content, it is too loud — turn it down, not up.
 *
 * Motion behaviour:
 * - `prefers-reduced-motion`: one static frame is rendered, no
 *   animation loop runs.
 * - `document.hidden`: the loop pauses (visibilitychange) and
 *   resumes when the tab is visible again.
 * - Unmount disposes everything: animation frame, resize and
 *   visibility listeners, geometries, materials and the renderer.
 *
 * Performance: ~160 points + 4 wireframe meshes, device pixel
 * ratio capped at 1.5, alpha canvas so the theme background shows
 * through.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const PARTICLE_COUNT = 160
const BRAND_BLUE = '#2563eb'
const BRAND_TEAL = '#0d9488'

export default function Background3D() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      60,
      host.clientWidth / Math.max(host.clientHeight, 1),
      0.1,
      100,
    )
    camera.position.z = 9.5

    // --- particles: a sparse field of brand-coloured points ---
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const colours = new Float32Array(PARTICLE_COUNT * 3)
    const blue = new THREE.Color(BRAND_BLUE)
    const teal = new THREE.Color(BRAND_TEAL)
    const tmp = new THREE.Color()
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 18
      positions[i * 3 + 1] = (Math.random() - 0.5) * 10
      positions[i * 3 + 2] = (Math.random() - 0.5) * 5 - 1
      tmp.copy(Math.random() > 0.5 ? blue : teal)
      colours[i * 3] = tmp.r
      colours[i * 3 + 1] = tmp.g
      colours[i * 3 + 2] = tmp.b
    }
    const pointsGeometry = new THREE.BufferGeometry()
    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    const pointsMaterial = new THREE.PointsMaterial({
      size: 0.06,
      transparent: true,
      opacity: 0.28,
      vertexColors: true,
      sizeAttenuation: true,
      depthWrite: false,
    })
    const points = new THREE.Points(pointsGeometry, pointsMaterial)
    scene.add(points)

    // --- wireframe shapes: slow-turning icosahedrons ---
    interface Floater {
      mesh: THREE.Mesh
      baseY: number
      phase: number
      rotSpeed: number
      floatSpeed: number
    }
    const floaters: Floater[] = []
    const shapeGeometry = new THREE.IcosahedronGeometry(1, 0)
    for (let i = 0; i < 4; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? BRAND_BLUE : BRAND_TEAL,
        wireframe: true,
        transparent: true,
        opacity: 0.07 + (i % 3) * 0.02,
      })
      const mesh = new THREE.Mesh(shapeGeometry, material)
      const scale = 0.35 + Math.random() * 0.35
      mesh.scale.setScalar(scale)
      mesh.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 7, -1 - Math.random() * 2)
      scene.add(mesh)
      floaters.push({
        mesh,
        baseY: mesh.position.y,
        phase: Math.random() * Math.PI * 2,
        rotSpeed: 0.03 + Math.random() * 0.04,
        floatSpeed: 0.12 + Math.random() * 0.13,
      })
    }

    const onResize = () => {
      const w = host.clientWidth
      const h = Math.max(host.clientHeight, 1)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    let raf = 0
    let running = !reducedMotion
    const clock = new THREE.Clock()

    const renderFrame = () => {
      const t = clock.getElapsedTime()
      points.rotation.y = t * 0.02
      for (const f of floaters) {
        f.mesh.rotation.x = t * f.rotSpeed
        f.mesh.rotation.y = t * f.rotSpeed * 0.7
        f.mesh.position.y = f.baseY + Math.sin(t * f.floatSpeed + f.phase) * 0.2
      }
      renderer.render(scene, camera)
    }

    const loop = () => {
      if (!running) return
      renderFrame()
      raf = requestAnimationFrame(loop)
    }

    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!reducedMotion) {
        running = true
        clock.getDelta()
        raf = requestAnimationFrame(loop)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    if (reducedMotion) {
      // One static frame — the shapes are visible, nothing moves.
      renderFrame()
    } else {
      raf = requestAnimationFrame(loop)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose()
          const mat = obj.material
          if (Array.isArray(mat)) {
            for (const m of mat) m.dispose()
          } else {
            mat.dispose()
          }
        }
      })
      shapeGeometry.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      ref={hostRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    />
  )
}
