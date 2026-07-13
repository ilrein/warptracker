import * as THREE from 'three'
import { instantiate, findBone } from './assets'
import { Animator } from './animator'
import type { Enemy } from './enemy'
import { WORLD_RADIUS } from './world'

/** Yaw the GLB needs so "facing angle 0" looks down +Z. */
const MODEL_YAW = 0

const RUN_SPEED = 6.8
const TURN_SPEED = 14

const ROLL_TIME = 0.42
const ROLL_SPEED = 13
const ROLL_COOLDOWN = 1.4

interface ComboStage {
  anim: string
  time: number
  hitAt: number
  dmgMult: number
  lunge: number
}

const COMBO: ComboStage[] = [
  { anim: 'Run_swordAttack', time: 0.4, hitAt: 0.18, dmgMult: 1.0, lunge: 2.0 },
  { anim: 'Run_swordAttack', time: 0.36, hitAt: 0.16, dmgMult: 1.0, lunge: 2.2 },
  { anim: 'swordAttackJump', time: 0.55, hitAt: 0.3, dmgMult: 1.8, lunge: 2.8 },
]
const ATTACK_RANGE = 2.9
const ATTACK_ARC_COS = 0.2 // ~±78° half-arc
const COMBO_RESET_AFTER = 0.7

type HeroState = 'idle' | 'run' | 'attack' | 'roll' | 'dead'

export interface StrikeResult {
  enemy: Enemy
  amount: number
  finisher: boolean
}

/** The Tracker: Quaternius knight with sword combos and an i-frame dodge roll. */
export class Hero {
  group = new THREE.Group()
  maxHp = 100
  hp = 100
  level = 1
  xp = 0

  state: HeroState = 'idle'
  private anim: Animator
  private yaw = 0
  private targetYaw = 0

  // attack state
  private comboStage = 0
  private stageT = 0
  private hitDone = false
  private queuedNext = false
  private comboIdleT = 0
  private attackDir = new THREE.Vector3(0, 0, 1)

  // roll state
  private rollT = 0
  rollCooldown = 0
  readonly rollCooldownMax = ROLL_COOLDOWN
  private rollDir = new THREE.Vector3(0, 0, 1)

  private sinceDamaged = 99
  private lantern: THREE.PointLight

  onStrike?: (hits: StrikeResult[]) => void
  onSwing?: () => void
  onRoll?: () => void

  constructor(scene: THREE.Scene) {
    const { root, clips } = instantiate('knight', 1.85)
    root.rotation.y = MODEL_YAW
    this.group.add(root)
    this.anim = new Animator(root, clips)

    const palm = findBone(root, 'palm', 'r')
    if (palm) {
      const sword = instantiate('sword', 1.1)
      palm.add(sword.root)
      // counteract the character's world scale so the sword isn't shrunk twice
      const inv = 1 / root.scale.x
      sword.root.scale.multiplyScalar(inv)
    } else {
      console.warn('hero: Palm.R bone not found; sword not attached')
    }
    const head = findBone(root, 'head')
    if (head) {
      const helmet = instantiate('helmet', 0.55)
      head.add(helmet.root)
      helmet.root.scale.multiplyScalar(1 / root.scale.x)
    }

    this.lantern = new THREE.PointLight(0xffc477, 32, 22, 1.5)
    this.lantern.position.set(0, 2.8, 0)
    this.group.add(this.lantern)

    this.anim.play('Idle_swordRight')
    scene.add(this.group)
  }

  get position(): THREE.Vector3 {
    return this.group.position
  }

  get damage(): number {
    return 14 + this.level * 3
  }

  get xpToLevel(): number {
    return Math.round(40 * Math.pow(this.level, 1.4))
  }

  get alive(): boolean {
    return this.state !== 'dead'
  }

  get invulnerable(): boolean {
    return this.state === 'roll'
  }

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

  takeDamage(amount: number): void {
    if (!this.alive || this.invulnerable) return
    this.hp -= amount
    this.sinceDamaged = 0
    if (this.hp <= 0) {
      this.state = 'dead'
      this.anim.play('Death', { loop: false, fade: 0.1 })
    }
  }

  respawn(): void {
    this.hp = this.maxHp
    this.group.position.set(0, 0, 0)
    this.state = 'idle'
    this.comboStage = 0
    this.rollCooldown = 0
    this.anim.play('Idle_swordRight')
  }

  /** Try to start/queue an attack toward the aim point. */
  attack(aim: THREE.Vector3 | null): void {
    if (this.state === 'dead' || this.state === 'roll') return
    if (this.state === 'attack') {
      this.queuedNext = true
      return
    }
    this.startSwing(aim)
  }

  dodge(move: THREE.Vector3 | null): void {
    if (this.state === 'dead' || this.state === 'roll' || this.rollCooldown > 0) return
    this.rollDir =
      move && move.lengthSq() > 0.01
        ? move.clone().normalize()
        : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    this.state = 'roll'
    this.rollT = 0
    this.rollCooldown = ROLL_COOLDOWN
    this.targetYaw = Math.atan2(this.rollDir.x, this.rollDir.z)
    this.yaw = this.targetYaw
    this.group.rotation.y = this.yaw
    this.anim.play(this.anim.has('Roll_sword') ? 'Roll_sword' : 'Roll', {
      loop: false,
      duration: ROLL_TIME,
      fade: 0.05,
    })
    this.onRoll?.()
  }

  private startSwing(aim: THREE.Vector3 | null): void {
    if (this.comboIdleT > COMBO_RESET_AFTER) this.comboStage = 0
    const stage = COMBO[this.comboStage]
    if (aim) {
      const dir = aim.clone().sub(this.position)
      dir.y = 0
      if (dir.lengthSq() > 0.01) this.attackDir = dir.normalize()
    }
    this.state = 'attack'
    this.stageT = 0
    this.hitDone = false
    this.queuedNext = false
    this.targetYaw = Math.atan2(this.attackDir.x, this.attackDir.z)
    this.yaw = this.targetYaw
    this.group.rotation.y = this.yaw
    this.anim.play(stage.anim, { loop: false, duration: stage.time, fade: 0.06 })
    this.onSwing?.()
  }

  private resolveHits(enemies: Enemy[], stage: ComboStage): void {
    const hits: StrikeResult[] = []
    const finisher = this.comboStage === COMBO.length - 1
    for (const enemy of enemies) {
      if (!enemy.alive) continue
      const to = enemy.position.clone().sub(this.position)
      to.y = 0
      const dist = to.length()
      if (dist > ATTACK_RANGE + enemy.radius) continue
      if (dist > 0.4 && to.normalize().dot(this.attackDir) < ATTACK_ARC_COS) continue
      hits.push({
        enemy,
        amount: Math.round(this.damage * stage.dmgMult),
        finisher,
      })
    }
    if (hits.length) this.onStrike?.(hits)
  }

  update(dt: number, enemies: Enemy[], move: THREE.Vector3, aim: THREE.Vector3 | null, attackHeld: boolean): void {
    this.rollCooldown = Math.max(0, this.rollCooldown - dt)
    this.sinceDamaged += dt
    this.anim.update(dt)
    this.lantern.intensity = 13 + Math.sin(performance.now() * 0.01) * 1.5

    if (this.state === 'dead') return

    // out-of-combat regen
    if (this.sinceDamaged > 4) this.hp = Math.min(this.maxHp, this.hp + dt * 2.5)

    if (this.state === 'roll') {
      this.rollT += dt
      this.step(this.rollDir, ROLL_SPEED * (1 - (this.rollT / ROLL_TIME) * 0.4), dt)
      if (this.rollT >= ROLL_TIME) {
        this.state = 'idle'
        this.anim.play('Idle_swordRight')
      }
      return
    }

    if (this.state === 'attack') {
      const stage = COMBO[this.comboStage]
      this.stageT += dt
      // slight forward lunge early in the swing
      if (this.stageT < stage.time * 0.5) {
        this.step(this.attackDir, stage.lunge / (stage.time * 0.5), dt, false)
      }
      if (!this.hitDone && this.stageT >= stage.hitAt) {
        this.hitDone = true
        this.resolveHits(enemies, stage)
      }
      if (this.stageT >= stage.time) {
        const chain = (this.queuedNext || attackHeld) && this.comboStage < COMBO.length - 1
        this.comboStage = chain ? this.comboStage + 1 : 0
        this.comboIdleT = 0
        if (chain || ((this.queuedNext || attackHeld) && this.comboStage === 0)) {
          this.startSwing(aim)
        } else {
          this.state = 'idle'
          this.anim.play('Idle_swordRight')
        }
      }
      return
    }

    this.comboIdleT += dt

    if (move.lengthSq() > 0.01) {
      this.state = 'run'
      this.targetYaw = Math.atan2(move.x, move.z)
      this.step(move, RUN_SPEED, dt)
      this.anim.play('Run_swordRight')
    } else {
      this.state = 'idle'
      this.anim.play('Idle_swordRight')
    }

    // smooth turn
    let d = this.targetYaw - this.yaw
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.yaw += d * Math.min(1, TURN_SPEED * dt)
    this.group.rotation.y = this.yaw
  }

  private step(dir: THREE.Vector3, speed: number, dt: number, turn = true): void {
    const next = this.position.clone().addScaledVector(dir, speed * dt)
    const flat = Math.hypot(next.x, next.z)
    if (flat > WORLD_RADIUS + 10) return
    this.position.copy(next)
    if (turn) this.targetYaw = Math.atan2(dir.x, dir.z)
  }
}
