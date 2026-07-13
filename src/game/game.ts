import * as THREE from 'three'
import { buildWorld, WORLD_RADIUS } from './world'
import { Hero } from './hero'
import { Enemy } from './enemy'
import { Warp } from './warp'
import { Hud } from './hud'
import { InputManager } from './input'
import { audio } from './audio'

const CAMERA_OFFSET = new THREE.Vector3(14, 18, 14)

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
  private viewSize = 13
  private riftTransition = -1
  private respawnT = -1
  private started = false

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 200)
    this.updateCameraFrustum()
    this.camera.position.copy(CAMERA_OFFSET)
    this.camera.lookAt(0, 0, 0)

    buildWorld(this.scene)
    this.hero = new Hero(this.scene)
    this.wireHero()

    this.input = new InputManager(this.renderer.domElement, this.camera, this.scene, () =>
      this.enemies.filter((e) => e.alive).map((e) => e.group)
    )
    this.wireInput()

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
    this.hero.onDealDamage = (enemy, amount) => {
      enemy.takeDamage(amount)
      audio.hit()
      this.hud.spawnFloatingText(
        enemy.position.clone().setY(1.6),
        this.camera,
        String(amount)
      )
      if (enemy.hp <= 0 && enemy.alive) this.killEnemy(enemy)
    }
  }

  private wireInput(): void {
    this.input.onFirstInteraction = () => {
      audio.unlock()
      if (!this.started) {
        this.started = true
        document.getElementById('intro-overlay')!.classList.remove('show')
        this.startRift(1)
      }
    }
    this.input.onPick = ({ enemyIndex, ground }) => {
      if (!this.started || !this.hero.alive) return
      if (enemyIndex !== null && this.enemies[enemyIndex]?.alive) {
        this.hero.attack(this.enemies[enemyIndex])
      } else if (ground) {
        this.hero.moveTo(ground)
      }
    }
    this.input.onZoom = (delta) => {
      this.viewSize = THREE.MathUtils.clamp(this.viewSize + delta * 1.4, 8, 22)
      this.updateCameraFrustum()
    }
  }

  private updateCameraFrustum(): void {
    const aspect = window.innerWidth / window.innerHeight
    this.camera.left = -this.viewSize * aspect
    this.camera.right = this.viewSize * aspect
    this.camera.top = this.viewSize
    this.camera.bottom = -this.viewSize
    this.camera.updateProjectionMatrix()
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
    this.hud.showBanner(`Rift ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][rift - 1] ?? rift} — ${warpCount} warps detected`)
  }

  private registerEnemy(enemy: Enemy): void {
    enemy.group.userData.enemyIndex = this.enemies.length
    enemy.onHitHero = (amount) => {
      this.hero.takeDamage(amount)
      audio.hurt()
      this.hud.spawnFloatingText(
        this.hero.position.clone().setY(2.4),
        this.camera,
        `-${amount}`,
        'hero'
      )
      if (!this.hero.alive && this.respawnT < 0) this.onHeroDeath()
    }
    this.enemies.push(enemy)
  }

  private killEnemy(enemy: Enemy): void {
    enemy.die()
    this.kills++
    audio.kill()
    this.hud.setKills(this.kills)
    const xp = enemy.elite ? 55 + this.rift * 10 : 14 + this.rift * 4
    const leveled = this.hero.gainXp(xp)
    this.hud.spawnFloatingText(
      enemy.position.clone().setY(1.2),
      this.camera,
      `+${xp} xp`,
      'xp'
    )
    if (leveled) {
      audio.levelUp()
      this.hud.showBanner(`Level ${this.hero.level}`, 1800)
    }
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

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05)

    this.input.update(dt)

    if (this.started) {
      this.hero.update(dt, this.enemies)
      for (const warp of this.warps) warp.update(dt)
      for (const enemy of this.enemies) enemy.update(dt, this.hero, this.enemies)

      if (this.respawnT >= 0) {
        this.respawnT -= dt
        if (this.respawnT < 0) {
          this.hero.respawn()
          this.hud.setDead(false)
        }
      }

      if (this.riftTransition >= 0) {
        this.riftTransition -= dt
        if (this.riftTransition < 0) {
          this.warps = []
          this.enemies = this.enemies.filter((e) => e.alive)
          this.enemies.forEach((e, i) => (e.group.userData.enemyIndex = i))
          this.startRift(this.rift + 1)
        }
      }

      this.hud.setHealth(this.hero.hp, this.hero.maxHp)
      this.hud.setXp(this.hero.xp, this.hero.xpToLevel, this.hero.level)
    }

    // smooth isometric follow
    const targetPos = this.hero.position.clone().add(CAMERA_OFFSET)
    this.camera.position.lerp(targetPos, Math.min(1, dt * 5))
    const look = this.camera.position.clone().sub(CAMERA_OFFSET)
    this.camera.lookAt(look)

    this.renderer.render(this.scene, this.camera)
  }
}
