import * as THREE from 'three'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

function roman(n: number): string {
  return ROMAN[n - 1] ?? String(n)
}

/** DOM-based HUD: health globe, XP bar, counters, banners, damage numbers. */
export class Hud {
  private healthFill = document.getElementById('health-fill')!
  private healthText = document.getElementById('health-text')!
  private xpFill = document.getElementById('xp-fill')!
  private levelBadge = document.getElementById('level-badge')!
  private riftLabel = document.getElementById('rift-label')!
  private warpsLabel = document.getElementById('warps-label')!
  private killsLabel = document.getElementById('kills-label')!
  private banner = document.getElementById('banner')!
  private deathOverlay = document.getElementById('death-overlay')!
  private hudRoot = document.getElementById('hud')!
  private dodgePip = document.getElementById('dodge-pip')!
  private bannerTimer = 0

  setHealth(hp: number, max: number): void {
    const pct = Math.max(0, Math.min(1, hp / max))
    this.healthFill.style.height = `${pct * 100}%`
    this.healthText.textContent = `${Math.ceil(Math.max(0, hp))}`
  }

  setXp(xp: number, needed: number, level: number): void {
    this.xpFill.style.width = `${Math.min(100, (xp / needed) * 100)}%`
    this.levelBadge.textContent = String(level)
  }

  setRift(rift: number): void {
    this.riftLabel.textContent = `Rift ${roman(rift)}`
  }

  setWarps(open: number): void {
    this.warpsLabel.textContent = `Warps: ${open}`
  }

  setKills(kills: number): void {
    this.killsLabel.textContent = `Kills: ${kills}`
  }

  setDodge(cooldownRemaining: number): void {
    this.dodgePip.classList.toggle('ready', cooldownRemaining <= 0)
  }

  showBanner(text: string, ms = 2600): void {
    this.banner.textContent = text
    this.banner.classList.add('show')
    window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), ms)
  }

  setDead(dead: boolean): void {
    this.deathOverlay.classList.toggle('show', dead)
  }

  /** Floating combat text, projected from a world position to the screen. */
  spawnFloatingText(
    worldPos: THREE.Vector3,
    camera: THREE.Camera,
    text: string,
    cls: '' | 'hero' | 'xp' = ''
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
