import * as THREE from 'three'

/** DOM-based HUD: globes, XP, action bar, zone label, banners, world-anchored markers. */
export class Hud {
  private healthFill = document.getElementById('health-fill')!
  private healthText = document.getElementById('health-text')!
  private manaFill = document.getElementById('mana-fill')!
  private manaText = document.getElementById('mana-text')!
  private xpFill = document.getElementById('xp-fill')!
  private levelBadge = document.getElementById('level-badge')!
  private zoneLabel = document.getElementById('zone-label')!
  private spiresLabel = document.getElementById('spires-label')!
  private killsLabel = document.getElementById('kills-label')!
  private banner = document.getElementById('banner')!
  private deathOverlay = document.getElementById('death-overlay')!
  private hudRoot = document.getElementById('hud')!
  private dodgeSlot = document.getElementById('slot-dodge')!
  private dodgeCd = document.getElementById('dodge-cd')!
  private skillSlots: HTMLElement[]
  private bossBar = document.getElementById('boss-bar')!
  private bossFill = document.getElementById('boss-fill')!
  private bossName = document.getElementById('boss-name')!
  private bannerTimer = 0
  private markers = new Map<string, { el: HTMLElement; pos: THREE.Vector3 }>()

  constructor() {
    this.skillSlots = [0, 1, 2].map((i) => document.getElementById(`slot-skill-${i}`)!)
  }

  setHealth(hp: number, max: number): void {
    const pct = Math.max(0, Math.min(1, hp / max))
    this.healthFill.style.height = `${pct * 100}%`
    this.healthText.textContent = `${Math.ceil(Math.max(0, hp))}`
  }

  setMana(mana: number, max: number): void {
    const pct = Math.max(0, Math.min(1, mana / max))
    this.manaFill.style.height = `${pct * 100}%`
    this.manaText.textContent = `${Math.floor(Math.max(0, mana))}`
  }

  setXp(xp: number, needed: number, level: number): void {
    this.xpFill.style.width = `${Math.min(100, (xp / needed) * 100)}%`
    this.levelBadge.textContent = String(level)
  }

  setZone(name: string): void {
    if (this.zoneLabel.textContent !== name) this.zoneLabel.textContent = name
  }

  setSpires(open: number): void {
    this.spiresLabel.textContent = `Spires: ${open}`
  }

  setKills(kills: number): void {
    this.killsLabel.textContent = `Kills: ${kills}`
  }

  showBanner(text: string, ms = 2600, cls: '' | 'boss' = ''): void {
    this.banner.textContent = text
    this.banner.className = cls ? `show ${cls}` : 'show'
    window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), ms)
  }

  setDead(dead: boolean): void {
    this.deathOverlay.classList.toggle('show', dead)
  }

  setDodge(cooldownRemaining: number, cooldownMax: number): void {
    const ready = cooldownRemaining <= 0
    this.dodgeSlot.classList.toggle('ready', ready)
    this.dodgeCd.style.height = ready ? '0%' : `${(cooldownRemaining / cooldownMax) * 100}%`
  }

  /** one-time skill slot setup: icon glyph + name tooltip */
  setSkillMeta(i: number, icon: string, name: string): void {
    const slot = this.skillSlots[i]
    const iconEl = slot.querySelector('.icon')!
    iconEl.textContent = icon
    slot.title = name
  }

  setSkillSlot(i: number, cdRemaining: number, cdMax: number, manaOk: boolean, unlocked: boolean): void {
    const slot = this.skillSlots[i]
    slot.classList.toggle('locked', !unlocked)
    slot.classList.toggle('no-mana', unlocked && !manaOk)
    const cd = slot.querySelector('.cd') as HTMLElement
    cd.style.height = !unlocked || cdRemaining <= 0 ? '0%' : `${(cdRemaining / cdMax) * 100}%`
    slot.classList.toggle('ready', unlocked && cdRemaining <= 0 && manaOk)
    // locked slots advertise their unlock level so leveling has a visible goal
    const key = slot.querySelector('.key') as HTMLElement
    const label = unlocked ? String(i + 1) : i === 0 ? '1' : i === 1 ? 'Lv 3' : 'Lv 5'
    if (key.textContent !== label) key.textContent = label
  }

  /** boss health bar (Warpheart / named elites) */
  setBoss(name: string | null, hp = 0, maxHp = 1): void {
    this.bossBar.classList.toggle('show', !!name)
    if (name) {
      this.bossName.textContent = name
      this.bossFill.style.width = `${Math.max(0, Math.min(1, hp / maxHp)) * 100}%`
    }
  }

  /** persistent world-anchored label (E-prompts, quest !/? marks). null pos removes it. */
  setMarker(id: string, pos: THREE.Vector3 | null, text = '', cls = ''): void {
    const existing = this.markers.get(id)
    if (!pos) {
      if (existing) {
        existing.el.remove()
        this.markers.delete(id)
      }
      return
    }
    if (existing) {
      existing.pos.copy(pos)
      if (existing.el.textContent !== text) existing.el.textContent = text
      existing.el.className = `hud-marker ${cls}`
    } else {
      const el = document.createElement('div')
      el.className = `hud-marker ${cls}`
      el.textContent = text
      this.hudRoot.appendChild(el)
      this.markers.set(id, { el, pos: pos.clone() })
    }
  }

  /** project all markers to the screen — call once per tick */
  updateMarkers(camera: THREE.Camera): void {
    for (const { el, pos } of this.markers.values()) {
      const p = pos.clone().project(camera)
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) {
        el.style.display = 'none'
        continue
      }
      el.style.display = ''
      el.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`
      // keep world markers out of the bottom HUD cluster
      el.style.top = `${Math.min(((1 - p.y) / 2) * window.innerHeight, window.innerHeight - 160)}px`
    }
  }

  /** Floating combat text, projected from a world position to the screen. */
  spawnFloatingText(
    worldPos: THREE.Vector3,
    camera: THREE.Camera,
    text: string,
    cls: '' | 'hero' | 'xp' | 'warded' | 'loot' = ''
  ): void {
    const projected = worldPos.clone().project(camera)
    if (projected.z > 1) return
    const el = document.createElement('div')
    el.className = cls ? `dmg ${cls}` : 'dmg'
    el.textContent = text
    el.style.left = `${((projected.x + 1) / 2) * window.innerWidth}px`
    el.style.top = `${((1 - projected.y) / 2) * window.innerHeight}px`
    this.hudRoot.appendChild(el)
    window.setTimeout(() => el.remove(), 850)
  }
}
