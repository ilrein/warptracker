import * as THREE from 'three'
import { mulberry32 } from './rng'
import type { EnemyKindId } from './enemy'

/**
 * The moor between Emberwatch and the Hollow Barrow: the old road (the
 * game's navigation system), the three Warpspire nests, the gallows tree,
 * and the corrupted Barrowfield. Geometry only — enemy/spire SPAWNING is
 * wired by the integrator from the data tables exported here.
 */

// Literal spec coordinates (kept local to avoid a circular import with world.ts).
const TOWN_CENTER_XZ = new THREE.Vector2(40, 40)
const BARROW_ENTRANCE_V = new THREE.Vector3(-46, 0, -46)

const EARTH_COLOR = 0x333c2a // must read against the ground, not vanish into it
const ROAD_COLOR = 0x262233
const BONE_COLOR = 0x4a4456
const WOOD_COLOR = 0x1d1826
const ROCK_COLOR = 0x2a2734

/** Gate → wagon → stones → gallows → barrow. Scatter rejects points near this. */
export const ROAD_POLYLINE: THREE.Vector3[] = [
  new THREE.Vector3(29, 0, 29),
  new THREE.Vector3(20, 0, 24),
  new THREE.Vector3(8, 0, 12),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(-12, 0, -4),
  new THREE.Vector3(-20, 0, -8),
  new THREE.Vector3(-34, 0, -28),
  new THREE.Vector3(-46, 0, -46),
]

/** Distance from a flat point to the old-road polyline. */
export function distanceToRoad(x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < ROAD_POLYLINE.length - 1; i++) {
    const a = ROAD_POLYLINE[i]!
    const b = ROAD_POLYLINE[i + 1]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const lenSq = abx * abx + abz * abz
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / lenSq)) : 0
    const dx = x - (a.x + abx * t)
    const dz = z - (a.z + abz * t)
    best = Math.min(best, Math.hypot(dx, dz))
  }
  return best
}

export interface NestSite {
  id: 'wagon' | 'stones' | 'gallows'
  name: string
  /** Warpspire position. */
  position: THREE.Vector3
  tier: number
  spireHp: number
  guards: EnemyKindId[]
}

/** The three overworld Warpspire nests (spec §3). Integrator spawns the spires + guards. */
export const NEST_SITES: NestSite[] = [
  {
    id: 'wagon',
    name: 'Wrecked Wagon',
    position: new THREE.Vector3(20, 0, 24),
    tier: 1,
    spireHp: 110,
    guards: ['skeleton', 'skeleton', 'skeleton', 'bat'],
  },
  {
    id: 'stones',
    name: 'Standing Stones',
    position: new THREE.Vector3(0, 0, 0),
    tier: 2,
    spireHp: 110,
    guards: ['skeleton', 'skeleton', 'skeleton', 'ghost', 'ghost'],
  },
  {
    id: 'gallows',
    name: 'Gallows Tree',
    position: new THREE.Vector3(-20, 0, -8),
    tier: 2,
    spireHp: 110,
    guards: ['ghost', 'ghost', 'bat', 'bat', 'bat'],
  },
]

export interface RoamerPack {
  id: string
  kinds: EnemyKindId[]
  positions: THREE.Vector3[]
  tier: number
  /** A dead pack respawns after this many seconds… */
  respawnSeconds: number
  /** …but only while the hero is at least this far from the anchor. */
  minHeroDistanceToRespawn: number
}

function roamTier(x: number, z: number): number {
  return Math.hypot(x - TOWN_CENTER_XZ.x, z - TOWN_CENTER_XZ.y) < 72 ? 1 : 2
}

function seedRoamers(): RoamerPack[] {
  const rand = mulberry32(4242)
  const packs: RoamerPack[] = []
  const kindsByPack: EnemyKindId[][] = [
    ['skeleton', 'skeleton'],
    ['skeleton', 'skeleton'],
    ['bat', 'bat'],
    ['bat', 'bat'],
  ]
  let attempts = 0
  while (packs.length < 4 && attempts < 400) {
    attempts++
    const angle = rand() * Math.PI * 2
    const radius = 18 + rand() * 42
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    if (Math.hypot(x - TOWN_CENTER_XZ.x, z - TOWN_CENTER_XZ.y) < 28) continue // town safe ring
    if (Math.hypot(x - BARROW_ENTRANCE_V.x, z - BARROW_ENTRANCE_V.z) < 24) continue
    if (NEST_SITES.some((n) => Math.hypot(x - n.position.x, z - n.position.z) < 10)) continue
    if (packs.some((p) => Math.hypot(x - p.positions[0]!.x, z - p.positions[0]!.z) < 14)) continue
    const i = packs.length
    packs.push({
      id: `roam-${i}`,
      kinds: kindsByPack[i]!,
      positions: [new THREE.Vector3(x - 1.2, 0, z), new THREE.Vector3(x + 1.2, 0, z + 0.8)],
      tier: roamTier(x, z),
      respawnSeconds: 30,
      minHeroDistanceToRespawn: 30,
    })
  }
  return packs
}

/** 4 seeded ambient packs of 2 — kill supply for Quest 1. Integrator spawns + respawns. */
export const ROAMER_PACKS: RoamerPack[] = seedRoamers()

export interface WardenPost {
  kind: EnemyKindId
  position: THREE.Vector3
  tier: number
}

/** Two grave-warden demons standing vigil in the Barrowfield. Never respawn. */
export const GRAVE_WARDENS: WardenPost[] = [
  { kind: 'demon', position: new THREE.Vector3(-38, 0, -43), tier: 3 },
  { kind: 'demon', position: new THREE.Vector3(-43, 0, -35), tier: 3 },
]

/** The roaming elite that patrols a ~14-unit loop between the gallows and the Barrowfield. */
export const ELITE_PATROL: { kind: EnemyKindId; tier: number; path: [THREE.Vector3, THREE.Vector3] } = {
  kind: 'demon',
  tier: 3,
  path: [new THREE.Vector3(-24, 0, -12), new THREE.Vector3(-34, 0, -22)],
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

let cagePivot: THREE.Group | null = null
let moorTime = 0

function buildRoad(group: THREE.Group): void {
  const rand = mulberry32(1101)
  const mat = new THREE.MeshStandardMaterial({ color: ROAD_COLOR, roughness: 1 })
  // ~26 worn patches spaced evenly along the polyline
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i < ROAD_POLYLINE.length - 1; i++) {
    const l = ROAD_POLYLINE[i]!.distanceTo(ROAD_POLYLINE[i + 1]!)
    lengths.push(l)
    total += l
  }
  const count = 26
  for (let i = 0; i < count; i++) {
    let d = (i / (count - 1)) * total
    let seg = 0
    while (seg < lengths.length - 1 && d > lengths[seg]!) {
      d -= lengths[seg]!
      seg++
    }
    const a = ROAD_POLYLINE[seg]!
    const b = ROAD_POLYLINE[seg + 1]!
    const t = Math.min(1, d / Math.max(0.001, lengths[seg]!))
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1.6 + rand() * 0.8, 10), mat)
    patch.rotation.x = -Math.PI / 2
    patch.position.set(
      a.x + (b.x - a.x) * t + (rand() - 0.5) * 1.2,
      0.02,
      a.z + (b.z - a.z) * t + (rand() - 0.5) * 1.2
    )
    patch.receiveShadow = true
    group.add(patch)
  }
}

function buildWreckedWagon(group: THREE.Group, pos: THREE.Vector3): void {
  const mat = new THREE.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 1 })
  const cart = new THREE.Group()
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.5), mat)
  bed.position.y = 0.75
  bed.rotation.z = 0.28 // collapsed on the broken axle
  bed.castShadow = true
  cart.add(bed)
  for (const side of [-1, 1]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.1), mat)
    board.position.set(0, 1.08, side * 0.75)
    board.rotation.z = 0.28
    cart.add(board)
  }
  // one wheel on, one thrown clear
  const wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.12, 12)
  const wheelOn = new THREE.Mesh(wheelGeo, mat)
  wheelOn.rotation.x = Math.PI / 2
  wheelOn.position.set(0.9, 0.62, 0.85)
  cart.add(wheelOn)
  const wheelOff = new THREE.Mesh(wheelGeo, mat)
  wheelOff.rotation.set(Math.PI / 2 - 1.3, 0.4, 0)
  wheelOff.position.set(-2.1, 0.18, 1.4)
  cart.add(wheelOff)
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat)
  crate.position.set(1.7, 0.3, -0.9)
  crate.rotation.y = 0.5
  cart.add(crate)
  cart.position.set(pos.x + 2.6, 0, pos.z + 1.8)
  cart.rotation.y = -0.6
  group.add(cart)
}

function buildStandingStones(group: THREE.Group, pos: THREE.Vector3): void {
  const rand = mulberry32(31)
  const mat = new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.9 })
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    // existing broken-pillar recipe ×2.5
    const h = (1 + rand() * 2.6) * 2.5
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * 2.5, 0.45 * 2.5, h, 6), mat)
    stone.position.set(pos.x + Math.cos(a) * 6, h / 2, pos.z + Math.sin(a) * 6)
    stone.rotation.z = (rand() - 0.5) * 0.35
    stone.rotation.y = rand() * Math.PI
    stone.castShadow = true
    group.add(stone)
  }
}

function buildGallowsTree(group: THREE.Group, nestPos: THREE.Vector3): void {
  const mat = new THREE.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 1 })
  const rand = mulberry32(66)
  const tree = new THREE.Group()
  const h = 9
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.84, h, 6), mat)
  trunk.position.y = h / 2
  trunk.castShadow = true
  tree.add(trunk)
  for (let b = 0; b < 5; b++) {
    const bl = 2 + rand() * 2.6
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.2, bl, 4), mat)
    branch.position.y = h * (0.55 + rand() * 0.4)
    branch.rotation.z = (rand() - 0.5) * 2.4
    branch.rotation.y = rand() * Math.PI * 2
    branch.translateY(bl / 2)
    branch.castShadow = true
    tree.add(branch)
  }

  // the hanging cage, swinging from a heavy bough
  const bough = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 3.4, 5), mat)
  bough.position.set(0, 7.2, 0)
  bough.rotation.z = Math.PI / 2 - 0.15
  bough.translateY(1.7)
  tree.add(bough)

  const pivot = new THREE.Group()
  pivot.position.set(3.1, 7.6, 0)
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4), mat)
  chain.position.y = -0.8
  pivot.add(chain)
  const cage = new THREE.Group()
  cage.position.y = -2.4
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2c2a30, roughness: 0.6, metalness: 0.5 })
  for (const y of [-0.7, 0, 0.7]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 14), ironMat)
    band.rotation.x = Math.PI / 2
    band.position.y = y
    cage.add(band)
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.06), ironMat)
    bar.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55)
    cage.add(bar)
  }
  pivot.add(cage)
  tree.add(pivot)
  cagePivot = pivot

  tree.position.set(nestPos.x - 2.5, 0, nestPos.z - 1.5)
  group.add(tree)
}

function buildBarrowfield(group: THREE.Group): void {
  const rand = mulberry32(1919)
  const earthMat = new THREE.MeshStandardMaterial({ color: EARTH_COLOR, roughness: 1 })
  const boneMat = new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.9 })
  const center = BARROW_ENTRANCE_V

  for (let i = 0; i < 9; i++) {
    // ring the mounds around the entrance, leaving the door approach clear
    const a = (i / 9) * Math.PI * 2 + rand() * 0.4
    const r = 8 + rand() * 10
    const x = center.x + Math.cos(a) * r
    const z = center.z + Math.sin(a) * r
    if (Math.hypot(x - (center.x + 6), z - (center.z + 6)) < 5) continue // keep the doorway open
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), earthMat)
    mound.scale.set(2.4, 0.8, 1.7)
    mound.position.set(x, 0.1, z)
    mound.rotation.y = rand() * Math.PI
    mound.castShadow = true
    group.add(mound)
  }
  // bone piles between the mounds
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2
    const r = 4 + rand() * 15
    const s = 0.18 + rand() * 0.3
    const bone = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), boneMat)
    bone.position.set(center.x + Math.cos(a) * r, s * 0.4, center.z + Math.sin(a) * r)
    bone.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    group.add(bone)
  }
  // a few blighted rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: ROCK_COLOR, roughness: 0.95 })
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2
    const r = 10 + rand() * 8
    const s = 0.5 + rand() * 1.1
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat)
    rock.position.set(center.x + Math.cos(a) * r, s * 0.4, center.z + Math.sin(a) * r)
    rock.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    group.add(rock)
  }
}

/** Builds the old road, the three nests and the Barrowfield dressing. */
export function buildMoor(scene: THREE.Scene): void {
  const group = new THREE.Group()
  group.name = 'moor'
  buildRoad(group)
  buildWreckedWagon(group, NEST_SITES[0]!.position)
  buildStandingStones(group, NEST_SITES[1]!.position)
  buildGallowsTree(group, NEST_SITES[2]!.position)
  buildBarrowfield(group)
  scene.add(group)
}

/** Swings the gallows cage. */
export function updateMoor(dt: number): void {
  moorTime += dt
  if (cagePivot) {
    cagePivot.rotation.z = Math.sin(moorTime * 0.7) * 0.12
    cagePivot.rotation.x = Math.sin(moorTime * 0.53 + 1.3) * 0.05
  }
}
