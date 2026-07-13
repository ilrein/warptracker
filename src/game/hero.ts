import * as THREE from 'three'
import type { Enemy } from './enemy'
import { WORLD_RADIUS } from './world'

const ATTACK_RANGE = 2.4
const ATTACK_COOLDOWN = 0.55
const SPLASH_RADIUS = 1.8
const SPLASH_FACTOR = 0.4

/** The Tracker — player-controlled hero. Procedural low-poly model. */
export class Hero {
  group = new THREE.Group()
  maxHp = 100
  hp = 100
  level = 1
  xp = 0
  speed = 6.5

  private destination: THREE.Vector3 | null = null
  private attackTimer = 0
  private swingTime = 0
  private swordArm!: THREE.Group
  private lantern!: THREE.PointLight
  target: Enemy | null = null

  onDealDamage?: (enemy: Enemy, amount: number) => void
  onSwing?: () => void

  constructor(scene: THREE.Scene) {
    this.buildModel()
    scene.add(this.group)
  }

  get position(): THREE.Vector3 {
    return this.group.position
  }

  get damage(): number {
    return 12 + this.level * 3
  }

  get xpToLevel(): number {
    return Math.round(40 * Math.pow(this.level, 1.4))
  }

  get alive(): boolean {
    return this.hp > 0
  }

  private buildModel(): void {
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.8 })
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a081, roughness: 0.7 })
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.9 })
    const steel = new THREE.MeshStandardMaterial({
      color: 0xb8c4d4,
      metalness: 0.85,
      roughness: 0.25,
      emissive: 0x223a55,
      emissiveIntensity: 0.4,
    })

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.8, 6, 12), cloth)
    body.position.y = 1.0
    body.castShadow = true
    this.group.add(body)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), skin)
    head.position.y = 1.95
    head.castShadow = true
    this.group.add(head)

    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.55, 10), cloth)
    hood.position.y = 2.2
    this.group.add(hood)

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 6, 14), leather)
    belt.rotation.x = Math.PI / 2
    belt.position.y = 0.95
    this.group.add(belt)

    // sword arm pivots at the shoulder so the whole arm swings
    this.swordArm = new THREE.Group()
    this.swordArm.position.set(0.5, 1.45, 0)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.03), steel)
    blade.position.y = -0.75
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), leather)
    guard.position.y = -0.2
    this.swordArm.add(blade, guard)
    this.swordArm.rotation.z = -0.5
    this.group.add(this.swordArm)

    this.lantern = new THREE.PointLight(0xffc477, 14, 16, 1.8)
    this.lantern.position.set(0, 2.6, 0)
    this.group.add(this.lantern)
  }

  moveTo(point: THREE.Vector3): void {
    this.destination = point.clone()
    this.destination.y = 0
    this.target = null
  }

  attack(enemy: Enemy): void {
    this.target = enemy
    this.destination = null
  }

  takeDamage(amount: number): void {
    if (!this.alive) return
    this.hp -= amount
  }

  /** @returns xp overflow leftover after leveling, for the HUD */
  gainXp(amount: number): boolean {
    this.xp += amount
    let leveled = false
    while (this.xp >= this.xpToLevel) {
      this.xp -= this.xpToLevel
      this.level++
      this.maxHp += 14
      this.hp = this.maxHp
      leveled = true
    }
    return leveled
  }

  respawn(): void {
    this.hp = this.maxHp
    this.group.position.set(0, 0, 0)
    this.destination = null
    this.target = null
    this.group.visible = true
  }

  update(dt: number, enemies: Enemy[]): void {
    if (!this.alive) {
      this.group.visible = false
      return
    }

    // passive regen out of combat pressure
    this.hp = Math.min(this.maxHp, this.hp + dt * 1.2)

    this.attackTimer = Math.max(0, this.attackTimer - dt)

    if (this.target && !this.target.alive) this.target = null

    if (this.target) {
      const toTarget = this.target.position.clone().sub(this.position)
      toTarget.y = 0
      const dist = toTarget.length()
      if (dist > ATTACK_RANGE) {
        this.step(toTarget.normalize(), dt)
      } else {
        this.face(this.target.position)
        if (this.attackTimer <= 0) this.swing(enemies)
      }
    } else if (this.destination) {
      const toDest = this.destination.clone().sub(this.position)
      toDest.y = 0
      if (toDest.length() < 0.15) {
        this.destination = null
      } else {
        this.step(toDest.normalize(), dt)
      }
    }

    // swing animation: arm arcs forward then returns
    if (this.swingTime > 0) {
      this.swingTime = Math.max(0, this.swingTime - dt)
      const t = 1 - this.swingTime / 0.25
      this.swordArm.rotation.x = -Math.sin(t * Math.PI) * 1.9
    } else {
      this.swordArm.rotation.x = 0
    }

    // lantern flicker
    this.lantern.intensity = 13 + Math.sin(performance.now() * 0.01) * 1.5
  }

  private step(dir: THREE.Vector3, dt: number): void {
    const next = this.position.clone().addScaledVector(dir, this.speed * dt)
    if (next.length() > WORLD_RADIUS + 12) return
    this.position.copy(next)
    this.face(this.position.clone().add(dir))
    // walk bob
    this.group.position.y = Math.abs(Math.sin(performance.now() * 0.012)) * 0.08
  }

  private face(point: THREE.Vector3): void {
    const dx = point.x - this.position.x
    const dz = point.z - this.position.z
    if (dx * dx + dz * dz > 0.0001) this.group.rotation.y = Math.atan2(dx, dz)
  }

  private swing(enemies: Enemy[]): void {
    if (!this.target) return
    this.attackTimer = ATTACK_COOLDOWN
    this.swingTime = 0.25
    this.onSwing?.()
    this.onDealDamage?.(this.target, this.damage)
    // small splash around the primary target
    for (const other of enemies) {
      if (other === this.target || !other.alive) continue
      if (other.position.distanceTo(this.target.position) < SPLASH_RADIUS) {
        this.onDealDamage?.(other, Math.round(this.damage * SPLASH_FACTOR))
      }
    }
  }
}
