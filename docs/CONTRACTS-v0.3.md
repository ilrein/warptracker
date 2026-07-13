# v0.3 implementation contracts

Four module authors implement `docs/DESIGN-v0.3.md` in parallel with strict file ownership.
This file is the SINGLE SOURCE OF TRUTH for cross-module APIs. Code against these signatures
exactly. APIs marked **(integrator)** will be provided in existing files by the integrator
AFTER module authoring — import them as specified and trust the signature; a full typecheck
happens at integration.

## Shared, already exists

```ts
// src/game/hittable.ts (exists now)
export interface Hittable {
  position: THREE.Vector3
  radius: number
  alive: boolean
  takeDamage(amount: number, knockback: THREE.Vector3 | null): void
}

// src/game/audio.ts (exists now)
export function tone(freq: number, duration: number, type: OscillatorType, gain: number, slideTo?: number, delay?: number): void
export const audio: { unlock, swing, hit, hurt, kill, levelUp, warpClosed, riftCleared, death, dodge }

// src/game/assets.ts (exists): instantiate(name, targetHeight): {root, clips}; findBone(root, ...tokens)
// src/game/animator.ts (exists): new Animator(root, clips); play(name, {loop, fade, duration}); update(dt); has(name)
// src/game/rng.ts (exists): mulberry32(seed)
```

## Owned by AGENT A — world (files: world.ts REWRITE, zones.ts, town.ts, moor.ts, dungeon.ts, vfx.ts)

```ts
// world.ts must export:
export const WORLD_RADIUS = 78
export const TOWN_CENTER: THREE.Vector3      // (40, 0, 40)
export const TOWN_RADIUS = 16
export const GATE_DIR: THREE.Vector3         // normalize(-1, 0, -1)
export const BARROW_ENTRANCE: THREE.Vector3  // (-46, 0, -46)
export const BARROW_FIELD_RADIUS = 20
export const DUNGEON_ORIGIN: THREE.Vector3   // (400, 0, 400)
export function buildWorld(scene: THREE.Scene): void   // ground, lights, scatter + calls town/moor/dungeon builders
export function resolveCollision(current: THREE.Vector3, next: THREE.Vector3): THREE.Vector3
// ^ world rim, palisade ring w/ gate arc, dungeon wall AABBs; returns adjusted position (slide or stop)
export function updateWorld(dt: number, heroPos: THREE.Vector3): void  // moon follow + animated props (flames, cage swing)
export interface DungeonPortals { entry: THREE.Vector3; exitInside: THREE.Vector3 } // entrance door point & inside stairs point
export const PORTALS: DungeonPortals

// zones.ts must export:
export type ZoneId = 'town' | 'blackfen' | 'gallows' | 'barrowfield' | 'barrow'
export const ZONE_NAMES: Record<ZoneId, string>  // display names per spec
export function zoneAt(pos: THREE.Vector3): ZoneId
export function dangerTier(pos: THREE.Vector3): number  // 0 town, 1-3 moor tiers, 3 barrow
export class ZoneDirector {
  constructor(scene: THREE.Scene, opts: { onZoneChange: (zone: ZoneId, displayName: string) => void })
  update(dt: number, heroPos: THREE.Vector3): void  // lerps fog/light params per zone, fires onZoneChange
}

// vfx.ts must export (used by totem.ts and skills.ts):
export function spawnRing(scene: THREE.Scene, pos: THREE.Vector3, color: number, fromR: number, toR: number, duration: number, opts?: { opacity?: number; y?: number }): void
export function spawnBurst(scene: THREE.Scene, pos: THREE.Vector3, color: number, count?: number, opts?: { speed?: number; up?: number; size?: number; gravity?: number; life?: number }): void
export function spawnTrail(scene: THREE.Scene, pos: THREE.Vector3, color: number, size?: number, life?: number): void
export function updateVfx(dt: number): void  // integrator calls once per tick
```

## Owned by AGENT B — totems & quests (files: totem.ts, quest.ts). warp.ts will be DELETED by integrator; copy any VFX recipes you need into totem.ts.

```ts
// totem.ts must export:
import type { EnemyKindId } from './enemy'
export class WarpSpire implements Hittable {
  constructor(opts: {
    scene: THREE.Scene
    position: THREE.Vector3
    hp: number
    tier: number                 // enemy scaling passed to guards
    isHeart?: boolean            // the Warpheart: bigger, screen flash + riftCleared on death
    guards: EnemyKindId[]
    spawnEnemy: (kind: EnemyKindId, pos: THREE.Vector3, tier: number, name?: string) => Hittable & { alive: boolean }   // (integrator wires real Enemy + registration)
    onSealed: () => void
    onAoE?: (pos: THREE.Vector3, radius: number, damage: number, knockback: number) => void  // destruction AoE vs enemies (integrator)
    floatText?: (pos: THREE.Vector3, text: string, cls?: string) => void
  })
  update(dt: number, heroPos: THREE.Vector3): void
  readonly warded: boolean       // any guard alive → immune ("WARDED" float + ping on hit)
  alive: boolean; position: THREE.Vector3; radius: number  // radius 1.1 (heart 1.6)
  takeDamage(amount: number, knockback: THREE.Vector3 | null): void
  hp: number; maxHp: number
}

// quest.ts must export:
export type QuestEvent = 'kill' | 'totem' | 'heart'
export type NpcId = 'serra' | 'marek' | 'vess' | 'brann'
export class QuestLog {
  constructor(opts: {
    showBanner: (text: string, ms?: number) => void
    unlockSkill: (slot: 1 | 2) => void            // (integrator: hero.unlockSkill)
    grantXp: (xp: number) => void
    fullHeal: () => void
    startHunt: (n: number) => void                // (integrator: respawns overworld spires + heart)
  })
  notify(event: QuestEvent): void
  readonly chapter: number                        // 0..4 (4 = hunts)
  readonly huntsCompleted: number
  /** dialogue npc.ts renders; advancing past last line triggers accept/turn-in side-effects */
  getDialogue(npc: NpcId): { name: string; lines: string[]; onDone?: () => void }
  markerFor(npc: NpcId): '!' | '?' | null
  save(): void; static load(deps: ConstructorParameters<typeof QuestLog>[0]): QuestLog  // localStorage 'wt.save'
}
// quest.ts ALSO owns the #quest-tracker DOM (creates element + injects its own <style> tag, per spec §5)
```

## Owned by AGENT C — NPCs (file: npc.ts)

```ts
// npc.ts must export:
import type { QuestLog, NpcId } from './quest'
export class NpcSystem {
  constructor(opts: {
    scene: THREE.Scene
    questLog: QuestLog
    fullHeal: () => void                                   // Vess
    setMarker: (id: string, pos: THREE.Vector3 | null, text: string, cls?: string) => void  // (integrator: hud.setMarker)
  })
  update(dt: number, heroPos: THREE.Vector3): void  // face hero, E-prompt + !/? markers via setMarker
  /** call when E pressed; opens/advances dialogue; returns true if it consumed the press */
  interact(heroPos: THREE.Vector3): boolean
  readonly dialogueOpen: boolean
}
// npc.ts owns the dialogue panel DOM + its <style> tag. NPCs = recolored knight instantiate()
// per spec §4 (no helmet/sword except Marek's staff + Brann's blade), positions from spec.
```

## Owned by AGENT D — classes & skills (files: classes.ts, skills.ts)

```ts
// classes.ts must export:
export type ClassId = 'sentinel' | 'stormcaller' | 'shade'
export interface ClassDef {
  id: ClassId; name: string; blurb: string
  maxHp: number; hpPerLevel: number; dmgMult: number; attackSpeed: number
  moveSpeed: number; rollCooldown: number
  maxMana: number; manaPerLevel: number; manaRegen: number
  lanternColor: number
  loadout: { helmet: boolean; dualSwords: boolean; bladeEmissive?: number }
  skills: [SkillDef, SkillDef, SkillDef]
}
export interface SkillDef { key: string; name: string; icon: string; manaCost: number; cooldown: number; describe: string }
export const CLASS_DEFS: Record<ClassId, ClassDef>
export function showClassSelect(): Promise<ClassId>  // owns its DOM + <style>; resolves on pick (this click also unlocks audio)

// skills.ts must export:
export class SkillSystem {
  constructor(opts: {
    scene: THREE.Scene
    classId: ClassId
    hero: HeroLike                                  // see below
    getTargets: () => Hittable[]
    applyHits: (hits: { target: Hittable; amount: number; stagger?: number }[], opts?: { hitstop?: number; shake?: number }) => void  // (integrator)
    aim: () => THREE.Vector3 | null
  })
  cast(slot: 0 | 1 | 2): void
  update(dt: number): void
  slotState(slot: 0 | 1 | 2): { cdRemaining: number; cdMax: number; manaOk: boolean; unlocked: boolean }
  unlock(slot: 1 | 2): void      // quest rewards; slot 0 always unlocked; also auto-unlock at levels 3/5 (read hero.level)
}
// HeroLike (integrator provides on Hero):
interface HeroLike {
  position: THREE.Vector3; level: number; alive: boolean; damage: number
  mana: number; maxMana: number
  spendMana(cost: number): boolean
  /** temporarily drive hero motion (leap/spin/dash/blink). Returns false if dead/rolling/already overridden. tick returns the WORLD-SPACE DISPLACEMENT for that frame (collision applied by hero); teleportTo applies at start. */
  overrideMotion(opts: { duration: number; invulnerable?: boolean; anim?: string; teleportTo?: THREE.Vector3; tick?: (dt: number, t01: number) => THREE.Vector3 | null; onEnd?: () => void }): boolean
}
// Use vfx.ts spawnRing/spawnBurst/spawnTrail for all skill visuals; tone() for sounds; numbers from spec §6.
```

## Rules for all agents

1. Write ONLY your owned files. Read anything.
2. Self-contained DOM: create your own elements + inject a `<style>` tag from your module. Match the existing gothic HUD look (see style.css: serif, dark panels, purple #a855f7 accents).
3. TypeScript strict; no `any` unless unavoidable. `bunx tsc --noEmit` errors caused by not-yet-existing integrator APIs are EXPECTED — everything else in your files must be clean.
4. All numbers/names come from docs/DESIGN-v0.3.md. Deviate only when the spec is infeasible; note deviations in your report.
5. Performance: pool/cap transient objects; no per-frame allocations in hot loops where avoidable; no new PointLights per projectile.
6. Return JSON: { files: string[], integration: string (exact wiring steps for the integrator: imports, call sites, tick order, DOM expectations), deviations: string }
