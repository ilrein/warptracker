import * as THREE from 'three'
import { instantiate, type ModelName } from './assets'
import { Animator } from './animator'
import type { Hero } from './hero'
import { WORLD_RADIUS } from './world'

const MODEL_YAW = Math.PI

export type EnemyKindId = 'skeleton' | 'bat' | 'ghost' | 'demon'

interface EnemyKind {
  model: ModelName
  height: number
  hover: number
  radius: number
  elite: boolean
  hp: (rift: number) => number
  dmg: (rift: number) => number
  xp: (rift: number) => number
  speed: number
  windup: number
  strikeTime: number
  strikeRange: number
  recover: number
  /** melee: arc swipe · dash: charges forward · slam: AoE ring around self */
  attack: 'melee' | 'dash' | 'slam'
  anims: { idle: string; move: string; attack: string; hit?: string; death: string; spawn?: string }
}

export const ENEMY_KINDS: Record<EnemyKindId, EnemyKind> = {
  skeleton: {
    model: 'skeleton',
    height: 1.75,
    hover: 0,
    radius: 0.55,
    elite: false,
    hp: (r) => 26 + r * 8,
    dmg: (r) => 8 + r * 2,
    xp: (r) => 14 + r * 4,
    speed: 3.1,
    windup: 0.55,
    strikeTime: 0.32,
    strikeRange: 2.3,
    recover: 0.55,
    attack: 'melee',
    anims: { idle: 'Idle', move: 'Running', attack: 'Attack', death: 'Death', spawn: 'Spawn' },
  },
  bat: {
    model: 'bat',
    height: 0.85,
    hover: 1.15,
    radius: 0.45,
    elite: false,
    hp: (r) => 12 + r * 4,
    dmg: (r) => 4 + r,
    xp: (r) => 9 + r * 3,
    speed: 4.7,
    windup: 0.3,
    strikeTime: 0.25,
    strikeRange: 1.7,
    recover: 0.7,
    attack: 'melee',
    anims: { idle: 'Flying', move: 'Flying', attack: 'Attack', hit: 'Hit', death: 'Death' },
  },
  ghost: {
    model: 'ghost',
    height: 1.5,
    hover: 0.75,
    radius: 0.6,
    elite: false,
    hp: (r) => 22 + r * 7,
    dmg: (r) => 10 + r * 2,
    xp: (r) => 18 + r * 5,
    speed: 3.4,
    windup: 0.5,
    strikeTime: 0.38,
    strikeRange: 6.5,
    recover: 0.85,
    attack: 'dash',
    anims: { idle: 'Flying_Idle', move: 'Fast_Flying', attack: 'Headbutt', hit: 'HitReact', death: 'Death' },
  },
  demon: {
    model: 'demon',
    height: 2.7,
    hover: 0,
    radius: 1.0,
    elite: true,
    hp: (r) => 130 + r * 45,
    dmg: (r) => 16 + r * 4,
    xp: (r) => 60 + r * 12,
    speed: 2.2,
    windup: 0.9,
    strikeTime: 0.4,
    strikeRange: 3.4,
    recover: 0.8,
    attack: 'slam',
    anims: { idle: 'Idle', move: 'Walk', attack: 'Punch', hit: 'HitReact', death: 'Death' },
  },
}

type EnemyState = 'spawn' | 'chase' | 'windup' | 'strike' | 'recover' | 'stagger' | 'dying'

/** Warpspawn with a telegraphed, dodgeable attack cycle. */
export class Enemy {
  group = new THREE.Group()
  readonly kind: EnemyKind
  readonly kindId: EnemyKindId
  hp: number
  maxHp: number
  alive = true
  /** still in the scene playing its death animation */
  removed = false

  private anim: Animator
  private state: EnemyState = 'spawn'
  private stateT = 0
  private yaw = 0
  private strikeDir = new THREE.Vector3(0, 0, 1)
  private strikeHitDone = false
  private staggerCount = 0
  private scene: THREE.Scene
  private rift: number
  private flashMats: THREE.MeshStandardMaterial[] = []
  private telegraphRing: THREE.Mesh | null = null
  private bobSeed = Math.random() * 10

  onHitHero?: (amount: number) => void

  constructor(scene: THREE.Scene, position: THREE.Vector3, rift: number, kindId: EnemyKindId) {
    this.scene = scene
    this.rift = rift
    this.kindId = kindId
    this.kind = ENEMY_KINDS[kindId]
    this.maxHp = this.kind.hp(rift)
    this.hp = this.maxHp

    const { root, clips } = instantiate(this.kind.model, this.kind.height)
    root.rotation.y = MODEL_YAW
    root.position.y = this.kind.hover
    this.group.add(root)
    this.anim = new Animator(root, clips)

    // clone materials so telegraph flashes don't affect siblings
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone()
        this.flashMats.push(mesh.material as THREE.MeshStandardMaterial)
      }
    })

    this.group.position.copy(position)
    scene.add(this.group)

    if (this.kind.anims.spawn) {
      this.anim.play(this.kind.anims.spawn, { loop: false, duration: 0.9 })
      this.stateT = -0.9
    } else {
      this.group.scale.setScalar(0.01)
      this.anim.play(this.kind.anims.move)
    }
  }

  get position(): THREE.Vector3 {
    return this.group.position
  }

  get radius(): number {
    return this.kind.radius
  }

  get elite(): boolean {
    return this.kind.elite
  }

  xpValue(): number {
    return this.kind.xp(this.rift)
  }

  takeDamage(amount: number, knockback: THREE.Vector3 | null): void {
    if (!this.alive) return
    this.hp -= amount
    if (this.hp <= 0) {
      this.die()
      return
    }
    if (knockback) this.position.addScaledVector(knockback, this.elite ? 0.25 : 1)
    // elites have poise: only every 4th hit staggers
    this.staggerCount++
    if (!this.elite || this.staggerCount % 4 === 0) {
      this.setState('stagger')
      this.clearTelegraph()
      const hit = this.kind.anims.hit
      if (hit) this.anim.play(hit, { loop: false, duration: 0.35, fade: 0.05 })
    }
  }

  private die(): void {
    this.alive = false
    this.setState('dying')
    this.clearTelegraph()
    this.anim.play(this.kind.anims.death, { loop: false, duration: 0.9, fade: 0.08 })
  }

  private setState(s: EnemyState): void {
    this.state = s
    this.stateT = 0
    this.strikeHitDone = false
  }

  private setFlash(intensity: number): void {
    for (const m of this.flashMats) {
      m.emissive.setRGB(intensity, intensity * 0.08, intensity * 0.08)
      m.emissiveIntensity = 1
    }
  }

  private clearTelegraph(): void {
    this.setFlash(0)
    if (this.telegraphRing) {
      this.scene.remove(this.telegraphRing)
      this.telegraphRing = null
    }
  }

  update(dt: number, hero: Hero, others: Enemy[]): void {
    this.anim.update(dt)
    this.stateT += dt

    if (this.state === 'dying') {
      if (this.stateT > 1.1) {
        this.group.position.y -= dt * 1.4 // sink into the ground
        if (this.stateT > 1.9) {
          this.scene.remove(this.group)
          this.removed = true
        }
      }
      return
    }

    // hover bob for flyers
    const baseY = this.kind.hover > 0 ? this.kind.hover + Math.sin(performance.now() * 0.003 + this.bobSeed) * 0.15 : 0
    const inner = this.group.children[0]
    if (inner) inner.position.y = baseY

    switch (this.state) {
      case 'spawn': {
        if (!this.kind.anims.spawn) {
          const k = Math.min(1, (this.stateT + 0.01) / 0.35)
          this.group.scale.setScalar(k)
          if (k >= 1) this.setState('chase')
        } else if (this.stateT >= 0) {
          this.setState('chase')
          this.anim.play(this.kind.anims.move)
        }
        return
      }
      case 'chase': {
        if (!hero.alive) {
          this.anim.play(this.kind.anims.idle)
          return
        }
        const toHero = hero.position.clone().sub(this.position)
        toHero.y = 0
        const dist = toHero.length()
        const triggerRange = this.kind.attack === 'dash' ? this.kind.strikeRange * 0.8 : this.kind.strikeRange * 0.8
        if (dist <= triggerRange) {
          this.setState('windup')
          this.strikeDir = toHero.normalize()
          this.face(this.strikeDir)
          this.anim.play(this.kind.anims.idle, { fade: 0.08 })
          if (this.kind.attack === 'slam') this.spawnTelegraphRing()
          return
        }
        const dir = toHero.normalize()
        for (const other of others) {
          if (other === this || !other.alive) continue
          const away = this.position.clone().sub(other.position)
          away.y = 0
          const d = away.length()
          const minGap = this.radius + other.radius + 0.2
          if (d > 0.001 && d < minGap) dir.addScaledVector(away.normalize(), (minGap - d) * 1.8)
        }
        dir.normalize()
        this.move(dir, this.kind.speed, dt)
        this.face(dir)
        this.anim.play(this.kind.anims.move)
        return
      }
      case 'windup': {
        // telegraph: red flash ramps up; slam ring expands
        const k = Math.min(1, this.stateT / this.kind.windup)
        this.setFlash(k * 0.9)
        if (this.telegraphRing) {
          this.telegraphRing.scale.setScalar(0.2 + k * 0.8)
          ;(this.telegraphRing.material as THREE.MeshBasicMaterial).opacity = 0.15 + k * 0.35
        }
        // track the hero a little while winding up
        if (hero.alive && this.kind.attack !== 'slam') {
          const to = hero.position.clone().sub(this.position)
          to.y = 0
          if (to.lengthSq() > 0.01) {
            this.strikeDir.lerp(to.normalize(), dt * 3).normalize()
            this.face(this.strikeDir)
          }
        }
        if (this.stateT >= this.kind.windup) {
          this.setState('strike')
          this.setFlash(0.25)
          this.anim.play(this.kind.anims.attack, { loop: false, duration: this.kind.strikeTime, fade: 0.04 })
        }
        return
      }
      case 'strike': {
        const t = this.stateT / this.kind.strikeTime
        if (this.kind.attack === 'dash') {
          this.move(this.strikeDir, this.kind.speed * 4.2, dt)
          if (!this.strikeHitDone && hero.alive) {
            const d = hero.position.clone().sub(this.position)
            d.y = 0
            if (d.length() < this.radius + 0.9) {
              this.strikeHitDone = true
              this.onHitHero?.(this.kind.dmg(this.rift))
            }
          }
        } else if (!this.strikeHitDone && t >= 0.5 && hero.alive) {
          this.strikeHitDone = true
          const to = hero.position.clone().sub(this.position)
          to.y = 0
          const dist = to.length()
          if (this.kind.attack === 'slam') {
            if (dist < this.kind.strikeRange) this.onHitHero?.(this.kind.dmg(this.rift))
          } else if (dist < this.kind.strikeRange + 0.3 && to.normalize().dot(this.strikeDir) > 0.1) {
            this.onHitHero?.(this.kind.dmg(this.rift))
          }
        }
        if (this.stateT >= this.kind.strikeTime) {
          this.clearTelegraph()
          this.setState('recover')
          this.anim.play(this.kind.anims.idle, { fade: 0.15 })
        }
        return
      }
      case 'recover': {
        if (this.stateT >= this.kind.recover) this.setState('chase')
        return
      }
      case 'stagger': {
        this.setFlash(Math.max(0, 0.7 - this.stateT * 2.5))
        if (this.stateT >= 0.32) {
          this.setFlash(0)
          this.setState('chase')
        }
        return
      }
    }
  }

  private spawnTelegraphRing(): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.kind.strikeRange - 0.35, this.kind.strikeRange, 40),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(this.position).setY(0.06)
    this.scene.add(ring)
    this.telegraphRing = ring
  }

  private move(dir: THREE.Vector3, speed: number, dt: number): void {
    const next = this.position.clone().addScaledVector(dir, speed * dt)
    if (Math.hypot(next.x, next.z) > WORLD_RADIUS + 12) return
    this.position.copy(next)
  }

  private face(dir: THREE.Vector3): void {
    this.yaw = Math.atan2(dir.x, dir.z)
    this.group.rotation.y = this.yaw
  }
}
