import * as THREE from 'three'
import { tone } from './audio'
import { spawnBurst, spawnRing } from './vfx'

/**
 * The Diablo dopamine: procedural gear drops with light beams, gothic names
 * and auto-equip. Three slots (weapon / armor / charm), four rarities, 1–4
 * affixes rolled from a tier-scaled pool. Equipped gear persists in
 * localStorage ('wt.gear'); the integrator applies `GearTotals` to the hero
 * via `onEquip` and the exposed `totals` getter. Press I for the gear panel.
 */

export type Rarity = 'common' | 'magic' | 'rare' | 'unique'
export type GearSlot = 'weapon' | 'armor' | 'charm'

export interface GearTotals {
  dmg: number
  hp: number
  speed: number
  mana: number
  regen: number
}

export interface Affix {
  stat: keyof GearTotals
  value: number
}

export interface Item {
  slot: GearSlot
  rarity: Rarity
  name: string
  affixes: Affix[]
}

// ---------- tuning tables ----------

const RARITIES: Rarity[] = ['common', 'magic', 'rare', 'unique']
const SLOTS: GearSlot[] = ['weapon', 'armor', 'charm']
const STATS: (keyof GearTotals)[] = ['dmg', 'hp', 'speed', 'mana', 'regen']

const RARITY_COLOR: Record<Rarity, number> = {
  common: 0xd6d3d1,
  magic: 0x60a5fa,
  rare: 0xfde047,
  unique: 0xc084fc,
}

const RARITY_CSS: Record<Rarity, string> = {
  common: '#d6d3d1',
  magic: '#60a5fa',
  rare: '#fde047',
  unique: '#c084fc',
}

/** vertical light beam per rarity — uniques must read across the screen */
const BEAM: Record<Rarity, { h: number; r: number; opacity: number }> = {
  common: { h: 2.2, r: 0.2, opacity: 0.14 },
  magic: { h: 4.5, r: 0.24, opacity: 0.22 },
  rare: { h: 8, r: 0.28, opacity: 0.3 },
  unique: { h: 18, r: 0.34, opacity: 0.42 },
}

const AFFIX_COUNT: Record<Rarity, [number, number]> = {
  common: [1, 1],
  magic: [1, 2],
  rare: [2, 3],
  unique: [3, 4],
}

const RARITY_MULT: Record<Rarity, number> = { common: 1, magic: 1.25, rare: 1.6, unique: 2.1 }

/** base affix magnitude at a given danger tier */
const AFFIX_BASE: Record<keyof GearTotals, (tier: number) => number> = {
  dmg: (t) => 2 + t * 2,
  hp: (t) => 8 + t * 6,
  speed: (t) => 3 + t * 1.5,
  mana: (t) => 6 + t * 5,
  regen: (t) => 0.4 + t * 0.35,
}

/** score weights — regen and dmg are precious, raw HP is cheap */
const SCORE_WEIGHT: Record<keyof GearTotals, number> = {
  dmg: 3,
  hp: 1,
  speed: 2.5,
  mana: 0.7,
  regen: 20,
}

const MAX_DROPS = 12
const PICKUP_RANGE = 1.3
/** drops can't be grabbed before the beam moment lands */
const PICKUP_GRACE = 0.4
const FADE_SECONDS = 0.6

// ---------- gothic name generator ----------

const BASES: Record<GearSlot, string[]> = {
  weapon: ['Blade', 'Sabre', 'Falchion', 'Cleaver', 'Warpick', 'Greatsword', 'Dirk', 'Glaive'],
  armor: ['Cuirass', 'Hauberk', 'Shroud', 'Carapace', 'Warcoat', 'Mantle', 'Plate'],
  charm: ['Talisman', 'Idol', 'Fetish', 'Sigil', 'Relic', 'Amulet', 'Eye'],
}
const COMMON_PREFIX = ['Worn', 'Rusted', 'Cracked', 'Plain', 'Dented', 'Tarnished', 'Crude']
const MAGIC_PREFIX = ['Keening', 'Ashen', 'Grim', 'Hollow', 'Vicious', 'Sombre', 'Baleful', 'Wailing']
const MAGIC_SUFFIX = ['Fen', 'Gallows', 'Moor', 'Barrow', 'Warp', 'Ember', 'Mire', 'Vigil']
const RARE_FIRST = ['Grave', 'Dusk', 'Wolf', 'Storm', 'Blood', 'Night', 'Sorrow', 'Warp', 'Bone', 'Raven']
const RARE_SECOND = ['mourn', 'bite', 'howl', 'shard', 'veil', 'brand', 'pall', 'thorn', 'song', 'grasp']
const UNIQUE_NAME = [
  'Vowbreaker',
  'Griefmaker',
  'Duskrender',
  'Warpsplitter',
  'Hollowfang',
  'Embergrasp',
  'Nightsunder',
  'Oathpyre',
]
const UNIQUE_TITLE = [
  'Fang of the First Warp',
  'Oath of Emberwatch',
  'Dirge of the Hollow King',
  'Last Light of the Moor',
  'Bane of the Warpspawn',
  'Crown of the Gallows',
  'Shard of the Warpheart',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function makeName(slot: GearSlot, rarity: Rarity): string {
  switch (rarity) {
    case 'common':
      return `${pick(COMMON_PREFIX)} ${pick(BASES[slot])}`
    case 'magic':
      return `${pick(MAGIC_PREFIX)} ${pick(BASES[slot])} of the ${pick(MAGIC_SUFFIX)}`
    case 'rare':
      return `${pick(RARE_FIRST)}${pick(RARE_SECOND)}`
    case 'unique':
      return `${pick(UNIQUE_NAME)}, ${pick(UNIQUE_TITLE)}`
  }
}

// ---------- item rolling ----------

function rollRarity(tier: number, floor: Rarity): Rarity {
  const t = Math.max(0, tier)
  const weights: Record<Rarity, number> = {
    common: 60,
    magic: 28 + t * 7,
    rare: 8 + t * 4,
    unique: 1 + t * 1.4,
  }
  let total = 0
  for (const r of RARITIES) total += weights[r]
  let roll = Math.random() * total
  let rolled: Rarity = 'common'
  for (const r of RARITIES) {
    roll -= weights[r]
    if (roll <= 0) {
      rolled = r
      break
    }
  }
  return RARITIES.indexOf(rolled) < RARITIES.indexOf(floor) ? floor : rolled
}

function rollItem(tier: number, rarity: Rarity): Item {
  const slot = pick(SLOTS)
  const [lo, hi] = AFFIX_COUNT[rarity]
  const count = lo + Math.floor(Math.random() * (hi - lo + 1))
  const pool = [...STATS]
  // a weapon should almost always bring damage — that is the fantasy
  const affixes: Affix[] = []
  if (slot === 'weapon' && Math.random() < 0.8) {
    pool.splice(pool.indexOf('dmg'), 1)
    affixes.push(rollAffix('dmg', tier, rarity))
  }
  while (affixes.length < count && pool.length) {
    const stat = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!
    affixes.push(rollAffix(stat, tier, rarity))
  }
  return { slot, rarity, name: makeName(slot, rarity), affixes }
}

function rollAffix(stat: keyof GearTotals, tier: number, rarity: Rarity): Affix {
  const raw = AFFIX_BASE[stat](Math.max(0, tier)) * RARITY_MULT[rarity] * (0.7 + Math.random() * 0.6)
  const value = stat === 'regen' ? Math.max(0.2, Math.round(raw * 10) / 10) : Math.max(1, Math.round(raw))
  return { stat, value }
}

function scoreOf(item: Item): number {
  let s = 0
  for (const a of item.affixes) s += a.value * SCORE_WEIGHT[a.stat]
  return s
}

function affixLabel(a: Affix): string {
  switch (a.stat) {
    case 'dmg':
      return `+${a.value} damage`
    case 'hp':
      return `+${a.value} HP`
    case 'speed':
      return `+${a.value}% move speed`
    case 'mana':
      return `+${a.value} mana`
    case 'regen':
      return `+${a.value} HP/s`
  }
}

function isValidItem(v: unknown): v is Item {
  if (typeof v !== 'object' || v === null) return false
  const it = v as Partial<Item>
  if (!SLOTS.includes(it.slot as GearSlot)) return false
  if (!RARITIES.includes(it.rarity as Rarity)) return false
  if (typeof it.name !== 'string' || !it.name || it.name.length > 80) return false
  if (!Array.isArray(it.affixes) || it.affixes.length < 1 || it.affixes.length > 4) return false
  for (const a of it.affixes) {
    if (typeof a !== 'object' || a === null) return false
    if (!STATS.includes((a as Affix).stat)) return false
    const value = (a as Affix).value
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 999) return false
  }
  return true
}

// ---------- shared geometry (allocated once) ----------

const BEAM_GEO = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true)
const GROUND_RING_GEO = new THREE.RingGeometry(0.72, 1, 32)
const WEAPON_GEO = new THREE.BoxGeometry(0.1, 0.85, 0.05)
const ARMOR_GEO = new THREE.BoxGeometry(0.46, 0.4, 0.22)
const CHARM_GEO = new THREE.OctahedronGeometry(0.22, 0)
const ITEM_GEOS: Record<GearSlot, THREE.BufferGeometry> = {
  weapon: WEAPON_GEO,
  armor: ARMOR_GEO,
  charm: CHARM_GEO,
}

interface FadeMat {
  mat: THREE.Material & { opacity: number }
  base: number
}

interface Drop {
  item: Item
  score: number
  group: THREE.Group
  spinner: THREE.Object3D
  mats: FadeMat[]
  age: number
  /** -1 while live; once >= 0 the drop is fading out */
  fadeT: number
}

export class LootSystem {
  /** equipped gear by slot — the panel's source of truth, persisted to 'wt.gear' */
  readonly equipped: Record<GearSlot, Item | null> = { weapon: null, armor: null, charm: null }

  private scene: THREE.Scene
  private floatText: (pos: THREE.Vector3, text: string, cls?: string) => void
  private onEquip: (totals: GearTotals, announcement: string) => void
  private drops: Drop[] = []
  private panel: HTMLElement
  private panelOpen = false

  constructor(opts: {
    scene: THREE.Scene
    floatText: (pos: THREE.Vector3, text: string, cls?: string) => void
    onEquip: (totals: GearTotals, announcement: string) => void
  }) {
    this.scene = opts.scene
    this.floatText = opts.floatText
    this.onEquip = opts.onEquip
    this.loadGear()
    this.injectStyle()
    this.panel = document.createElement('div')
    this.panel.id = 'gear-panel'
    document.body.appendChild(this.panel)
    this.renderPanel()
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyI' && !e.repeat) this.togglePanel()
    })
  }

  /** combined bonuses of everything equipped — apply to the hero on boot */
  get totals(): GearTotals {
    const t: GearTotals = { dmg: 0, hp: 0, speed: 0, mana: 0, regen: 0 }
    for (const slot of SLOTS) {
      const item = this.equipped[slot]
      if (!item) continue
      for (const a of item.affixes) t[a.stat] += a.value
    }
    t.regen = Math.round(t.regen * 10) / 10
    return t
  }

  // ---------- dropping ----------

  maybeDrop(pos: THREE.Vector3, tier: number, source: 'enemy' | 'elite' | 'spire' | 'heart'): void {
    switch (source) {
      case 'enemy':
        if (Math.random() < 0.12) this.drop(pos, rollItem(tier, rollRarity(tier, 'common')))
        break
      case 'elite':
        this.drop(pos, rollItem(tier, rollRarity(tier, 'magic')))
        break
      case 'spire':
        this.drop(pos, rollItem(tier, rollRarity(tier + 1, 'magic')))
        // sealed spires spill an extra roll more often than not
        if (Math.random() < 0.6) this.drop(pos, rollItem(tier, rollRarity(tier, 'common')))
        break
      case 'heart':
        this.drop(pos, rollItem(Math.max(3, tier), 'unique'))
        break
    }
  }

  private drop(pos: THREE.Vector3, item: Item): void {
    const color = RARITY_COLOR[item.rarity]
    const a = Math.random() * Math.PI * 2
    const r = 0.4 + Math.random() * 0.7
    const at = new THREE.Vector3(pos.x + Math.cos(a) * r, 0, pos.z + Math.sin(a) * r)

    const group = new THREE.Group()
    group.position.copy(at)
    const mats: FadeMat[] = []

    // the item itself, slowly spinning + bobbing
    const itemMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: item.rarity === 'common' ? 0.25 : 0.6,
      roughness: 0.4,
      metalness: 0.3,
      transparent: true,
      opacity: 1,
    })
    const spinner = new THREE.Group()
    const mesh = new THREE.Mesh(ITEM_GEOS[item.slot], itemMat)
    if (item.slot === 'weapon') mesh.rotation.z = 0.55
    spinner.add(mesh)
    spinner.position.y = 0.4
    group.add(spinner)
    mats.push({ mat: itemMat, base: 1 })

    // the beam — the thing you see from across the moor
    const beam = BEAM[item.rarity]
    const beamMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: beam.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const beamMesh = new THREE.Mesh(BEAM_GEO, beamMat)
    beamMesh.scale.set(beam.r, beam.h, beam.r)
    beamMesh.position.y = beam.h / 2
    group.add(beamMesh)
    mats.push({ mat: beamMat, base: beam.opacity })

    if (item.rarity === 'unique') {
      // gold trim: a wider, fainter second beam wrapping the purple core
      const trimMat = beamMat.clone()
      trimMat.color.setHex(0xf59e0b)
      trimMat.opacity = 0.16
      const trim = new THREE.Mesh(BEAM_GEO, trimMat)
      trim.scale.set(beam.r * 1.8, beam.h * 0.85, beam.r * 1.8)
      trim.position.y = (beam.h * 0.85) / 2
      group.add(trim)
      mats.push({ mat: trimMat, base: 0.16 })
    }

    // pulsing ground ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: item.rarity === 'unique' ? 0xf59e0b : color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(GROUND_RING_GEO, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.06
    ring.scale.setScalar(0.55)
    group.add(ring)
    mats.push({ mat: ringMat, base: 0.5 })

    this.scene.add(group)
    this.drops.push({ item, score: scoreOf(item), group, spinner, mats, age: 0, fadeT: -1 })

    // the EVENT: burst, shockwave ring, chime, floated name
    spawnBurst(this.scene, at.clone().setY(0.4), color, item.rarity === 'unique' ? 22 : 10, {
      speed: 4,
      up: 5,
    })
    spawnRing(this.scene, at, color, 0.3, item.rarity === 'unique' ? 4 : 2.2, 0.55)
    this.chime(item.rarity)
    this.floatText(at.clone().setY(1.7), item.name, `loot-${item.rarity}`)

    // cap live drops — the oldest still-live one fades away
    const live = this.drops.filter((d) => d.fadeT < 0)
    if (live.length > MAX_DROPS) live[0]!.fadeT = 0
  }

  private chime(rarity: Rarity): void {
    switch (rarity) {
      case 'common':
        tone(494, 0.1, 'triangle', 0.045)
        break
      case 'magic':
        tone(523, 0.12, 'triangle', 0.06)
        tone(659, 0.18, 'triangle', 0.055, undefined, 0.09)
        break
      case 'rare':
        tone(587, 0.12, 'triangle', 0.07)
        tone(740, 0.14, 'triangle', 0.065, undefined, 0.1)
        tone(880, 0.24, 'triangle', 0.06, undefined, 0.2)
        break
      case 'unique':
        // choir-ish 3-note arpeggio: long sines with a triangle octave halo
        tone(392, 0.6, 'sine', 0.07)
        tone(494, 0.6, 'sine', 0.06, undefined, 0.16)
        tone(587, 0.9, 'sine', 0.07, undefined, 0.32)
        tone(784, 0.8, 'triangle', 0.04, undefined, 0.32)
        tone(1175, 0.7, 'sine', 0.025, undefined, 0.48)
        break
    }
  }

  // ---------- per-tick ----------

  update(dt: number, heroPos: THREE.Vector3): void {
    const t = performance.now() * 0.001
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!
      d.age += dt
      d.group.rotation.y += dt * 1.4
      d.spinner.position.y = 0.4 + Math.sin(t * 2 + d.group.position.x) * 0.08
      // spawn pop: scale in over the first quarter second
      const popK = Math.min(1, d.age / 0.25)
      const pulse = 0.9 + Math.sin(t * 3 + d.group.position.z) * 0.1

      if (d.fadeT >= 0) {
        d.fadeT += dt
        const k = Math.min(1, d.fadeT / FADE_SECONDS)
        d.group.scale.setScalar(Math.max(0.001, 1 - k))
        for (const { mat, base } of d.mats) mat.opacity = base * (1 - k)
        if (k >= 1) this.remove(i)
        continue
      }

      d.group.scale.setScalar(popK)
      for (const { mat, base } of d.mats) mat.opacity = base * popK * pulse

      if (d.age < PICKUP_GRACE) continue
      const dx = heroPos.x - d.group.position.x
      const dz = heroPos.z - d.group.position.z
      if (dx * dx + dz * dz <= PICKUP_RANGE * PICKUP_RANGE) this.pickUp(i)
    }
  }

  private pickUp(index: number): void {
    const d = this.drops[index]!
    const pos = d.group.position.clone()
    this.remove(index)

    const current = this.equipped[d.item.slot]
    const upgrade = !current || d.score > scoreOf(current)
    if (!upgrade) {
      // not worth carrying — it crumbles, keeping the flow moving
      spawnBurst(this.scene, pos.clone().setY(0.5), 0x57534e, 8, { speed: 2.5, up: 2, size: 0.09 })
      tone(220, 0.12, 'square', 0.03, 140)
      this.floatText(pos.setY(1.4), 'shattered', 'loot-shatter')
      return
    }

    this.equipped[d.item.slot] = d.item
    this.saveGear()
    this.renderPanel()
    spawnRing(this.scene, pos, RARITY_COLOR[d.item.rarity], 0.3, 1.8, 0.4)
    tone(660, 0.14, 'triangle', 0.06)
    tone(880, 0.2, 'triangle', 0.05, undefined, 0.08)
    const stats = d.item.affixes.map(affixLabel).join(', ')
    this.onEquip(this.totals, `${d.item.name.toUpperCase()} — ${stats}`)
  }

  private remove(index: number): void {
    const d = this.drops[index]!
    this.scene.remove(d.group)
    for (const { mat } of d.mats) mat.dispose()
    this.drops.splice(index, 1)
  }

  // ---------- persistence ----------

  private loadGear(): void {
    try {
      const raw = localStorage.getItem('wt.gear')
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const slot of SLOTS) {
        const v = parsed[slot]
        if (isValidItem(v) && v.slot === slot) this.equipped[slot] = v
      }
    } catch {
      localStorage.removeItem('wt.gear')
    }
  }

  private saveGear(): void {
    try {
      localStorage.setItem('wt.gear', JSON.stringify(this.equipped))
    } catch {
      /* storage full or blocked — gear just won't persist */
    }
  }

  // ---------- gear panel (I) ----------

  private togglePanel(): void {
    this.panelOpen = !this.panelOpen
    this.panel.classList.toggle('show', this.panelOpen)
    if (this.panelOpen) this.renderPanel()
  }

  private renderPanel(): void {
    const rows = SLOTS.map((slot) => {
      const item = this.equipped[slot]
      if (!item) {
        return `<div class="gear-slot"><div class="gear-slot-label">${slot}</div>
          <div class="gear-empty">— nothing equipped —</div></div>`
      }
      const affixes = item.affixes.map((a) => `<div class="gear-affix">${affixLabel(a)}</div>`).join('')
      return `<div class="gear-slot"><div class="gear-slot-label">${slot}</div>
        <div class="gear-name ${item.rarity}">${item.name}</div>${affixes}</div>`
    }).join('')

    const t = this.totals
    const parts: string[] = []
    if (t.dmg) parts.push(`+${t.dmg} dmg`)
    if (t.hp) parts.push(`+${t.hp} HP`)
    if (t.speed) parts.push(`+${t.speed}% speed`)
    if (t.mana) parts.push(`+${t.mana} mana`)
    if (t.regen) parts.push(`+${t.regen} HP/s`)
    const totals = parts.length ? parts.join(' &middot; ') : 'no bonuses yet'

    this.panel.innerHTML = `<div class="gear-title">Gear <span class="gear-key">I</span></div>
      ${rows}<div class="gear-totals">${totals}</div>`
  }

  private injectStyle(): void {
    if (document.getElementById('loot-style')) return
    const style = document.createElement('style')
    style.id = 'loot-style'
    style.textContent = `
#gear-panel {
  position: fixed;
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
  width: 236px;
  z-index: 20;
  display: none;
  pointer-events: none;
  background: rgba(10, 7, 16, 0.92);
  border: 1px solid rgba(168, 85, 247, 0.35);
  border-radius: 10px;
  padding: 12px 14px;
  font-family: Georgia, 'Times New Roman', serif;
  color: #d6d3d1;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
#gear-panel.show { display: block; }
#gear-panel .gear-title {
  font-size: 13px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #f59e0b;
  border-bottom: 1px solid rgba(168, 85, 247, 0.25);
  padding-bottom: 6px;
  margin-bottom: 8px;
}
#gear-panel .gear-key {
  float: right;
  font-family: monospace;
  font-size: 10px;
  color: #71717a;
  border: 1px solid #3f3f46;
  border-radius: 4px;
  padding: 0 4px;
}
#gear-panel .gear-slot { margin-bottom: 10px; }
#gear-panel .gear-slot-label {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #71717a;
}
#gear-panel .gear-name { font-size: 14px; line-height: 1.25; text-shadow: 0 1px 3px #000; }
#gear-panel .gear-name.common { color: ${RARITY_CSS.common}; }
#gear-panel .gear-name.magic { color: ${RARITY_CSS.magic}; }
#gear-panel .gear-name.rare { color: ${RARITY_CSS.rare}; }
#gear-panel .gear-name.unique {
  color: ${RARITY_CSS.unique};
  text-shadow: 0 0 8px rgba(245, 158, 11, 0.55), 0 1px 3px #000;
}
#gear-panel .gear-empty { font-size: 12px; font-style: italic; color: #52525b; }
#gear-panel .gear-affix { font-size: 12px; color: #a1a1aa; padding-left: 8px; }
#gear-panel .gear-totals {
  border-top: 1px solid rgba(168, 85, 247, 0.25);
  padding-top: 7px;
  font-size: 12px;
  color: #f59e0b;
}
.dmg.loot-common { color: ${RARITY_CSS.common}; font-size: 14px; }
.dmg.loot-magic { color: ${RARITY_CSS.magic}; font-size: 15px; text-shadow: 0 0 8px rgba(96, 165, 250, 0.6), 0 1px 3px #000; }
.dmg.loot-rare { color: ${RARITY_CSS.rare}; font-size: 16px; text-shadow: 0 0 10px rgba(253, 224, 71, 0.6), 0 1px 3px #000; }
.dmg.loot-unique {
  color: ${RARITY_CSS.unique};
  font-size: 18px;
  letter-spacing: 0.04em;
  text-shadow: 0 0 14px rgba(245, 158, 11, 0.8), 0 0 26px rgba(192, 132, 252, 0.6), 0 1px 3px #000;
}
.dmg.loot-shatter { color: #57534e; font-size: 13px; font-style: italic; }
`
    document.head.appendChild(style)
  }
}
