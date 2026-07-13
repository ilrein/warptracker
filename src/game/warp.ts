import * as THREE from 'three'
import { Enemy, type EnemyKindId } from './enemy'

const SPAWN_INTERVAL = 2.7
const ALIVE_CAP = 4

function rollKind(rand: number): EnemyKindId {
  if (rand < 0.5) return 'skeleton'
  if (rand < 0.75) return 'bat'
  return 'ghost'
}

/**
 * A warp — a tear in the world through which evil streams in.
 * It spawns warpspawn from a finite budget; the final spawn is always an
 * elite demon guardian. Once the budget is spent and every creature it
 * birthed is dead, the warp collapses and seals.
 */
export class Warp {
  group = new THREE.Group()
  closed = false
  private budget: number
  private spawnTimer = 1.2
  private spawned: Enemy[] = []
  private ring: THREE.Mesh
  private core: THREE.Mesh
  private light: THREE.PointLight
  private motes: THREE.Mesh[] = []
  private closingT = -1
  private scene: THREE.Scene
  private rift: number
  private pulseSeed = Math.random() * 10

  onSpawn?: (enemy: Enemy) => void
  onClosed?: () => void

  constructor(scene: THREE.Scene, position: THREE.Vector3, rift: number) {
    this.scene = scene
    this.rift = rift
    this.budget = 5 + rift * 2

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.14, 10, 40),
      new THREE.MeshStandardMaterial({
        color: 0x2e1065,
        emissive: 0xa855f7,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      })
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.25
    this.group.add(this.ring)

    this.core = new THREE.Mesh(
      new THREE.CircleGeometry(1.45, 32),
      new THREE.MeshBasicMaterial({
        color: 0x7c3aed,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )
    this.core.rotation.x = -Math.PI / 2
    this.core.position.y = 0.12
    this.group.add(this.core)

    const moteGeo = new THREE.SphereGeometry(0.09, 6, 6)
    const moteMat = new THREE.MeshBasicMaterial({ color: 0xc4b5fd })
    for (let i = 0; i < 5; i++) {
      const mote = new THREE.Mesh(moteGeo, moteMat)
      this.motes.push(mote)
      this.group.add(mote)
    }

    this.light = new THREE.PointLight(0x9333ea, 30, 18, 1.9)
    this.light.position.y = 1.6
    this.group.add(this.light)

    this.group.position.copy(position)
    scene.add(this.group)
  }

  get position(): THREE.Vector3 {
    return this.group.position
  }

  private aliveCount(): number {
    return this.spawned.filter((e) => e.alive).length
  }

  update(dt: number): void {
    if (this.closed) return

    const t = performance.now() * 0.001 + this.pulseSeed

    if (this.closingT >= 0) {
      this.closingT += dt
      const k = Math.max(0, 1 - this.closingT / 0.9)
      this.group.scale.setScalar(k)
      this.light.intensity = 30 * k + 60 * (1 - k) * k
      if (this.closingT >= 0.9) {
        this.closed = true
        this.scene.remove(this.group)
        this.onClosed?.()
      }
      return
    }

    this.ring.rotation.z = t * 0.8
    const pulse = 1 + Math.sin(t * 3) * 0.07
    this.ring.scale.setScalar(pulse)
    ;(this.core.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(t * 2.4) * 0.18
    this.light.intensity = 26 + Math.sin(t * 3) * 7

    this.motes.forEach((mote, i) => {
      const a = t * 1.4 + (i / this.motes.length) * Math.PI * 2
      mote.position.set(Math.cos(a) * 1.6, 0.5 + Math.sin(t * 2 + i) * 0.5, Math.sin(a) * 1.6)
    })

    if (this.budget > 0) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0 && this.aliveCount() < ALIVE_CAP) {
        this.spawnTimer = SPAWN_INTERVAL
        this.budget--
        // the last thing out of every warp is its elite guardian
        const kind: EnemyKindId = this.budget === 0 ? 'demon' : rollKind(Math.random())
        const angle = Math.random() * Math.PI * 2
        const pos = this.position
          .clone()
          .add(new THREE.Vector3(Math.cos(angle) * 1.2, 0, Math.sin(angle) * 1.2))
        const enemy = new Enemy(this.scene, pos, this.rift, kind)
        this.spawned.push(enemy)
        this.onSpawn?.(enemy)
      }
    } else if (this.aliveCount() === 0) {
      this.closingT = 0
    }
  }
}
