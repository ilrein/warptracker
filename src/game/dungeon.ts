import * as THREE from 'three'
import { mulberry32 } from './rng'
import type { EnemyKindId } from './enemy'

/**
 * The Hollow Barrow: the earthen entrance mound on the moor and the dungeon
 * interior, which lives in the same scene at a far XZ offset (fog + black
 * background hide it). Geometry, wall collision AABBs and torch lighting
 * only — spire/enemy SPAWNING is wired by the integrator from SPIRE_SITES.
 */

// Literal spec coordinates (kept local to avoid a circular import with world.ts).
const ORIGIN = new THREE.Vector3(400, 0, 400)
const ENTRANCE = new THREE.Vector3(-46, 0, -46)
/** The mound doorway faces back up the old road, toward the town. */
const DOOR_DIR = new THREE.Vector3(1, 0, 1).normalize()

/** Waist-high ruin walls — full-height walls occluded the hero across half the interior. */
const WALL_HEIGHT = 1.7
const WALL_THICKNESS = 0.8
const STONE_COLOR = 0x2b2530
const FLOOR_COLOR = 0x201b28
const EARTH_COLOR = 0x1a1f16
const BONE_COLOR = 0x4a4456

/** Outside trigger point: hero within 1.4 → fade + teleport to ORIGIN + (0,0,5). */
export const DOOR_WORLD_POINT: THREE.Vector3 = ENTRANCE.clone().addScaledVector(DOOR_DIR, 7.2)
/** Inside trigger point (the exit stairs): hero within 1.4 → teleport back to DOOR_WORLD_POINT. */
export const EXIT_STAIRS_WORLD_POINT: THREE.Vector3 = ORIGIN.clone().add(new THREE.Vector3(0, 0, 5.2))

export interface WallAabb {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Local wall runs: [x1, z1, x2, z2], axis-aligned, doorway gaps already cut. */
const WALL_RUNS: [number, number, number, number][] = [
  // entry chamber 12×12 @ (0,0)
  [-6, 6, 6, 6],
  [6, -6, 6, 6],
  [-6, -6, -6, 6],
  [-6, -6, -1.5, -6],
  [1.5, -6, 6, -6],
  // corridor 4 wide × 18 long, z -6 → -24
  [-2, -10.5, -2, -6],
  [-2, -24, -2, -13.5],
  [2, -14.5, 2, -6],
  [2, -24, 2, -17.5],
  // doorway stubs: corridor → crypt
  [-4, -10.5, -2, -10.5],
  [-4, -13.5, -2, -13.5],
  // doorway stubs: corridor → ossuary
  [2, -14.5, 4, -14.5],
  [2, -17.5, 4, -17.5],
  // crypt 10×10 @ (-9,-12)
  [-14, -7, -4, -7],
  [-14, -17, -4, -17],
  [-14, -17, -14, -7],
  [-4, -10.5, -4, -7],
  [-4, -17, -4, -13.5],
  // ossuary 10×10 @ (9,-16)
  [4, -11, 14, -11],
  [4, -21, 14, -21],
  [14, -21, 14, -11],
  [4, -14.5, 4, -11],
  [4, -21, 4, -17.5],
  // vault 20×16 @ (0,-32)
  [-10, -24, -1.5, -24],
  [1.5, -24, 10, -24],
  [-10, -40, 10, -40],
  [-10, -40, -10, -24],
  [10, -40, 10, -24],
]

function toAabb([x1, z1, x2, z2]: [number, number, number, number]): WallAabb {
  const half = WALL_THICKNESS / 2
  return {
    minX: ORIGIN.x + Math.min(x1, x2) - half,
    maxX: ORIGIN.x + Math.max(x1, x2) + half,
    minZ: ORIGIN.z + Math.min(z1, z2) - half,
    maxZ: ORIGIN.z + Math.max(z1, z2) + half,
  }
}

/** World-space wall boxes, consumed by world.resolveCollision for hero + enemies. */
export const WALL_AABBS: WallAabb[] = WALL_RUNS.map(toAabb)

export interface SpireSite {
  id: 'crypt' | 'ossuary' | 'heart'
  /** World-space position. */
  position: THREE.Vector3
  hp: number
  tier: number
  guards: EnemyKindId[]
  isHeart: boolean
  /** Named elite spawned alongside `guards` (Gorthul, ×1.6 scale). */
  boss?: { kind: EnemyKindId; name: string; scale: number }
}

/** Dungeon Warpspire placements. Integrator constructs WarpSpires + guards from this. */
export const SPIRE_SITES: SpireSite[] = [
  {
    id: 'crypt',
    position: ORIGIN.clone().add(new THREE.Vector3(-9, 0, -12)),
    hp: 140,
    tier: 3,
    guards: ['skeleton', 'skeleton', 'skeleton', 'skeleton'],
    isHeart: false,
  },
  {
    id: 'ossuary',
    position: ORIGIN.clone().add(new THREE.Vector3(9, 0, -16)),
    hp: 140,
    tier: 3,
    guards: ['bat', 'bat', 'bat', 'bat', 'bat'],
    isHeart: false,
  },
  {
    id: 'heart',
    position: ORIGIN.clone().add(new THREE.Vector3(0, 0, -36.5)),
    hp: 320,
    tier: 3,
    guards: ['ghost', 'ghost'],
    isHeart: true,
    boss: { kind: 'demon', name: 'Gorthul, Warden of the First Warp', scale: 1.6 },
  },
]

export interface Poi {
  position: THREE.Vector3
  text: string
  radius: number
}

/** Act II tease: the sealed door at the back of the vault. Marker text only, no interaction. */
export const ACT2_DOOR_POI: Poi = {
  position: ORIGIN.clone().add(new THREE.Vector3(0, 0, -39.4)),
  text: 'The stream runs deeper.',
  radius: 2,
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Torch {
  flame: THREE.Mesh
  light: THREE.PointLight
  baseIntensity: number
  phase: number
}

const torches: Torch[] = []
let dungeonTime = 0

function makeTorch(parent: THREE.Object3D, pos: THREE.Vector3, intensity = 18): void {
  const bracket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 0.55, 5),
    new THREE.MeshStandardMaterial({ color: 0x241d14, roughness: 1 })
  )
  bracket.position.copy(pos)
  parent.add(bracket)

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.42, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffa640,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  flame.position.copy(pos).add(new THREE.Vector3(0, 0.45, 0))
  parent.add(flame)

  const light = new THREE.PointLight(0xff9a3d, intensity, 12, 1.8)
  light.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0))
  parent.add(light)

  torches.push({ flame, light, baseIntensity: intensity, phase: Math.random() * 10 })
}

function buildMound(scene: THREE.Scene): void {
  const group = new THREE.Group()
  group.name = 'barrow-mound'

  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(7, 18, 12),
    new THREE.MeshStandardMaterial({ color: EARTH_COLOR, roughness: 1 })
  )
  mound.scale.y = 0.45
  mound.position.copy(ENTRANCE).setY(-0.4)
  mound.castShadow = true
  mound.receiveShadow = true
  group.add(mound)

  const yaw = Math.atan2(DOOR_DIR.x, DOOR_DIR.z)
  const perp = new THREE.Vector3(-DOOR_DIR.z, 0, DOOR_DIR.x)
  const doorBase = ENTRANCE.clone().addScaledVector(DOOR_DIR, 6.9)

  const boneMat = new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.9 })
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 0.8), boneMat)
    jamb.position.copy(doorBase).addScaledVector(perp, side * 1.15).setY(1.5)
    jamb.rotation.y = yaw
    jamb.castShadow = true
    group.add(jamb)
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 0.9), boneMat)
  lintel.position.copy(doorBase).setY(3.1)
  lintel.rotation.y = yaw
  lintel.castShadow = true
  group.add(lintel)

  // the black mouth of the barrow
  const maw = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 2.8),
    new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
  )
  maw.position.copy(ENTRANCE).addScaledVector(DOOR_DIR, 6.55).setY(1.4)
  maw.rotation.y = yaw
  group.add(maw)

  for (const side of [-1, 1]) {
    makeTorch(
      group,
      ENTRANCE.clone().addScaledVector(DOOR_DIR, 7.4).addScaledVector(perp, side * 1.9).setY(1.1),
      16
    )
  }

  scene.add(group)
}

function buildInterior(scene: THREE.Scene): void {
  const group = new THREE.Group()
  group.name = 'barrow-interior'
  group.position.copy(ORIGIN)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(38, 56),
    new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 1 })
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, -17)
  floor.receiveShadow = true
  group.add(floor)

  const wallMat = new THREE.MeshStandardMaterial({ color: STONE_COLOR, roughness: 0.9 })
  for (const [x1, z1, x2, z2] of WALL_RUNS) {
    const lenX = Math.abs(x2 - x1)
    const lenZ = Math.abs(z2 - z1)
    // extend runs by half thickness so corners close
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(
        (lenX > lenZ ? lenX : 0) + WALL_THICKNESS,
        WALL_HEIGHT,
        (lenZ >= lenX ? lenZ : 0) + WALL_THICKNESS
      ),
      wallMat
    )
    wall.position.set((x1 + x2) / 2, WALL_HEIGHT / 2, (z1 + z2) / 2)
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)
  }

  // exit stairs against the +Z wall of the entry chamber
  const stairMat = new THREE.MeshStandardMaterial({ color: 0x352e3c, roughness: 0.9 })
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18 + i * 0.18, 0.55), stairMat)
    step.position.set(0, (0.18 + i * 0.18) / 2, 4.5 + i * 0.55)
    group.add(step)
  }

  // crypt: 4 sarcophagi
  const rand = mulberry32(1204)
  for (const [sx, sz] of [
    [-11.5, -9.5],
    [-6.5, -9.5],
    [-11.5, -14.5],
    [-6.5, -14.5],
  ] as const) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 0.9), stairMat)
    box.position.set(sx, 0.35, sz)
    box.rotation.y = (rand() - 0.5) * 0.2
    box.castShadow = true
    group.add(box)
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 1.0), wallMat)
    lid.position.set(sx + (rand() - 0.5) * 0.3, 0.77, sz)
    lid.rotation.y = box.rotation.y + (rand() - 0.5) * 0.25
    group.add(lid)
  }

  // ossuary: heaped bone piles
  const boneMat = new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.9 })
  for (let i = 0; i < 12; i++) {
    const s = 0.15 + rand() * 0.28
    const bone = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), boneMat)
    bone.position.set(5.5 + rand() * 7.5, s * 0.4, -20 + rand() * 8.2)
    bone.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    group.add(bone)
  }

  // the sealed Act II door in the vault's far wall
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 3.2, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.6 })
  )
  door.position.set(0, 1.6, -39.45)
  group.add(door)
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 2.9, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x1a0505,
      emissive: 0xdc2626,
      emissiveIntensity: 0.9,
      roughness: 0.5,
    })
  )
  seam.position.set(0, 1.55, -39.24)
  group.add(seam)

  // torches: entry pair, corridor alternating, one per side room, four in the vault
  const torchPoints: [number, number][] = [
    [-2.2, -5.4],
    [2.2, -5.4],
    [-1.5, -10],
    [1.5, -19],
    [-9, -7.7],
    [9, -11.7],
    [-9.4, -25],
    [9.4, -25],
    [-9.4, -37.5],
    [9.4, -37.5],
  ]
  for (const [tx, tz] of torchPoints) {
    makeTorch(group, new THREE.Vector3(tx, 1.7, tz))
  }

  scene.add(group)
}

/** Builds the barrow mound on the moor and the interior at the far offset. */
export function buildDungeon(scene: THREE.Scene): void {
  buildMound(scene)
  buildInterior(scene)
}

/** Flickers every barrow torch. */
export function updateDungeon(dt: number): void {
  dungeonTime += dt
  const t = dungeonTime
  for (const torch of torches) {
    const j = Math.sin(t * 11 + torch.phase) * 0.5 + Math.sin(t * 7.3 + torch.phase * 2.1) * 0.5
    torch.light.intensity = torch.baseIntensity * (1 + j * 0.18)
    torch.flame.scale.set(1 + j * 0.15, 1 + j * 0.25, 1 + j * 0.15)
  }
}
