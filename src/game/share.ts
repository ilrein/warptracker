import { tone } from './audio'
import { mulberry32 } from './rng'

/**
 * Shareable run cards: RunStats tracks per-session + lifetime numbers
 * (persisted to localStorage 'wt.stats'), and ShareCard renders a 1200x630
 * procedural canvas card in a modal with copy / post-on-X / dismiss actions.
 * No images, no fetches — every pixel is drawn on the fly.
 */

export type StatEvent = 'kill' | 'death' | 'spire' | 'heart' | 'levelup' | 'hunt'

export interface RunSnapshot {
  kills: number
  deaths: number
  spires: number
  hearts: number
  level: number
  hunts: number
  /** seconds of visible-tab play this session */
  playSeconds: number
}

interface LifetimeStats {
  kills: number
  deaths: number
  spires: number
  hearts: number
  hunts: number
  playSeconds: number
  bestLevel: number
}

const STATS_KEY = 'wt.stats'
const SITE_URL = 'https://warptracker.com'

function zeroLifetime(): LifetimeStats {
  return { kills: 0, deaths: 0, spires: 0, hearts: 0, hunts: 0, playSeconds: 0, bestLevel: 1 }
}

export class RunStats {
  private run: RunSnapshot = { kills: 0, deaths: 0, spires: 0, hearts: 0, level: 1, hunts: 0, playSeconds: 0 }
  private life: LifetimeStats
  private tabVisible = !document.hidden
  private lastMark = performance.now()
  private sessionMs = 0
  /** portion of sessionMs already folded into lifetime playSeconds */
  private flushedMs = 0

  constructor() {
    this.life = this.load()
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.sample()
        this.tabVisible = false
        this.save() // bank play time before the tab may be discarded
      } else {
        this.tabVisible = true
        this.lastMark = performance.now()
      }
    })
  }

  note(event: StatEvent, detail?: string | number): void {
    switch (event) {
      case 'kill':
        this.run.kills++
        this.life.kills++
        break
      case 'death':
        this.run.deaths++
        this.life.deaths++
        break
      case 'spire':
        this.run.spires++
        this.life.spires++
        break
      case 'heart':
        this.run.hearts++
        this.life.hearts++
        break
      case 'hunt':
        this.run.hunts++
        this.life.hunts++
        break
      case 'levelup': {
        const lvl = typeof detail === 'number' ? detail : this.run.level + 1
        this.run.level = lvl
        this.life.bestLevel = Math.max(this.life.bestLevel, lvl)
        break
      }
    }
    this.save()
  }

  get current(): RunSnapshot {
    this.sample()
    return { ...this.run, playSeconds: Math.round(this.sessionMs / 1000) }
  }

  get lifetime(): LifetimeStats {
    this.sample()
    const extra = (this.sessionMs - this.flushedMs) / 1000
    return { ...this.life, playSeconds: Math.round(this.life.playSeconds + extra) }
  }

  /** accumulate visible-tab play time up to now */
  private sample(): void {
    if (!this.tabVisible) return
    const now = performance.now()
    this.sessionMs += now - this.lastMark
    this.lastMark = now
  }

  private load(): LifetimeStats {
    try {
      const raw = localStorage.getItem(STATS_KEY)
      if (!raw) return zeroLifetime()
      const parsed = JSON.parse(raw) as Partial<Record<keyof LifetimeStats, unknown>>
      const out = zeroLifetime()
      for (const key of Object.keys(out) as (keyof LifetimeStats)[]) {
        const v = parsed[key]
        if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.max(0, Math.floor(v))
      }
      out.bestLevel = Math.max(1, out.bestLevel)
      return out
    } catch {
      return zeroLifetime()
    }
  }

  private save(): void {
    this.sample()
    const deltaMs = this.sessionMs - this.flushedMs
    this.flushedMs = this.sessionMs
    this.life.playSeconds += deltaMs / 1000
    try {
      localStorage.setItem(
        STATS_KEY,
        JSON.stringify({ ...this.life, playSeconds: Math.round(this.life.playSeconds) })
      )
    } catch {
      // storage full / private mode — stats stay in-memory only
    }
  }
}

// ---------- share card ----------

export interface ShareContext {
  className: string
  level: number
  zone: string
}

export interface ShareCardOptions {
  stats: RunStats
  getContext: () => ShareContext
}

const CARD_W = 1200
const CARD_H = 630
const STYLE_ID = 'share-card-style'

const CSS = `
#share-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(5, 2, 8, 0.78);
  pointer-events: auto;
  font-family: Georgia, 'Times New Roman', serif;
}
#share-overlay.show {
  display: flex;
}
#share-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 18px 20px 16px;
  border: 1px solid rgba(168, 85, 247, 0.45);
  border-radius: 12px;
  background: linear-gradient(180deg, #17111f, #0b0712);
  box-shadow: 0 0 60px rgba(88, 28, 135, 0.35), 0 8px 40px rgba(0, 0, 0, 0.9);
  animation: share-in 0.28s ease-out;
  max-width: min(92vw, 760px);
}
@keyframes share-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.97);
  }
}
#share-modal .share-kicker {
  font-size: 12px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #a855f7;
  text-shadow: 0 0 12px #6b21a8;
}
#share-modal canvas {
  width: 100%;
  height: auto;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.8);
}
#share-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.share-btn {
  font-family: inherit;
  font-size: 14px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #d6d3d1;
  background: linear-gradient(180deg, #1c1b22, #101014);
  border: 1px solid #52525b;
  border-radius: 8px;
  padding: 9px 18px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, box-shadow 0.15s;
}
.share-btn:hover {
  border-color: #a855f7;
  color: #e9d5ff;
  box-shadow: 0 0 14px rgba(168, 85, 247, 0.3);
}
.share-btn.gold {
  border-color: #7c5a2b;
  color: #f59e0b;
}
.share-btn.gold:hover {
  border-color: #f59e0b;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.3);
}
#share-modal .share-hint {
  font-size: 11px;
  color: #71717a;
  letter-spacing: 0.06em;
}
`

export class ShareCard {
  private opts: ShareCardOptions
  private overlay: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private copyBtn: HTMLButtonElement
  private postBtn: HTMLButtonElement
  private open = false
  private tweetText = ''
  private copyResetTimer = 0

  constructor(opts: ShareCardOptions) {
    this.opts = opts
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    this.canvas = document.createElement('canvas')
    this.canvas.width = CARD_W
    this.canvas.height = CARD_H
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('share card: no 2d context')
    this.ctx = ctx

    this.overlay = document.createElement('div')
    this.overlay.id = 'share-overlay'
    const modal = document.createElement('div')
    modal.id = 'share-modal'

    const kicker = document.createElement('div')
    kicker.className = 'share-kicker'
    kicker.textContent = 'A tale from the moor'

    const actions = document.createElement('div')
    actions.id = 'share-actions'
    this.copyBtn = this.button('Copy image', '', () => void this.copyImage())
    this.postBtn = this.button('Post on X', 'gold', () => this.postOnX())
    const dismissBtn = this.button('Keep playing', '', () => this.hide())
    actions.append(this.copyBtn, this.postBtn, dismissBtn)

    const hint = document.createElement('div')
    hint.className = 'share-hint'
    hint.textContent = 'Esc to close'

    modal.append(kicker, this.canvas, actions, hint)
    this.overlay.appendChild(modal)
    // click on the dark backdrop (not the modal) dismisses too
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide()
    })
    document.body.appendChild(this.overlay)
  }

  /** show the share UI moment: kind 'death' (detail = killer name) or 'triumph' (detail = title) */
  show(kind: 'death' | 'triumph', detail: string): void {
    const context = this.opts.getContext()
    const run = this.opts.stats.current
    const headline = kind === 'death' ? `FELL TO ${detail.toUpperCase()}` : detail.toUpperCase()
    this.render(kind, headline, context, run)
    this.tweetText =
      kind === 'death'
        ? `Fell to ${detail} at level ${context.level} — but took ${run.kills} warpspawn down first. Warptracker: a free, open source Diablo-style ARPG in your browser.`
        : `${detail} — level ${context.level} ${context.className}, ${run.kills} kills and counting. Warptracker: a free, open source Diablo-style ARPG in your browser.`

    this.overlay.classList.add('show')
    if (!this.open) {
      this.open = true
      window.addEventListener('keydown', this.onKeyDown)
    }
    if (kind === 'triumph') {
      tone(523, 0.14, 'triangle', 0.06)
      tone(784, 0.3, 'triangle', 0.07, undefined, 0.12)
    } else {
      tone(98, 0.6, 'sine', 0.05, 55)
    }
  }

  private hide(): void {
    if (!this.open) return
    this.open = false
    this.overlay.classList.remove('show')
    window.removeEventListener('keydown', this.onKeyDown)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      this.hide()
    }
  }

  private button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = cls ? `share-btn ${cls}` : 'share-btn'
    btn.type = 'button'
    btn.textContent = label
    btn.addEventListener('click', onClick)
    return btn
  }

  // ---------- actions ----------

  private async copyImage(): Promise<void> {
    const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    let label: string
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard) throw new Error('unsupported')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      label = 'Copied!'
    } catch {
      // graceful fallback: save the PNG instead
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'warptracker-run.png'
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      label = 'Saved PNG'
    }
    this.copyBtn.textContent = label
    window.clearTimeout(this.copyResetTimer)
    this.copyResetTimer = window.setTimeout(() => (this.copyBtn.textContent = 'Copy image'), 1800)
  }

  private postOnX(): void {
    const intent = new URL('https://twitter.com/intent/tweet')
    intent.searchParams.set('text', this.tweetText)
    intent.searchParams.set('url', SITE_URL)
    window.open(intent.toString(), '_blank', 'noopener')
  }

  // ---------- canvas rendering ----------

  private render(kind: 'death' | 'triumph', headline: string, context: ShareContext, run: RunSnapshot): void {
    const ctx = this.ctx
    const accent = kind === 'death' ? '#f87171' : '#fbbf24'
    const accentGlow = kind === 'death' ? '#7f1d1d' : '#92400e'

    // dark vignette background
    ctx.save()
    ctx.clearRect(0, 0, CARD_W, CARD_H)
    const bg = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2 - 40, 80, CARD_W / 2, CARD_H / 2, 760)
    bg.addColorStop(0, '#191026')
    bg.addColorStop(0.55, '#0d0815')
    bg.addColorStop(1, '#040207')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, CARD_W, CARD_H)

    // drifting embers + faint stars (deterministic so the card is stable)
    const rand = mulberry32(kind === 'death' ? 1349 : 7717)
    for (let i = 0; i < 70; i++) {
      const x = rand() * CARD_W
      const y = rand() * CARD_H
      const r = 0.6 + rand() * 1.7
      ctx.globalAlpha = 0.05 + rand() * 0.16
      ctx.fillStyle = rand() < 0.35 ? '#f59e0b' : '#c4b5fd'
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // huge watermark warp ring behind the text, then a crisp emblem up top
    this.drawEmblem(ctx, CARD_W / 2, CARD_H / 2 + 30, 300, 0.1)
    this.drawEmblem(ctx, CARD_W / 2, 128, 64, 1)

    // frame + gold corner ticks
    ctx.strokeStyle = 'rgba(107, 33, 168, 0.55)'
    ctx.lineWidth = 2
    ctx.strokeRect(24, 24, CARD_W - 48, CARD_H - 48)
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 3
    const corner = 26
    for (const [cx, cy, dx, dy] of [
      [24, 24, 1, 1],
      [CARD_W - 24, 24, -1, 1],
      [24, CARD_H - 24, 1, -1],
      [CARD_W - 24, CARD_H - 24, -1, -1],
    ] as const) {
      ctx.beginPath()
      ctx.moveTo(cx + dx * corner, cy)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx, cy + dy * corner)
      ctx.stroke()
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // kicker
    ctx.fillStyle = '#a855f7'
    ctx.shadowColor = '#6b21a8'
    ctx.shadowBlur = 14
    ctx.font = '22px Georgia, serif'
    ctx.fillText(this.spaced(kind === 'death' ? 'A DEATH ON THE MOOR' : 'A TRIUMPH ON THE MOOR'), CARD_W / 2, 226)

    // headline, shrunk / wrapped to fit
    ctx.fillStyle = accent
    ctx.shadowColor = accentGlow
    ctx.shadowBlur = 26
    const { lines, size } = this.layoutHeadline(ctx, headline, CARD_W - 160)
    const lineH = size * 1.12
    const baseY = 306 - ((lines.length - 1) * lineH) / 2
    ctx.font = `bold ${size}px Georgia, serif`
    lines.forEach((line, i) => ctx.fillText(line, CARD_W / 2, baseY + i * lineH))

    // class + level + zone
    ctx.shadowColor = '#000'
    ctx.shadowBlur = 8
    ctx.fillStyle = '#d6d3d1'
    const subline = this.spaced(
      `LEVEL ${context.level} ${context.className.toUpperCase()} — ${context.zone.toUpperCase()}`
    )
    let subSize = 26
    ctx.font = `${subSize}px Georgia, serif`
    while (subSize > 16 && ctx.measureText(subline).width > CARD_W - 140) {
      subSize -= 2
      ctx.font = `${subSize}px Georgia, serif`
    }
    ctx.fillText(subline, CARD_W / 2, 396)

    // stat row: kills · spires sealed · deaths
    const stats: [string, string][] = [
      [String(run.kills), run.kills === 1 ? 'KILL' : 'KILLS'],
      [String(run.spires + run.hearts), run.spires + run.hearts === 1 ? 'SPIRE SEALED' : 'SPIRES SEALED'],
      [String(run.deaths), run.deaths === 1 ? 'DEATH' : 'DEATHS'],
    ]
    const rowY = 476
    const slotW = 280
    const startX = CARD_W / 2 - slotW
    stats.forEach(([num, label], i) => {
      const x = startX + i * slotW
      ctx.fillStyle = '#f59e0b'
      ctx.shadowColor = '#78350f'
      ctx.shadowBlur = 16
      ctx.font = 'bold 44px Georgia, serif'
      ctx.fillText(num, x, rowY)
      ctx.fillStyle = '#a1a1aa'
      ctx.shadowColor = '#000'
      ctx.shadowBlur = 6
      ctx.font = '17px Georgia, serif'
      ctx.fillText(this.spaced(label), x, rowY + 36)
      if (i > 0) {
        ctx.fillStyle = '#6b21a8'
        ctx.font = '30px Georgia, serif'
        ctx.fillText('·', x - slotW / 2, rowY)
      }
    })

    // play time, tucked above the footer
    ctx.fillStyle = '#71717a'
    ctx.shadowBlur = 0
    ctx.font = 'italic 18px Georgia, serif'
    ctx.fillText(`${this.formatPlaytime(run.playSeconds)} on the moor this run`, CARD_W / 2, 546)

    // footer
    ctx.fillStyle = '#c4b5fd'
    ctx.shadowColor = '#6b21a8'
    ctx.shadowBlur = 10
    ctx.font = '20px Georgia, serif'
    ctx.fillText('warptracker.com — a free open source ARPG in your browser', CARD_W / 2, 586)
    ctx.restore()
  }

  /** simple procedural warp ring emblem: concentric purple circles, broken arcs, ticks */
  private drawEmblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
    const rand = mulberry32(88 + Math.round(r))
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(x, y)

    // inner glow
    const glow = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * 1.15)
    glow.addColorStop(0, 'rgba(168, 85, 247, 0.35)')
    glow.addColorStop(1, 'rgba(168, 85, 247, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2)
    ctx.fill()

    // full rings
    for (const [rr, color, w] of [
      [r, '#6b21a8', 3],
      [r * 0.78, '#a855f7', 2],
      [r * 0.34, '#c4b5fd', 1.5],
    ] as const) {
      ctx.strokeStyle = color
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.arc(0, 0, rr, 0, Math.PI * 2)
      ctx.stroke()
    }

    // broken orbital arcs
    ctx.strokeStyle = '#a855f7'
    for (let i = 0; i < 5; i++) {
      const a0 = rand() * Math.PI * 2
      ctx.lineWidth = 1 + rand() * 2.5
      ctx.beginPath()
      ctx.arc(0, 0, r * (0.45 + rand() * 0.48), a0, a0 + 0.5 + rand() * 1.6)
      ctx.stroke()
    }

    // rim ticks
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 2
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92)
      ctx.lineTo(Math.cos(a) * r * 1.04, Math.sin(a) * r * 1.04)
      ctx.stroke()
    }

    // core diamond
    ctx.fillStyle = '#e9d5ff'
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.14)
    ctx.lineTo(r * 0.09, 0)
    ctx.lineTo(0, r * 0.14)
    ctx.lineTo(-r * 0.09, 0)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /** find the largest font size where the headline fits in <= 2 lines */
  private layoutHeadline(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): { lines: string[]; size: number } {
    const fits = (s: string, size: number): boolean => {
      ctx.font = `bold ${size}px Georgia, serif`
      return ctx.measureText(s).width <= maxWidth
    }
    for (let size = 78; size >= 54; size -= 4) {
      if (fits(text, size)) return { lines: [text], size }
    }
    // wrap into two roughly balanced lines
    const words = text.split(' ')
    let best = [text]
    let bestDiff = Infinity
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ')
      const b = words.slice(i).join(' ')
      const diff = Math.abs(a.length - b.length)
      if (diff < bestDiff) {
        bestDiff = diff
        best = [a, b]
      }
    }
    for (let size = 62; size >= 40; size -= 4) {
      if (best.every((line) => fits(line, size))) return { lines: best, size }
    }
    return { lines: best, size: 36 }
  }

  /** faux letter-spacing for small-caps lines (canvas has no reliable letterSpacing) */
  private spaced(text: string): string {
    return text.split('').join(' ')
  }

  private formatPlaytime(seconds: number): string {
    if (seconds < 60) return `${Math.max(1, seconds)} seconds`
    const mins = Math.round(seconds / 60)
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
    const hrs = Math.floor(mins / 60)
    const rem = mins % 60
    return rem ? `${hrs}h ${rem}m` : `${hrs} hour${hrs === 1 ? '' : 's'}`
  }
}
