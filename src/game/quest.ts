import { tone } from './audio'

export type QuestEvent = 'kill' | 'totem' | 'heart'
export type NpcId = 'serra' | 'marek' | 'vess' | 'brann'

export interface QuestLogDeps {
  showBanner: (text: string, ms?: number) => void
  /** hero.unlockSkill — quest rewards for action-bar slots 2/3 */
  unlockSkill: (slot: 1 | 2) => void
  grantXp: (xp: number) => void
  fullHeal: () => void
  /** respawns the overworld spires + the Warpheart for Hunt n */
  startHunt: (n: number) => void
}

/** Shape of the `wt.save` localStorage slot. */
export interface SavedState {
  class: string
  chapter: number
  huntsCompleted: number
  level: number
  xp: number
}

export interface Dialogue {
  name: string
  lines: string[]
  onDone?: () => void
}

const SAVE_KEY = 'wt.save'
const KILLS_NEEDED = 8
const SPIRES_NEEDED = 3
/** a hunt seals the 3 overworld spires + the Warpheart */
const HUNT_SEALS_NEEDED = 4
const XP_Q1 = 60
const XP_Q2 = 120
const XP_Q3 = 250
const XP_HUNT_PER = 100

const SERRA = 'Warden Serra'
const MAREK = 'Old Marek, the Lorekeeper'
const VESS = 'Vess, the Stitcher'
const BRANN = 'Brann Coalhand'

const TRACKER_STYLE = `
#quest-tracker {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 240px;
  padding: 10px 12px;
  background: rgba(10, 7, 16, 0.6);
  border: 1px solid rgba(168, 85, 247, 0.25);
  border-radius: 6px;
  z-index: 11;
  pointer-events: none;
  font-family: Georgia, 'Palatino', serif;
  text-shadow: 0 1px 3px #000;
}
#quest-tracker .qt-header {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: #a855f7;
}
#quest-tracker .qt-name {
  font-size: 14px;
  color: #e7e4f0;
  margin-top: 3px;
}
#quest-tracker .qt-obj {
  font-size: 12px;
  color: #b9b3c9;
  margin-top: 2px;
}
#quest-tracker .qt-obj.ready {
  color: #fbbf24;
}
#quest-tracker .qt-count {
  font-weight: bold;
  display: inline-block;
}
#quest-tracker .qt-count.tick {
  animation: qt-tick 0.2s ease-out;
}
@keyframes qt-tick {
  0% { transform: scale(1.15); color: #c4b5fd; }
  100% { transform: scale(1); }
}`

interface TrackerView {
  name: string
  obj: string
  count?: string
  ready: boolean
}

/**
 * QuestLog — the linear Act I chapter machine plus the repeatable Hunt loop.
 * Chapters: 0 First Blood · 1 Break the Spires · 2 The Heart Below ·
 * 3 chain complete (a hunt is on offer) · 4 The Long Hunt in progress.
 * Owns the #quest-tracker DOM (top-right) and the `wt.save` localStorage
 * slot; all quest-gated NPC dialogue lives here and npc.ts renders it.
 */
export class QuestLog {
  /** parsed `wt.save` (null on a fresh start) — integrator restores hero level/xp from it */
  readonly savedState: SavedState | null
  /** integrator keeps this current (class on select, level/xp on change); save() snapshots it */
  heroState = { classId: 'sentinel', level: 1, xp: 0 }

  private readonly deps: QuestLogDeps
  private _chapter = 0
  private _hunts = 0
  /** current chapter's quest has been accepted from its giver */
  private accepted = false
  private kills = 0
  /** lifetime overworld spires sealed — counted from chapter 0 so Q2 credits retroactively */
  private totems = 0
  /** the Warpheart is dead — set from chapter ≤2 so Q3 credits retroactively */
  private heartDead = false
  private huntSeals = 0
  private vessTalk = 0
  private brannTalk = 0

  private readonly root = document.createElement('div')
  private readonly nameEl = document.createElement('div')
  private readonly objEl = document.createElement('div')

  constructor(deps: QuestLogDeps, restored: SavedState | null = null) {
    this.deps = deps
    this.savedState = restored
    if (restored) {
      this._chapter = Math.max(0, Math.min(3, Math.floor(restored.chapter)))
      this._hunts = Math.max(0, Math.floor(restored.huntsCompleted))
      this.heroState = { classId: restored.class, level: restored.level, xp: restored.xp }
      // chapters past 0 were auto-accepted at the previous turn-in; without this
      // a chapter-1 reload can never turn in Quest 2 (no re-accept path exists)
      if (this._chapter > 0) this.accepted = true
      if (this._chapter >= 2) {
        this.totems = SPIRES_NEEDED
        this.deps.unlockSkill(1) // Q2 reward re-applied
      }
      if (this._chapter >= 3) {
        this.heartDead = true
        this.deps.unlockSkill(2) // Q3 reward re-applied
      }
    }
    this.buildTracker()
    this.renderTracker()
  }

  get chapter(): number {
    return this._chapter
  }

  get huntsCompleted(): number {
    return this._hunts
  }

  // -- progression events -------------------------------------------------

  notify(event: QuestEvent): void {
    if (event === 'kill') {
      if (this._chapter === 0 && this.accepted && this.kills < KILLS_NEEDED) {
        this.kills++
        this.renderTracker(true)
      }
      return
    }
    if (event === 'totem') {
      if (this._chapter <= 1) {
        this.totems++
        if (this._chapter === 1) this.renderTracker(true)
      } else if (this._chapter === 4 && this.huntSeals < HUNT_SEALS_NEEDED) {
        this.huntSeals++
        this.renderTracker(true)
      }
      this.save()
      return
    }
    // 'heart' — the Warpheart's own death banner lives here so it also fires
    // when the heart is killed before Q3 is accepted (retroactive credit)
    this.deps.showBanner('The warp is sealed. The moor breathes again.', 3200)
    if (this._chapter <= 2) {
      this.heartDead = true
      this.renderTracker()
    } else if (this._chapter === 4 && this.huntSeals < HUNT_SEALS_NEEDED) {
      this.huntSeals++
      this.renderTracker(true)
    }
  }

  private get q1Ready(): boolean {
    return this._chapter === 0 && this.accepted && this.kills >= KILLS_NEEDED
  }

  private get q2Ready(): boolean {
    return this._chapter === 1 && this.accepted && this.totems >= SPIRES_NEEDED
  }

  private get q3Ready(): boolean {
    return this._chapter === 2 && this.accepted && this.heartDead
  }

  private get huntReady(): boolean {
    return this._chapter === 4 && this.huntSeals >= HUNT_SEALS_NEEDED
  }

  // -- dialogue ------------------------------------------------------------

  /** dialogue npc.ts renders; advancing past the last line fires onDone (accept/turn-in) */
  getDialogue(npc: NpcId): Dialogue {
    switch (npc) {
      case 'serra':
        return this.serraDialogue()
      case 'marek':
        return this.marekDialogue()
      case 'vess':
        return this.vessDialogue()
      case 'brann':
        return this.brannDialogue()
    }
  }

  markerFor(npc: NpcId): '!' | '?' | null {
    if (npc === 'serra') {
      if (this._chapter === 0) return this.q1Ready ? '?' : this.accepted ? null : '!'
      if (this._chapter === 1) return this.q2Ready ? '?' : null
      if (this._chapter === 3) return '!'
      if (this._chapter === 4) return this.huntReady ? '?' : null
      return null
    }
    if (npc === 'marek' && this._chapter === 2) {
      return this.q3Ready ? '?' : this.accepted ? null : '!'
    }
    return null
  }

  private serraDialogue(): Dialogue {
    if (this._chapter === 0) {
      if (!this.accepted) {
        return {
          name: SERRA,
          lines: [
            'Another Tracker. Good. The last one came back in pieces.',
            "The moor crawls with warpspawn. Thin them — eight heads — and I'll believe your sword is more than polish.",
          ],
          onDone: () => this.acceptQuest1(),
        }
      }
      if (this.q1Ready) {
        // Q1 turn-in flows straight into the Q2 offer
        return {
          name: SERRA,
          lines: [
            'So you can bite. The spawn pour from spires — black nails the warp drives into the earth.',
            'Three stand out on the moor. Their wards break when their keepers die. Shatter all three.',
          ],
          onDone: () => this.completeQuest1(),
        }
      }
      return { name: SERRA, lines: ['Eight. Count them, or the moor will count you.'] }
    }
    if (this._chapter === 1) {
      if (this.q2Ready) {
        return {
          name: SERRA,
          lines: ["The moor is quiet. But the ground still hums, Tracker. Talk to Marek — he's felt it too."],
          onDone: () => this.completeQuest2(),
        }
      }
      return { name: SERRA, lines: ["A spire's ward dies with its keepers. Kill the pack, then break the stone."] }
    }
    if (this._chapter === 2) {
      return {
        name: SERRA,
        lines: ["The moor is quiet. But the ground still hums, Tracker. Talk to Marek — he's felt it too."],
      }
    }
    if (this._chapter === 3) {
      return {
        name: SERRA,
        lines: ["The moor never stays clean. There's always another hunt."],
        onDone: () => this.acceptHunt(),
      }
    }
    // chapter 4 — a hunt is running
    if (this.huntReady) {
      return {
        name: SERRA,
        lines: ['Four seals, clean. The moor will fill again — it always does.'],
        onDone: () => this.completeHunt(),
      }
    }
    return { name: SERRA, lines: ["A spire's ward dies with its keepers. Kill the pack, then break the stone."] }
  }

  private marekDialogue(): Dialogue {
    if (this._chapter < 2) {
      return {
        name: MAREK,
        lines: [
          'Sit by the fire awhile, Tracker. Listen.',
          "The warps aren't wounds. Wounds close. These are doors — and doors are held open.",
        ],
      }
    }
    if (this._chapter === 2) {
      if (!this.accepted) {
        return {
          name: MAREK,
          lines: [
            'Sit by the fire awhile, Tracker. Listen.',
            "The warps aren't wounds. Wounds close. These are doors — and doors are held open.",
            'Beneath the barrow, something anchors them all. A heart of the stream. Break it, and the moor breathes again.',
          ],
          onDone: () => this.acceptQuest3(),
        }
      }
      if (this.q3Ready) {
        return {
          name: MAREK,
          lines: [
            'You felt it die? That was one knot in one thread. The stream flows from somewhere far darker. Rest. Then we follow it.',
          ],
          onDone: () => this.completeQuest3(),
        }
      }
      return {
        name: MAREK,
        lines: ['The barrow lies at the far edge of the moor, past the gallows tree. Follow the old road down.'],
      }
    }
    return {
      name: MAREK,
      lines: [
        'You felt it die? That was one knot in one thread. The stream flows from somewhere far darker. Rest. Then we follow it.',
      ],
    }
  }

  private vessDialogue(): Dialogue {
    // npc.ts applies the full heal on talk; these are just her lines
    const pool =
      this._chapter >= 3
        ? [
            "You came back whole. That's new around here.",
            "Bleeding? Sit. I've thread and fire, and neither cares how much you scream.",
            'The warp leaves marks under the skin. Yours are… shallow. Keep them that way.',
          ]
        : [
            "Bleeding? Sit. I've thread and fire, and neither cares how much you scream.",
            'The warp leaves marks under the skin. Yours are… shallow. Keep them that way.',
          ]
    const line = pool[this.vessTalk % pool.length]
    return { name: VESS, lines: [line], onDone: () => void this.vessTalk++ }
  }

  private brannDialogue(): Dialogue {
    const pool = [
      "Don't touch the forge. Don't touch the blades. Talk, if you must.",
      "Bring me warp-iron from the deep barrow someday. I'll hammer you something that sings.",
    ]
    const line = pool[this.brannTalk % pool.length]
    return { name: BRANN, lines: [line], onDone: () => void this.brannTalk++ }
  }

  // -- accept / turn-in side-effects ----------------------------------------

  private acceptSfx(delay = 0): void {
    tone(392, 0.12, 'triangle', 0.08, undefined, delay)
    tone(523, 0.2, 'triangle', 0.08, undefined, delay + 0.1)
  }

  /** 3-note rising jingle — the riftCleared chord shape, brighter */
  private jingle(): void {
    tone(494, 0.15, 'triangle', 0.09)
    tone(587, 0.15, 'triangle', 0.09, undefined, 0.12)
    tone(784, 0.3, 'triangle', 0.1, undefined, 0.24)
  }

  private acceptQuest1(): void {
    if (this._chapter !== 0 || this.accepted) return
    this.accepted = true
    this.deps.showBanner('New hunt: First Blood')
    this.acceptSfx()
    this.save()
    this.renderTracker()
  }

  private completeQuest1(): void {
    if (!this.q1Ready) return
    this.deps.grantXp(XP_Q1)
    this.deps.fullHeal()
    this.jingle()
    // the same conversation hands out Break the Spires
    this._chapter = 1
    this.accepted = true
    this.deps.showBanner('New hunt: Break the Spires')
    this.acceptSfx(0.45)
    this.save()
    this.renderTracker()
  }

  private completeQuest2(): void {
    if (!this.q2Ready) return
    this.deps.grantXp(XP_Q2)
    this.deps.unlockSkill(1)
    this.jingle()
    this._chapter = 2
    this.accepted = false
    this.deps.showBanner('Hunt complete: Break the Spires')
    this.save()
    this.renderTracker()
  }

  private acceptQuest3(): void {
    if (this._chapter !== 2 || this.accepted) return
    this.accepted = true
    this.deps.showBanner('New hunt: The Heart Below')
    this.acceptSfx()
    this.save()
    this.renderTracker()
  }

  private completeQuest3(): void {
    if (!this.q3Ready) return
    this.deps.grantXp(XP_Q3)
    this.deps.unlockSkill(2)
    this.jingle()
    this._chapter = 3
    this.accepted = false
    this.deps.showBanner('The Heart is broken. Far darker waters stir — rest now, Tracker.', 4600)
    this.save()
    this.renderTracker()
  }

  private acceptHunt(): void {
    if (this._chapter !== 3) return
    this._chapter = 4
    this.accepted = true
    this.huntSeals = 0
    this.deps.startHunt(this._hunts + 1)
    this.deps.showBanner('New hunt: The Long Hunt')
    this.acceptSfx()
    this.save()
    this.renderTracker()
  }

  private completeHunt(): void {
    if (!this.huntReady) return
    this._hunts++
    this.deps.grantXp(XP_HUNT_PER * this._hunts)
    this.deps.fullHeal()
    this.jingle()
    this._chapter = 3
    this.accepted = false
    this.deps.showBanner(`Hunt ${this._hunts} complete`)
    this.save()
    this.renderTracker()
  }

  // -- persistence -----------------------------------------------------------

  save(): void {
    const data: SavedState = {
      class: this.heroState.classId,
      // a hunt in progress resumes as "hunt on offer" — its spires aren't persisted
      chapter: Math.min(this._chapter, 3),
      huntsCompleted: this._hunts,
      level: this.heroState.level,
      xp: this.heroState.xp,
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data))
    } catch {
      /* storage unavailable — play on without saving */
    }
  }

  static load(deps: QuestLogDeps): QuestLog {
    let saved: SavedState | null = null
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (raw) {
        const p = JSON.parse(raw) as Record<string, unknown>
        if (
          typeof p.class === 'string' &&
          typeof p.chapter === 'number' &&
          typeof p.huntsCompleted === 'number' &&
          typeof p.level === 'number' &&
          typeof p.xp === 'number'
        ) {
          saved = {
            class: p.class,
            chapter: p.chapter,
            huntsCompleted: p.huntsCompleted,
            level: Math.min(60, Math.max(1, Math.floor(p.level))),
            xp: Math.max(0, Math.min(1e7, p.xp)),
          }
        }
      }
    } catch {
      /* corrupted or unavailable save → fresh start */
    }
    return new QuestLog(deps, saved)
  }

  // -- #quest-tracker DOM ------------------------------------------------------

  private buildTracker(): void {
    if (!document.getElementById('wt-quest-style')) {
      const style = document.createElement('style')
      style.id = 'wt-quest-style'
      style.textContent = TRACKER_STYLE
      document.head.appendChild(style)
    }
    this.root.id = 'quest-tracker'
    const header = document.createElement('div')
    header.className = 'qt-header'
    header.textContent = 'HUNT'
    this.nameEl.className = 'qt-name'
    this.objEl.className = 'qt-obj'
    this.root.append(header, this.nameEl, this.objEl)
    ;(document.getElementById('hud') ?? document.body).appendChild(this.root)
  }

  private trackerView(): TrackerView | null {
    if (this._chapter === 0 && this.accepted) {
      return this.q1Ready
        ? { name: 'First Blood', obj: 'Return to Warden Serra.', ready: true }
        : { name: 'First Blood', obj: 'Warpspawn slain', count: `${this.kills}/${KILLS_NEEDED}`, ready: false }
    }
    if (this._chapter === 1) {
      return this.q2Ready
        ? { name: 'Break the Spires', obj: 'Return to Warden Serra.', ready: true }
        : {
            name: 'Break the Spires',
            obj: 'Spires shattered',
            count: `${Math.min(this.totems, SPIRES_NEEDED)}/${SPIRES_NEEDED}`,
            ready: false,
          }
    }
    if (this._chapter === 2 && this.accepted) {
      return this.q3Ready
        ? { name: 'The Heart Below', obj: 'Return to Old Marek.', ready: true }
        : { name: 'The Heart Below', obj: 'Destroy the Warpheart in the Hollow Barrow.', ready: false }
    }
    if (this._chapter === 4) {
      return this.huntReady
        ? { name: 'The Long Hunt', obj: 'Return to Warden Serra.', ready: true }
        : {
            name: 'The Long Hunt',
            obj: 'Warpspires sealed',
            count: `${this.huntSeals}/${HUNT_SEALS_NEEDED}`,
            ready: false,
          }
    }
    return null
  }

  private renderTracker(bump = false): void {
    const view = this.trackerView()
    if (!view) {
      this.root.style.display = 'none'
      return
    }
    this.root.style.display = 'block'
    this.nameEl.textContent = view.name
    this.objEl.classList.toggle('ready', view.ready)
    if (view.count !== undefined) {
      this.objEl.innerHTML = `${view.obj} <span class="qt-count${bump ? ' tick' : ''}">${view.count}</span>`
    } else {
      this.objEl.textContent = view.obj
    }
  }
}
