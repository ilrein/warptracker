import * as THREE from 'three'

/**
 * Shared pooled VFX: expanding rings, ballistic particle bursts and fading
 * trail motes. Everything is pre-allocated and recycled — spawning never
 * allocates geometry, and `updateVfx` is the single per-tick driver.
 */

const RING_POOL_SIZE = 24
const PARTICLE_POOL_SIZE = 220
const TRAIL_POOL_SIZE = 90

/** Unit annulus, scaled per ring instance. */
const RING_GEO = new THREE.RingGeometry(0.82, 1, 48)
const PARTICLE_GEO = new THREE.TetrahedronGeometry(1, 0)
const TRAIL_GEO = new THREE.SphereGeometry(1, 8, 8)

interface RingFx {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  active: boolean
  t: number
  duration: number
  fromR: number
  toR: number
  opacity: number
}

interface ParticleFx {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  active: boolean
  t: number
  life: number
  size: number
  gravity: number
  vel: THREE.Vector3
  spin: THREE.Vector3
}

interface TrailFx {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  active: boolean
  t: number
  life: number
  size: number
}

function makeMesh(geo: THREE.BufferGeometry): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.visible = false
  return { mesh, mat }
}

const rings: RingFx[] = []
const particles: ParticleFx[] = []
const trails: TrailFx[] = []

for (let i = 0; i < RING_POOL_SIZE; i++) {
  const { mesh, mat } = makeMesh(RING_GEO)
  mesh.rotation.x = -Math.PI / 2
  rings.push({ mesh, mat, active: false, t: 0, duration: 1, fromR: 0, toR: 1, opacity: 0.8 })
}
for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
  const { mesh, mat } = makeMesh(PARTICLE_GEO)
  particles.push({
    mesh,
    mat,
    active: false,
    t: 0,
    life: 1,
    size: 0.1,
    gravity: 0,
    vel: new THREE.Vector3(),
    spin: new THREE.Vector3(),
  })
}
for (let i = 0; i < TRAIL_POOL_SIZE; i++) {
  const { mesh, mat } = makeMesh(TRAIL_GEO)
  trails.push({ mesh, mat, active: false, t: 0, life: 0.25, size: 0.12 })
}

let ringCursor = 0
let particleCursor = 0
let trailCursor = 0

function attach(mesh: THREE.Mesh, scene: THREE.Scene): void {
  if (mesh.parent !== scene) scene.add(mesh)
  mesh.visible = true
}

/** Flat expanding ring on the ground — telegraphs, shockwaves, seal waves. */
export function spawnRing(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  color: number,
  fromR: number,
  toR: number,
  duration: number,
  opts?: { opacity?: number; y?: number }
): void {
  const fx = rings[ringCursor]!
  ringCursor = (ringCursor + 1) % rings.length
  fx.active = true
  fx.t = 0
  fx.duration = Math.max(0.01, duration)
  fx.fromR = Math.max(0.01, fromR)
  fx.toR = toR
  fx.opacity = opts?.opacity ?? 0.8
  fx.mat.color.setHex(color)
  fx.mat.opacity = fx.opacity
  fx.mesh.position.set(pos.x, opts?.y ?? 0.07, pos.z)
  fx.mesh.scale.setScalar(fx.fromR)
  attach(fx.mesh, scene)
}

/** Ballistic shard burst — impacts, totem cracks, landing dust. */
export function spawnBurst(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  color: number,
  count = 10,
  opts?: { speed?: number; up?: number; size?: number; gravity?: number; life?: number }
): void {
  const speed = opts?.speed ?? 5
  const up = opts?.up ?? 4
  const size = opts?.size ?? 0.12
  const gravity = opts?.gravity ?? 12
  const life = opts?.life ?? 0.6
  for (let i = 0; i < count; i++) {
    const fx = particles[particleCursor]!
    particleCursor = (particleCursor + 1) % particles.length
    fx.active = true
    fx.t = 0
    fx.life = life * (0.75 + Math.random() * 0.5)
    fx.size = size * (0.7 + Math.random() * 0.7)
    fx.gravity = gravity
    const a = Math.random() * Math.PI * 2
    const s = speed * (0.5 + Math.random() * 0.7)
    fx.vel.set(Math.cos(a) * s, up * (0.5 + Math.random() * 0.8), Math.sin(a) * s)
    fx.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12)
    fx.mat.color.setHex(color)
    fx.mat.opacity = 0.95
    fx.mesh.position.copy(pos)
    fx.mesh.scale.setScalar(fx.size)
    attach(fx.mesh, scene)
  }
}

/** Stationary fading mote — projectile trails, blink after-images. */
export function spawnTrail(scene: THREE.Scene, pos: THREE.Vector3, color: number, size = 0.12, life = 0.25): void {
  const fx = trails[trailCursor]!
  trailCursor = (trailCursor + 1) % trails.length
  fx.active = true
  fx.t = 0
  fx.life = Math.max(0.01, life)
  fx.size = size
  fx.mat.color.setHex(color)
  fx.mat.opacity = 0.7
  fx.mesh.position.copy(pos)
  fx.mesh.scale.setScalar(size)
  attach(fx.mesh, scene)
}

/** Advance every live effect. The integrator calls this once per tick. */
export function updateVfx(dt: number): void {
  for (const fx of rings) {
    if (!fx.active) continue
    fx.t += dt
    const k = Math.min(1, fx.t / fx.duration)
    fx.mesh.scale.setScalar(fx.fromR + (fx.toR - fx.fromR) * k)
    fx.mat.opacity = fx.opacity * (1 - k)
    if (k >= 1) {
      fx.active = false
      fx.mesh.visible = false
    }
  }
  for (const fx of particles) {
    if (!fx.active) continue
    fx.t += dt
    if (fx.t >= fx.life) {
      fx.active = false
      fx.mesh.visible = false
      continue
    }
    fx.vel.y -= fx.gravity * dt
    fx.mesh.position.addScaledVector(fx.vel, dt)
    if (fx.mesh.position.y < fx.size * 0.4) {
      fx.mesh.position.y = fx.size * 0.4
      fx.vel.y = 0
      fx.vel.x *= 0.8
      fx.vel.z *= 0.8
    }
    fx.mesh.rotation.x += fx.spin.x * dt
    fx.mesh.rotation.y += fx.spin.y * dt
    fx.mesh.rotation.z += fx.spin.z * dt
    fx.mat.opacity = 0.95 * (1 - fx.t / fx.life)
  }
  for (const fx of trails) {
    if (!fx.active) continue
    fx.t += dt
    const k = fx.t / fx.life
    if (k >= 1) {
      fx.active = false
      fx.mesh.visible = false
      continue
    }
    fx.mat.opacity = 0.7 * (1 - k)
    fx.mesh.scale.setScalar(fx.size * (1 - k * 0.4))
  }
}
