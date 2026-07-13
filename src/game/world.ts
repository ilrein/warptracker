import * as THREE from 'three'
import { mulberry32 } from './rng'
import { buildTown, updateTown } from './town'
import { buildMoor, updateMoor, distanceToRoad } from './moor'
import {
  buildDungeon,
  updateDungeon,
  WALL_AABBS,
  DOOR_WORLD_POINT,
  EXIT_STAIRS_WORLD_POINT,
} from './dungeon'

/**
 * The static world: one circular moor with Emberwatch in the south-east and
 * the Hollow Barrow in the north-west; the dungeon interior lives in the same
 * scene at a far XZ offset. Also home of the shared collision resolver used
 * by the hero and every enemy.
 */

export const WORLD_RADIUS = 78
export const TOWN_CENTER = new THREE.Vector3(40, 0, 40)
export const TOWN_RADIUS = 16
export const GATE_DIR = new THREE.Vector3(-1, 0, -1).normalize()
export const BARROW_ENTRANCE = new THREE.Vector3(-46, 0, -46)
export const BARROW_FIELD_RADIUS = 20
export const DUNGEON_ORIGIN = new THREE.Vector3(400, 0, 400)

export interface DungeonPortals {
  /** The barrow doorway point on the moor (trigger radius ≈1.4). */
  entry: THREE.Vector3
  /** The exit stairs point inside the dungeon (trigger radius ≈1.4). */
  exitInside: THREE.Vector3
}

export const PORTALS: DungeonPortals = {
  entry: DOOR_WORLD_POINT,
  exitInside: EXIT_STAIRS_WORLD_POINT,
}

/** Hard edge of walkable ground on the moor. */
const RIM_RADIUS = WORLD_RADIUS + 6
/** Everything past this x is the dungeon interior: AABB collision, no rim. */
const DUNGEON_X_THRESHOLD = 250
/** Palisade blocking band around TOWN_CENTER. */
const PALISADE_INNER = 14.4
const PALISADE_OUTER = 15.6
/** cos(25°): half of the 50° gate arc facing GATE_DIR. */
const GATE_ARC_COS = Math.cos((25 * Math.PI) / 180)
/** Body radius padding applied to walls and the palisade band. */
const COLLIDER_PAD = 0.45

const MOON_OFFSET = new THREE.Vector3(-30, 40, -20)

interface WorldLights {
  hemi: THREE.HemisphereLight
  moon: THREE.DirectionalLight
}

let lights: WorldLights | null = null

/** The lights ZoneDirector drives. Valid after buildWorld(). */
export function getWorldLights(): WorldLights {
  if (!lights) throw new Error('buildWorld() has not run yet')
  return lights
}

/** Builds ground, sky lights and scatter, then the town, moor and dungeon. */
export function buildWorld(scene: THREE.Scene): void {
  // start in the town preset — the hero wakes at the Emberwatch fire
  scene.background = new THREE.Color(0x0a0712)
  scene.fog = new THREE.FogExp2(0x0a0712, 0.014)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD_RADIUS + 18, 96),
    new THREE.MeshStandardMaterial({ color: 0x1d1a29, roughness: 1 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.name = 'ground'
  scene.add(ground)

  const hemi = new THREE.HemisphereLight(0x8a7a64, 0x3a2c1e, 4.0)
  scene.add(hemi)

  const moon = new THREE.DirectionalLight(0x9ab2dc, 2.2)
  moon.position.copy(MOON_OFFSET)
  moon.castShadow = true
  moon.shadow.mapSize.set(2048, 2048)
  const cam = moon.shadow.camera
  cam.left = -40
  cam.right = 40
  cam.top = 40
  cam.bottom = -40
  scene.add(moon)
  scene.add(moon.target) // the shadow box follows the hero via updateWorld
  lights = { hemi, moon }

  buildTown(scene, TOWN_CENTER, GATE_DIR)
  buildMoor(scene)
  buildDungeon(scene)
  scatterDecor(scene)
}

/**
 * Shared movement collision for hero and enemies. Resolves, in order:
 * dungeon wall AABBs (when in the interior), the world rim, and the palisade
 * ring with its gate arc. Returns the adjusted position (slide, not stop).
 */
export function resolveCollision(current: THREE.Vector3, next: THREE.Vector3): THREE.Vector3 {
  const out = next.clone()

  if (out.x > DUNGEON_X_THRESHOLD) {
    collideWallAabbs(current, out)
    return out
  }

  // world rim
  const flat = Math.hypot(out.x, out.z)
  if (flat > RIM_RADIUS) {
    const s = RIM_RADIUS / flat
    out.x *= s
    out.z *= s
  }

  // palisade band, passable only through the gate arc
  const dx = out.x - TOWN_CENTER.x
  const dz = out.z - TOWN_CENTER.z
  const dist = Math.hypot(dx, dz)
  if (dist > PALISADE_INNER - COLLIDER_PAD && dist < PALISADE_OUTER + COLLIDER_PAD && dist > 0.001) {
    const inGate = (dx / dist) * GATE_DIR.x + (dz / dist) * GATE_DIR.z >= GATE_ARC_COS
    if (!inGate) {
      const curDist = Math.hypot(current.x - TOWN_CENTER.x, current.z - TOWN_CENTER.z)
      const mid = (PALISADE_INNER + PALISADE_OUTER) / 2
      const target = curDist < mid ? PALISADE_INNER - COLLIDER_PAD : PALISADE_OUTER + COLLIDER_PAD
      const s = target / dist
      out.x = TOWN_CENTER.x + dx * s
      out.z = TOWN_CENTER.z + dz * s
    }
  }

  return out
}

/** Axis-separated AABB resolution so walls feel slippery, not sticky. */
function collideWallAabbs(current: THREE.Vector3, out: THREE.Vector3): void {
  for (const w of WALL_AABBS) {
    if (current.z > w.minZ - COLLIDER_PAD && current.z < w.maxZ + COLLIDER_PAD) {
      if (out.x > w.minX - COLLIDER_PAD && out.x < w.maxX + COLLIDER_PAD) {
        out.x = current.x >= (w.minX + w.maxX) / 2 ? w.maxX + COLLIDER_PAD : w.minX - COLLIDER_PAD
      }
    }
  }
  for (const w of WALL_AABBS) {
    if (out.x > w.minX - COLLIDER_PAD && out.x < w.maxX + COLLIDER_PAD) {
      if (out.z > w.minZ - COLLIDER_PAD && out.z < w.maxZ + COLLIDER_PAD) {
        out.z = current.z >= (w.minZ + w.maxZ) / 2 ? w.maxZ + COLLIDER_PAD : w.minZ - COLLIDER_PAD
      }
    }
  }
}

/** Moon shadow-box follows the hero; town flames, gallows cage and torches animate. */
export function updateWorld(dt: number, heroPos: THREE.Vector3): void {
  if (lights) {
    lights.moon.position.copy(heroPos).add(MOON_OFFSET)
    lights.moon.target.position.copy(heroPos)
  }
  updateTown(dt)
  updateMoor(dt)
  updateDungeon(dt)
}

/** Seeded gothic scatter, rejecting the town, the old road and the Barrowfield. */
function scatterDecor(scene: THREE.Scene): void {
  const rand = mulberry32(20260713)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2734, roughness: 0.95 })
  const boneMat = new THREE.MeshStandardMaterial({ color: 0x4a4456, roughness: 0.9 })
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x1d1826, roughness: 1 })

  const decor = new THREE.Group()
  decor.name = 'decor'

  let placed = 0
  let attempts = 0
  while (placed < 150 && attempts < 900) {
    attempts++
    const angle = rand() * Math.PI * 2
    const radius = 8 + rand() * (WORLD_RADIUS + 6 - 8)
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius

    // rejection zones: town, road, barrowfield
    if (Math.hypot(x - TOWN_CENTER.x, z - TOWN_CENTER.z) < TOWN_RADIUS + 2) continue
    if (distanceToRoad(x, z) < 3) continue
    if (Math.hypot(x - BARROW_ENTRANCE.x, z - BARROW_ENTRANCE.z) < BARROW_FIELD_RADIUS) continue

    placed++
    const kind = rand()
    let mesh: THREE.Mesh
    if (kind < 0.5) {
      // jagged rock
      const s = 0.4 + rand() * 1.6
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat)
      mesh.position.set(x, s * 0.4, z)
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    } else if (kind < 0.8) {
      // dead tree: trunk + a couple of bare branches
      const tree = new THREE.Group()
      const h = 2.5 + rand() * 3
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, h, 5), trunkMat)
      trunk.position.y = h / 2
      trunk.castShadow = true
      tree.add(trunk)
      for (let b = 0; b < 3; b++) {
        const bl = 0.8 + rand() * 1.4
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, bl, 4), trunkMat)
        branch.position.y = h * (0.55 + rand() * 0.4)
        branch.rotation.z = (rand() - 0.5) * 2.2
        branch.rotation.y = rand() * Math.PI * 2
        branch.translateY(bl / 2)
        tree.add(branch)
      }
      tree.position.set(x, 0, z)
      tree.rotation.z = (rand() - 0.5) * 0.15
      decor.add(tree)
      continue
    } else {
      // broken pillar / old monolith
      const h = 1 + rand() * 2.6
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, h, 6), boneMat)
      mesh.position.set(x, h / 2, z)
      mesh.rotation.z = (rand() - 0.5) * 0.35
      mesh.rotation.y = rand() * Math.PI
    }
    mesh.castShadow = true
    decor.add(mesh)
  }
  scene.add(decor)
}
