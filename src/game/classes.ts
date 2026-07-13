import { audio } from './audio'

/**
 * The three Orders a Tracker can swear to — class definitions (stats +
 * skill data) and the full-screen "Choose your Order" selection screen.
 * All numbers come from the v0.3 design spec §6.
 */
export type ClassId = 'sentinel' | 'stormcaller' | 'shade'

export interface SkillDef {
  key: string
  name: string
  icon: string
  manaCost: number
  cooldown: number
  describe: string
}

export interface ClassDef {
  id: ClassId
  name: string
  blurb: string
  maxHp: number
  hpPerLevel: number
  dmgMult: number
  attackSpeed: number
  moveSpeed: number
  rollCooldown: number
  maxMana: number
  manaPerLevel: number
  manaRegen: number
  lanternColor: number
  loadout: { helmet: boolean; dualSwords: boolean; bladeEmissive?: number }
  skills: [SkillDef, SkillDef, SkillDef]
}

export const CLASS_DEFS: Record<ClassId, ClassDef> = {
  sentinel: {
    id: 'sentinel',
    name: 'Sentinel',
    blurb: 'A bulwark of the old Orders — breaks warpspawn lines with steel and fury.',
    maxHp: 125,
    hpPerLevel: 18,
    dmgMult: 1.15,
    attackSpeed: 1.0,
    moveSpeed: 6.3,
    rollCooldown: 1.4,
    maxMana: 40,
    manaPerLevel: 4,
    manaRegen: 3.0,
    lanternColor: 0xffc477,
    loadout: { helmet: true, dualSwords: false },
    skills: [
      {
        key: '1',
        name: 'Sunder',
        icon: '⤵',
        manaCost: 12,
        cooldown: 5,
        describe: 'Leap to a point and slam down, staggering everything nearby.',
      },
      {
        key: '2',
        name: 'Steelstorm',
        icon: '⟳',
        manaCost: 18,
        cooldown: 8,
        describe: 'Become a whirling storm of steel, grinding down all around you.',
      },
      {
        key: '3',
        name: 'Warcall',
        icon: '◉',
        manaCost: 20,
        cooldown: 12,
        describe: 'A shout that batters and staggers every foe within earshot.',
      },
    ],
  },
  stormcaller: {
    id: 'stormcaller',
    name: 'Stormcaller',
    blurb: 'Channels the storm between worlds; the warp itself answers.',
    maxHp: 80,
    hpPerLevel: 10,
    dmgMult: 0.85,
    attackSpeed: 1.0,
    moveSpeed: 6.8,
    rollCooldown: 1.4,
    maxMana: 70,
    manaPerLevel: 7,
    manaRegen: 6.0,
    lanternColor: 0xa855f7,
    loadout: { helmet: false, dualSwords: false, bladeEmissive: 0xa855f7 },
    skills: [
      {
        key: '1',
        name: 'Warp Bolt',
        icon: '✦',
        manaCost: 8,
        cooldown: 0.6,
        describe: 'Hurl a bolt of warpfire that bursts on impact.',
      },
      {
        key: '2',
        name: 'Stormburst',
        icon: '◎',
        manaCost: 22,
        cooldown: 6,
        describe: 'A ring of storm energy erupts outward from where you stand.',
      },
      {
        key: '3',
        name: 'Riftstep',
        icon: '⌁',
        manaCost: 15,
        cooldown: 4,
        describe: 'Step through the warp to a point of your choosing.',
      },
    ],
  },
  shade: {
    id: 'shade',
    name: 'Shade',
    blurb: 'A knife in the dark — fast, and everywhere at once.',
    maxHp: 90,
    hpPerLevel: 13,
    dmgMult: 1.0,
    attackSpeed: 1.12,
    moveSpeed: 7.5,
    rollCooldown: 1.0,
    maxMana: 55,
    manaPerLevel: 5,
    manaRegen: 4.5,
    lanternColor: 0x7dd3fc,
    loadout: { helmet: false, dualSwords: true },
    skills: [
      {
        key: '1',
        name: 'Fan of Blades',
        icon: '⋔',
        manaCost: 10,
        cooldown: 2.5,
        describe: 'Fling five blades in a wide killing fan.',
      },
      {
        key: '2',
        name: 'Sting Trap',
        icon: '▲',
        manaCost: 18,
        cooldown: 9,
        describe: 'Plant a trap that stings the nearest foe, again and again.',
      },
      {
        key: '3',
        name: 'Phase Strike',
        icon: '➤',
        manaCost: 14,
        cooldown: 6,
        describe: 'Dash through your enemies, cutting everything in your path.',
      },
    ],
  },
}

const STORAGE_KEY = 'wt.class'
const ORDER: ClassId[] = ['sentinel', 'stormcaller', 'shade']

/** Vitality / Force / Swiftness pip values (1–5) shown on the select cards. */
const PIPS: Record<ClassId, [number, number, number]> = {
  sentinel: [5, 4, 2],
  stormcaller: [2, 5, 3],
  shade: [3, 3, 5],
}
const PIP_LABELS = ['Vitality', 'Force', 'Swiftness'] as const

const CSS = `
#class-select {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 24px;
  overflow-y: auto;
  background:
    radial-gradient(ellipse at 50% 32%, rgba(46, 16, 101, 0.4), rgba(5, 2, 8, 0.97) 68%),
    #050208;
  font-family: Georgia, 'Palatino', 'Times New Roman', serif;
  color: #d6d3d1;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity 0.3s ease;
}
#class-select.leaving {
  opacity: 0;
  pointer-events: none;
}
#class-select h1 {
  font-weight: normal;
  font-size: clamp(24px, 4.5vw, 42px);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: #a855f7;
  text-shadow: 0 0 36px #6b21a8, 0 2px 6px #000;
  text-align: center;
}
#class-select .wt-sub {
  margin-top: -12px;
  font-size: 15px;
  letter-spacing: 0.06em;
  color: #b9b3c9;
  font-style: italic;
  text-align: center;
}
.wt-cards {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
  justify-content: center;
}
.wt-card {
  position: relative;
  width: 252px;
  padding: 20px 18px 14px;
  border: 1px solid rgba(168, 85, 247, 0.22);
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(21, 14, 32, 0.94), rgba(9, 5, 15, 0.96));
  cursor: pointer;
  text-align: left;
  transition: border-color 0.18s, box-shadow 0.18s, transform 0.18s;
}
.wt-card:hover {
  border-color: rgba(168, 85, 247, 0.65);
  box-shadow: 0 0 24px rgba(168, 85, 247, 0.2);
  transform: translateY(-3px);
}
.wt-card.selected {
  border-color: #a855f7;
  box-shadow: 0 0 32px rgba(168, 85, 247, 0.38), inset 0 0 20px rgba(107, 33, 168, 0.16);
}
.wt-card .wt-keycap {
  position: absolute;
  top: 10px;
  right: 12px;
  font-family: monospace;
  font-size: 12px;
  color: #71717a;
  border: 1px solid #3a3151;
  border-radius: 4px;
  padding: 1px 6px;
}
.wt-card.selected .wt-keycap {
  color: #c4b5fd;
  border-color: #a855f7;
}
.wt-card h2 {
  font-weight: normal;
  font-size: 21px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #e7e4f0;
  margin-bottom: 8px;
}
.wt-card.selected h2 {
  color: #c4b5fd;
  text-shadow: 0 0 14px rgba(168, 85, 247, 0.5);
}
.wt-fantasy {
  min-height: 60px;
  font-size: 13px;
  font-style: italic;
  line-height: 1.5;
  color: #b9b3c9;
  margin-bottom: 12px;
}
.wt-stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8f8aa3;
}
.wt-pips .wt-pip {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 4px;
  border-radius: 50%;
  background: #241e38;
  border: 1px solid #3a3151;
}
.wt-pips .wt-pip.fill {
  background: #a855f7;
  border-color: #a855f7;
  box-shadow: 0 0 6px rgba(168, 85, 247, 0.7);
}
.wt-skills {
  list-style: none;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(168, 85, 247, 0.15);
}
.wt-skills li {
  padding: 2px 0;
  font-size: 13px;
  color: #cfcadd;
}
.wt-skills .wt-glyph {
  display: inline-block;
  width: 22px;
  color: #a855f7;
}
#wt-class-confirm {
  padding: 12px 36px;
  font-family: inherit;
  font-size: 15px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #f59e0b;
  background: rgba(28, 20, 8, 0.6);
  border: 1px solid #7c5a2b;
  border-radius: 4px;
  cursor: pointer;
  transition: box-shadow 0.18s, opacity 0.18s;
}
#wt-class-confirm:disabled {
  opacity: 0.35;
  cursor: default;
}
#wt-class-confirm:not(:disabled):hover {
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.3);
}
.wt-hint {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #71717a;
}
`

function isClassId(v: string | null): v is ClassId {
  return v === 'sentinel' || v === 'stormcaller' || v === 'shade'
}

function pipRowHtml(label: string, filled: number): string {
  let pips = ''
  for (let i = 0; i < 5; i++) pips += `<i class="wt-pip${i < filled ? ' fill' : ''}"></i>`
  return `<div class="wt-stat-row"><span>${label}</span><span class="wt-pips">${pips}</span></div>`
}

function cardHtml(def: ClassDef, index: number): string {
  const pips = PIPS[def.id]
  const rows = PIP_LABELS.map((label, i) => pipRowHtml(label, pips[i])).join('')
  const skills = def.skills
    .map((s) => `<li><span class="wt-glyph">${s.icon}</span>${s.name}</li>`)
    .join('')
  return `
    <div class="wt-card" data-class="${def.id}">
      <span class="wt-keycap">${index + 1}</span>
      <h2>${def.name}</h2>
      <p class="wt-fantasy">${def.blurb}</p>
      ${rows}
      <ul class="wt-skills">${skills}</ul>
    </div>`
}

/**
 * Full-screen "Choose your Order" screen. Owns its DOM + styles; resolves
 * with the chosen class once confirmed (1/2/3 or click to select, Enter or
 * click to begin). Persists the choice to localStorage and pre-highlights
 * it on revisit. Confirming also unlocks WebAudio (it's a user gesture).
 */
export function showClassSelect(): Promise<ClassId> {
  return new Promise((resolve) => {
    const saved = localStorage.getItem(STORAGE_KEY)
    let selected: ClassId | null = isClassId(saved) ? saved : null

    const root = document.createElement('div')
    root.id = 'class-select'
    const style = document.createElement('style')
    style.textContent = CSS
    root.appendChild(style)

    const body = document.createElement('div')
    body.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:24px;'
    body.innerHTML = `
      <h1>Choose your Order</h1>
      <p class="wt-sub">Every Tracker swears to one. The moor does not care which.</p>
      <div class="wt-cards">${ORDER.map((id, i) => cardHtml(CLASS_DEFS[id], i)).join('')}</div>
      <button id="wt-class-confirm" disabled>Begin the Hunt</button>
      <p class="wt-hint">1 / 2 / 3 to choose &middot; Enter to begin</p>`
    root.appendChild(body)
    document.body.appendChild(root)

    const confirmBtn = body.querySelector<HTMLButtonElement>('#wt-class-confirm')!
    const cards = new Map<ClassId, HTMLElement>()
    for (const el of body.querySelectorAll<HTMLElement>('.wt-card')) {
      cards.set(el.dataset.class as ClassId, el)
    }

    const select = (id: ClassId): void => {
      selected = id
      for (const [cid, el] of cards) el.classList.toggle('selected', cid === id)
      confirmBtn.disabled = false
    }

    const confirm = (): void => {
      if (!selected) return
      const choice = selected
      localStorage.setItem(STORAGE_KEY, choice)
      audio.unlock()
      window.removeEventListener('keydown', onKey)
      root.classList.add('leaving')
      window.setTimeout(() => root.remove(), 320)
      resolve(choice)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Digit1' || e.code === 'Numpad1') select('sentinel')
      else if (e.code === 'Digit2' || e.code === 'Numpad2') select('stormcaller')
      else if (e.code === 'Digit3' || e.code === 'Numpad3') select('shade')
      else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && selected) confirm()
    }
    window.addEventListener('keydown', onKey)

    for (const [id, el] of cards) {
      el.addEventListener('click', () => {
        // clicking the already-selected card confirms; otherwise select it
        if (selected === id) confirm()
        else select(id)
      })
    }
    confirmBtn.addEventListener('click', confirm)

    if (selected) select(selected)
  })
}
