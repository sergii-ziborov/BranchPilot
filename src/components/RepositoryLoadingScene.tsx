import { useEffect, useRef } from 'react'
import type * as ThreeModule from 'three'

interface RepositoryLoadingSceneProps {
  className?: string
}

type Three = typeof ThreeModule

type DisposableObject = ThreeModule.Object3D & {
  geometry?: ThreeModule.BufferGeometry
  material?: ThreeModule.Material | ThreeModule.Material[]
}

export function RepositoryLoadingScene({ className }: RepositoryLoadingSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let disposed = false
    let cleanupScene: (() => void) | undefined

    void (async () => {
      const THREE = await import('three')
      if (disposed || !mount.isConnected) return
      cleanupScene = createLoadingScene(THREE, mount)
    })()

    return () => {
      disposed = true
      cleanupScene?.()
    }
  }, [])

  return <div ref={mountRef} className={className} aria-hidden="true" />
}

function createLoadingScene(THREE: Three, mount: HTMLDivElement): () => void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const style = getComputedStyle(document.documentElement)
  const accent = cssColor(style, '--accent', '#6d5dfc')
  const accentStrong = cssColor(style, '--accent-strong', '#8b5cf6')
  const accentSoft = cssColor(style, '--accent-soft', '#22d3ee')
  const border = cssColor(style, '--border', '#283044')
  const surface = cssColor(style, '--surface', '#0f111a')

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  camera.position.set(0, 0.18, 6.8)

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  mount.appendChild(renderer.domElement)

  const routeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.1, -0.7, 0),
    new THREE.Vector3(-1.85, -0.42, 0.12),
    new THREE.Vector3(-0.75, 0.18, -0.08),
    new THREE.Vector3(0.55, 0.56, 0.18),
    new THREE.Vector3(1.62, 0.16, -0.04),
    new THREE.Vector3(2.92, 0.58, 0.08)
  ])
  const branchCurveA = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.85, -0.42, 0.05),
    new THREE.Vector3(-1.26, 0.24, 0.14),
    new THREE.Vector3(-0.42, 0.74, 0.03)
  ])
  const branchCurveB = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.55, 0.56, 0.1),
    new THREE.Vector3(1.18, 1.05, 0.18),
    new THREE.Vector3(2.16, 1.02, 0.04)
  ])

  const route = tube(THREE, routeCurve, 0.028, accent, 0.92)
  const routeGlow = tube(THREE, routeCurve, 0.075, accent, 0.15)
  const branchA = tube(THREE, branchCurveA, 0.018, accentSoft, 0.58)
  const branchB = tube(THREE, branchCurveB, 0.018, accentStrong, 0.5)
  scene.add(routeGlow, route, branchA, branchB)

  const nodes = [
    routeCurve.getPointAt(0),
    routeCurve.getPointAt(0.24),
    routeCurve.getPointAt(0.48),
    routeCurve.getPointAt(0.72),
    routeCurve.getPointAt(1),
    branchCurveA.getPointAt(1),
    branchCurveB.getPointAt(1)
  ].map((point, index) => makeNode(THREE, point, index < 5 ? accent : accentSoft, surface))
  scene.add(...nodes)

  const pilot = makePilot(THREE, accentStrong, accentSoft)
  scene.add(pilot)

  const scanner = makeScanner(THREE, accentSoft)
  scene.add(scanner)

  const grid = makeGrid(THREE, border)
  scene.add(grid)

  const particles = makeParticles(THREE, accent, accentSoft)
  scene.add(particles)

  const resize = () => {
    const { width, height } = mount.getBoundingClientRect()
    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    renderer.setSize(safeWidth, safeHeight, false)
    camera.aspect = safeWidth / safeHeight
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(mount)
  resize()

  let raf = 0
  const startTime = performance.now()
  const render = () => {
    const time = (performance.now() - startTime) / 1000
    const progress = reduceMotion ? 0.42 : (time * 0.13) % 1
    const point = routeCurve.getPointAt(progress)
    const tangent = routeCurve.getTangentAt(progress)

    pilot.position.copy(point)
    pilot.position.z += 0.34
    pilot.rotation.z = Math.atan2(tangent.y, tangent.x) - Math.PI / 2
    pilot.rotation.x = Math.sin(time * 1.7) * 0.08

    scanner.position.copy(routeCurve.getPointAt((progress + 0.08) % 1))
    scanner.position.z += 0.12
    scanner.scale.setScalar(0.9 + Math.sin(time * 4) * 0.13)

    nodes.forEach((node, index) => {
      const pulse = 1 + Math.sin(time * 3.4 - index * 0.75) * 0.12
      node.scale.setScalar(reduceMotion ? 1 : pulse)
    })

    particles.rotation.z = reduceMotion ? 0 : time * 0.03
    grid.rotation.z = reduceMotion ? -0.08 : -0.08 + Math.sin(time * 0.18) * 0.012
    renderer.render(scene, camera)
    if (!reduceMotion) raf = window.requestAnimationFrame(render)
  }
  render()

  return () => {
    if (raf) window.cancelAnimationFrame(raf)
    observer.disconnect()
    scene.traverse((object) => disposeObject(object as DisposableObject))
    renderer.dispose()
    renderer.domElement.remove()
  }
}

function cssColor(style: CSSStyleDeclaration, token: string, fallback: string): string {
  return withoutAlpha(style.getPropertyValue(token).trim() || fallback)
}

function withoutAlpha(color: string): string {
  const rgba = color.match(/^rgba\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*[^)]+\)$/i)
  return rgba ? `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})` : color
}

function tube(THREE: Three, curve: ThreeModule.Curve<ThreeModule.Vector3>, radius: number, color: string, opacity: number) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 96, radius, 10, false),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 0.6
    })
  )
}

function makeNode(THREE: Three, position: ThreeModule.Vector3, color: string, surface: string) {
  const group = new THREE.Group()
  const nodeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(surface) })
  const ringMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9 })
  const glowMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.16 })
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 18), nodeMaterial)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.016, 10, 36), ringMaterial)
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 18), glowMaterial)

  group.position.copy(position)
  group.add(glow, core, ring)
  return group
}

function makePilot(THREE: Three, accent: string, accentSoft: string) {
  const group = new THREE.Group()
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.24)
  shape.lineTo(-0.14, -0.16)
  shape.lineTo(0, -0.09)
  shape.lineTo(0.14, -0.16)
  shape.closePath()

  const body = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), side: THREE.DoubleSide })
  )
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accentSoft), transparent: true, opacity: 0.14, side: THREE.DoubleSide })
  )
  glow.position.z = -0.05
  body.position.z = 0.02
  group.add(glow, body)
  return group
}

function makeScanner(THREE: Three, color: string) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.012, 8, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.72 })
  )
}

function makeGrid(THREE: Three, color: string) {
  const group = new THREE.Group()
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.22 })
  const size = 6
  const step = 0.6

  for (let i = -size; i <= size; i += 1) {
    const offset = i * step
    group.add(line(THREE, [new THREE.Vector3(-3.9, offset, -0.55), new THREE.Vector3(3.9, offset, -0.55)], material))
    group.add(line(THREE, [new THREE.Vector3(offset, -2.4, -0.55), new THREE.Vector3(offset, 2.4, -0.55)], material))
  }

  group.rotation.z = -0.08
  return group
}

function makeParticles(THREE: Three, accent: string, accentSoft: string) {
  const count = 90
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const a = new THREE.Color(accent)
  const b = new THREE.Color(accentSoft)

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 6.6
    positions[i * 3 + 1] = (Math.random() - 0.5) * 3.2
    positions[i * 3 + 2] = -0.2 + Math.random() * 0.7
    const color = i % 3 === 0 ? b : a
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.018,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    })
  )
}

function line(THREE: Three, points: ThreeModule.Vector3[], material: ThreeModule.Material) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material)
}

function disposeObject(object: DisposableObject) {
  object.geometry?.dispose()
  const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
  materials.forEach((material) => material.dispose())
}
