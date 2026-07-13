import * as THREE from 'three'
import { audio, tone } from './audio'
import type { EnemyKindId } from './enemy'
import type { Hittable } from './hittable'
import { spawnBurst, spawnRing } from './vfx'

/** Hittable cylinder radius of a spire (the Warpheart is wider). */
const SPIRE_RADIUS = 1.1
const HEART_RADIUS = 1.6
/** Visual scale multiplier applied to the whole Warpheart build. */
const HEART_SCALE = 1.45
/** Guards materialize on this ring around the spire base. */
const GUARD_RING_RADIUS = 2.5
/** HP fractions at which the spire visibly cracks. */
const CRACK_STAGES = [0.66, 0.33]
const HIT_FLASH_TIME = 0.15
const WARD_BREAK_TIME = 0.4
/** Destruction timeline: crystal flare, then burst + light decay. */
const SEAL_FLARE_TIME = 0.25
const SEAL_LIGHT_DECAY = 0.7
const SEAL_TOTAL = SEAL_FLARE_TIME + SEAL_LIGHT_DECAY
/** Permanent seal-ring residue decals are capped world-wide. */
const SEAL_DECAL_CAP = 12
const AOE_RADIUS = 4
const AOE_DAMAGE = 20
const AOE_KNOCKBACK = 1.5
const GORTHUL_NAME = 'Gorthul, Warden of the First Warp'

const CRYSTAL_EMISSIVE = new THREE.Color(0xc084fc)
const WHITE = new THREE.Color(0xffffff)

/** Oldest-first list of permanent seal-ring residue decals. */
const sealDecals: THREE.Mesh[] = []

function addSealDecal(scene: THREE.Scene, pos: THREE.Vector3, scale: number): void {
  const decal = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.35, 40),
    new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  )
  decal.rotation.x = -Math.PI / 2
  decal.position.copy(pos).setY(0.06)
  decal.scale.setScalar(scale)
  scene.add(decal)
  sealDecals.push(decal)
  if (sealDecals.length > SEAL_DECAL_CAP) sealDecals.shift()!.removeFromParent()
}

/** 300 ms white screen flash for the Warpheart's death. */
function heartFlash(): void {
  if (!document.getElementById('wt-flash-style')) {
    const style = document.createElement('style')
    style.id = 'wt-flash-style'
    style.textContent = `
.wt-heart-flash {
  position: fixed;
  inset: 0;
  background: #fff;
  pointer-events: none;
  z-index: 60;
  animation: wt-heart-flash 0.3s ease-out forwards;
}
@keyframes wt-heart-flash {
  0% { opacity: 0.9; }
  100% { opacity: 0; }
}`
    document.head.appendChild(style)
  }
  const el = document.createElement('div')
  el.className = 'wt-heart-flash'
  document.body.appendChild(el)
  window.setTimeout(() => el.remove(), 320)
}

/**
 * The dormant warp ring/core/motes recipe carried over from the retired
 * warp.ts, kept as static nest dressing beside overworld spires (spec: 60%
 * scale). No update loop — it just glows.
 */
export function buildWarpDressing(scene: THREE.Scene, position: THREE.Vector3, scale = 0.6): THREE.Group {
  const group = new THREE.Group()

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.6, 0.14, 10, 40),
    new THREE.MeshStandardMaterial({
      color: 0x2e1065,
      emissive: 0xa855f7,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    })
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.25
  group.add(ring)

  const core = new THREE.Mesh(
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
  core.rotation.x = -Math.PI / 2
  core.position.y = 0.12
  group.add(core)

  const moteGeo = new THREE.SphereGeometry(0.09, 6, 6)
  const moteMat = new THREE.MeshBasicMaterial({ color: 0xc4b5fd })
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const mote = new THREE.Mesh(moteGeo, moteMat)
    mote.position.set(Math.cos(a) * 1.6, 0.5 + Math.sin(i * 2.1) * 0.3, Math.sin(a) * 1.6)
    group.add(mote)
  }

  group.scale.setScalar(scale)
  group.position.copy(position)
  scene.add(group)
  return group
}

export interface WarpSpireOpts {
  scene: THREE.Scene
  position: THREE.Vector3
  hp: number
  /** enemy scaling passed to guards */
  tier: number
  /** the Warpheart: bigger, screen flash + riftCleared on death */
  isHeart?: boolean
  guards: EnemyKindId[]
  spawnEnemy: (kind: EnemyKindId, pos: THREE.Vector3, tier: number, name?: string) => Hittable & { alive: boolean }
  onSealed: () => void
  /** destruction AoE vs enemies */
  onAoE?: (pos: THREE.Vector3, radius: number, damage: number, knockback: number) => void
  floatText?: (pos: THREE.Vector3, text: string, cls?: string) => void
}

/**
 * A Warpspire — a destructible obsidian obelisk the warp drives into the
 * earth. It spawns its fixed guard pack once at construction and is warded
 * (immune) while any guard lives. Killing it plays a sealing sequence:
 * crystal flare, chunk burst, an expanding seal wave that damages nearby
 * enemies, and a permanent pale-blue residue ring. The Warpheart variant is
 * bigger and ends Act I with a white flash.
 */
export class WarpSpire implements Hittable {
  alive = true
  hp: number
  maxHp: number
  readonly radius: number
  readonly group = new THREE.Group()

  private readonly scene: THREE.Scene
  private readonly isHeart: boolean
  private readonly onSealed: () => void
  private readonly onAoE?: (pos: THREE.Vector3, radius: number, damage: number, knockback: number) => void
  private readonly floatText?: (pos: THREE.Vector3, text: string, cls?: string) => void
  private readonly guards: (Hittable & { alive: boolean })[] = []

  private readonly baseMat: THREE.MeshStandardMaterial
  private readonly ringMesh: THREE.Mesh
  private readonly shaft: THREE.Mesh[] = []
  private readonly runes: THREE.Mesh[] = []
  private readonly runeMat: THREE.MeshStandardMaterial
  private readonly crystal: THREE.Mesh
  private readonly crystalMat: THREE.MeshStandardMaterial
  private readonly motes: THREE.Mesh[] = []
  private readonly light: THREE.PointLight
  private readonly wardSphere: THREE.Mesh
  private readonly wardMat: THREE.MeshBasicMaterial
  private readonly crystalBaseY = 3.6

  private pulseSeed = Math.random() * 10
  private crackStage = 0
  private moteSpeedMult = 1
  private hitFlashT = 0
  private hadGuards: boolean
  private wardBreakT = -1
  private sealT = -1
  private burstDone = false
  private sealed = false

  constructor(opts: WarpSpireOpts) {
    this.scene = opts.scene
    this.isHeart = opts.isHeart ?? false
    this.onSealed = opts.onSealed
    this.onAoE = opts.onAoE
    this.floatText = opts.floatText
    this.maxHp = opts.hp
    this.hp = opts.hp
    this.radius = this.isHeart ? HEART_RADIUS : SPIRE_RADIUS

    // base
    this.baseMat = new THREE.MeshStandardMaterial({ color: 0x231f30, roughness: 0.85 })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 0.5, 6), this.baseMat)
    base.position.y = 0.25
    base.castShadow = true
    base.receiveShadow = true
    this.group.add(base)

    // rotating warp torus (recipe from the old warp.ts)
    this.ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.14, 10, 40),
      new THREE.MeshStandardMaterial({
        color: 0x2e1065,
        emissive: 0xa855f7,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      })
    )
    this.ringMesh.rotation.x = -Math.PI / 2
    this.ringMesh.position.y = 0.25
    this.group.add(this.ringMesh)

    // screwed obsidian shaft: three stacked, twisted blocks
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x141021, roughness: 0.35 })
    const shaftGeo = new THREE.BoxGeometry(0.62, 0.95, 0.62)
    const shaftYs = [1.0, 1.9, 2.8]
    const shaftYaws = [0, 0.35, 0.7]
    const shaftScales = [1.0, 0.85, 0.7]
    for (let i = 0; i < 3; i++) {
      const block = new THREE.Mesh(shaftGeo, shaftMat)
      block.position.y = shaftYs[i]
      block.rotation.y = shaftYaws[i]
      block.scale.setScalar(shaftScales[i])
      block.castShadow = true
      this.shaft.push(block)
      this.group.add(block)
    }

    // rune slivers spiraling up the shaft faces
    this.runeMat = new THREE.MeshStandardMaterial({
      color: 0x2e1065,
      emissive: 0xa855f7,
      emissiveIntensity: 1.8,
      roughness: 0.4,
    })
    const runeGeo = new THREE.BoxGeometry(0.05, 0.7, 0.05)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      const rune = new THREE.Mesh(runeGeo, this.runeMat)
      rune.position.set(Math.sin(a) * 0.36, 1.2 + i * 0.55, Math.cos(a) * 0.36)
      rune.rotation.y = a
      this.runes.push(rune)
      this.group.add(rune)
    }

    // bobbing, spinning crystal
    this.crystalMat = new THREE.MeshStandardMaterial({
      color: 0x1a1030,
      emissive: 0xc084fc,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    })
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), this.crystalMat)
    this.crystal.position.y = this.crystalBaseY
    this.crystal.castShadow = true
    this.group.add(this.crystal)

    // orbiting motes (recipe from the old warp.ts)
    const moteGeo = new THREE.SphereGeometry(0.09, 6, 6)
    const moteMat = new THREE.MeshBasicMaterial({ color: 0xc4b5fd })
    for (let i = 0; i < 5; i++) {
      const mote = new THREE.Mesh(moteGeo, moteMat)
      this.motes.push(mote)
      this.group.add(mote)
    }

    this.light = new THREE.PointLight(0x9333ea, 26, 16, 1.9)
    this.light.position.y = 2.5
    this.group.add(this.light)

    // ward sphere, visible only while guards live
    this.wardMat = new THREE.MeshBasicMaterial({
      color: 0x7c3aed,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.wardSphere = new THREE.Mesh(new THREE.SphereGeometry(2.1, 24, 16), this.wardMat)
    this.wardSphere.position.y = 1.9
    this.group.add(this.wardSphere)

    if (this.isHeart) this.group.scale.setScalar(HEART_SCALE)
    this.group.position.copy(opts.position)
    opts.scene.add(this.group)

    // the fixed guard pack spawns once, on a ring around the base
    const ringR = Math.max(GUARD_RING_RADIUS, this.radius + 1.4)
    const baseAngle = Math.random() * Math.PI * 2
    opts.guards.forEach((kind, i) => {
      const a = baseAngle + (i / opts.guards.length) * Math.PI * 2
      const pos = opts.position.clone().add(new THREE.Vector3(Math.sin(a) * ringR, 0, Math.cos(a) * ringR))
      const name = this.isHeart && kind === 'demon' ? GORTHUL_NAME : undefined
      this.guards.push(opts.spawnEnemy(kind, pos, opts.tier, name))
    })
    this.hadGuards = this.guards.length > 0
    this.wardSphere.visible = this.hadGuards
  }

  get position(): THREE.Vector3 {
    return this.group.position
  }

  /** any guard alive → immune */
  get warded(): boolean {
    return this.alive && this.guards.some((g) => g.alive)
  }

  private textAnchor(): THREE.Vector3 {
    return this.position.clone().setY(this.isHeart ? 3.8 : 2.8)
  }

  takeDamage(amount: number, _knockback: THREE.Vector3 | null): void {
    if (!this.alive) return
    if (this.warded) {
      this.floatText?.(this.textAnchor(), 'WARDED', 'warded')
      tone(700, 0.06, 'sine', 0.04, 500)
      return
    }
    this.hp -= amount
    this.hitFlashT = HIT_FLASH_TIME
    const s = this.isHeart ? HEART_SCALE : 1
    spawnBurst(this.scene, this.position.clone().setY(this.crystalBaseY * s), 0xc084fc, 4 + Math.floor(Math.random() * 3), {
      speed: 4,
      up: 3.5,
      size: 0.11,
      gravity: 12,
      life: 0.9,
    })
    tone(150, 0.08, 'square', 0.06, 100)
    while (this.crackStage < CRACK_STAGES.length && this.hp / this.maxHp <= CRACK_STAGES[this.crackStage]) {
      this.applyCrack()
    }
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
      this.sealT = 0 // the destruction sequence takes over in update()
    }
  }

  private applyCrack(): void {
    this.crackStage++
    const axis = this.crackStage === 1 ? 'z' : 'x'
    this.shaft.forEach((block, i) => {
      block.rotation[axis] += 0.06 * (i % 2 === 0 ? 1 : -1)
    })
    this.runeMat.emissiveIntensity = 1.8 + this.crackStage * 0.8
    this.moteSpeedMult = 1 + this.crackStage * 0.5
    tone(90, 0.14, 'sawtooth', 0.08, 45)
  }

  /** t0.25 of the sealing: chunks, seal wave, AoE, residue, sounds. */
  private burst(): void {
    const s = this.isHeart ? HEART_SCALE : 1
    const p = this.position
    const mid = p.clone().setY(1.4 * s)
    spawnBurst(this.scene, mid, 0x141021, 6, { speed: 5.5, up: 4.5, size: 0.3 * s, gravity: 14, life: 1.5 })
    spawnBurst(this.scene, mid, 0xc4b5fd, 10, { speed: 3.5, up: 3, size: 0.09, gravity: 4, life: 0.8 })
    spawnRing(this.scene, p, 0xa855f7, 1.6 * s, 5.2 * s, 0.55, { opacity: 0.9, y: 0.25 })
    this.onAoE?.(p, AOE_RADIUS, AOE_DAMAGE, AOE_KNOCKBACK)

    // strip the spire down to its recolored base — the permanent residue
    for (const m of [this.ringMesh, this.crystal, this.wardSphere, ...this.shaft, ...this.runes, ...this.motes]) {
      this.group.remove(m)
    }
    this.baseMat.color.setHex(0x3a3547)
    addSealDecal(this.scene, p, s)

    tone(160, 0.5, 'sawtooth', 0.09, 40)
    tone(300, 0.6, 'sine', 0.07, 900, 0.1)
    window.setTimeout(() => audio.warpClosed(), 150)
    if (this.isHeart) {
      heartFlash()
      audio.riftCleared()
    }
    this.light.intensity = 90
    this.onSealed()
  }

  update(dt: number, _heroPos: THREE.Vector3): void {
    if (this.sealed) return
    const t = performance.now() * 0.001 + this.pulseSeed

    // destruction timeline
    if (this.sealT >= 0) {
      this.sealT += dt
      if (!this.burstDone) {
        const k = Math.min(1, this.sealT / SEAL_FLARE_TIME)
        this.crystal.position.y = this.crystalBaseY + k * 1.2
        this.crystalMat.emissive.copy(CRYSTAL_EMISSIVE).lerp(WHITE, k)
        this.crystalMat.emissiveIntensity = 2.2 + k * 6
        this.light.intensity = 26 + k * 30
        if (this.sealT >= SEAL_FLARE_TIME) {
          this.burstDone = true
          this.burst()
        }
      } else {
        const k = Math.min(1, (this.sealT - SEAL_FLARE_TIME) / SEAL_LIGHT_DECAY)
        this.light.intensity = 90 * (1 - k)
        if (this.sealT >= SEAL_TOTAL) {
          this.group.remove(this.light)
          this.sealed = true
        }
      }
      return
    }

    // ward break: the last guard just died
    const warded = this.warded
    if (this.hadGuards && !warded) {
      this.hadGuards = false
      this.wardBreakT = 0
      tone(880, 0.3, 'sine', 0.08, 220)
      tone(520, 0.2, 'triangle', 0.06, 130, 0.05)
      this.floatText?.(this.textAnchor(), 'THE WARD BREAKS', 'warded')
    }
    if (this.wardBreakT >= 0) {
      this.wardBreakT += dt
      const k = Math.min(1, this.wardBreakT / WARD_BREAK_TIME)
      this.wardSphere.scale.setScalar(1 + k * 0.6)
      this.wardMat.opacity = 0.16 * (1 - k)
      if (k >= 1) {
        this.wardSphere.visible = false
        this.wardBreakT = -1
      }
    } else if (warded) {
      this.wardMat.opacity = 0.12 + Math.sin(t * 2.6) * 0.04
    }

    // idle animation
    this.ringMesh.rotation.z = t * 0.8
    this.ringMesh.scale.setScalar(1 + Math.sin(t * 3) * 0.07)
    this.crystal.position.y = this.crystalBaseY + Math.sin(t * 2) * 0.12
    this.crystal.rotation.y += dt * 1.3
    this.hitFlashT = Math.max(0, this.hitFlashT - dt)
    this.crystalMat.emissiveIntensity = 2.2 + (this.hitFlashT / HIT_FLASH_TIME) * 2.8

    for (let i = 0; i < this.motes.length; i++) {
      const a = t * 1.4 * this.moteSpeedMult + (i / this.motes.length) * Math.PI * 2
      this.motes[i].position.set(Math.cos(a) * 1.6, 0.5 + Math.sin(t * 2 + i) * 0.5, Math.sin(a) * 1.6)
    }

    let intensity = 26 + Math.sin(t * 3) * 5
    if (this.crackStage > 0) intensity *= 1 + (Math.random() - 0.5) * 0.35 * this.crackStage
    this.light.intensity = intensity
  }
}
