import * as THREE from 'three'
import type { Hittable } from './hittable'
import { CLASS_DEFS, type ClassId, type SkillDef } from './classes'
import { spawnRing, spawnBurst, spawnTrail } from './vfx'
import { resolveCollision } from './world'
import { tone } from './audio'

/**
 * The nine Order skills (keys 1/2/3): cooldowns, mana, projectile pool,
 * traps and expanding rings, with motion skills driven through
 * `hero.overrideMotion`. All numbers from the v0.3 design spec §6.
 */

/** The slice of Hero this system drives (provided by the integrator on Hero). */
export interface HeroLike {
  position: THREE.Vector3
  level: number
  alive: boolean
  damage: number
  mana: number
  maxMana: number
  spendMana(cost: number): boolean
  /**
   * Temporarily drive hero motion (leap/spin/dash/blink). Returns false if
   * dead/rolling/already overridden. `tick` returns the world-space
   * displacement for that frame (collision applied by hero); `teleportTo`
   * applies at start.
   */
  overrideMotion(opts: {
    duration: number
    invulnerable?: boolean
    anim?: string
    teleportTo?: THREE.Vector3
    tick?: (dt: number, t01: number) => THREE.Vector3 | null
    onEnd?: () => void
  }): boolean
}

export interface SkillHit {
  target: Hittable
  amount: number
  stagger?: number
}

export interface SkillSystemOpts {
  scene: THREE.Scene
  classId: ClassId
  hero: HeroLike
  getTargets: () => Hittable[]
  applyHits: (hits: SkillHit[], opts?: { hitstop?: number; shake?: number }) => void
  aim: () => THREE.Vector3 | null
}

// ── Skill unlock levels (slot 0 from the start; quests can unlock earlier) ──
const UNLOCK_LEVELS = [1, 3, 5] as const

// ── Sentinel ──
const SUNDER_RANGE = 8
const SUNDER_DURATION = 0.5
const SUNDER_PEAK = 3
const SUNDER_RADIUS = 3.2
const SUNDER_MULT = 2.2
const SUNDER_STAGGER = 0.8
const SPIN_DURATION = 1.6
const SPIN_MOVE_SPEED = 4.2
const SPIN_TICK_INTERVAL = 0.27
const SPIN_RADIUS = 2.6
const SPIN_MULT = 0.6
const WARCALL_RADIUS = 5.5
const WARCALL_MULT = 0.7
const WARCALL_STAGGER = 2.0

// ── Stormcaller ──
const BOLT_SPEED = 16
const BOLT_RANGE = 14
const BOLT_HIT_RADIUS = 0.35
const BOLT_MULT = 1.4
const BOLT_SPLASH_RADIUS = 1.2
const BOLT_SPLASH_MULT = 0.7
const BOLT_TRAIL_INTERVAL = 0.04
const BOLT_HEIGHT = 1.1
const BURST_RADIUS = 6
const BURST_TIME = 0.45
const BURST_BAND = 0.8
const BURST_MULT = 1.8
const BURST_STAGGER = 0.4
const RIFTSTEP_RANGE = 9
const RIFTSTEP_IFRAMES = 0.15

// ── Shade ──
const FAN_COUNT = 5
const FAN_ARC = (50 * Math.PI) / 180
const FAN_SPEED = 20
const FAN_RANGE = 10
const FAN_HIT_RADIUS = 0.3
const FAN_MULT = 0.8
const TRAP_MAX = 2
const TRAP_RANGE = 7
const TRAP_ZAP_RADIUS = 4
const TRAP_ZAP_INTERVAL = 0.8
const TRAP_MULT = 0.9
const TRAP_LIFETIME = 6
const BEAM_LIFE = 0.08
const DASH_DIST = 6
const DASH_TIME = 0.22
const DASH_MULT = 1.5
const DASH_HIT_PAD = 0.9

const PROJECTILE_POOL_CAP = 14

// ── Colors ──
const AMBER = 0xf59e0b
const GOLD = 0xfacc15
const DUST = 0x9ca3af
const VIOLET = 0xa855f7
const VIOLET_BRIGHT = 0xc084fc
const CYAN = 0x22d3ee
const BLADE_WHITE = 0xe2e8f0
const BLUE_GRAY = 0x94a3b8

// ── Shared geometry/materials (one of each; no per-projectile lights) ──
const UNIT_SPHERE = new THREE.SphereGeometry(1, 10, 8)
const BOLT_MAT = new THREE.MeshBasicMaterial({
  color: VIOLET_BRIGHT,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const BLADE_MAT = new THREE.MeshBasicMaterial({
  color: BLADE_WHITE,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const BEAM_GEO = new THREE.CylinderGeometry(0.025, 0.025, 1, 6)
const BEAM_MAT = new THREE.MeshBasicMaterial({
  color: CYAN,
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})

const FORWARD = new THREE.Vector3(0, 0, 1)
const UP = new THREE.Vector3(0, 1, 0)
const _v = new THREE.Vector3()
const _dir = new THREE.Vector3()

function distXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

type ProjectileKind = 'bolt' | 'blade'

interface Projectile {
  mesh: THREE.Mesh
  active: boolean
  kind: ProjectileKind
  vel: THREE.Vector3
  traveled: number
  range: number
  hitRadius: number
  damage: number
  splashDamage: number
  trailT: number
}

interface Trap {
  group: THREE.Group
  tip: THREE.Mesh
  t: number
  zapT: number
}

interface Beam {
  mesh: THREE.Mesh
  t: number
}

interface Burst {
  center: THREE.Vector3
  t: number
  hit: Set<Hittable>
}

/** Per-class skill executor: casting, cooldowns, projectiles, traps, rings. */
export class SkillSystem {
  private readonly scene: THREE.Scene
  private readonly hero: HeroLike
  private readonly getTargets: () => Hittable[]
  private readonly applyHits: SkillSystemOpts['applyHits']
  private readonly aim: () => THREE.Vector3 | null
  private readonly defs: [SkillDef, SkillDef, SkillDef]
  private readonly casters: [() => boolean, () => boolean, () => boolean]

  private readonly cds: [number, number, number] = [0, 0, 0]
  private readonly unlockedSlots: [boolean, boolean, boolean] = [true, false, false]
  private readonly lastAimDir = new THREE.Vector3(-1, 0, -1).normalize()
  private delayed: { t: number; fn: () => void }[] = []

  private readonly projectiles: Projectile[] = []
  private readonly traps: Trap[] = []
  private readonly trapPool: { group: THREE.Group; tip: THREE.Mesh }[] = []
  private readonly beams: Beam[] = []
  private readonly beamPool: THREE.Mesh[] = []
  private bursts: Burst[] = []

  // Steelstorm channel
  private spinActive = false
  private spinT = 0
  private spinTicks = 0
  private spinTorus: THREE.Mesh | null = null

  // Phase Strike sweep
  private dashActive = false
  private readonly dashHit = new Set<Hittable>()

  constructor(opts: SkillSystemOpts) {
    this.scene = opts.scene
    this.hero = opts.hero
    this.getTargets = opts.getTargets
    this.applyHits = opts.applyHits
    this.aim = opts.aim
    this.defs = CLASS_DEFS[opts.classId].skills
    const table: Record<ClassId, [() => boolean, () => boolean, () => boolean]> = {
      sentinel: [() => this.castSunder(), () => this.castSteelstorm(), () => this.castWarcall()],
      stormcaller: [() => this.castWarpBolt(), () => this.castStormburst(), () => this.castRiftstep()],
      shade: [() => this.castFanOfBlades(), () => this.castStingTrap(), () => this.castPhaseStrike()],
    }
    this.casters = table[opts.classId]
  }

  /** Quest-reward unlock (slot 0 is always unlocked). */
  unlock(slot: 1 | 2): void {
    this.unlockedSlots[slot] = true
  }

  slotState(slot: 0 | 1 | 2): { cdRemaining: number; cdMax: number; manaOk: boolean; unlocked: boolean } {
    const def = this.defs[slot]
    return {
      cdRemaining: this.cds[slot],
      cdMax: def.cooldown,
      manaOk: this.hero.mana >= def.manaCost,
      unlocked: this.unlockedSlots[slot],
    }
  }

  cast(slot: 0 | 1 | 2): void {
    if (!this.unlockedSlots[slot] || this.cds[slot] > 0 || !this.hero.alive) return
    if (this.casters[slot]()) this.cds[slot] = this.defs[slot].cooldown
  }

  update(dt: number): void {
    // level-based auto-unlock (quests may have unlocked earlier)
    for (let i = 1; i <= 2; i++) {
      if (!this.unlockedSlots[i] && this.hero.level >= UNLOCK_LEVELS[i]) this.unlockedSlots[i] = true
    }
    for (let i = 0; i < 3; i++) this.cds[i] = Math.max(0, this.cds[i] - dt)

    if (this.delayed.length) {
      for (const d of this.delayed) d.t -= dt
      const due = this.delayed.filter((d) => d.t <= 0)
      if (due.length) {
        this.delayed = this.delayed.filter((d) => d.t > 0)
        for (const d of due) d.fn()
      }
    }

    if (dt <= 0) return
    const targets = this.getTargets()
    this.updateSpin(dt)
    this.updateDash(targets)
    this.updateProjectiles(dt, targets)
    this.updateBursts(dt, targets)
    this.updateTraps(dt, targets)
    this.updateBeams(dt)
  }

  // ─────────────────────────── helpers ───────────────────────────

  /** Spend mana for an instant cast; a failed spend triggers hero feedback. */
  private pay(slot: 0 | 1 | 2): boolean {
    return this.hero.spendMana(this.defs[slot].manaCost)
  }

  /**
   * Mana pre-check for motion skills (which must not spend until
   * `overrideMotion` accepts). A failed check still routes through
   * `spendMana` so the hero fires its "no mana" feedback.
   */
  private canAfford(slot: 0 | 1 | 2): boolean {
    if (this.hero.mana >= this.defs[slot].manaCost) return true
    this.hero.spendMana(this.defs[slot].manaCost)
    return false
  }

  /** Flat unit direction toward the aim point (falls back to the last one). */
  private aimDir(out: THREE.Vector3): THREE.Vector3 {
    const aim = this.aim()
    if (aim) {
      out.copy(aim).sub(this.hero.position)
      out.y = 0
      if (out.lengthSq() > 0.04) {
        out.normalize()
        this.lastAimDir.copy(out)
        return out
      }
    }
    return out.copy(this.lastAimDir)
  }

  /** Ground point toward the aim, clamped to `maxDist` from the hero. */
  private aimPointClamped(maxDist: number, out: THREE.Vector3): THREE.Vector3 {
    const aim = this.aim()
    if (aim) {
      out.copy(aim).sub(this.hero.position)
      out.y = 0
      const d = out.length()
      if (d > 0.2) {
        this.lastAimDir.copy(out).divideScalar(d)
        if (d > maxDist) out.multiplyScalar(maxDist / d)
        out.add(this.hero.position)
        out.y = 0
        return out
      }
    }
    out.copy(this.lastAimDir).multiplyScalar(maxDist).add(this.hero.position)
    out.y = 0
    return out
  }

  /** All alive targets within `radius` (+ their own radius) of `center`. */
  private collectRadial(center: THREE.Vector3, radius: number, mult: number, stagger?: number): SkillHit[] {
    const hits: SkillHit[] = []
    const amount = Math.round(this.hero.damage * mult)
    for (const t of this.getTargets()) {
      if (!t.alive) continue
      if (distXZ(center, t.position) <= radius + t.radius) hits.push({ target: t, amount, stagger })
    }
    return hits
  }

  // ─────────────────────────── Sentinel ───────────────────────────

  private castSunder(): boolean {
    if (!this.canAfford(0)) return false
    const start = this.hero.position.clone()
    const target = this.aimPointClamped(SUNDER_RANGE, new THREE.Vector3())
    const step = new THREE.Vector3()
    let prev = 0
    const ok = this.hero.overrideMotion({
      duration: SUNDER_DURATION,
      invulnerable: true,
      anim: 'leap',
      tick: (_dt, t01) => {
        const arc = (t: number): number => SUNDER_PEAK * 4 * t * (1 - t)
        step.copy(target).sub(start).multiplyScalar(t01 - prev)
        step.y = arc(t01) - arc(prev)
        prev = t01
        return step
      },
      onEnd: () => this.sunderLand(),
    })
    if (!ok) return false
    this.hero.spendMana(this.defs[0].manaCost)
    spawnRing(this.scene, target, AMBER, 0.3, SUNDER_RADIUS, 0.35)
    tone(160, 0.35, 'sine', 0.06, 500)
    return true
  }

  private sunderLand(): void {
    this.hero.position.y = 0
    const pos = this.hero.position
    this.applyHits(this.collectRadial(pos, SUNDER_RADIUS, SUNDER_MULT, SUNDER_STAGGER), {
      hitstop: 0.06,
      shake: 0.35,
    })
    spawnBurst(this.scene, pos, DUST, 6, { speed: 3.2, up: 2.4, size: 0.16, life: 0.5 })
    tone(60, 0.25, 'sawtooth', 0.12, 35)
  }

  private castSteelstorm(): boolean {
    if (this.spinActive || !this.canAfford(1)) return false
    const step = new THREE.Vector3()
    const ok = this.hero.overrideMotion({
      duration: SPIN_DURATION,
      anim: 'spin',
      tick: (dt) => {
        this.aimDir(_dir)
        return step.copy(_dir).multiplyScalar(SPIN_MOVE_SPEED * dt)
      },
      onEnd: () => this.endSpin(),
    })
    if (!ok) return false
    this.hero.spendMana(this.defs[1].manaCost)
    this.spinActive = true
    this.spinT = 0
    this.spinTicks = 0
    if (!this.spinTorus) {
      this.spinTorus = new THREE.Mesh(
        new THREE.TorusGeometry(1.9, 0.05, 8, 40),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      this.spinTorus.rotation.x = Math.PI / 2
    }
    this.scene.add(this.spinTorus)
    this.spinTick() // first hit lands immediately
    return true
  }

  private spinTick(): void {
    if (this.hero.alive) {
      this.applyHits(this.collectRadial(this.hero.position, SPIN_RADIUS, SPIN_MULT))
    }
    tone(120 + this.spinTicks * 15, 0.06, 'square', 0.04, 80)
    this.spinTicks++
  }

  private updateSpin(dt: number): void {
    if (!this.spinActive) return
    this.spinT += dt
    if (this.spinTorus) {
      const p = this.hero.position
      this.spinTorus.position.set(p.x, 1.1, p.z)
    }
    while (this.spinActive && this.spinT >= this.spinTicks * SPIN_TICK_INTERVAL) this.spinTick()
  }

  private endSpin(): void {
    this.spinActive = false
    if (this.spinTorus) this.scene.remove(this.spinTorus)
  }

  private castWarcall(): boolean {
    if (!this.pay(2)) return false
    const pos = this.hero.position.clone()
    this.applyHits(this.collectRadial(pos, WARCALL_RADIUS, WARCALL_MULT, WARCALL_STAGGER), { shake: 0.3 })
    spawnRing(this.scene, pos, GOLD, 0, WARCALL_RADIUS, 0.4, { opacity: 0.7 })
    this.delayed.push({
      t: 0.12,
      fn: () => spawnRing(this.scene, pos, GOLD, 0, WARCALL_RADIUS, 0.4, { opacity: 0.7 }),
    })
    tone(90, 0.5, 'square', 0.12, 70)
    tone(135, 0.5, 'square', 0.08, 100, 0.02)
    return true
  }

  // ─────────────────────────── Stormcaller ───────────────────────────

  private castWarpBolt(): boolean {
    if (!this.pay(0)) return false
    this.aimDir(_dir)
    const dmg = Math.round(this.hero.damage * BOLT_MULT)
    const splash = Math.round(this.hero.damage * BOLT_SPLASH_MULT)
    const p = this.acquireProjectile('bolt')
    p.mesh.position.copy(this.hero.position).addScaledVector(_dir, 0.6)
    p.mesh.position.y = BOLT_HEIGHT
    p.vel.copy(_dir).multiplyScalar(BOLT_SPEED)
    p.range = BOLT_RANGE
    p.hitRadius = BOLT_HIT_RADIUS
    p.damage = dmg
    p.splashDamage = splash
    tone(760, 0.12, 'sine', 0.06, 240)
    return true
  }

  private castStormburst(): boolean {
    if (!this.pay(1)) return false
    const center = this.hero.position.clone().setY(0)
    this.bursts.push({ center, t: 0, hit: new Set() })
    spawnRing(this.scene, center, CYAN, 0, BURST_RADIUS, BURST_TIME, { opacity: 0.6 })
    tone(900, 0.35, 'sawtooth', 0.07, 140)
    return true
  }

  private updateBursts(dt: number, targets: Hittable[]): void {
    if (!this.bursts.length) return
    const amount = Math.round(this.hero.damage * BURST_MULT)
    const hits: SkillHit[] = []
    for (const b of this.bursts) {
      b.t += dt
      const r = BURST_RADIUS * Math.min(1, b.t / BURST_TIME)
      for (const t of targets) {
        if (!t.alive || b.hit.has(t)) continue
        const d = distXZ(b.center, t.position)
        if (d <= r + t.radius && d >= r - BURST_BAND - t.radius) {
          b.hit.add(t)
          hits.push({ target: t, amount, stagger: BURST_STAGGER })
        }
      }
    }
    if (hits.length) this.applyHits(hits)
    this.bursts = this.bursts.filter((b) => b.t < BURST_TIME)
  }

  private castRiftstep(): boolean {
    if (!this.canAfford(2)) return false
    const origin = this.hero.position.clone()
    const dest = this.aimPointClamped(RIFTSTEP_RANGE, new THREE.Vector3())
    const resolved = resolveCollision(origin, dest)
    const ok = this.hero.overrideMotion({
      duration: RIFTSTEP_IFRAMES,
      invulnerable: true,
      anim: 'blink',
      teleportTo: resolved,
    })
    if (!ok) return false
    this.hero.spendMana(this.defs[2].manaCost)
    for (const pos of [origin, resolved]) {
      spawnRing(this.scene, pos, VIOLET, 0.2, 1.1, 0.3, { opacity: 0.6 })
      spawnBurst(this.scene, pos, VIOLET_BRIGHT, 5, { speed: 0.4, up: 2.6, gravity: 0, size: 0.11, life: 0.3 })
    }
    tone(500, 0.1, 'sine', 0.05, 1200)
    tone(1200, 0.12, 'sine', 0.05, 400, 0.08)
    return true
  }

  // ─────────────────────────── Shade ───────────────────────────

  private castFanOfBlades(): boolean {
    if (!this.pay(0)) return false
    this.aimDir(_dir)
    const base = Math.atan2(_dir.x, _dir.z)
    const stepAngle = FAN_ARC / (FAN_COUNT - 1)
    const dmg = Math.round(this.hero.damage * FAN_MULT)
    for (let i = 0; i < FAN_COUNT; i++) {
      const a = base + (i - (FAN_COUNT - 1) / 2) * stepAngle
      _v.set(Math.sin(a), 0, Math.cos(a))
      const p = this.acquireProjectile('blade')
      p.mesh.position.copy(this.hero.position).addScaledVector(_v, 0.7)
      p.mesh.position.y = 1.0
      p.mesh.quaternion.setFromUnitVectors(FORWARD, _v)
      p.vel.copy(_v).multiplyScalar(FAN_SPEED)
      p.range = FAN_RANGE
      p.hitRadius = FAN_HIT_RADIUS
      p.damage = dmg
      p.splashDamage = 0
    }
    for (let i = 0; i < 3; i++) tone(880, 0.05, 'square', 0.035, 660, i * 0.03)
    return true
  }

  private castStingTrap(): boolean {
    if (!this.pay(1)) return false
    const pos = this.aimPointClamped(TRAP_RANGE, new THREE.Vector3())
    if (this.traps.length >= TRAP_MAX) this.removeTrap(0)
    const { group, tip } = this.trapPool.pop() ?? this.buildTrap()
    group.position.copy(pos)
    this.scene.add(group)
    this.traps.push({ group, tip, t: 0, zapT: 0 })
    tone(220, 0.1, 'triangle', 0.06, 330)
    return true
  }

  private buildTrap(): { group: THREE.Group; tip: THREE.Mesh } {
    const group = new THREE.Group()
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1524, roughness: 0.55 })
    )
    cone.position.y = 0.25
    group.add(cone)
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    )
    tip.position.y = 0.53
    group.add(tip)
    return { group, tip }
  }

  private removeTrap(index: number): void {
    const trap = this.traps[index]
    if (!trap) return
    this.scene.remove(trap.group)
    this.trapPool.push({ group: trap.group, tip: trap.tip })
    this.traps.splice(index, 1)
  }

  private updateTraps(dt: number, targets: Hittable[]): void {
    const amount = Math.round(this.hero.damage * TRAP_MULT)
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i]
      trap.t += dt
      trap.zapT += dt
      trap.tip.scale.setScalar(1 + Math.sin(trap.t * 6) * 0.25)
      if (trap.zapT >= TRAP_ZAP_INTERVAL) {
        trap.zapT -= TRAP_ZAP_INTERVAL
        let nearest: Hittable | null = null
        let nearestD = TRAP_ZAP_RADIUS
        for (const t of targets) {
          if (!t.alive) continue
          const d = distXZ(trap.group.position, t.position)
          if (d <= nearestD) {
            nearest = t
            nearestD = d
          }
        }
        if (nearest) {
          this.applyHits([{ target: nearest, amount }])
          this.fireBeam(trap.group.position, nearest.position)
          tone(1400, 0.07, 'sawtooth', 0.045, 500)
        }
      }
      if (trap.t >= TRAP_LIFETIME) this.removeTrap(i)
    }
  }

  private fireBeam(from: THREE.Vector3, to: THREE.Vector3): void {
    const mesh = this.beamPool.pop() ?? new THREE.Mesh(BEAM_GEO, BEAM_MAT)
    _v.set(to.x, 0.9, to.z).sub(_dir.set(from.x, 0.5, from.z))
    const len = Math.max(0.001, _v.length())
    mesh.quaternion.setFromUnitVectors(UP, _v.divideScalar(len))
    mesh.scale.set(1, len, 1)
    mesh.position.set((from.x + to.x) / 2, 0.7, (from.z + to.z) / 2)
    this.scene.add(mesh)
    this.beams.push({ mesh, t: BEAM_LIFE })
  }

  private updateBeams(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]
      b.t -= dt
      if (b.t <= 0) {
        this.scene.remove(b.mesh)
        this.beamPool.push(b.mesh)
        this.beams.splice(i, 1)
      }
    }
  }

  private castPhaseStrike(): boolean {
    if (!this.canAfford(2)) return false
    const dir = this.aimDir(new THREE.Vector3()).clone()
    const step = new THREE.Vector3()
    let prev = 0
    let rings = 0
    const ok = this.hero.overrideMotion({
      duration: DASH_TIME,
      invulnerable: true,
      anim: 'dash',
      tick: (_dt, t01) => {
        while (rings < 4 && t01 >= (rings + 1) * 0.25 - 0.01) {
          spawnRing(this.scene, this.hero.position, BLUE_GRAY, 0.25, 1.0, 0.3, { opacity: 0.5, y: 0.9 })
          rings++
        }
        step.copy(dir).multiplyScalar(DASH_DIST * (t01 - prev))
        prev = t01
        return step
      },
      onEnd: () => {
        this.dashActive = false
      },
    })
    if (!ok) return false
    this.hero.spendMana(this.defs[2].manaCost)
    this.dashActive = true
    this.dashHit.clear()
    tone(340, 0.18, 'sine', 0.07, 90)
    return true
  }

  private updateDash(targets: Hittable[]): void {
    if (!this.dashActive || !this.hero.alive) return
    const amount = Math.round(this.hero.damage * DASH_MULT)
    const hits: SkillHit[] = []
    for (const t of targets) {
      if (!t.alive || this.dashHit.has(t)) continue
      if (distXZ(this.hero.position, t.position) <= DASH_HIT_PAD + t.radius) {
        this.dashHit.add(t)
        hits.push({ target: t, amount })
      }
    }
    if (hits.length) this.applyHits(hits, { hitstop: 0.05 })
  }

  // ─────────────────────────── projectile pool ───────────────────────────

  private acquireProjectile(kind: ProjectileKind): Projectile {
    let p = this.projectiles.find((q) => !q.active)
    if (!p) {
      if (this.projectiles.length < PROJECTILE_POOL_CAP) {
        p = {
          mesh: new THREE.Mesh(UNIT_SPHERE, BOLT_MAT),
          active: false,
          kind,
          vel: new THREE.Vector3(),
          traveled: 0,
          range: 0,
          hitRadius: 0,
          damage: 0,
          splashDamage: 0,
          trailT: 0,
        }
        this.projectiles.push(p)
      } else {
        // pool exhausted: recycle the projectile closest to expiring
        p = this.projectiles.reduce((a, b) => (a.traveled / a.range > b.traveled / b.range ? a : b))
        this.releaseProjectile(p)
      }
    }
    p.active = true
    p.kind = kind
    p.traveled = 0
    p.trailT = 0
    p.mesh.material = kind === 'bolt' ? BOLT_MAT : BLADE_MAT
    if (kind === 'bolt') p.mesh.scale.setScalar(0.16)
    else p.mesh.scale.set(0.072, 0.072, 0.264) // 0.12 sphere stretched (0.6, 0.6, 2.2)
    p.mesh.quaternion.identity()
    this.scene.add(p.mesh)
    return p
  }

  private releaseProjectile(p: Projectile): void {
    p.active = false
    this.scene.remove(p.mesh)
  }

  private updateProjectiles(dt: number, targets: Hittable[]): void {
    for (const p of this.projectiles) {
      if (!p.active) continue
      p.mesh.position.addScaledVector(p.vel, dt)
      p.traveled += p.vel.length() * dt
      if (p.kind === 'bolt') {
        p.trailT -= dt
        if (p.trailT <= 0) {
          p.trailT = BOLT_TRAIL_INTERVAL
          spawnTrail(this.scene, p.mesh.position, VIOLET_BRIGHT, 0.14, 0.25)
        }
      }
      let direct: Hittable | null = null
      for (const t of targets) {
        if (!t.alive) continue
        if (distXZ(p.mesh.position, t.position) <= p.hitRadius + t.radius) {
          direct = t
          break
        }
      }
      if (direct) {
        this.impactProjectile(p, direct, targets)
        continue
      }
      if (p.traveled >= p.range) this.releaseProjectile(p)
    }
  }

  private impactProjectile(p: Projectile, direct: Hittable, targets: Hittable[]): void {
    const hits: SkillHit[] = [{ target: direct, amount: p.damage }]
    if (p.kind === 'bolt') {
      for (const t of targets) {
        if (!t.alive || t === direct) continue
        if (distXZ(p.mesh.position, t.position) <= BOLT_SPLASH_RADIUS + t.radius) {
          hits.push({ target: t, amount: p.splashDamage })
        }
      }
      _v.set(p.mesh.position.x, 0, p.mesh.position.z)
      spawnRing(this.scene, _v, VIOLET, 0.1, 0.8, 0.2, { opacity: 0.7 })
      tone(300, 0.08, 'sawtooth', 0.05, 90)
    }
    this.applyHits(hits)
    this.releaseProjectile(p)
  }
}
