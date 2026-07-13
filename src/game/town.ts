import * as THREE from 'three'
import { mulberry32 } from './rng'

/**
 * Emberwatch — the palisaded Tracker camp. Pure procedural set dressing:
 * stake ring with one gate arc, the central campfire (world spawn point),
 * elder tent, smith stall, well and dormant beacon stones.
 *
 * `buildTown` is called once by world.ts; `updateTown` animates the flames
 * and the beacon pulse each tick.
 */

const PALISADE_RADIUS = 15
const STAKE_COUNT = 64
/** Half-angle of the 50° gate opening. */
const GATE_HALF_ANGLE = (50 * Math.PI) / 180 / 2

const CANVAS_COLOR = 0x6b5a44
const WOOD_COLOR = 0x3a2c1e
const STONE_COLOR = 0x2a2734

interface Flame {
  inner: THREE.Mesh
  outer: THREE.Mesh
  light: THREE.PointLight
  baseIntensity: number
  phase: number
}

const flames: Flame[] = []
let beaconMat: THREE.MeshStandardMaterial | null = null
let townTime = 0

function woodMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 0.95 })
}

/** Two nested additive cones + a point light: campfire, braziers, torches. */
function makeFlame(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  scale: number,
  lightColor: number,
  intensity: number,
  distance: number
): void {
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.32 * scale, 0.9 * scale, 7),
    new THREE.MeshBasicMaterial({
      color: 0xffa640,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  outer.position.copy(pos).add(new THREE.Vector3(0, 0.45 * scale, 0))
  parent.add(outer)

  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.16 * scale, 0.55 * scale, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffe0a0,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  inner.position.copy(pos).add(new THREE.Vector3(0, 0.32 * scale, 0))
  parent.add(inner)

  const light = new THREE.PointLight(lightColor, intensity, distance, 1.8)
  light.position.copy(pos).add(new THREE.Vector3(0, 0.7 * scale, 0))
  parent.add(light)

  flames.push({ inner, outer, light, baseIntensity: intensity, phase: Math.random() * 10 })
}

function buildPalisade(group: THREE.Group, center: THREE.Vector3, gateDir: THREE.Vector3): void {
  const rand = mulberry32(2026)
  const gateAngle = Math.atan2(gateDir.z, gateDir.x)

  // count the stakes that survive the gate cut so the instanced mesh is exact
  const placements: { angle: number; h: number; jitter: number; tiltX: number; tiltZ: number }[] = []
  for (let i = 0; i < STAKE_COUNT; i++) {
    const angle = (i / STAKE_COUNT) * Math.PI * 2
    const h = 2.6 + rand() * 0.8
    const jitter = (rand() - 0.5) * 0.6
    const tiltX = (rand() - 0.5) * 0.12
    const tiltZ = (rand() - 0.5) * 0.12
    let d = angle - gateAngle
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    if (Math.abs(d) < GATE_HALF_ANGLE) continue
    placements.push({ angle, h, jitter, tiltX, tiltZ })
  }

  const stakeGeo = new THREE.CylinderGeometry(0.14, 0.2, 1, 5)
  stakeGeo.translate(0, 0.5, 0) // pivot at the base so per-instance height scaling works
  const tipGeo = new THREE.ConeGeometry(0.15, 0.35, 5)
  const mat = woodMat()
  const stakes = new THREE.InstancedMesh(stakeGeo, mat, placements.length)
  const tips = new THREE.InstancedMesh(tipGeo, mat, placements.length)
  stakes.castShadow = true
  tips.castShadow = true

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  placements.forEach((st, i) => {
    const r = PALISADE_RADIUS + st.jitter
    p.set(center.x + Math.cos(st.angle) * r, 0, center.z + Math.sin(st.angle) * r)
    e.set(st.tiltX, 0, st.tiltZ)
    q.setFromEuler(e)
    s.set(1, st.h, 1)
    m.compose(p, q, s)
    stakes.setMatrixAt(i, m)
    // tip rides the tilted stake top
    const tipOffset = up.clone().applyQuaternion(q).multiplyScalar(st.h)
    p.add(tipOffset)
    s.set(1, 1, 1)
    m.compose(p, q, s)
    tips.setMatrixAt(i, m)
  })
  group.add(stakes, tips)

  // gate posts + braziers at the edges of the arc
  for (const side of [-1, 1]) {
    const a = gateAngle + side * GATE_HALF_ANGLE
    const pos = new THREE.Vector3(
      center.x + Math.cos(a) * PALISADE_RADIUS,
      0,
      center.z + Math.sin(a) * PALISADE_RADIUS
    )
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 4.2, 6), mat)
    post.position.copy(pos).setY(2.1)
    post.castShadow = true
    group.add(post)

    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.2, 0.3, 7),
      new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.8 })
    )
    bowl.position.copy(pos).setY(4.35)
    group.add(bowl)
    makeFlame(group, pos.clone().setY(4.5), 0.8, 0xffa050, 14, 10)
  }
}

function buildCampfire(group: THREE.Group, center: THREE.Vector3): void {
  const rand = mulberry32(77)
  const stoneMat = new THREE.MeshStandardMaterial({ color: STONE_COLOR, roughness: 0.95 })
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + rand() * 0.1, 0), stoneMat)
    stone.position.set(center.x + Math.cos(a) * 0.85, 0.12, center.z + Math.sin(a) * 0.85)
    stone.rotation.set(rand() * Math.PI, rand() * Math.PI, 0)
    group.add(stone)
  }
  const logMat = woodMat()
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 5), logMat)
    log.position.set(center.x, 0.22, center.z)
    log.rotation.set(Math.PI / 2 - 0.5, (i / 3) * Math.PI * 2, 0)
    group.add(log)
  }
  // the fire that calls dead Trackers home
  makeFlame(group, new THREE.Vector3(center.x, 0.15, center.z), 1.6, 0xff8c3b, 40, 26)
}

function buildTent(group: THREE.Group, pos: THREE.Vector3): void {
  const tent = new THREE.Mesh(
    new THREE.ConeGeometry(2.6, 3.4, 7),
    new THREE.MeshStandardMaterial({ color: CANVAS_COLOR, roughness: 1 })
  )
  tent.position.copy(pos).setY(1.7)
  tent.castShadow = true
  group.add(tent)

  const slit = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x241d14, roughness: 1, side: THREE.DoubleSide })
  )
  // door slit faces the campfire (roughly +x/-z from the tent)
  slit.position.copy(pos).add(new THREE.Vector3(1.35, 0.85, -1.35))
  slit.lookAt(pos.x + 4, 0.85, pos.z - 4)
  group.add(slit)

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.9, 5), woodMat())
  pole.position.copy(pos).setY(1.95)
  group.add(pole)
}

function buildSmithStall(group: THREE.Group, pos: THREE.Vector3): void {
  const mat = woodMat()
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 2.4, 5)
  const corners: [number, number][] = [
    [-2.2, -1.5],
    [2.2, -1.5],
    [-2.2, 1.5],
    [2.2, 1.5],
  ]
  for (const [dx, dz] of corners) {
    const post = new THREE.Mesh(postGeo, mat)
    post.position.set(pos.x + dx, 1.1 + (dz > 0 ? 0 : 0.25), pos.z + dz)
    post.castShadow = true
    group.add(post)
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 3.6), mat)
  roof.position.copy(pos).setY(2.45)
  roof.rotation.x = 0.14
  roof.castShadow = true
  group.add(roof)

  const counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 0.5), mat)
  counter.position.set(pos.x, 0.45, pos.z + 1.5)
  group.add(counter)

  // anvil: two boxes on a stump
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x3d3d44, roughness: 0.5, metalness: 0.6 })
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.55, 7), mat)
  stump.position.set(pos.x - 0.6, 0.28, pos.z - 0.4)
  group.add(stump)
  const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.3), ironMat)
  anvilBase.position.set(pos.x - 0.6, 0.66, pos.z - 0.4)
  group.add(anvilBase)
  const anvilTop = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.16, 0.26), ironMat)
  anvilTop.position.set(pos.x - 0.6, 0.85, pos.z - 0.4)
  group.add(anvilTop)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.75, 9), mat)
  barrel.position.set(pos.x + 1.4, 0.38, pos.z - 0.8)
  group.add(barrel)
}

function buildWell(group: THREE.Group, pos: THREE.Vector3): void {
  const stoneMat = new THREE.MeshStandardMaterial({ color: STONE_COLOR, roughness: 0.95 })
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.8, 10, 1, true), stoneMat)
  ring.position.copy(pos).setY(0.4)
  ring.castShadow = true
  group.add(ring)
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.8, 12),
    new THREE.MeshStandardMaterial({ color: 0x0c1220, roughness: 0.2 })
  )
  water.rotation.x = -Math.PI / 2
  water.position.copy(pos).setY(0.55)
  group.add(water)

  const mat = woodMat()
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.8, 5), mat)
    post.position.set(pos.x + side * 0.85, 1.3, pos.z)
    group.add(post)
  }
  const roofL = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.6), mat)
  roofL.position.set(pos.x - 0.5, 2.35, pos.z)
  roofL.rotation.z = 0.6
  group.add(roofL)
  const roofR = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.6), mat)
  roofR.position.set(pos.x + 0.5, 2.35, pos.z)
  roofR.rotation.z = -0.6
  group.add(roofR)
}

function buildBeaconStones(group: THREE.Group, pos: THREE.Vector3): void {
  const rand = mulberry32(505)
  const stoneMat = new THREE.MeshStandardMaterial({ color: STONE_COLOR, roughness: 0.95 })
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const isBeacon = i === 0
    const mat = isBeacon
      ? new THREE.MeshStandardMaterial({
          color: STONE_COLOR,
          roughness: 0.8,
          emissive: 0xa855f7,
          emissiveIntensity: 0.25,
        })
      : stoneMat
    const h = 0.5 + rand() * 0.25
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, h, 5), mat)
    stone.position.set(pos.x + Math.cos(a) * 1.3, h / 2, pos.z + Math.sin(a) * 1.3)
    stone.rotation.y = rand() * Math.PI
    group.add(stone)
    if (isBeacon) beaconMat = mat
  }
}

function buildClutter(group: THREE.Group, center: THREE.Vector3): void {
  const rand = mulberry32(909)
  const mat = woodMat()
  // 3 crates near the stall
  for (let i = 0; i < 3; i++) {
    const s = 0.5 + rand() * 0.25
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat)
    crate.position.set(center.x + 8.2 + rand() * 1.4, s / 2, center.z + 0.5 + i * 1.1)
    crate.rotation.y = rand() * 0.8
    crate.castShadow = true
    group.add(crate)
  }
  // 2 barrels near the well
  for (let i = 0; i < 2; i++) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.8, 9), mat)
    barrel.position.set(center.x + 3.4 + i * 0.9, 0.4, center.z + 7.6)
    group.add(barrel)
  }
  // handcart by the gate
  const cart = new THREE.Group()
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1.0), mat)
  bed.position.y = 0.55
  cart.add(bed)
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 10), mat)
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(0, 0.42, side * 0.58)
    cart.add(wheel)
  }
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4, 5), mat)
  handle.rotation.z = 1.1
  handle.position.set(-1.2, 0.75, 0)
  cart.add(handle)
  cart.position.set(center.x - 6.5, 0, center.z - 8.5)
  cart.rotation.y = 0.7
  group.add(cart)
}

/** Builds Emberwatch around `center` with the gate opening toward `gateDir`. */
export function buildTown(scene: THREE.Scene, center: THREE.Vector3, gateDir: THREE.Vector3): void {
  const group = new THREE.Group()
  group.name = 'town'

  buildPalisade(group, center, gateDir)
  buildCampfire(group, center)
  buildTent(group, center.clone().add(new THREE.Vector3(-5, 0, 5)))
  buildSmithStall(group, center.clone().add(new THREE.Vector3(6, 0, -2)))
  buildWell(group, center.clone().add(new THREE.Vector3(5, 0, 6)))
  buildBeaconStones(group, center.clone().add(new THREE.Vector3(-6, 0, -6)))
  buildClutter(group, center)

  scene.add(group)
}

/** Flickers every flame (campfire, braziers, torches registered via town) and pulses the beacon. */
export function updateTown(dt: number): void {
  townTime += dt
  const t = townTime
  for (const f of flames) {
    const j1 = Math.sin(t * 9 + f.phase)
    const j2 = Math.sin(t * 13 + f.phase * 1.7)
    f.outer.scale.set(1 + j1 * 0.12, 1 + j2 * 0.18, 1 + j1 * 0.12)
    f.inner.scale.set(1 + j2 * 0.15, 1 + j1 * 0.22, 1 + j2 * 0.15)
    f.light.intensity = f.baseIntensity * (1 + (j1 * 0.12 + j2 * 0.08))
  }
  if (beaconMat) beaconMat.emissiveIntensity = 0.2 + (Math.sin(t * 1.5) * 0.5 + 0.5) * 0.2
}
