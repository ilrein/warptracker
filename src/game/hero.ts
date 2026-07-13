import * as THREE from 'three'
import { instantiate, findBone } from './assets'
import { Animator } from './animator'
import type { Hittable } from './hittable'
import type { ClassDef } from './classes'
import { TOWN_CENTER, resolveCollision } from './world'
import { tone } from './audio'

/** Yaw the GLB needs so "facing angle 0" looks down +Z. */
const MODEL_YAW = 0

const TURN_SPEED = 14

const ROLL_TIME = 0.42
const ROLL_SPEED = 13

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

type HeroState = 'idle' | 'run' | 'attack' | 'roll' | 'skill' | 'dead'

export interface StrikeResult {
  target: Hittable
  amount: number
  finisher: boolean
}

export interface MotionOverride {
  duration: number
  invulnerable?: boolean
  anim?: string
  teleportTo?: THREE.Vector3
  /** returns the world-space displacement to apply this frame (collision applied by hero) */
  tick?: (dt: number, t01: number) => THREE.Vector3 | null
  onEnd?: () => void
}

/** Attach class loadout gear to a knight model (also used for NPC props). */
export function attachGear(
  root: THREE.Object3D,
  loadout: { helmet: boolean; dualSwords: boolean; bladeEmissive?: number }
): void {
  const inv = 1 / root.scale.x
  const addSword = (boneTokens: string[]) => {
    const bone = findBone(root, ...boneTokens)
    if (!bone) return
    const sword = instantiate('sword', 1.1)
    sword.root.scale.multiplyScalar(inv)
    if (loadout.bladeEmissive !== undefined) {
      sword.root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          const mat = (mesh.material as THREE.MeshStandardMaterial).clone()
          mat.emissive.setHex(loadout.bladeEmissive!)
          mat.emissiveIntensity = 0.7
          mesh.material = mat
        }
      })
    }
    bone.add(sword.root)
  }
  addSword(['palm', 'r'])
  if (loadout.dualSwords) addSword(['palm', 'l'])
  if (loadout.helmet) {
    const head = findBone(root, 'head')
    if (head) {
      const helmet = instantiate('helmet', 0.55)
      helmet.root.scale.multiplyScalar(inv)
      head.add(helmet.root)
    }
  }
}

/** The Tracker: class-configured knight with sword combos, dodge roll, mana. */
export class Hero {
  group = new THREE.Group()
  readonly classDef: ClassDef
  maxHp: number
  hp: number
  maxMana: number
  mana: number
  level = 1
  xp = 0

  state: HeroState = 'idle'
  /** set by Game each tick from the zone system */
  inTown = false
  /** equipped gear bonuses (loot system) */
  gear = { dmg: 0, hp: 0, speed: 0, mana: 0, regen: 0 }

  private anim: Animator
  private yaw = 0
  private targetYaw = 0
  private combo: ComboStage[]
  private runSpeed: number

  private comboStage = 0
  private stageT = 0
  private hitDone = false
  private queuedNext = false
  private comboIdleT = 0
  private attackDir = new THREE.Vector3(0, 0, 1)

  private rollT = 0
  rollCooldown = 0
  readonly rollCooldownMax: number
  private rollDir = new THREE.Vector3(0, 0, 1)

  private motion: (MotionOverride & { t: number }) | null = null

  private sinceDamaged = 99
  private lantern: THREE.PointLight

  onStrike?: (hits: StrikeResult[]) => void
  onSwing?: () => void
  onRoll?: () => void

  constructor(scene: THREE.Scene, classDef: ClassDef) {
    this.classDef = classDef
    this.maxHp = classDef.maxHp
    this.hp = classDef.maxHp
    this.maxMana = classDef.maxMana
    this.mana = classDef.maxMana
    this.runSpeed = classDef.moveSpeed
    this.rollCooldownMax = classDef.rollCooldown
    this.combo = COMBO.map((s) => ({
      ...s,
      time: s.time / classDef.attackSpeed,
      hitAt: s.hitAt / classDef.attackSpeed,
    }))

    const { root, clips } = instantiate('knight', 1.85)
    root.rotation.y = MODEL_YAW
    this.group.add(root)
    this.anim = new Animator(root, clips)
    attachGear(root, classDef.loadout)

    this.lantern = new THREE.PointLight(classDef.lanternColor, 32, 22, 1.5)
    this.lantern.position.set(0, 2.8, 0)
    this.group.add(this.lantern)

    this.anim.play('Idle_swordRight')
    this.group.position.copy(TOWN_CENTER).add(new THREE.Vector3(0, 0, 2))
    scene.add(this.group)
  }

  get position(): THREE.Vector3 {
    return this.group.position
  }

  get damage(): number {
    return Math.round((14 + this.level * 3) * this.classDef.dmgMult) + this.gear.dmg
  }

  /** loot system hands in new equip totals; deltas keep current hp/mana sensible */
  applyGear(totals: { dmg: number; hp: number; speed: number; mana: number; regen: number }): void {
    this.maxHp += totals.hp - this.gear.hp
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, totals.hp - this.gear.hp))
    this.maxMana += totals.mana - this.gear.mana
    this.mana = Math.min(this.maxMana, this.mana)
    this.runSpeed = this.classDef.moveSpeed * (1 + totals.speed / 100)
    this.gear = { ...totals }
  }

  get xpToLevel(): number {
    return Math.round(40 * Math.pow(this.level, 1.4))
  }

  get alive(): boolean {
    return this.state !== 'dead'
  }

  get invulnerable(): boolean {
    return this.state === 'roll' || (this.state === 'skill' && !!this.motion?.invulnerable)
  }

  spendMana(cost: number): boolean {
    if (this.mana < cost) {
      tone(160, 0.12, 'sine', 0.04, 110) // dry click
      const globe = document.getElementById('mana-globe')
      if (globe) {
        globe.classList.remove('pulse')
        void globe.offsetWidth // restart the animation
        globe.classList.add('pulse')
      }
      return false
    }
    this.mana -= cost
    return true
  }

  gainXp(amount: number): boolean {
    this.xp += amount
    let leveled = false
    while (this.xp >= this.xpToLevel) {
      this.xp -= this.xpToLevel
      this.level++
      this.maxHp += this.classDef.hpPerLevel
      this.maxMana += this.classDef.manaPerLevel
      this.hp = this.maxHp
      this.mana = this.maxMana
      leveled = true
    }
    return leveled
  }

  /** restore progression from a save */
  restore(level: number, xp: number): void {
    level = Math.min(60, Math.max(1, Math.floor(level))) // corrupt saves must not hang the boot
    while (this.level < level) {
      this.level++
      this.maxHp += this.classDef.hpPerLevel
      this.maxMana += this.classDef.manaPerLevel
    }
    this.xp = xp
    this.hp = this.maxHp
    this.mana = this.maxMana
  }

  takeDamage(amount: number): void {
    if (!this.alive || this.invulnerable) return
    this.hp -= amount
    this.sinceDamaged = 0
    if (this.hp <= 0) {
      this.cancelMotion()
      this.state = 'dead'
      this.anim.play('Death', { loop: false, fade: 0.1 })
    }
  }

  respawn(): void {
    this.hp = this.maxHp
    this.mana = this.maxMana
    this.group.position.copy(TOWN_CENTER).add(new THREE.Vector3(0, 0, 2))
    this.state = 'idle'
    this.comboStage = 0
    this.rollCooldown = 0
    this.anim.play('Idle_swordRight')
  }

  /** temporarily drive hero motion (leap/spin/dash/blink) — see contracts */
  overrideMotion(opts: MotionOverride): boolean {
    if (this.state === 'dead' || this.state === 'roll' || this.motion) return false
    if (opts.teleportTo) {
      const clamped = resolveCollision(this.position, opts.teleportTo.clone().setY(0))
      this.position.copy(clamped)
    }
    this.state = 'skill'
    this.motion = { ...opts, t: 0 }
    if (opts.anim && this.anim.has(opts.anim)) {
      this.anim.play(opts.anim, { loop: false, duration: opts.duration, fade: 0.06 })
    }
    return true
  }

  private cancelMotion(): void {
    const m = this.motion
    this.motion = null
    // skills rely on onEnd for cleanup (spin/dash flags, y reset) — always fire it
    m?.onEnd?.()
  }

  attack(aim: THREE.Vector3 | null): void {
    if (this.state === 'dead' || this.state === 'roll' || this.state === 'skill') return
    if (this.state === 'attack') {
      this.queuedNext = true
      return
    }
    this.startSwing(aim)
  }

  dodge(move: THREE.Vector3 | null): void {
    if (this.state === 'dead' || this.state === 'roll' || this.rollCooldown > 0) return
    if (this.state === 'skill') {
      this.cancelMotion() // dodge cancels channeled skills
    }
    this.rollDir =
      move && move.lengthSq() > 0.01
        ? move.clone().normalize()
        : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    this.state = 'roll'
    this.rollT = 0
    this.rollCooldown = this.rollCooldownMax
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

  /** point the model at a world position (skills use this before casting) */
  face(point: THREE.Vector3): void {
    const dx = point.x - this.position.x
    const dz = point.z - this.position.z
    if (dx * dx + dz * dz > 0.0001) {
      this.yaw = Math.atan2(dx, dz)
      this.targetYaw = this.yaw
      this.group.rotation.y = this.yaw
    }
  }

  private startSwing(aim: THREE.Vector3 | null): void {
    if (this.comboIdleT > COMBO_RESET_AFTER) this.comboStage = 0
    const stage = this.combo[this.comboStage]
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

  private resolveHits(targets: Hittable[], stage: ComboStage): void {
    const hits: StrikeResult[] = []
    const finisher = this.comboStage === this.combo.length - 1
    for (const target of targets) {
      if (!target.alive) continue
      const to = target.position.clone().sub(this.position)
      to.y = 0
      const dist = to.length()
      if (dist > ATTACK_RANGE + target.radius) continue
      // point-blank targets always count — the lunge can carry the hero past them
      if (dist > 1.3 && to.normalize().dot(this.attackDir) < ATTACK_ARC_COS) continue
      hits.push({ target, amount: Math.round(this.damage * stage.dmgMult), finisher })
    }
    if (hits.length) this.onStrike?.(hits)
  }

  update(
    dt: number,
    targets: Hittable[],
    move: THREE.Vector3,
    aim: THREE.Vector3 | null,
    attackHeld: boolean
  ): void {
    this.rollCooldown = Math.max(0, this.rollCooldown - dt)
    this.sinceDamaged += dt
    this.anim.update(dt)
    this.lantern.intensity = 13 + Math.sin(performance.now() * 0.01) * 1.5

    if (this.state === 'dead') return

    this.mana = Math.min(this.maxMana, this.mana + this.classDef.manaRegen * dt)
    if (this.gear.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.gear.regen * dt)
    if (this.sinceDamaged > 4) {
      this.hp = Math.min(this.maxHp, this.hp + dt * (this.inTown ? 12.5 : 2.5))
    }

    if (this.state === 'skill') {
      const m = this.motion
      if (!m) {
        this.state = 'idle'
        this.anim.play('Idle_swordRight')
      } else {
        m.t += dt
        const disp = m.tick?.(dt, Math.min(1, m.t / m.duration))
        if (disp && disp.lengthSq() > 0) {
          const next = resolveCollision(this.position, this.position.clone().add(disp))
          this.position.copy(next)
        }
        if (m.t >= m.duration) {
          this.motion = null
          this.state = 'idle'
          this.anim.play('Idle_swordRight')
          m.onEnd?.()
        }
      }
      return
    }

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
      const stage = this.combo[this.comboStage]
      this.stageT += dt
      if (this.stageT < stage.time * 0.5) {
        this.step(this.attackDir, stage.lunge / (stage.time * 0.5), dt, false)
      }
      if (!this.hitDone && this.stageT >= stage.hitAt) {
        this.hitDone = true
        this.resolveHits(targets, stage)
      }
      if (this.stageT >= stage.time) {
        const chain = (this.queuedNext || attackHeld) && this.comboStage < this.combo.length - 1
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
      this.step(move, this.runSpeed, dt)
      this.anim.play('Run_swordRight')
    } else {
      this.state = 'idle'
      this.anim.play('Idle_swordRight')
    }

    let d = this.targetYaw - this.yaw
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.yaw += d * Math.min(1, TURN_SPEED * dt)
    this.group.rotation.y = this.yaw
  }

  private step(dir: THREE.Vector3, speed: number, dt: number, turn = true): void {
    const next = resolveCollision(
      this.position,
      this.position.clone().addScaledVector(dir, speed * dt)
    )
    this.position.copy(next)
    if (turn) this.targetYaw = Math.atan2(dir.x, dir.z)
  }
}
