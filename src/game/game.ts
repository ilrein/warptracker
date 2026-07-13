import * as THREE from 'three'
import { buildWorld, updateWorld, PORTALS, DUNGEON_ORIGIN } from './world'
import { zoneAt, dangerTier, ZoneDirector } from './zones'
import { LootSystem } from './loot'
import { RunStats, ShareCard } from './share'
import { Ambience } from './ambience'
import { NEST_SITES, ROAMER_PACKS, GRAVE_WARDENS, ELITE_PATROL, type RoamerPack } from './moor'
import { SPIRE_SITES, ACT2_DOOR_POI } from './dungeon'
import { WarpSpire } from './totem'
import { QuestLog } from './quest'
import { NpcSystem } from './npc'
import { CLASS_DEFS, type ClassId } from './classes'
import { SkillSystem, type SkillHit } from './skills'
import { updateVfx } from './vfx'
import { Hero } from './hero'
import { Enemy, type EnemyKindId, type EnemyOptions } from './enemy'
import { Hud } from './hud'
import { InputManager } from './input'
import { audio } from './audio'
import type { Hittable } from './hittable'

const CAMERA_OFFSET = new THREE.Vector3(14, 18, 14)
const PORTAL_TRIGGER = 1.4
const PORTAL_REARM = 2.5

interface RoamerState {
  pack: RoamerPack
  enemies: Enemy[]
  respawnTimer: number
}

export class Game {
  private renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.OrthographicCamera
  private clock = new THREE.Clock()
  private hud = new Hud()
  private input: InputManager

  hero: Hero
  enemies: Enemy[] = []
  spires: WarpSpire[] = []
  private questLog: QuestLog
  private npcs: NpcSystem
  private skills: SkillSystem
  private zoneDirector: ZoneDirector
  private loot!: LootSystem
  private stats = new RunStats()
  private share!: ShareCard
  private ambience!: Ambience
  private zoneName = 'Emberwatch'

  private kills = 0
  private viewSize = 9
  private respawnT = -1
  private hitstopT = 0
  private shakeAmp = 0
  private firstZone = true

  /** currently-bannered named elite for the boss bar */
  private boss: Enemy | null = null
  private heart: WarpSpire | null = null

  private roamers: RoamerState[] = []
  private portalsArmed = true
  /** world is frozen while the teleport fade is in flight */
  private fadePending = false
  private fade = document.getElementById('fade')!

  private camForward = new THREE.Vector3(-1, 0, -1).normalize()
  private camRight = new THREE.Vector3(1, 0, -1).normalize()

  constructor(container: HTMLElement, classId: ClassId) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.7
    container.appendChild(this.renderer.domElement)

    // switching class starts that class fresh — mixed-class saves corrupt progression
    try {
      const raw = localStorage.getItem('wt.save')
      if (raw && (JSON.parse(raw) as { class?: string }).class !== classId) {
        localStorage.removeItem('wt.save')
      }
    } catch {
      localStorage.removeItem('wt.save')
    }

    this.camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 400)
    this.updateCameraFrustum()

    buildWorld(this.scene)

    this.questLog = QuestLog.load({
      showBanner: (text, ms) => this.hud.showBanner(text, ms),
      unlockSkill: (slot) => this.skills?.unlock(slot),
      grantXp: (xp) => this.grantXp(xp),
      fullHeal: () => this.fullHeal(),
      startHunt: (n) => this.startHunt(n),
      onHuntComplete: (n) => {
        this.stats.note('hunt')
        this.share.show('triumph', `Hunt ${n} Complete`)
      },
    })

    const classDef = CLASS_DEFS[classId]
    this.hero = new Hero(this.scene, classDef)
    this.hero.onSwing = () => audio.swing()
    this.hero.onRoll = () => audio.dodge()
    this.hero.onStrike = (hits) => {
      let landed = false
      let killedAny = false
      let finisher = false
      for (const hit of hits) {
        const warded = this.isWardedSpire(hit.target)
        let knock: THREE.Vector3 | null = null
        if (hit.target instanceof Enemy) {
          knock = hit.target.position.clone().sub(this.hero.position)
          knock.y = 0
          knock.normalize().multiplyScalar(hit.finisher ? 1.1 : 0.35)
        }
        const killed = this.handleTargetDamage(hit.target, hit.amount, knock)
        if (!warded) {
          landed = true
          killedAny ||= killed
          finisher ||= hit.finisher
          this.hud.spawnFloatingText(hit.target.position.clone().setY(1.8), this.camera, String(hit.amount))
        }
      }
      if (landed) {
        audio.hit()
        this.hitstop(killedAny || finisher ? 0.09 : 0.045)
        this.shake(killedAny ? 0.3 : finisher ? 0.22 : 0.1)
      }
    }
    const saved = this.questLog.savedState
    if (saved && saved.class === classId) this.hero.restore(saved.level, saved.xp)
    this.questLog.heroState = { classId, level: this.hero.level, xp: this.hero.xp }

    this.skills = new SkillSystem({
      scene: this.scene,
      classId,
      hero: this.hero,
      getTargets: () => this.hittables(),
      applyHits: (hits, opts) => this.applySkillHits(hits, opts),
      aim: () => this.input.aimPoint(this.camera),
    })
    // QuestLog.load ran before skills existed; re-apply quest-reward unlocks
    if (this.questLog.chapter >= 2) this.skills.unlock(1)
    if (this.questLog.chapter >= 3) this.skills.unlock(2)
    classDef.skills.forEach((s, i) => this.hud.setSkillMeta(i, s.icon, `${s.name} — ${s.describe}`))

    this.loot = new LootSystem({
      scene: this.scene,
      floatText: (pos, text, cls) => this.hud.spawnFloatingText(pos, this.camera, text, cls ?? ''),
      onEquip: (totals, announcement) => {
        this.hero.applyGear(totals)
        this.hud.showBanner(announcement, 2600)
      },
    })
    this.hero.applyGear(this.loot.totals) // persisted gear from previous sessions

    this.share = new ShareCard({
      stats: this.stats,
      getContext: () => ({ className: classDef.name, level: this.hero.level, zone: this.zoneName }),
    })

    this.ambience = new Ambience(this.scene)

    this.npcs = new NpcSystem({
      scene: this.scene,
      questLog: this.questLog,
      fullHeal: () => this.fullHeal(true),
      setMarker: (id, pos, text, cls) => this.hud.setMarker(id, pos, text ?? '', cls ?? ''),
    })

    this.zoneDirector = new ZoneDirector(this.scene, {
      onZoneChange: (_zone, displayName) => {
        this.zoneName = displayName
        this.hud.setZone(displayName)
        if (!this.firstZone) this.hud.showBanner(displayName, 1800)
        this.firstZone = false
      },
    })

    this.spawnSpires()
    this.spawnRoamers()
    this.spawnWardensAndPatrol()
    this.hud.setSpires(this.aliveSpireCount())

    this.input = new InputManager(this.renderer.domElement)
    this.input.onFirstInteraction = () => {
      audio.unlock()
      this.ambience.start()
    }
    this.input.onZoom = (delta) => {
      this.viewSize = THREE.MathUtils.clamp(this.viewSize + delta * 1.2, 6, 16)
      this.updateCameraFrustum()
    }

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight)
      this.updateCameraFrustum()
    })

    // camera starts on the hero at the Emberwatch fire
    this.camera.position.copy(this.hero.position).add(CAMERA_OFFSET)
    this.camera.lookAt(this.hero.position)
    this.hud.setHealth(this.hero.hp, this.hero.maxHp)
    this.hud.setMana(this.hero.mana, this.hero.maxMana)
    this.hud.setXp(this.hero.xp, this.hero.xpToLevel, this.hero.level)

    this.renderer.setAnimationLoop(() => this.tick())
  }

  // ---------- spawning ----------

  private spawnEnemy(kind: EnemyKindId, pos: THREE.Vector3, tier: number, opts: EnemyOptions = {}): Enemy {
    const enemy = new Enemy(this.scene, pos, tier, kind, opts)
    enemy.onHitHero = (amount) => this.onHeroHit(amount, enemy)
    enemy.onAggro = (e) => {
      if (e.name) {
        this.boss = e
        this.hud.showBanner(e.name, 3000, 'boss')
      }
    }
    this.enemies.push(enemy)
    return enemy
  }

  private makeSpire(
    position: THREE.Vector3,
    hp: number,
    tier: number,
    guards: EnemyKindId[],
    isHeart: boolean,
    bossName?: string
  ): WarpSpire {
    const spire = new WarpSpire({
      scene: this.scene,
      position,
      hp,
      tier,
      isHeart,
      guards,
      spawnEnemy: (kind, pos, t, name) => {
        const named = name ?? (isHeart && kind === 'demon' ? bossName : undefined)
        return this.spawnEnemy(kind, pos, t, {
          name: named,
          scale: named ? 1.6 : 1,
          aggroRange: tier >= 3 ? 9 : 11,
          anchor: position,
        })
      },
      onSealed: () => {
        this.questLog.notify(isHeart ? 'heart' : 'totem')
        this.hud.setSpires(this.aliveSpireCount())
        this.stats.note(isHeart ? 'heart' : 'spire')
        this.loot.maybeDrop(position, tier, isHeart ? 'heart' : 'spire')
        if (isHeart) window.setTimeout(() => this.share.show('triumph', 'Sealed the First Warp'), 2400)
      },
      onAoE: (pos, radius, damage, knockback) => this.aoeEnemies(pos, radius, damage, knockback),
      floatText: (pos, text, cls) =>
        this.hud.spawnFloatingText(pos, this.camera, text, (cls as '' | 'warded') ?? ''),
    })
    this.spires.push(spire)
    if (isHeart) this.heart = spire
    return spire
  }

  private spawnSpires(): void {
    for (const site of NEST_SITES) {
      this.makeSpire(site.position, site.spireHp, site.tier, site.guards, false)
    }
    for (const site of SPIRE_SITES) {
      const guards: EnemyKindId[] = site.boss ? [...site.guards, site.boss.kind] : site.guards
      this.makeSpire(site.position, site.hp, site.tier, guards, site.isHeart, site.boss?.name)
    }
  }

  private spawnRoamers(): void {
    for (const pack of ROAMER_PACKS) {
      const state: RoamerState = { pack, enemies: [], respawnTimer: 0 }
      this.spawnPack(state)
      this.roamers.push(state)
    }
  }

  private spawnPack(state: RoamerState): void {
    state.enemies = state.pack.kinds.map((kind, i) =>
      this.spawnEnemy(kind, state.pack.positions[i] ?? state.pack.positions[0], state.pack.tier)
    )
  }

  private spawnWardensAndPatrol(): void {
    for (const post of GRAVE_WARDENS) {
      this.spawnEnemy(post.kind, post.position, post.tier)
    }
    const mid = ELITE_PATROL.path[0].clone().lerp(ELITE_PATROL.path[1], 0.5)
    this.spawnEnemy(ELITE_PATROL.kind, ELITE_PATROL.path[0], ELITE_PATROL.tier, {
      anchor: mid,
      aggroRange: 11,
    })
  }

  private startHunt(n: number): void {
    // drop long-dead spires and never double-spawn a site that is still standing
    this.spires = this.spires.filter((s) => s.alive)
    if (this.heart && !this.heart.alive) this.heart = null
    const standing = (pos: THREE.Vector3) => this.spires.some((s) => s.position.distanceTo(pos) < 2)
    for (const site of NEST_SITES) {
      if (standing(site.position)) continue
      this.makeSpire(site.position, 110 + 30 * n, site.tier + n, site.guards, false)
    }
    const heartSite = SPIRE_SITES.find((s) => s.isHeart)!
    if (!standing(heartSite.position)) {
      const guards: EnemyKindId[] = heartSite.boss
        ? [...heartSite.guards, heartSite.boss.kind]
        : heartSite.guards
      this.makeSpire(heartSite.position, 320 + 60 * n, heartSite.tier + n, guards, true, heartSite.boss?.name)
    }
    this.hud.setSpires(this.aliveSpireCount())
  }

  // ---------- combat plumbing ----------

  private hittables(): Hittable[] {
    const list: Hittable[] = []
    for (const e of this.enemies) if (e.alive) list.push(e)
    for (const s of this.spires) if (s.alive) list.push(s)
    return list
  }

  private aliveSpireCount(): number {
    return this.spires.filter((s) => s.alive).length
  }

  private isWardedSpire(target: Hittable): boolean {
    return target instanceof WarpSpire && target.warded
  }

  private handleTargetDamage(target: Hittable, amount: number, knockback: THREE.Vector3 | null): boolean {
    const warded = this.isWardedSpire(target)
    const wasAlive = target.alive
    target.takeDamage(amount, knockback)
    if (warded) return false // spire self-reports "WARDED"
    const killed = wasAlive && !target.alive
    if (killed && target instanceof Enemy) this.onEnemyKilled(target)
    if (killed && target instanceof WarpSpire) {
      this.hitstop(0.12)
      this.shake(0.4)
    }
    return killed
  }

  private onEnemyKilled(enemy: Enemy): void {
    this.kills++
    audio.kill()
    this.hud.setKills(this.kills)
    this.stats.note('kill')
    this.loot.maybeDrop(
      enemy.position,
      dangerTier(enemy.position),
      enemy.name || enemy.elite ? 'elite' : 'enemy'
    )
    const xp = enemy.xpValue()
    this.hud.spawnFloatingText(enemy.position.clone().setY(1.2), this.camera, `+${xp} xp`, 'xp')
    this.grantXp(xp)
    this.questLog.notify('kill')
    if (this.boss === enemy) {
      this.boss = null
      this.hud.setBoss(null)
    }
  }

  private grantXp(xp: number): void {
    const leveled = this.hero.gainXp(xp)
    if (leveled) {
      audio.levelUp()
      if (this.hero.level === 3) this.hud.showBanner('Level 3 — a new skill awakens. Press 2.', 2600)
      else if (this.hero.level === 5) this.hud.showBanner('Level 5 — a new skill awakens. Press 3.', 2600)
      else this.hud.showBanner(`Level ${this.hero.level}`, 1800)
      this.stats.note('levelup', this.hero.level)
    }
    this.questLog.heroState.level = this.hero.level
    this.questLog.heroState.xp = this.hero.xp
    if (leveled) this.questLog.save()
  }

  private fullHeal(float = false): void {
    this.hero.hp = this.hero.maxHp
    this.hero.mana = this.hero.maxMana
    if (float) this.hud.spawnFloatingText(this.hero.position.clone().setY(2.5), this.camera, '+HP', 'xp')
  }

  private applySkillHits(hits: SkillHit[], opts?: { hitstop?: number; shake?: number }): void {
    for (const { target, amount, stagger } of hits) {
      const warded = this.isWardedSpire(target)
      this.handleTargetDamage(target, amount, null)
      if (!warded) {
        this.hud.spawnFloatingText(target.position.clone().setY(1.8), this.camera, String(amount))
        if (stagger && target instanceof Enemy) target.applyStagger(stagger)
      }
    }
    if (hits.length) audio.hit()
    if (opts?.hitstop) this.hitstop(opts.hitstop)
    if (opts?.shake) this.shake(opts.shake)
  }

  private aoeEnemies(pos: THREE.Vector3, radius: number, damage: number, knockback: number): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue
      const to = enemy.position.clone().sub(pos)
      to.y = 0
      if (to.length() > radius) continue
      const dir = to.lengthSq() > 0.001 ? to.normalize() : new THREE.Vector3(1, 0, 0)
      const killed = this.handleTargetDamage(enemy, damage, dir.multiplyScalar(knockback))
      if (!killed) this.hud.spawnFloatingText(enemy.position.clone().setY(1.8), this.camera, String(damage))
    }
  }

  private onHeroHit(amount: number, attacker?: Enemy): void {
    const before = this.hero.hp
    this.hero.takeDamage(amount)
    if (this.hero.hp === before) return // i-frames or dead already
    audio.hurt()
    this.shake(0.25)
    this.hud.spawnFloatingText(this.hero.position.clone().setY(2.5), this.camera, `-${amount}`, 'hero')
    if (!this.hero.alive && this.respawnT < 0) {
      audio.death()
      this.hud.setDead(true)
      this.respawnT = 3
      this.stats.note('death')
      const killedBy =
        attacker?.name ??
        (attacker ? `a warpspawn ${attacker.kindId}` : 'the Warpspawn')
      window.setTimeout(() => this.share.show('death', killedBy), 1200)
    }
  }

  // ---------- world flow ----------

  private teleport(to: THREE.Vector3): void {
    this.fade.classList.add('show')
    this.portalsArmed = false
    this.fadePending = true // freezes hero/world updates so a dodge can't race the fade
    window.setTimeout(() => {
      this.hero.position.copy(to)
      this.camera.position.copy(to).add(CAMERA_OFFSET)
      this.fade.classList.remove('show')
      this.fadePending = false
    }, 250)
  }

  private updatePortals(): void {
    if (this.fadePending) return
    const heroPos = this.hero.position
    const dEntry = heroPos.distanceTo(PORTALS.entry)
    const dExit = heroPos.distanceTo(PORTALS.exitInside)
    if (!this.portalsArmed) {
      if (dEntry > PORTAL_REARM && dExit > PORTAL_REARM) this.portalsArmed = true
      return
    }
    if (dEntry < PORTAL_TRIGGER) {
      this.teleport(DUNGEON_ORIGIN.clone().add(new THREE.Vector3(0, 0, 5)))
    } else if (dExit < PORTAL_TRIGGER) {
      this.teleport(PORTALS.entry.clone())
    }
  }

  private updateRoamers(dt: number): void {
    for (const state of this.roamers) {
      if (state.enemies.some((e) => !e.removed)) continue
      state.respawnTimer += dt
      if (state.respawnTimer < state.pack.respawnSeconds) continue
      const anchor = state.pack.positions[0]
      if (this.hero.position.distanceTo(anchor) < state.pack.minHeroDistanceToRespawn) continue
      state.respawnTimer = 0
      this.spawnPack(state)
    }
  }

  private updateBossBar(): void {
    if (this.boss && this.boss.alive) {
      this.hud.setBoss(this.boss.name ?? '', this.boss.hp, this.boss.maxHp)
    } else if (
      this.heart &&
      this.heart.alive &&
      this.hero.position.distanceTo(this.heart.position) < 18 && // the vault, not the whole crawl
      (!this.boss || !this.boss.alive)
    ) {
      this.hud.setBoss('THE WARPHEART', this.heart.hp, this.heart.maxHp)
    } else {
      this.hud.setBoss(null)
    }
  }

  hitstop(seconds: number): void {
    this.hitstopT = Math.max(this.hitstopT, seconds)
  }

  shake(amp: number): void {
    this.shakeAmp = Math.min(0.5, this.shakeAmp + amp)
  }

  private updateCameraFrustum(): void {
    const aspect = window.innerWidth / window.innerHeight
    this.camera.left = -this.viewSize * aspect
    this.camera.right = this.viewSize * aspect
    this.camera.top = this.viewSize
    this.camera.bottom = -this.viewSize
    this.camera.updateProjectionMatrix()
  }

  // ---------- main loop ----------

  private tick(): void {
    const realDt = Math.min(this.clock.getDelta(), 0.05)
    let dt = realDt
    if (this.hitstopT > 0) {
      this.hitstopT -= realDt
      dt = 0
    }

    const aim = this.input.aimPoint(this.camera)
    const raw = this.input.moveInput()
    const move = new THREE.Vector3()
      .addScaledVector(this.camForward, raw.y)
      .addScaledVector(this.camRight, raw.x)
    if (move.lengthSq() > 1) move.normalize()

    if (this.fadePending) {
      this.renderer.render(this.scene, this.camera)
      return
    }

    if (dt > 0 && this.hero.alive) {
      if (this.input.takeInteractPressed()) this.npcs.interact(this.hero.position)
      if (this.input.takeDodgePressed()) this.hero.dodge(move)
      const slot = this.input.takeSkillPressed()
      if (slot !== null && this.hero.state !== 'roll') this.skills.cast(slot)
      if (this.input.takeAttackPressed()) this.hero.attack(aim)
    }

    if (dt > 0) {
      const targets = this.hittables()
      this.hero.inTown = zoneAt(this.hero.position) === 'town'
      this.hero.update(dt, targets, move, aim, this.input.attackHeld)
      this.loot.update(dt, this.hero.position)
      for (const enemy of this.enemies) enemy.update(dt, this.hero, this.enemies)
      this.enemies = this.enemies.filter((e) => !e.removed)
      for (const spire of this.spires) spire.update(dt, this.hero.position)
      this.npcs.update(dt, this.hero.position)
      this.skills.update(dt)
      updateWorld(dt, this.hero.position)
      this.zoneDirector.update(dt, this.hero.position)
      this.ambience.update(dt, this.hero.position, zoneAt(this.hero.position))
      updateVfx(dt)
      this.updatePortals()
      this.updateRoamers(dt)
    }

    if (this.respawnT >= 0) {
      this.respawnT -= realDt
      if (this.respawnT < 0) {
        this.hero.respawn()
        this.hud.setDead(false)
        this.camera.position.copy(this.hero.position).add(CAMERA_OFFSET)
      }
    }

    // Act II door tease
    if (this.hero.position.distanceTo(ACT2_DOOR_POI.position) < ACT2_DOOR_POI.radius) {
      this.hud.setMarker('act2', ACT2_DOOR_POI.position.clone().setY(2.2), ACT2_DOOR_POI.text, 'poi')
    } else {
      this.hud.setMarker('act2', null)
    }

    // HUD
    this.hud.setHealth(this.hero.hp, this.hero.maxHp)
    this.hud.setMana(this.hero.mana, this.hero.maxMana)
    this.hud.setXp(this.hero.xp, this.hero.xpToLevel, this.hero.level)
    this.hud.setDodge(this.hero.rollCooldown, this.hero.rollCooldownMax)
    for (let i = 0; i < 3; i++) {
      const s = this.skills.slotState(i as 0 | 1 | 2)
      this.hud.setSkillSlot(i, s.cdRemaining, s.cdMax, s.manaOk, s.unlocked)
    }
    this.updateBossBar()

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

    this.hud.updateMarkers(this.camera)
    this.renderer.render(this.scene, this.camera)
  }
}
