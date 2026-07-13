import * as THREE from 'three'
import { instantiate, findBone } from './assets'
import { Animator } from './animator'
import { tone } from './audio'
import { TOWN_CENTER, GATE_DIR } from './world'
import type { QuestLog, NpcId } from './quest'

/** Hero must be this close (XZ) for the E-prompt and to start a conversation. */
const INTERACT_RANGE = 2.4
/** NPCs slerp their yaw toward the hero inside this radius. */
const FACE_RANGE = 4
/** Walking further than this from the speaker closes the dialogue panel. */
const DIALOGUE_CLOSE_RANGE = 3.5
/** Yaw slerp speed — a touch slower than the hero's TURN_SPEED, feels unhurried. */
const NPC_TURN_SPEED = 6

const NPC_HEIGHT = 1.8
/** Old Marek is shorter — a "seated by the fire" fake. */
const MAREK_HEIGHT = 1.65
const STAFF_TINT = 0x4a3826
const BLADE_TINT = 0x4a4650

/** Per-line dialogue blip. */
function lineBlip(): void {
  tone(300, 0.05, 'sine', 0.04)
}

/** Vess's soft mending chime, played when her talk completes (full heal). */
function healChime(): void {
  tone(660, 0.15, 'sine', 0.05)
}

interface NpcDef {
  id: NpcId
  /** Short name used in the `E — Name` prompt. */
  promptName: string
  tint: number
  height: number
  position: THREE.Vector3
  /** World point the NPC faces when the hero isn't near. */
  lookAt: THREE.Vector3
  held: 'staff' | 'blade' | null
}

function makeDefs(): NpcDef[] {
  const serraPos = TOWN_CENTER.clone().addScaledVector(GATE_DIR, 10)
  return [
    {
      id: 'serra',
      promptName: 'Serra',
      tint: 0x9a7546, // warm bronze — enemy-red tints read as hostile from afar

      height: NPC_HEIGHT,
      position: serraPos,
      lookAt: serraPos.clone().add(GATE_DIR), // watches the moor
      held: null,
    },
    {
      id: 'marek',
      promptName: 'Marek',
      tint: 0x9a94a8,
      height: MAREK_HEIGHT,
      position: new THREE.Vector3(38, 0, 42),
      lookAt: TOWN_CENTER.clone(), // faces the campfire
      held: 'staff',
    },
    {
      id: 'vess',
      promptName: 'Vess',
      tint: 0xcbb27a,
      height: NPC_HEIGHT,
      position: new THREE.Vector3(38.1, 0, 45.4), // clear of the tent cone footprint
      lookAt: TOWN_CENTER.clone(), // beside the tent, facing camp
      held: null,
    },
    {
      id: 'brann',
      promptName: 'Brann',
      tint: 0x555055,
      height: NPC_HEIGHT,
      position: new THREE.Vector3(45, 0, 38.5),
      lookAt: new THREE.Vector3(46, 0, 38), // at the anvil
      held: 'blade',
    },
  ]
}

/** Clone every MeshStandardMaterial under root and multiply its color by tint. */
function tintModel(root: THREE.Object3D, tintHex: number): void {
  const tint = new THREE.Color(tintHex)
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (!mat.isMeshStandardMaterial) return
    const clone = mat.clone()
    clone.color.multiply(tint)
    mesh.material = clone
  })
}

/** One townsfolk: recolored knight, idle loop, turns to face a nearby hero. */
class Npc {
  readonly def: NpcDef
  readonly group = new THREE.Group()
  /** World anchor for the `E — Name` prompt, just above the head. */
  readonly promptAnchor: THREE.Vector3
  /** World anchor for the ! / ? quest marker, higher than the prompt. */
  readonly questAnchor: THREE.Vector3
  readonly promptText: string

  private anim: Animator
  private yaw: number
  private baseYaw: number

  constructor(scene: THREE.Scene, def: NpcDef) {
    this.def = def
    const { root, clips } = instantiate('knight', def.height)
    tintModel(root, def.tint) // clone-then-tint so instances don't share paint
    if (def.held) this.attachHeld(root, def.held)
    this.group.add(root)
    this.anim = new Animator(root, clips)
    this.anim.play(this.anim.has('Idle') ? 'Idle' : 'Idle_swordRight')

    this.group.position.copy(def.position)
    const toLook = def.lookAt.clone().sub(def.position)
    this.baseYaw = Math.atan2(toLook.x, toLook.z)
    this.yaw = this.baseYaw
    this.group.rotation.y = this.yaw
    scene.add(this.group)

    this.promptAnchor = def.position.clone().setY(def.height + 0.5)
    this.questAnchor = def.position.clone().setY(def.height + 0.95)
    this.promptText = `E — ${def.promptName}`
  }

  /** No helmet, no sword-in-hand loadout — except Marek's staff and Brann's blade. */
  private attachHeld(root: THREE.Object3D, kind: 'staff' | 'blade'): void {
    const palm = findBone(root, 'palm', 'r')
    if (!palm) return
    const counterScale = 1 / root.scale.x
    if (kind === 'staff') {
      const staff = instantiate('sword', 1.5)
      staff.root.scale.multiplyScalar(counterScale)
      staff.root.rotation.x = Math.PI // point-down: a lorekeeper's staff, not a weapon
      tintModel(staff.root, STAFF_TINT)
      palm.add(staff.root)
    } else {
      const blade = instantiate('sword', 1.1)
      blade.root.scale.multiplyScalar(counterScale)
      tintModel(blade.root, BLADE_TINT)
      palm.add(blade.root)
    }
  }

  distSqTo(pos: THREE.Vector3): number {
    const dx = this.group.position.x - pos.x
    const dz = this.group.position.z - pos.z
    return dx * dx + dz * dz
  }

  update(dt: number, heroPos: THREE.Vector3): void {
    this.anim.update(dt)
    const dx = heroPos.x - this.group.position.x
    const dz = heroPos.z - this.group.position.z
    const heroNear = dx * dx + dz * dz < FACE_RANGE * FACE_RANGE
    const targetYaw = heroNear ? Math.atan2(dx, dz) : this.baseYaw
    let d = targetYaw - this.yaw
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.yaw += d * Math.min(1, NPC_TURN_SPEED * dt)
    this.group.rotation.y = this.yaw
  }
}

interface ActiveDialogue {
  npc: Npc
  lines: string[]
  onDone?: () => void
  index: number
}

const NPC_STYLE = `
#npc-dialogue {
  position: fixed;
  bottom: 150px;
  left: 50%;
  transform: translateX(-50%);
  width: min(560px, 80vw);
  background: rgba(8, 6, 14, 0.85);
  border: 1px solid rgba(168, 85, 247, 0.35);
  border-radius: 10px;
  padding: 14px 18px 10px;
  display: none;
  z-index: 11;
  pointer-events: auto;
  cursor: pointer;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
  font-family: Georgia, 'Palatino', serif;
}
#npc-dialogue.show {
  display: block;
}
#npc-dialogue .npc-name {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #c4b5fd;
  margin-bottom: 6px;
}
#npc-dialogue .npc-line {
  font-size: 15px;
  line-height: 1.5;
  color: #e7e4f0;
}
#npc-dialogue .npc-hint {
  margin-top: 8px;
  text-align: right;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #71717a;
}
.quest-mark {
  font-size: 20px;
  font-weight: bold;
  color: #fbbf24;
  text-shadow: 0 0 10px rgba(251, 191, 36, 0.5), 0 1px 3px #000;
  animation: quest-bob 1.4s ease-in-out infinite;
}
@keyframes quest-bob {
  0%, 100% { margin-top: 0; }
  50% { margin-top: -6px; }
}
`

/**
 * The four townsfolk of Emberwatch: Warden Serra at the gate, Old Marek by
 * the fire, Vess by the tent (full heal on talk), Brann at the anvil.
 * Owns the dialogue panel DOM; quest markers and E-prompts render through
 * hud.setMarker. Dialogue text comes from the QuestLog.
 */
export class NpcSystem {
  private scene: THREE.Scene
  private questLog: QuestLog
  private fullHeal: () => void
  private setMarker: (id: string, pos: THREE.Vector3 | null, text: string, cls?: string) => void

  private npcs: Npc[]
  private active: ActiveDialogue | null = null
  private panel: HTMLDivElement
  private nameEl: HTMLDivElement
  private lineEl: HTMLDivElement

  constructor(opts: {
    scene: THREE.Scene
    questLog: QuestLog
    fullHeal: () => void
    setMarker: (id: string, pos: THREE.Vector3 | null, text: string, cls?: string) => void
  }) {
    this.scene = opts.scene
    this.questLog = opts.questLog
    this.fullHeal = opts.fullHeal
    this.setMarker = opts.setMarker

    const style = document.createElement('style')
    style.textContent = NPC_STYLE
    document.head.appendChild(style)

    this.panel = document.createElement('div')
    this.panel.id = 'npc-dialogue'
    this.nameEl = document.createElement('div')
    this.nameEl.className = 'npc-name'
    this.lineEl = document.createElement('div')
    this.lineEl.className = 'npc-line'
    const hint = document.createElement('div')
    hint.className = 'npc-hint'
    hint.textContent = 'E ▸'
    this.panel.append(this.nameEl, this.lineEl, hint)
    this.panel.addEventListener('click', () => this.advance())
    document.body.appendChild(this.panel)

    this.npcs = makeDefs().map((def) => new Npc(this.scene, def))
  }

  get dialogueOpen(): boolean {
    return this.active !== null
  }

  update(dt: number, heroPos: THREE.Vector3): void {
    for (const npc of this.npcs) {
      npc.update(dt, heroPos)
      const mark = this.questLog.markerFor(npc.def.id)
      this.setMarker(`npc-quest-${npc.def.id}`, mark ? npc.questAnchor : null, mark ?? '', 'quest-mark')
    }

    // walked away mid-conversation → the panel closes, no side effects
    if (this.active && this.active.npc.distSqTo(heroPos) > DIALOGUE_CLOSE_RANGE * DIALOGUE_CLOSE_RANGE) {
      this.close()
    }

    const near = this.dialogueOpen ? null : this.nearestNpc(heroPos, INTERACT_RANGE)
    this.setMarker('npc-prompt', near ? near.promptAnchor : null, near ? near.promptText : '')
  }

  /** Call when E is pressed; opens/advances dialogue. Returns true if it consumed the press. */
  interact(heroPos: THREE.Vector3): boolean {
    if (this.active) {
      this.advance()
      return true
    }
    const npc = this.nearestNpc(heroPos, INTERACT_RANGE)
    if (!npc) return false
    this.open(npc)
    return true
  }

  private nearestNpc(heroPos: THREE.Vector3, range: number): Npc | null {
    let best: Npc | null = null
    let bestDistSq = range * range
    for (const npc of this.npcs) {
      const d = npc.distSqTo(heroPos)
      if (d < bestDistSq) {
        bestDistSq = d
        best = npc
      }
    }
    return best
  }

  private open(npc: Npc): void {
    const dialogue = this.questLog.getDialogue(npc.def.id)
    this.active = { npc, lines: dialogue.lines, onDone: dialogue.onDone, index: 0 }
    this.nameEl.textContent = dialogue.name
    this.renderLine()
    this.panel.classList.add('show')
  }

  private advance(): void {
    if (!this.active) return
    this.active.index++
    if (this.active.index < this.active.lines.length) {
      this.renderLine()
      return
    }
    // advanced past the last line → conversation completes
    const { npc, onDone } = this.active
    this.close()
    onDone?.()
    if (npc.def.id === 'vess') {
      this.fullHeal()
      healChime()
    }
  }

  private renderLine(): void {
    if (!this.active) return
    this.lineEl.textContent = this.active.lines[this.active.index] ?? ''
    lineBlip()
  }

  private close(): void {
    this.active = null
    this.panel.classList.remove('show')
  }
}
