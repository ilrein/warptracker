import * as THREE from 'three'
import { instantiate, type ModelName } from './assets'
import { Animator } from './animator'
import type { Hero } from './hero'
import type { Hittable } from './hittable'
import { resolveCollision, TOWN_CENTER, TOWN_RADIUS } from './world'

const MODEL_YAW = 0
const LEASH_RANGE = 16
/** enemies never set foot this close to the campfire */
const TOWN_EXCLUSION = TOWN_RADIUS - 2

export type EnemyKindId = 'skeleton' | 'bat' | 'ghost' | 'demon'

interface EnemyKind {
  model: ModelName
  height: number
  hover: number
  radius: number
  elite: boolean
  hp: (tier: number) => number
  dmg: (tier: number) => number
  xp: (tier: number) => number
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

export interface EnemyOptions {
  name?: string
  anchor?: THREE.Vector3
  aggroRange?: number
  scale?: number
}

/** Warpspawn with a telegraphed, dodgeable attack cycle, leashed to its spawn. */
export class Enemy implements Hittable {
  group = new THREE.Group()
  readonly kind: EnemyKind
  readonly kindId: EnemyKindId
  /** named elites get a boss banner on aggro (game wires it) */
  readonly name?: string
  hp: number
  maxHp: number
  alive = true
  /** still in the scene playing its death animation */
  removed = false

  private anim: Animator
  private state: EnemyState = 'spawn'
  private stateT = 0
  private staggerDuration = 0.32
  private yaw = 0
  private strikeDir = new THREE.Vector3(0, 0, 1)
  private strikeHitDone = false
  private staggerCount = 0
  private scene: THREE.Scene
  private tier: number
  private flashMats: THREE.MeshStandardMaterial[] = []
  private telegraphRing: THREE.Mesh | null = null
  private bobSeed = Math.random() * 10

  private anchor: THREE.Vector3
  private aggroRange: number
  private aggroed = false
  /** walking home after over-extending the leash (hysteresis: home < 2u) */
  private returning = false
  /** named-elite periodic nova pulse */
  private novaCd = 6
  private novaMode = false

  onHitHero?: (amount: number) => void
  onAggro?: (enemy: Enemy) => void

  constructor(
    scene: THREE.Scene,
    position: THREE.Vector3,
    tier: number,
    kindId: EnemyKindId,
    opts: EnemyOptions = {}
  ) {
    this.scene = scene
    this.tier = tier
    this.kindId = kindId
    this.kind = ENEMY_KINDS[kindId]
    this.name = opts.name
    this.anchor = (opts.anchor ?? position).clone()
    this.aggroRange = opts.aggroRange ?? 9
    const extraScale = opts.scale ?? 1
    this.maxHp = Math.round(this.kind.hp(tier) * (opts.name ? 1.8 : 1))
    this.hp = this.maxHp

    const { root, clips } = instantiate(this.kind.model, this.kind.height * extraScale)
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
    return Math.round(this.kind.xp(this.tier) * (this.name ? 2.5 : 1))
  }

  takeDamage(amount: number, knockback: THREE.Vector3 | null): void {
    if (!this.alive) return
    this.hp -= amount
    this.aggroed = true
    if (this.hp <= 0) {
      this.die()
      return
    }
    if (knockback) {
      const next = this.position.clone().addScaledVector(knockback, this.elite ? 0.25 : 1)
      this.position.copy(resolveCollision(this.position, next))
    }
    // elites have poise: only every 4th hit staggers
    this.staggerCount++
    if (!this.elite || this.staggerCount % 4 === 0) this.applyStagger(0.32)
  }

  /** force the stagger state (skills use longer durations; elites take 40%) */
  applyStagger(seconds: number): void {
    if (!this.alive) return
    const duration = this.elite ? seconds * 0.4 : seconds
    if (duration <= 0) return
    this.staggerDuration = duration
    this.setState('stagger')
    this.clearTelegraph()
    const hit = this.kind.anims.hit
    if (hit) this.anim.play(hit, { loop: false, duration: Math.max(0.3, duration), fade: 0.05 })
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

  setFlash(intensity: number, colorHex = 0xff2222): void {
    const c = new THREE.Color(colorHex)
    for (const m of this.flashMats) {
      m.emissive.setRGB(c.r * intensity, c.g * intensity, c.b * intensity)
      m.emissiveIntensity = 1
    }
  }

  private clearTelegraph(): void {
    this.setFlash(0)
    if (this.telegraphRing) {
      this.scene.remove(this.telegraphRing)
      this.telegraphRing.geometry.dispose()
      ;(this.telegraphRing.material as THREE.Material).dispose()
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
    const baseY =
      this.kind.hover > 0 ? this.kind.hover + Math.sin(performance.now() * 0.003 + this.bobSeed) * 0.15 : 0
    const inner = this.group.children[0]
    if (inner) inner.position.y = baseY

    // named elites pulse a nova once aggroed
    if (this.name && this.aggroed && this.kind.attack === 'slam' && this.state === 'chase') {
      this.novaCd -= dt
      if (this.novaCd <= 0) {
        this.novaCd = 6
        this.novaMode = true
        this.setState('windup')
        this.anim.play(this.kind.anims.idle, { fade: 0.08 })
        this.spawnTelegraphRing(4.5)
        return
      }
    }

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
        const toHero = hero.position.clone().sub(this.position)
        toHero.y = 0
        const heroDist = toHero.length()
        const anchorDist = this.position.distanceTo(this.anchor)
        const heroInTown =
          Math.hypot(hero.position.x - TOWN_CENTER.x, hero.position.z - TOWN_CENTER.z) < TOWN_RADIUS

        if (!this.aggroed) {
          if (hero.alive && !heroInTown && heroDist <= this.aggroRange) {
            this.aggroed = true
            this.returning = false
            this.onAggro?.(this)
          } else {
            this.anim.play(this.kind.anims.idle)
            return
          }
        }

        // leash home when over-extended or when the hero reaches safety;
        // hysteresis: keep walking until actually home, don't flicker at the edge
        if (heroInTown || anchorDist > LEASH_RANGE) this.returning = true
        if (this.returning) {
          const home = this.anchor.clone().sub(this.position)
          home.y = 0
          if (home.length() > 2) {
            const dir = home.normalize()
            this.move(dir, this.kind.speed, dt)
            this.face(dir)
            this.anim.play(this.kind.anims.move)
          } else {
            this.returning = false
            this.aggroed = false
            this.anim.play(this.kind.anims.idle)
          }
          return
        }

        if (!hero.alive) {
          this.anim.play(this.kind.anims.idle)
          return
        }
        const triggerRange = this.kind.strikeRange * 0.8
        if (heroDist <= triggerRange) {
          this.novaMode = false
          this.setState('windup')
          this.strikeDir = toHero.normalize()
          this.face(this.strikeDir)
          this.anim.play(this.kind.anims.idle, { fade: 0.08 })
          if (this.kind.attack === 'slam') this.spawnTelegraphRing(this.kind.strikeRange)
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
        const windup = this.novaMode ? 1.0 : this.kind.windup
        const k = Math.min(1, this.stateT / windup)
        this.setFlash(k * 0.9)
        if (this.telegraphRing) {
          this.telegraphRing.scale.setScalar(0.2 + k * 0.8)
          ;(this.telegraphRing.material as THREE.MeshBasicMaterial).opacity = 0.15 + k * 0.35
        }
        if (hero.alive && this.kind.attack !== 'slam') {
          const to = hero.position.clone().sub(this.position)
          to.y = 0
          if (to.lengthSq() > 0.01) {
            this.strikeDir.lerp(to.normalize(), dt * 3).normalize()
            this.face(this.strikeDir)
          }
        }
        if (this.stateT >= windup) {
          this.setState('strike')
          this.setFlash(0.25)
          this.anim.play(this.kind.anims.attack, { loop: false, duration: this.kind.strikeTime, fade: 0.04 })
        }
        return
      }
      case 'strike': {
        const t = this.stateT / this.kind.strikeTime
        if (this.kind.attack === 'dash' && !this.novaMode) {
          this.move(this.strikeDir, this.kind.speed * 4.2, dt)
          if (!this.strikeHitDone && hero.alive) {
            const d = hero.position.clone().sub(this.position)
            d.y = 0
            if (d.length() < this.radius + 0.9) {
              this.strikeHitDone = true
              this.onHitHero?.(this.kind.dmg(this.tier))
            }
          }
        } else if (!this.strikeHitDone && t >= 0.5 && hero.alive) {
          this.strikeHitDone = true
          const to = hero.position.clone().sub(this.position)
          to.y = 0
          const dist = to.length()
          if (this.kind.attack === 'slam' || this.novaMode) {
            const radius = this.novaMode ? 4.5 : this.kind.strikeRange
            const dmg = this.novaMode ? 14 : this.kind.dmg(this.tier)
            if (dist < radius) this.onHitHero?.(dmg)
          } else if (dist < this.kind.strikeRange + 0.3 && to.normalize().dot(this.strikeDir) > 0.1) {
            this.onHitHero?.(this.kind.dmg(this.tier))
          }
        }
        if (this.stateT >= this.kind.strikeTime) {
          this.novaMode = false
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
        if (this.stateT >= this.staggerDuration) {
          this.setFlash(0)
          this.setState('chase')
        }
        return
      }
    }
  }

  private spawnTelegraphRing(radius: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.35, radius, 40),
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
    // hard town exclusion — warpspawn never pass the hearth-light
    if (Math.hypot(next.x - TOWN_CENTER.x, next.z - TOWN_CENTER.z) < TOWN_EXCLUSION) return
    this.position.copy(resolveCollision(this.position, next))
  }

  private face(dir: THREE.Vector3): void {
    this.yaw = Math.atan2(dir.x, dir.z)
    this.group.rotation.y = this.yaw
  }
}
