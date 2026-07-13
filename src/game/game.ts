import * as THREE from 'three'
import { buildWorld, WORLD_RADIUS } from './world'
import { Hero } from './hero'
import { Enemy } from './enemy'
import { Warp } from './warp'
import { Hud } from './hud'
import { InputManager } from './input'
import { audio } from './audio'

const CAMERA_OFFSET = new THREE.Vector3(14, 18, 14)
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.OrthographicCamera
  private clock = new THREE.Clock()
  private hud = new Hud()
  private input: InputManager

  private hero: Hero
  private enemies: Enemy[] = []
  private warps: Warp[] = []

  private rift = 1
  private kills = 0
  private viewSize = 9
  private riftTransition = -1
  private respawnT = -1
  private started = false

  // combat feel
  private hitstopT = 0
  private shakeAmp = 0

  // camera-relative movement basis for the fixed isometric angle
  private camForward = new THREE.Vector3(-1, 0, -1).normalize()
  private camRight = new THREE.Vector3(1, 0, -1).normalize()

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.7
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 200)
    this.updateCameraFrustum()
    this.camera.position.copy(CAMERA_OFFSET)
    this.camera.lookAt(0, 0, 0)

    buildWorld(this.scene)
    this.hero = new Hero(this.scene)
    this.wireHero()

    this.input = new InputManager(this.renderer.domElement)
    this.input.onFirstInteraction = () => {
      audio.unlock()
      if (!this.started) {
        this.started = true
        document.getElementById('intro-overlay')!.classList.remove('show')
        this.startRift(1)
      }
    }
    this.input.onZoom = (delta) => {
      this.viewSize = THREE.MathUtils.clamp(this.viewSize + delta * 1.2, 6, 16)
      this.updateCameraFrustum()
    }

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight)
      this.updateCameraFrustum()
    })

    this.hud.setHealth(this.hero.hp, this.hero.maxHp)
    this.hud.setXp(0, this.hero.xpToLevel, 1)
    document.getElementById('intro-overlay')!.classList.add('show')

    this.renderer.setAnimationLoop(() => this.tick())
  }

  private wireHero(): void {
    this.hero.onSwing = () => audio.swing()
    this.hero.onRoll = () => audio.dodge()
    this.hero.onStrike = (hits) => {
      for (const { enemy, amount, finisher } of hits) {
        const knockDir = enemy.position.clone().sub(this.hero.position)
        knockDir.y = 0
        knockDir.normalize().multiplyScalar(finisher ? 1.1 : 0.35)
        enemy.takeDamage(amount, knockDir)
        this.hud.spawnFloatingText(enemy.position.clone().setY(1.8), this.camera, String(amount))
        if (!enemy.alive) this.onEnemyKilled(enemy)
      }
      if (hits.length) {
        audio.hit()
        const killed = hits.some((h) => !h.enemy.alive)
        const finisher = hits.some((h) => h.finisher)
        this.hitstop(killed || finisher ? 0.09 : 0.045)
        this.shake(killed ? 0.3 : finisher ? 0.22 : 0.1)
      }
    }
  }

  private registerEnemy(enemy: Enemy): void {
    enemy.onHitHero = (amount) => {
      const before = this.hero.hp
      this.hero.takeDamage(amount)
      if (this.hero.hp === before) return // dodged (i-frames) or already dead
      audio.hurt()
      this.shake(0.25)
      this.hud.spawnFloatingText(this.hero.position.clone().setY(2.5), this.camera, `-${amount}`, 'hero')
      if (!this.hero.alive && this.respawnT < 0) this.onHeroDeath()
    }
    this.enemies.push(enemy)
  }

  private onEnemyKilled(enemy: Enemy): void {
    this.kills++
    audio.kill()
    this.hud.setKills(this.kills)
    const xp = enemy.xpValue()
    const leveled = this.hero.gainXp(xp)
    this.hud.spawnFloatingText(enemy.position.clone().setY(1.2), this.camera, `+${xp} xp`, 'xp')
    if (leveled) {
      audio.levelUp()
      this.hud.showBanner(`Level ${this.hero.level}`, 1800)
    }
  }

  private startRift(rift: number): void {
    this.rift = rift
    const warpCount = Math.min(2 + rift, 8)
    const baseAngle = Math.random() * Math.PI * 2
    for (let i = 0; i < warpCount; i++) {
      const angle = baseAngle + (i / warpCount) * Math.PI * 2
      const radius = WORLD_RADIUS * (0.45 + Math.random() * 0.4)
      const pos = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
      const warp = new Warp(this.scene, pos, rift)
      warp.onSpawn = (enemy) => this.registerEnemy(enemy)
      warp.onClosed = () => this.onWarpClosed()
      this.warps.push(warp)
    }
    this.hud.setRift(rift)
    this.hud.setWarps(this.openWarpCount())
    this.hud.showBanner(`Rift ${ROMAN[rift - 1] ?? rift} — ${warpCount} warps detected`)
  }

  private openWarpCount(): number {
    return this.warps.filter((w) => !w.closed).length
  }

  private onWarpClosed(): void {
    audio.warpClosed()
    const open = this.openWarpCount()
    this.hud.setWarps(open)
    if (open === 0) {
      audio.riftCleared()
      this.hud.showBanner('Rift sealed. The evil recedes… for now.', 3200)
      this.hero.hp = this.hero.maxHp
      this.riftTransition = 3.4
    } else {
      this.hud.showBanner('Warp sealed', 1500)
    }
  }

  private onHeroDeath(): void {
    audio.death()
    this.hud.setDead(true)
    this.respawnT = 3
  }

  private updateCameraFrustum(): void {
    const aspect = window.innerWidth / window.innerHeight
    this.camera.left = -this.viewSize * aspect
    this.camera.right = this.viewSize * aspect
    this.camera.top = this.viewSize
    this.camera.bottom = -this.viewSize
    this.camera.updateProjectionMatrix()
  }

  hitstop(seconds: number): void {
    this.hitstopT = Math.max(this.hitstopT, seconds)
  }

  shake(amp: number): void {
    this.shakeAmp = Math.min(0.5, this.shakeAmp + amp)
  }

  private tick(): void {
    const realDt = Math.min(this.clock.getDelta(), 0.05)
    let dt = realDt
    if (this.hitstopT > 0) {
      this.hitstopT -= realDt
      dt = 0
    }

    const aim = this.input.aimPoint(this.camera)

    if (this.started) {
      // movement input, rotated into the isometric ground plane
      const raw = this.input.moveInput()
      const move = new THREE.Vector3()
        .addScaledVector(this.camForward, raw.y)
        .addScaledVector(this.camRight, raw.x)
      if (move.lengthSq() > 1) move.normalize()

      if (this.hero.alive && dt > 0) {
        if (this.input.takeDodgePressed()) this.hero.dodge(move)
        if (this.input.takeAttackPressed()) this.hero.attack(aim)
      }

      if (dt > 0) {
        this.hero.update(dt, this.enemies, move, aim, this.input.attackHeld)
        for (const warp of this.warps) warp.update(dt)
        for (const enemy of this.enemies) enemy.update(dt, this.hero, this.enemies)
        this.enemies = this.enemies.filter((e) => !e.removed)
      }

      if (this.respawnT >= 0) {
        this.respawnT -= realDt
        if (this.respawnT < 0) {
          this.hero.respawn()
          this.hud.setDead(false)
        }
      }

      if (this.riftTransition >= 0) {
        this.riftTransition -= realDt
        if (this.riftTransition < 0) {
          this.warps = []
          this.startRift(this.rift + 1)
        }
      }

      this.hud.setHealth(this.hero.hp, this.hero.maxHp)
      this.hud.setXp(this.hero.xp, this.hero.xpToLevel, this.hero.level)
      this.hud.setDodge(this.hero.rollCooldown, this.hero.rollCooldownMax)
    }

    // smooth isometric follow + decaying shake
    const targetPos = this.hero.position.clone().add(CAMERA_OFFSET)
    this.camera.position.lerp(targetPos, Math.min(1, realDt * 6))
    if (this.shakeAmp > 0.005) {
      const t = performance.now() * 0.05
      this.camera.position.x += Math.sin(t * 1.7) * this.shakeAmp
      this.camera.position.y += Math.cos(t * 2.3) * this.shakeAmp * 0.6
      this.shakeAmp *= Math.max(0, 1 - realDt * 7)
    }
    const look = this.camera.position.clone().sub(CAMERA_OFFSET)
    this.camera.lookAt(look)

    this.renderer.render(this.scene, this.camera)
  }
}
