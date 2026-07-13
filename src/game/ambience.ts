import * as THREE from 'three'
import { TOWN_CENTER } from './world'
import type { ZoneId } from './zones'

/**
 * Ambience: weather over the moor and a fully procedural dark-ambient
 * soundtrack. Rain (a recycled Points cloud that follows the hero) falls over
 * the moor zones; lightning + noise-buffer thunder roll over the deep moor;
 * fireflies drift near the Emberwatch fire. The soundtrack is a quiet WebAudio
 * bed — detuned drones, a slow minor pad, rare far bells — with dungeon and
 * town variants crossfaded on zone change. 'M' mutes (persisted).
 */

// ---------- weather tuning ----------

const RAIN_COUNT = 700
const RAIN_BOX_X = 30
const RAIN_BOX_Y = 18
const RAIN_BOX_Z = 30
const RAIN_FADE_SECONDS = 2
const RAIN_OPACITY = 0.5

const FIREFLY_COUNT = 12
const FIREFLY_FADE_SECONDS = 2

const BOLT_MIN_SECONDS = 12
const BOLT_MAX_SECONDS = 30
const BOLT_FLASH_SECONDS = 0.12
const BOLT_PEAK_INTENSITY = 1600

const RAIN_ZONES: ReadonlySet<ZoneId> = new Set(['blackfen', 'gallows', 'barrowfield'])
const BOLT_ZONES: ReadonlySet<ZoneId> = new Set(['gallows', 'barrowfield'])

// ---------- soundtrack tuning ----------

const MASTER_GAIN = 0.05
const LAYER_FADE_TC = 1.0 // setTargetAtTime constant → ~3 s crossfade
const MUTE_KEY = 'wt.mute'

/** Two low minor voicings the pad drifts between (~every 20 s). */
const PAD_VOICINGS: ReadonlyArray<readonly [number, number, number]> = [
  [110, 130.81, 164.81], // A minor
  [73.42, 87.31, 110], // D minor
]
/** A-minor-pentatonic-ish degrees for the far bells. */
const BELL_RATIOS = [1, 1.189, 1.335, 1.498, 1.782] as const

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** Soft radial glow sprite for fireflies (procedural, no assets). */
function glowTexture(): THREE.Texture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

/** Thin vertical streak sprite so each rain point reads as a falling line. */
function streakTexture(): THREE.Texture {
  const w = 8
  const h = 32
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.9)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(w / 2 - 1, 0, 2, h)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

export class Ambience {
  // weather
  private rain: THREE.Points
  private rainGeo: THREE.BufferGeometry
  private rainMat: THREE.PointsMaterial
  private rainSpeeds = new Float32Array(RAIN_COUNT)
  private rainIntensity = 0
  private fireflies: THREE.Points
  private fireflyMat: THREE.PointsMaterial
  private fireflySeeds: { r: number; a: number; y: number; phase: number; speed: number }[] = []
  private fireflyIntensity = 0
  private boltLight: THREE.PointLight
  private boltTimer = rand(BOLT_MIN_SECONDS, BOLT_MAX_SECONDS)
  private flashT = 0
  private elapsed = 0

  // audio
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private music: GainNode | null = null
  private padZone: GainNode | null = null
  private townZone: GainNode | null = null
  private dungeonZone: GainNode | null = null
  private crackleGain: GainNode | null = null
  private padOscs: OscillatorNode[] = []
  private padVoicing = 0
  private padTimer = 20
  private bellTimer = rand(15, 40)
  private crackleTimer = 0
  private brownNoise: AudioBuffer | null = null
  private whiteNoise: AudioBuffer | null = null
  private muted = false

  private zone: ZoneId | null = null
  private toast: HTMLElement

  constructor(scene: THREE.Scene) {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      this.muted = false
    }

    // ----- rain cloud -----
    this.rainGeo = new THREE.BufferGeometry()
    const pos = new Float32Array(RAIN_COUNT * 3)
    for (let i = 0; i < RAIN_COUNT; i++) {
      pos[i * 3] = rand(-RAIN_BOX_X / 2, RAIN_BOX_X / 2)
      pos[i * 3 + 1] = rand(0, RAIN_BOX_Y)
      pos[i * 3 + 2] = rand(-RAIN_BOX_Z / 2, RAIN_BOX_Z / 2)
      this.rainSpeeds[i] = rand(16, 26)
    }
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.rainMat = new THREE.PointsMaterial({
      color: 0x9db4d8,
      map: streakTexture(),
      size: 14,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.rain = new THREE.Points(this.rainGeo, this.rainMat)
    this.rain.frustumCulled = false
    this.rain.visible = false
    scene.add(this.rain)

    // ----- fireflies around the Emberwatch fire -----
    const fpos = new Float32Array(FIREFLY_COUNT * 3)
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      this.fireflySeeds.push({
        r: rand(2.5, 7.5),
        a: rand(0, Math.PI * 2),
        y: rand(0.5, 2),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.15, 0.45) * (Math.random() < 0.5 ? -1 : 1),
      })
    }
    const fireflyGeo = new THREE.BufferGeometry()
    fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3))
    this.fireflyMat = new THREE.PointsMaterial({
      color: 0xf5b04a,
      map: glowTexture(),
      size: 12,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.fireflies = new THREE.Points(fireflyGeo, this.fireflyMat)
    this.fireflies.frustumCulled = false
    this.fireflies.visible = false
    scene.add(this.fireflies)

    // ----- lightning -----
    this.boltLight = new THREE.PointLight(0xd6ddff, 0, 140, 0.9)
    this.boltLight.visible = false
    scene.add(this.boltLight)

    // ----- self-contained DOM: mute toast -----
    const style = document.createElement('style')
    style.textContent = `
      #ambience-toast {
        position: fixed;
        top: 52px;
        left: 50%;
        transform: translateX(-50%);
        padding: 6px 18px;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 13px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #d6d3d1;
        background: rgba(10, 7, 16, 0.85);
        border: 1px solid rgba(168, 85, 247, 0.45);
        border-radius: 3px;
        box-shadow: 0 0 14px rgba(0, 0, 0, 0.7);
        opacity: 0;
        transition: opacity 0.4s ease;
        pointer-events: none;
        z-index: 30;
      }
      #ambience-toast.show { opacity: 1; }
      #ambience-toast .gold { color: #f59e0b; }
    `
    document.head.appendChild(style)
    this.toast = document.createElement('div')
    this.toast.id = 'ambience-toast'
    document.body.appendChild(this.toast)

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.toggleMute()
    })
  }

  // ---------- public API ----------

  /** Call once after the first user gesture — WebAudio needs it. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    try {
      this.ctx = new AudioContext()
    } catch {
      return
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.buildGraph(this.ctx)
    if (this.zone) this.applyZoneMix(this.zone)
  }

  update(dt: number, heroPos: THREE.Vector3, zone: ZoneId): void {
    this.elapsed += dt
    if (zone !== this.zone) {
      this.zone = zone
      this.applyZoneMix(zone)
    }
    this.updateRain(dt, heroPos, zone)
    this.updateFireflies(dt, zone)
    this.updateLightning(dt, heroPos, zone)
    this.updateMusicTimers(dt, zone)
  }

  // ---------- weather ----------

  private updateRain(dt: number, heroPos: THREE.Vector3, zone: ZoneId): void {
    const target = RAIN_ZONES.has(zone) ? 1 : 0
    const step = dt / RAIN_FADE_SECONDS
    this.rainIntensity = THREE.MathUtils.clamp(
      this.rainIntensity + Math.sign(target - this.rainIntensity) * step,
      0,
      1
    )
    this.rainMat.opacity = RAIN_OPACITY * this.rainIntensity
    this.rain.visible = this.rainIntensity > 0.01
    if (!this.rain.visible) return

    // world-space points recycled into a box around the hero, so the rain
    // follows without visibly sliding with movement
    const attr = this.rainGeo.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    const hx = heroPos.x
    const hz = heroPos.z
    for (let i = 0; i < RAIN_COUNT; i++) {
      const j = i * 3
      let y = arr[j + 1]! - this.rainSpeeds[i]! * dt
      if (y < 0) {
        y += RAIN_BOX_Y
        arr[j] = hx + rand(-RAIN_BOX_X / 2, RAIN_BOX_X / 2)
        arr[j + 2] = hz + rand(-RAIN_BOX_Z / 2, RAIN_BOX_Z / 2)
      } else {
        // wrap streaks the hero has outrun back into the box
        if (arr[j]! - hx > RAIN_BOX_X / 2) arr[j]! -= RAIN_BOX_X
        else if (hx - arr[j]! > RAIN_BOX_X / 2) arr[j]! += RAIN_BOX_X
        if (arr[j + 2]! - hz > RAIN_BOX_Z / 2) arr[j + 2]! -= RAIN_BOX_Z
        else if (hz - arr[j + 2]! > RAIN_BOX_Z / 2) arr[j + 2]! += RAIN_BOX_Z
      }
      arr[j + 1] = y
    }
    attr.needsUpdate = true
  }

  private updateFireflies(dt: number, zone: ZoneId): void {
    const target = zone === 'town' ? 1 : 0
    const step = dt / FIREFLY_FADE_SECONDS
    this.fireflyIntensity = THREE.MathUtils.clamp(
      this.fireflyIntensity + Math.sign(target - this.fireflyIntensity) * step,
      0,
      1
    )
    this.fireflyMat.opacity = 0.85 * this.fireflyIntensity
    this.fireflies.visible = this.fireflyIntensity > 0.01
    if (!this.fireflies.visible) return

    const attr = this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    const t = this.elapsed
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const s = this.fireflySeeds[i]!
      const a = s.a + t * s.speed
      const r = s.r + Math.sin(t * 0.6 + s.phase) * 0.8
      arr[i * 3] = TOWN_CENTER.x + Math.cos(a) * r
      arr[i * 3 + 1] = s.y + Math.sin(t * 1.3 + s.phase * 2) * 0.35
      arr[i * 3 + 2] = TOWN_CENTER.z + Math.sin(a) * r
    }
    attr.needsUpdate = true
  }

  private updateLightning(dt: number, heroPos: THREE.Vector3, zone: ZoneId): void {
    if (this.flashT > 0) {
      this.flashT -= dt
      if (this.flashT <= 0) {
        this.boltLight.intensity = 0
        this.boltLight.visible = false
      } else {
        // ragged flicker across the 120 ms flash
        const k = this.flashT / BOLT_FLASH_SECONDS
        this.boltLight.intensity = BOLT_PEAK_INTENSITY * k * (0.45 + 0.55 * Math.random())
      }
    }
    if (!BOLT_ZONES.has(zone)) return
    this.boltTimer -= dt
    if (this.boltTimer > 0) return
    this.boltTimer = rand(BOLT_MIN_SECONDS, BOLT_MAX_SECONDS)
    this.flashT = BOLT_FLASH_SECONDS
    this.boltLight.position.set(heroPos.x + rand(-12, 12), 28, heroPos.z + rand(-12, 12))
    this.boltLight.visible = true
    this.boltLight.intensity = BOLT_PEAK_INTENSITY
    this.thunder(rand(0.4, 1.2))
  }

  // ---------- soundtrack ----------

  private buildGraph(ctx: AudioContext): void {
    const now = ctx.currentTime
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 1
    this.master.connect(ctx.destination)

    this.music = ctx.createGain()
    this.music.gain.value = MASTER_GAIN
    this.music.connect(this.master)

    // noise buffers, built once
    this.brownNoise = this.makeBrownNoise(ctx)
    this.whiteNoise = this.makeWhiteNoise(ctx)

    // --- base bed: two detuned low drones through a slow-LFO'd lowpass ---
    const droneFilter = ctx.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 180
    droneFilter.Q.value = 1.2
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.5
    droneFilter.connect(droneGain).connect(this.music)
    for (const freq of [55, 55.5]) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      osc.connect(droneFilter)
      osc.start(now)
    }
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.05
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 110
    lfo.connect(lfoGain).connect(droneFilter.frequency)
    lfo.start(now)

    // --- pad: three gentle sines drifting between two minor voicings ---
    this.padZone = ctx.createGain()
    this.padZone.gain.value = 0
    this.padZone.connect(this.music)
    const voicing = PAD_VOICINGS[0]!
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = voicing[i]!
      const g = ctx.createGain()
      g.gain.value = 0.16
      osc.connect(g).connect(this.padZone)
      osc.start(now)
      this.padOscs.push(osc)
    }
    // gentle swell in so the pad never clicks on
    this.padZone.gain.setTargetAtTime(0, now, 0.01)

    // --- dungeon variant: sub throb (~0.5 Hz gain LFO on a low sine) ---
    this.dungeonZone = ctx.createGain()
    this.dungeonZone.gain.value = 0
    this.dungeonZone.connect(this.music)
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.value = 41.2
    const subGain = ctx.createGain()
    subGain.gain.value = 0.3
    const subLfo = ctx.createOscillator()
    subLfo.type = 'sine'
    subLfo.frequency.value = 0.5
    const subLfoGain = ctx.createGain()
    subLfoGain.gain.value = 0.22
    subLfo.connect(subLfoGain).connect(subGain.gain)
    sub.connect(subGain).connect(this.dungeonZone)
    sub.start(now)
    subLfo.start(now)

    // --- town variant: warm 110 Hz drone + fireside crackle ---
    this.townZone = ctx.createGain()
    this.townZone.gain.value = 0
    this.townZone.connect(this.music)
    const hearth = ctx.createOscillator()
    hearth.type = 'triangle'
    hearth.frequency.value = 110
    const hearthGain = ctx.createGain()
    hearthGain.gain.value = 0.14
    hearth.connect(hearthGain).connect(this.townZone)
    hearth.start(now)
    const crackleSrc = ctx.createBufferSource()
    crackleSrc.buffer = this.whiteNoise
    crackleSrc.loop = true
    const crackleFilter = ctx.createBiquadFilter()
    crackleFilter.type = 'bandpass'
    crackleFilter.frequency.value = 2600
    crackleFilter.Q.value = 0.8
    this.crackleGain = ctx.createGain()
    this.crackleGain.gain.value = 0
    crackleSrc.connect(crackleFilter).connect(this.crackleGain).connect(this.townZone)
    crackleSrc.start(now)
  }

  private makeBrownNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 2
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    return buffer
  }

  private makeWhiteNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  /** Crossfade the zone-variant layers over ~3 s. */
  private applyZoneMix(zone: ZoneId): void {
    if (!this.ctx || !this.padZone || !this.townZone || !this.dungeonZone) return
    const now = this.ctx.currentTime
    this.padZone.gain.setTargetAtTime(zone === 'barrow' ? 0 : 1, now, LAYER_FADE_TC)
    this.townZone.gain.setTargetAtTime(zone === 'town' ? 1 : 0, now, LAYER_FADE_TC)
    this.dungeonZone.gain.setTargetAtTime(zone === 'barrow' ? 1 : 0, now, LAYER_FADE_TC)
  }

  private updateMusicTimers(dt: number, zone: ZoneId): void {
    if (!this.ctx) return

    // pad voicing shift every ~20 s (frequencies glide, no new nodes)
    this.padTimer -= dt
    if (this.padTimer <= 0) {
      this.padTimer = rand(17, 24)
      this.padVoicing = (this.padVoicing + 1) % PAD_VOICINGS.length
      const chord = PAD_VOICINGS[this.padVoicing]!
      const now = this.ctx.currentTime
      for (let i = 0; i < this.padOscs.length; i++) {
        this.padOscs[i]!.frequency.setTargetAtTime(chord[i]!, now, 3.5)
      }
    }

    // rare far bells — sparser and an octave darker in the barrow
    this.bellTimer -= dt
    if (this.bellTimer <= 0) {
      const inBarrow = zone === 'barrow'
      this.bellTimer = inBarrow ? rand(25, 60) : rand(15, 40)
      this.bell(inBarrow)
    }

    // fireside crackle pops while in town
    if (zone === 'town' && this.crackleGain) {
      this.crackleTimer -= dt
      if (this.crackleTimer <= 0) {
        this.crackleTimer = rand(0.05, 0.3)
        const now = this.ctx.currentTime
        const g = this.crackleGain.gain
        g.setTargetAtTime(rand(0.06, 0.16), now, 0.004)
        g.setTargetAtTime(0.0001, now + 0.02, 0.02)
      }
    }
  }

  /** One far bell: two slightly detuned sines with a fast exponential decay. */
  private bell(dark: boolean): void {
    if (!this.ctx || !this.music) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const base = dark ? 220 : 440
    const freq = base * BELL_RATIOS[Math.floor(Math.random() * BELL_RATIOS.length)]!
    const peak = dark ? 0.09 : 0.13
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peak, now + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 3)
    g.connect(this.music)
    for (const f of [freq, freq * 1.004]) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = f
      osc.connect(g)
      osc.start(now)
      osc.stop(now + 3.1)
    }
  }

  /** Lowpassed brown-noise rumble, delayed behind the flash. */
  private thunder(delay: number): void {
    if (!this.ctx || !this.master || !this.brownNoise) return
    const ctx = this.ctx
    const t0 = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.brownNoise
    src.playbackRate.value = rand(0.55, 0.8) // stretch the 2 s buffer into a longer roll
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(320, t0)
    filter.frequency.exponentialRampToValueAtTime(70, t0 + 2.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(rand(0.22, 0.38), t0 + 0.08)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3)
    // routed post-music so thunder sits above the quiet bed but under mute
    src.connect(filter).connect(g).connect(this.master)
    src.start(t0)
    src.stop(t0 + 3.2)
  }

  // ---------- mute ----------

  private toggleMute(): void {
    this.muted = !this.muted
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    } catch {
      /* private mode — the toggle still works for this session */
    }
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.1)
    }
    this.toast.innerHTML = this.muted
      ? 'Sound <span class="gold">Muted</span> — M'
      : 'Sound <span class="gold">On</span> — M'
    this.toast.classList.add('show')
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1600)
  }

  private toastTimer = 0
}
