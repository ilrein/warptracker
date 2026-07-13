import * as THREE from 'three'
import type { Hero } from './hero'

let enemyMatCache: {
  body: THREE.MeshStandardMaterial
  elite: THREE.MeshStandardMaterial
  eye: THREE.MeshBasicMaterial
} | null = null

function materials() {
  enemyMatCache ??= {
    body: new THREE.MeshStandardMaterial({ color: 0x3d1220, roughness: 0.75 }),
    elite: new THREE.MeshStandardMaterial({
      color: 0x1a0b2e,
      roughness: 0.6,
      emissive: 0x4c1d95,
      emissiveIntensity: 0.5,
    }),
    eye: new THREE.MeshBasicMaterial({ color: 0xff2244 }),
  }
  return enemyMatCache
}

/** A warpspawn — twisted creature that pours out of a warp and hunts the Tracker. */
export class Enemy {
  group = new THREE.Group()
  hp: number
  maxHp: number
  alive = true
  readonly elite: boolean
  private speed: number
  private damage: number
  private attackTimer = 0
  private wobbleSeed = Math.random() * 100
  private scene: THREE.Scene

  onHitHero?: (amount: number) => void

  constructor(scene: THREE.Scene, position: THREE.Vector3, rift: number, elite: boolean) {
    this.scene = scene
    this.elite = elite
    const scale = elite ? 1.7 : 1
    this.maxHp = Math.round((26 + rift * 9) * (elite ? 3.2 : 1))
    this.hp = this.maxHp
    this.speed = (2.5 + Math.min(rift * 0.15, 1.5)) * (elite ? 0.85 : 1)
    this.damage = Math.round((5 + rift * 2) * (elite ? 1.8 : 1))

    const m = materials()
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * scale, 0), elite ? m.elite : m.body)
    body.position.y = 0.6 * scale
    body.castShadow = true
    this.group.add(body)

    const hornGeo = new THREE.ConeGeometry(0.09 * scale, 0.4 * scale, 5)
    const hornL = new THREE.Mesh(hornGeo, elite ? m.elite : m.body)
    hornL.position.set(-0.22 * scale, 1.05 * scale, 0)
    hornL.rotation.z = 0.35
    const hornR = hornL.clone()
    hornR.position.x *= -1
    hornR.rotation.z *= -1
    this.group.add(hornL, hornR)

    const eyeGeo = new THREE.SphereGeometry(0.07 * scale, 8, 8)
    const eyeL = new THREE.Mesh(eyeGeo, m.eye)
    eyeL.position.set(-0.15 * scale, 0.72 * scale, 0.42 * scale)
    const eyeR = eyeL.clone()
    eyeR.position.x *= -1
    this.group.add(eyeL, eyeR)

    this.group.position.copy(position)
    scene.add(this.group)
  }

  get position(): THREE.Vector3 {
    return this.group.position
  }

  takeDamage(amount: number): void {
    if (!this.alive) return
    this.hp -= amount
  }

  die(): void {
    this.alive = false
    this.scene.remove(this.group)
  }

  update(dt: number, hero: Hero, others: Enemy[]): void {
    if (!this.alive) return
    this.attackTimer = Math.max(0, this.attackTimer - dt)

    if (!hero.alive) return

    const toHero = hero.position.clone().sub(this.position)
    toHero.y = 0
    const dist = toHero.length()

    if (dist > 1.3) {
      const dir = toHero.normalize()
      // soft separation so packs don't stack into one point
      for (const other of others) {
        if (other === this || !other.alive) continue
        const away = this.position.clone().sub(other.position)
        away.y = 0
        const d = away.length()
        if (d > 0.001 && d < 1.1) dir.addScaledVector(away.normalize(), (1.1 - d) * 1.6)
      }
      dir.normalize()
      this.position.addScaledVector(dir, this.speed * dt)
      this.group.rotation.y = Math.atan2(dir.x, dir.z)
    } else if (this.attackTimer <= 0) {
      this.attackTimer = 1.1
      this.onHitHero?.(this.damage)
    }

    // menacing bob
    this.group.position.y = Math.abs(Math.sin(performance.now() * 0.006 + this.wobbleSeed)) * 0.12
  }
}
