import * as THREE from 'three'
import {
  TOWN_CENTER,
  TOWN_RADIUS,
  BARROW_ENTRANCE,
  BARROW_FIELD_RADIUS,
  getWorldLights,
} from './world'

/**
 * Zone partitioning and the ZoneDirector: names, danger tiers, and the
 * per-zone atmosphere (fog / hemisphere / moon / background) that lerps as
 * the hero crosses the moor — and snaps on the barrow teleport.
 */

export type ZoneId = 'town' | 'blackfen' | 'gallows' | 'barrowfield' | 'barrow'

export const ZONE_NAMES: Record<ZoneId, string> = {
  town: 'Emberwatch',
  blackfen: 'The Blackfen Moor',
  gallows: 'The Gallows Reach',
  barrowfield: 'The Barrowfield',
  barrow: 'The Hollow Barrow',
}

/** Anything past this x lives in the dungeon's far-offset interior. */
const DUNGEON_X_THRESHOLD = 250
/** Blackfen (tier 1) reaches this far from town; beyond it is the Gallows Reach. */
const BLACKFEN_RADIUS = 72

export function zoneAt(pos: THREE.Vector3): ZoneId {
  if (pos.x > DUNGEON_X_THRESHOLD) return 'barrow'
  if (pos.distanceTo(TOWN_CENTER) < TOWN_RADIUS) return 'town'
  if (pos.distanceTo(BARROW_ENTRANCE) < BARROW_FIELD_RADIUS) return 'barrowfield'
  return pos.distanceTo(TOWN_CENTER) < BLACKFEN_RADIUS ? 'blackfen' : 'gallows'
}

const TIERS: Record<ZoneId, number> = { town: 0, blackfen: 1, gallows: 2, barrowfield: 3, barrow: 3 }

/** 0 in town, 1–2 across the moor, 3 in the Barrowfield and the barrow itself. */
export function dangerTier(pos: THREE.Vector3): number {
  return TIERS[zoneAt(pos)]
}

interface ZonePreset {
  bg: number
  fogDensity: number
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  moonColor: number
  moonIntensity: number
  moonShadow: boolean
}

/** Spec §2 lighting table. */
const PRESETS: Record<ZoneId, ZonePreset> = {
  town: {
    bg: 0x0a0712,
    fogDensity: 0.014,
    hemiSky: 0x8a7a64,
    hemiGround: 0x3a2c1e,
    hemiIntensity: 4.0,
    moonColor: 0x9ab2dc,
    moonIntensity: 2.2,
    moonShadow: true,
  },
  blackfen: {
    bg: 0x05040a,
    fogDensity: 0.022,
    hemiSky: 0x6a6494,
    hemiGround: 0x241e38,
    hemiIntensity: 4.4,
    moonColor: 0x9ab2dc,
    moonIntensity: 2.6,
    moonShadow: true,
  },
  gallows: {
    bg: 0x04030a,
    fogDensity: 0.027,
    hemiSky: 0x5c5a86,
    hemiGround: 0x1e1a30,
    hemiIntensity: 4.0,
    moonColor: 0x8aa2cc,
    moonIntensity: 2.3,
    moonShadow: true,
  },
  barrowfield: {
    bg: 0x060806,
    fogDensity: 0.026,
    hemiSky: 0x66784f,
    hemiGround: 0x1e2818,
    hemiIntensity: 4.0,
    moonColor: 0x7a92b4,
    moonIntensity: 1.8,
    moonShadow: true,
  },
  barrow: {
    bg: 0x050308,
    fogDensity: 0.035,
    hemiSky: 0x4a3626,
    hemiGround: 0x1a100a,
    hemiIntensity: 2.8,
    moonColor: 0x9ab2dc,
    moonIntensity: 0.5,
    moonShadow: false,
  },
}

const BLEND_SECONDS = 1.6

/** Mutable snapshot of every lerped lighting parameter. */
interface LightingState {
  bg: THREE.Color
  fog: THREE.Color
  fogDensity: number
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  moonColor: THREE.Color
  moonIntensity: number
}

function stateFromPreset(p: ZonePreset): LightingState {
  return {
    bg: new THREE.Color(p.bg),
    fog: new THREE.Color(p.bg),
    fogDensity: p.fogDensity,
    hemiSky: new THREE.Color(p.hemiSky),
    hemiGround: new THREE.Color(p.hemiGround),
    hemiIntensity: p.hemiIntensity,
    moonColor: new THREE.Color(p.moonColor),
    moonIntensity: p.moonIntensity,
  }
}

/**
 * Watches the hero's zone; on change fires `onZoneChange` (the integrator
 * shows the banner) and blends the atmosphere over 1.6 s — snapping for the
 * barrow, which is entered by teleport.
 */
export class ZoneDirector {
  private scene: THREE.Scene
  private onZoneChange: (zone: ZoneId, displayName: string) => void
  private zone: ZoneId | null = null
  private from: LightingState = stateFromPreset(PRESETS.town)
  private to: LightingState = stateFromPreset(PRESETS.town)
  private blendT = 1
  private blendDuration = BLEND_SECONDS

  constructor(scene: THREE.Scene, opts: { onZoneChange: (zone: ZoneId, displayName: string) => void }) {
    this.scene = scene
    this.onZoneChange = opts.onZoneChange
  }

  private capture(): LightingState {
    const { hemi, moon } = getWorldLights()
    const fog = this.scene.fog as THREE.FogExp2
    return {
      bg: (this.scene.background as THREE.Color).clone(),
      fog: fog.color.clone(),
      fogDensity: fog.density,
      hemiSky: hemi.color.clone(),
      hemiGround: hemi.groundColor.clone(),
      hemiIntensity: hemi.intensity,
      moonColor: moon.color.clone(),
      moonIntensity: moon.intensity,
    }
  }

  private apply(k: number): void {
    const { hemi, moon } = getWorldLights()
    const fog = this.scene.fog as THREE.FogExp2
    const a = this.from
    const b = this.to
    ;(this.scene.background as THREE.Color).lerpColors(a.bg, b.bg, k)
    fog.color.lerpColors(a.fog, b.fog, k)
    fog.density = a.fogDensity + (b.fogDensity - a.fogDensity) * k
    hemi.color.lerpColors(a.hemiSky, b.hemiSky, k)
    hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, k)
    hemi.intensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * k
    moon.color.lerpColors(a.moonColor, b.moonColor, k)
    moon.intensity = a.moonIntensity + (b.moonIntensity - a.moonIntensity) * k
  }

  update(dt: number, heroPos: THREE.Vector3): void {
    const zone = zoneAt(heroPos)
    if (zone !== this.zone) {
      // teleports (in or out of the barrow) snap; overland transitions blend
      const snap = this.zone === null || zone === 'barrow' || this.zone === 'barrow'
      this.zone = zone
      this.from = this.capture()
      this.to = stateFromPreset(PRESETS[zone])
      getWorldLights().moon.castShadow = PRESETS[zone].moonShadow
      if (snap) {
        this.blendT = this.blendDuration = BLEND_SECONDS
        this.apply(1)
      } else {
        this.blendT = 0
        this.blendDuration = BLEND_SECONDS
      }
      this.onZoneChange(zone, ZONE_NAMES[zone])
    }
    if (this.blendT < this.blendDuration) {
      this.blendT = Math.min(this.blendDuration, this.blendT + dt)
      this.apply(this.blendT / this.blendDuration)
    }
  }
}
