# Warptracker v0.3 — "Emberwatch and the Hollow Barrow"

Merged implementation spec. One coding session. Grounded in the existing code:
`hero.damage = 14 + level*3`, `RUN_SPEED = 6.8`, `ROLL_COOLDOWN = 1.4`, `WORLD_RADIUS = 46` (grows to 78),
`ENEMY_KINDS` rift-scaled stats, `spawnTelegraphRing` (enemy.ts), `.cd` overlay pattern (`hud.setDodge`),
three `.slot.locked` slots keyed 1/2/3 (index.html), `tone(freq, dur, type, gain, slideTo?, delay)` (audio.ts),
warp ring/core/motes/light VFX (warp.ts — reused by totems), `mulberry32` seeded scatter (world.ts),
`instantiate`/`findBone` (assets.ts). No new assets: knight/sword/helmet/skeleton/bat/ghost/demon GLBs + procedural geometry only.

**Naming (canonical, legally safe — original names in D2 cadence):**

| Name | Role |
|---|---|
| **Emberwatch** | the town (palisade Tracker camp) |
| **The Blackfen Moor** | outer danger zone (tier 1) |
| **The Gallows Reach** | deep moor (tier 2) |
| **The Barrowfield** | corrupted field around the dungeon (tier 3) |
| **The Hollow Barrow** | the dungeon |
| **Warpspire** | destructible warp totem |
| **The Warpheart** | final spire in the barrow vault |
| **Gorthul, Warden of the First Warp** | elite demon guarding the Warpheart |
| **Warden Serra** | watch captain, quests 1–2 + repeatable Hunts |
| **Old Marek, the Lorekeeper** | elder by the fire, quest 3 + lore |
| **Vess, the Stitcher** | healer (full heal on talk) |
| **Brann Coalhand** | smith (flavor, loot tease) |
| **Sentinel / Stormcaller / Shade** | the three Orders (classes) |

Forbidden-word grep before shipping: Tristram, Sanctuary, Horadrim, Deckard, Cain, Akara, Andariel, Wirt, verbatim "Stay awhile and listen", Exocet.

---

## 1. World layout (coordinates)

Single circular ground disc, one scene, no scene swaps. The dungeon interior lives in the same scene at a far XZ offset; entering is a hero teleport (ortho follow camera and FogExp2 come along for free).

New/changed constants in `world.ts`:

```ts
export const WORLD_RADIUS = 78            // was 46; ground disc radius = WORLD_RADIUS + 18 = 96
export const TOWN_CENTER  = new THREE.Vector3(40, 0, 40)
export const TOWN_RADIUS  = 16            // safe zone; palisade ring at r=15
export const GATE_DIR     = new THREE.Vector3(-1, 0, -1).normalize()   // gate faces the moor
export const BARROW_ENTRANCE = new THREE.Vector3(-46, 0, -46)
export const BARROW_FIELD_RADIUS = 20
export const DUNGEON_ORIGIN = new THREE.Vector3(400, 0, 400)
```

Why the diagonal: `camForward = (-1,0,-1)`, so **holding W walks from town toward the dungeon**. Town→barrow ≈ 121.6 units ≈ 18 s clean run at 6.8 u/s; with landmark fights it's a 3–5 minute first expedition.

### Map (x → right, z → down)

```
            x = -78                          x = +78
  z=-78  . - ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ - .
       /   [D]≡                             \     [D] Hollow Barrow entrance @ (-46,-46)
      |   BARROWFIELD (tier 3, r=20)         |    [G] Gallows Tree nest @ (-20,-8)
      |        \                             |    [S] Standing Stones nest @ (0,0)
      |        [G]  GALLOWS REACH (tier 2)   |    [W] Wrecked Wagon nest @ (20,24)
      |          \                           |    Old road links gate→W→S→G→D
      |           [S]                        |
      |             \                        |    TOWN "Emberwatch" @ (40,40) r=16
      |              [W]  BLACKFEN MOOR      |      ☼ campfire (spawn/respawn)
      |                \      (tier 1)       |      t elder tent  s smith stall
      |                 \\ <- gate arc       |      well + beacon stones (decor)
      |               /==TOWN==\             |
      |               | t  ☼  s |            |    DUNGEON INTERIOR @ (400,0,400),
       \              \========/            /       same scene, fog-hidden
         ` - ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ - '
```

### Landmarks (all procedural primitives, existing materials + two new: canvas 0x6b5a44, earth 0x1a1f16)

- **Old Road** — ~26 worn ground patches (`CircleGeometry(1.6–2.4)`, color 0x262233, y=0.02) along the polyline: gate (29,29) → (20,24) → (8,12) → (0,0) → (-12,-4) → (-20,-8) → (-34,-28) → (-46,-46). This is the navigation system; no minimap.
- **Nest 1 — Wrecked Wagon** (20,24), tier 1: broken cart (boxes + 2 cylinder wheels, one off), **1 Warpspire**, guards: 3 skeletons + 1 bat. Visible from the gate — the tutorial fight.
- **Nest 2 — Standing Stones** (0,0), tier 2: 7 monoliths (existing pillar recipe ×2.5 scale) in a circle r=6, **1 Warpspire**, guards: 3 skeletons + 2 ghosts.
- **Nest 3 — Gallows Tree** (-20,-8), tier 2/3: one giant dead tree (existing tree gen, h=9, trunk radius ×3) with a hanging cage (`TorusGeometry` bands + box frame, swings on `sin(t)`), **1 Warpspire**, guards: 2 ghosts + 3 bats, plus **one roaming elite demon** patrolling a 14-unit loop between here and the Barrowfield.
- **The Barrowfield** (r=20 around (-46,-46)): 9 burial mounds (`SphereGeometry` scaled (2.4, 0.8, 1.7), earth 0x1a1f16), bone piles (existing boneMat dodecahedrons), 2 grave-warden demons standing vigil.
- **Barrow entrance** at (-46,-46): earthen mound (squashed sphere r=7, y-scale 0.45), stone lintel doorway (two box jambs 0.8×3×0.8 boneMat + lintel box), black inner plane (`MeshBasicMaterial 0x000000`), 2 torches. Trigger: hero within 1.4 of the door point → 250 ms fade-to-black (reuse intro overlay div) → teleport to `DUNGEON_ORIGIN + (0,0,5)` facing -Z → snap lighting to `dungeon`.
- **Ambient roamers:** 4 seeded packs of 2 (skeleton pairs near rocks, bats wide-ranging) across radius 18–60, tier by `dangerTier(spawnPos)`; a dead pack respawns after 30 s only while the hero is >30 units away. Kill supply for Quest 1.
- **Scatter:** keep existing `scatterDecor`, reseeded; reject points within TOWN_RADIUS+2 of town, 3 of road patches, or BARROW_FIELD_RADIUS of the entrance.

### Dungeon interior (local coords relative to DUNGEON_ORIGIN)

All walls `BoxGeometry`, h=3.5, thickness 0.8, stone 0x2b2530; floor = one plane 0x201b28; **no ceiling** (top-down camera + fog 0.045 + black background close the horizon). ~14 wall AABBs registered with collision. Doorways = 3-unit gaps in wall runs. If a near wall covers the hero, drop that wall's height to 1.2 (parapet trick) — decide per room in playtest.

- **Entry chamber** 12×12 at (0,0): exit stairs against +Z wall (3 shallow box steps + trigger → teleport back to the mound front, snap to `barrows` lighting). One torch pair.
- **Corridor** 4 wide × 18 long heading -Z; torches every 9 units, alternating sides.
- **Crypt** 10×10 off corridor-left at (-9,-12): 4 box sarcophagi, **Warpspire (140 HP)** + 4 skeletons.
- **Ossuary** 10×10 off corridor-right at (9,-16): bone piles, **Warpspire (140 HP)** + 5 bats.
- **The Vault** 20×16 at (0,-28): **the Warpheart (320 HP)** against the far wall, full-size warp visual, guarded by **Gorthul** (elite demon, 1.6× scale) + 2 ghosts. At the back wall: a sealed black-stone door with a faint red emissive seam — walking within 2 shows marker text *"The stream runs deeper."* (Act II tease, no interaction logic.)

### Engine fixes (required)

- **Shadow camera:** the moon's static ±60 shadow box fails at radius 78. Each tick: `moon.position.copy(hero.position).add(new THREE.Vector3(-30,40,-20)); moon.target.position.copy(hero.position)`; add `moon.target` to the scene; shrink shadow box to ±40.
- **Collision:** replace `hero.step()`'s `WORLD_RADIUS + 10` clamp (and the enemy equivalent at +12) with `resolveCollision(next)` exported from `world.ts` (~40 lines): (a) world circle r=WORLD_RADIUS+6, skipped when `x > 250` (in dungeon); (b) palisade band r 14.4–15.6 around TOWN_CENTER, passable only within the 50° gate arc facing GATE_DIR; (c) flat list of dungeon wall AABBs. Shared by hero and enemies.
- **Hero spawn/respawn:** `(0,0,0)` → `TOWN_CENTER + (0,0,2)` (beside the campfire). Death anywhere, including the dungeon, respawns here; death overlay text becomes *"You died. The fire calls you back."*; respawn snaps lighting to `town`.
- **Delete the rift loop:** `startRift`, `Warp` auto-spawning, `riftTransition` are removed. All content is placed at build time by `town.ts`/`moor.ts`/`dungeon.ts`.

---

## 2. Zones & rules

New module `zones.ts`:

```ts
export type ZoneId = 'town' | 'fields' | 'deepmoor' | 'barrows' | 'dungeon'

export function zoneAt(p: THREE.Vector3): ZoneId {
  if (p.x > 250) return 'dungeon'
  if (p.distanceTo(TOWN_CENTER) < TOWN_RADIUS) return 'town'
  if (p.distanceTo(BARROW_ENTRANCE) < BARROW_FIELD_RADIUS) return 'barrows'
  return p.distanceTo(TOWN_CENTER) < 72 ? 'fields' : 'deepmoor'
}

export function dangerTier(p: THREE.Vector3): 0 | 1 | 2 | 3
// town→0, fields→1, deepmoor→2, barrows & dungeon→3
```

**Enemy scaling:** `dangerTier` replaces the old `rift` scalar. An enemy's stats use `r = dangerTier(spawnPos) + huntsCompleted` in the existing `ENEMY_KINDS.hp/dmg/xp` lambdas (huntsCompleted = 0 until the post-chain Hunt loop).

**ZoneDirector** (in `zones.ts`, owned by `game.ts`, `update(dt, heroPos)` each tick): detects zone change → `hud.showBanner(displayName)` (larger serif style: `Georgia, 'Palatino', serif`, letter-spaced, dark gold `#c8a35a`) and lerps `scene.fog` color/density, hemi colors/intensity, moon color/intensity, `scene.background` toward the target over **1.6 s** — except entering/leaving `dungeon`, which **snaps** (it's a teleport). Zone display names: "Emberwatch" / "The Blackfen Moor" / "The Gallows Reach" / "The Barrowfield" / "The Hollow Barrow".

### Lighting table (exact)

| Zone | bg / fog color | fogDensity | hemi sky / ground / int | moon color / int | Local lights |
|---|---|---|---|---|---|
| town | 0x0a0712 | 0.014 | 0x8a7a64 / 0x3a2c1e / 4.0 | 0x9ab2dc / 2.2 | campfire PointLight 0xff8c3b int 40 dist 26 flicker ±20%; 2 gate braziers 0xffa050 int 14 dist 10 |
| fields | 0x05040a | 0.022 | 0x6a6494 / 0x241e38 / 4.4 | 0x9ab2dc / 2.6 | (current values — baseline moor) |
| deepmoor | 0x04030a | 0.027 | 0x5c5a86 / 0x1e1a30 / 4.0 | 0x8aa2cc / 2.3 | spire nest glow (purple, from totem code) |
| barrows | 0x040604 | 0.032 | 0x54663f / 0x141c10 / 3.4 | 0x7a92b4 / 1.8 | sickly green cast; 2 torches at barrow door 0xff9a3d int 16 |
| dungeon | 0x030203 | 0.045 | 0x3a2a1c / 0x120a06 / 1.6 | — / 0.35 fill, castShadow off | wall torches 0xff9a3d int 18 dist 12 decay 1.8, one per ~9 units of wall; vault warp light |

The hero's existing lantern (0xffc477, int ~13 flickering, dist 22) is unchanged — in the dungeon it becomes the light-radius signature.

### Safe-zone rules (all keyed on `zoneAt(pos) === 'town'`)

1. Nothing ever spawns within TOWN_RADIUS + 12 of TOWN_CENTER.
2. Enemies never path inside TOWN_RADIUS (rejected in `Enemy.move`, mirrors the world-edge clamp); if the hero is in town, enemies drop aggro and leash back to their spawn anchor.
3. Hero out-of-combat regen ×5 while in town (existing `sinceDamaged > 4` gate; 2.5 → 12.5 hp/s).

### Town of Emberwatch (module `town.ts`, ~200 lines, all primitives)

- **Palisade:** ~64 stakes on ring r=15: `CylinderGeometry(0.14, 0.2, h, 5)`, h = 2.6–3.4 via mulberry32, cone tips, tilt ±0.06 rad, radial jitter ±0.3, one material 0x3a2c1e, merged group or InstancedMesh. Skip stakes inside the 50° gate arc facing GATE_DIR. Two thicker gate posts (r 0.3, h 4.2), each with a brazier (cylinder bowl + additive cone flame + PointLight).
- **Campfire** at TOWN_CENTER: ring of 7 dodecahedron stones, 3 crossed log cylinders, flame = 2 nested additive cones (0xffa640 / 0xffe0a0) scale-jittered on `sin(t*9)`/`sin(t*13)`, flickering PointLight. World spawn & respawn point.
- **Elder's tent** at TOWN_CENTER + (-5,0,5): `ConeGeometry(2.6, 3.4, 7)` canvas 0x6b5a44, darker door-slit plane, center pole.
- **Smith stall** at TOWN_CENTER + (6,0,-2): 4 posts, slanted `BoxGeometry(5, 0.12, 3.6)` roof, counter, anvil (two boxes on a cylinder), quench barrel.
- **Well** at TOWN_CENTER + (5,0,6): stone cylinder ring + tiny gabled roof on two posts. Decor only.
- **Beacon stones** at TOWN_CENTER + (-6,0,-6): knee-high circle of 5 stones, one pulsing faint purple — dormant waypoint homage, no logic, hook for v0.4 fast travel.
- **Scatter:** 3 crates, 2 barrels, a handcart (boxes + 2 cylinder wheels).

---

## 3. Warp totems (Warpspires) — module `totem.ts`, replaces `warp.ts` spawning

A **Warpspire** is a destructible obelisk. It spawns its **fixed guard pack once at construction** and is **warded (immune) while any guard lives**. No streaming spawns, no budget, no auto-close.

### Visuals (procedural, reusing warp.ts VFX verbatim where noted)

- Base: `CylinderGeometry(1.0, 1.25, 0.5, 6)`, color 0x231f30.
- Ring: the existing warp torus (`TorusGeometry(1.6, 0.14, 10, 40)`, emissive 0xa855f7 @1.6), rotating, at y 0.25.
- Shaft: 3 stacked `BoxGeometry(0.62, 0.95, 0.62)` blocks, color 0x141021, roughness 0.35, at y 1.0/1.9/2.8, yaw 0/0.35/0.7 rad, scale 1.0/0.85/0.7 — a screwed obsidian spire.
- 4 rune slivers: `BoxGeometry(0.05, 0.7, 0.05)`, emissive 0xa855f7 @1.8, on shaft faces.
- Crystal: `OctahedronGeometry(0.42)` at y ≈ 3.6, emissive 0xc084fc @2.2, bobbing `sin(t·2)·0.12`, spinning.
- Existing 5 orbiting motes + `PointLight(0x9333ea, 26, 16, 1.9)` at y 2.5.
- **Ward sphere:** `SphereGeometry(2.1, 24, 16)`, `MeshBasicMaterial 0x7c3aed` additive, opacity pulsing 0.08–0.16, visible only while guards live.
- Nest dressing: the existing warp ring/core/motes at 60% scale beside each overworld spire.

### Attackability

Introduce `Hittable = { position: Vector3, radius: number, alive: boolean, takeDamage(amount: number, knockback: Vector3 | null): void }`. `hero.resolveHits(targets: Hittable[])`; `Game` passes `[...enemies, ...totems.filter(t => t.alive)]`. Totem `radius = 1.1`. Skill damage hits totems through the same list. Warded hits: 0 damage, "WARDED" floating text, ping `tone(700, 0.06, 'sine', 0.04, 500)`.

### Numbers

| Spire | HP | Guards |
|---|---|---|
| Wagon (tier 1) | 110 | 3 skeletons + 1 bat |
| Stones (tier 2) | 110 | 3 skeletons + 2 ghosts |
| Gallows (tier 2/3) | 110 | 2 ghosts + 3 bats (+ nearby patrolling elite demon, not ward-linked) |
| Crypt / Ossuary | 140 | 4 skeletons / 5 bats |
| **Warpheart** | **320** | **Gorthul** (elite demon ×1.6 scale, r=4 stats) + 2 ghosts |

Guards spawn in a ring 2.5 units out; leash: aggro at 9 units (11 for overworld nests), return past 16, never respawn. On Hunt N (post-chain): totem HP 110+30N, Warpheart 320+60N.

**Gorthul:** `name` field on Enemy → on aggro, `hud.showBanner('Gorthul, Warden of the First Warp')` in a red/gold `.boss` banner variant. Extra attack: **nova pulse every 6 s** — reuse the demon-slam red telegraph ring (1.0 s windup, radius 4.5, 14 damage). Thin top-center HP bar labeled "THE WARPHEART" while the hero is in the vault (tracks Warpheart HP).

### Feedback & destruction

- **Hit:** crystal emissive spikes to 5 (decays 0.15 s), 4–6 tetrahedron shards eject ballistically, damage number via `spawnFloatingText`, `hitstop(0.03)`, thunk `tone(150, 0.08, 'square', 0.06, 100)`.
- **Crack stages at 66%/33% HP:** shaft segments tilt ±0.06 rad, rune slivers brighten, motes orbit 1.5×, light flickers, `tone(90, 0.14, 'sawtooth', 0.08, 45)`.
- **Ward break** (last guard dies): sphere scales to 1.6× fading over 0.4 s, chime `tone(880, 0.3, 'sine', 0.08, 220)` + `tone(520, 0.2, 'triangle', 0.06, 130, 0.05)`, floating text "THE WARD BREAKS".
- **Destruction ("sealing"):** t0 final hit → `hitstop(0.12)`, `shake(0.4)`; 0–0.25 s crystal rises +1.2 and flares white; at 0.25 s the spire bursts — 6 box chunks fly out (v 4–7, up 3–6, gravity 14, spin, sink after 1.5 s), torus ring expands to 3.2× while fading (the seal wave), motes scatter, light spikes to 90 then decays 0.7 s, and a **20-damage / 1.5-knockback AoE (r=4) hits enemies** — rewards fighting near it. Sound: `tone(160, 0.5, 'sawtooth', 0.09, 40)` + `tone(300, 0.6, 'sine', 0.07, 900, 0.1)` + existing `audio.warpClosed()` at +0.15 s. Residue: base recolored 0x3a3547 + permanent pale-blue seal ring decal (`RingGeometry(1.1, 1.35)`, 0x93c5fd, opacity 0.3; cap 12, oldest removed).
- **Warpheart extra:** 300 ms white DOM screen flash, `audio.riftCleared()`, banner "The warp is sealed. The moor breathes again."

---

## 4. NPCs & dialogue

### NPC tech (`npc.ts`)

Each NPC = `instantiate('knight', 1.8)` with **no helmet, no sword** (skip `attachGear`), materials cloned per-instance (same clone pattern as `Enemy.flashMats`) and tinted via `traverse` + `material.color.multiply(tint)`. Anim: `anim.has('Idle') ? 'Idle' : 'Idle_swordRight'`, looped. NPCs slerp yaw to face the hero within 4 units (reuse the hero smooth-turn snippet).

| NPC | Tint | Position | Notes |
|---|---|---|---|
| Warden Serra | 0x8a3b3b | TOWN_CENTER + GATE_DIR·10 ≈ (32.9, 32.9), facing the moor | quests 1, 2, Hunts |
| Old Marek | 0x9a94a8 | (38, 42), by the fire, scale 1.65 (seated fake) | holds `instantiate('sword', 1.5)` tinted 0x4a3826 point-down as a staff; quest 3 |
| Vess | 0xcbb27a | (36, 44), beside the tent | full heal on talk |
| Brann Coalhand | 0x555055 | (45, 38.5), at the anvil | holds dark-tinted sword model |

### Interaction

- `input.ts`: `KeyE` → edge-triggered `takeInteractPressed()` (mirror `takeDodgePressed`).
- Within **2.4 units** of the nearest NPC → persistent projected DOM label above head: `E — Serra` (new `hud.setMarker(id, worldPos | null, text, cls)` — same projection math as `spawnFloatingText` but a persistent element updated per frame).
- Quest markers via the same API: gold **!** above a giver with a quest available, gold **?** when ready to turn in (`.quest-mark`, 20 px, CSS bob).
- E opens the dialogue panel (`npc.ts` owns it): fixed bottom-center above the action bar, `min(560px, 80vw)`, bg `rgba(8,6,14,0.85)`, border `1px solid rgba(168,85,247,0.35)`, name 12 px uppercase `#c4b5fd` letter-spacing .12em, body 15 px `#e7e4f0` serif, hint "E ▸" right-aligned. E or click advances one line; the last line auto-accepts/turns in quests; walking >3.5 units away closes it. World keeps running (town is safe). Per-line blip: `tone(300, 0.05, 'sine', 0.04)`.

### Full dialogue text

**Warden Serra**
- Q1 offer: "Another Tracker. Good. The last one came back in pieces." → "The moor crawls with warpspawn. Thin them — eight heads — and I'll believe your sword is more than polish."
- Q1 active: "Eight. Count them, or the moor will count you."
- Q1 turn-in → Q2 offer: "So you can bite. The spawn pour from spires — black nails the warp drives into the earth." → "Three stand out on the moor. Their wards break when their keepers die. Shatter all three."
- Q2 active: "A spire's ward dies with its keepers. Kill the pack, then break the stone."
- Q2 turn-in: "The moor is quiet. But the ground still hums, Tracker. Talk to Marek — he's felt it too."
- Post-chain (offers a Hunt): "The moor never stays clean. There's always another hunt."

**Old Marek, the Lorekeeper**
- Greeting: "Sit by the fire awhile, Tracker. Listen." → "The warps aren't wounds. Wounds close. These are doors — and doors are held open." *(cadence homage; never the verbatim catchphrase)*
- Q3 offer: "Beneath the barrow, something anchors them all. A heart of the stream. Break it, and the moor breathes again."
- Q3 active: "The barrow lies at the far edge of the moor, past the gallows tree. Follow the old road down."
- Q3 turn-in (Act II tease): "You felt it die? That was one knot in one thread. The stream flows from somewhere far darker. Rest. Then we follow it."

**Vess, the Stitcher** — every talk fully heals (`hero.hp = maxHp`, floating text "+HP", soft chime `tone(660, 0.15, 'sine', 0.05)`).
- "Bleeding? Sit. I've thread and fire, and neither cares how much you scream."
- "The warp leaves marks under the skin. Yours are… shallow. Keep them that way."
- After Q3: "You came back whole. That's new around here."

**Brann Coalhand**
- "Don't touch the forge. Don't touch the blades. Talk, if you must."
- "Bring me warp-iron from the deep barrow someday. I'll hammer you something that sings." *(v0.4 loot tease)*

---

## 5. Quest chain (`quest.ts`)

`QuestLog` = linear chapter machine, `chapter: 0–4`, per-quest `progress`. Game code calls `questLog.notify('kill' | 'totem' | 'heart')`. Persistence: one localStorage key `wt.save = { class, chapter, huntsCompleted, level, xp }` written on quest/level events; absent key = fresh start.

| # | Quest | Giver | Objective / trigger | Reward |
|---|---|---|---|---|
| 1 | **First Blood** | Serra | Slay 8 warpspawn (any kill counts, guards included; `notify('kill')`) | 60 XP + full heal |
| 2 | **Break the Spires** | Serra | Shatter the 3 overworld Warpspires (wagon/stones/gallows; `notify('totem')`; spires destroyed before accepting count retroactively) | 120 XP + **unlock skill slot 2** (`hero.unlockSkill(1)`) |
| 3 | **The Heart Below** | Marek | Descend into the Hollow Barrow and destroy the Warpheart (`notify('heart')`; retroactive if pre-killed) | 250 XP + **unlock skill slot 3** (`hero.unlockSkill(2)`) + epilogue banner + Hunts unlocked |
| 4 | **The Long Hunt** (repeatable) | Serra | Respawn the 3 overworld spires (at their nest positions, fresh guards) + the Warpheart, with `r = tier + huntsCompleted` and totem HP 110+30N / 320+60N. Seal all four. | 100·N XP + full heal; banner "Hunt N complete" |

The dungeon is never gated — danger tiers self-gate; Q3 just directs.

**Feedback:** accepting fires `hud.showBanner('New hunt: First Blood')` + `tone(392, 0.12, 'triangle', 0.08)` + `tone(523, 0.2, 'triangle', 0.08, undefined, 0.1)`; completion plays a 3-note rising triangle jingle (reuse the `riftCleared` chord shape, brighter).

**Quest tracker UI** — `#quest-tracker`, fixed top-right 16 px, ~240 px wide, bg `rgba(10,7,16,0.6)`, border `1px solid rgba(168,85,247,0.25)`: header "HUNT" (11 px uppercase `#a855f7`, letter-spacing .18em), quest name 14 px `#e7e4f0`, objective 12 px `#b9b3c9` — "Warpspawn slain **5/8**" / "Spires shattered **1/3**". Counter span gets `.tick` on increment (scale 1.15 + flash `#c4b5fd`, 200 ms). Ready state: gold `#fbbf24` "Return to Warden Serra." Top bar: replace `Rift I` label with the current zone name; repurpose `Warps:` as `Spires: n` (remaining).

**First 10 minutes:** wake at the Emberwatch fire → Serra at the gate (!) → out the gate holding W → wagon fight → stones → gallows → Barrowfield dread → the Hollow Barrow → seal the Warpheart → run home a hero.

---

## 6. Classes & skills

Fiction: Trackers swear to one of three **Orders**. All three reuse the knight model; differentiation = loadout (helmet on/off, second sword in the left palm via `findBone(root, 'palm', 'l')` — same attach code as the right hand), lantern color, subtle emissive blade tint, stats, skills.

**Class select ("Choose your Order")** replaces the intro-overlay flow in `game.ts` (in `classes.ts`): three DOM cards (name, one-liner, Vitality/Force/Swiftness pip rows 1–5, three skill names). Click or press 1/2/3 to select, Enter/click to begin (this interaction unlocks audio, preserving `onFirstInteraction`). Persist `wt.class`; pre-highlight saved card on revisit but require confirm.

| | **Sentinel** | **Stormcaller** | **Shade** |
|---|---|---|---|
| Fantasy | "A bulwark of the old Orders — breaks warpspawn lines with steel and fury." | "Channels the storm between worlds; the warp itself answers." | "A knife in the dark — fast, and everywhere at once." |
| Loadout | sword + helmet (current hero) | sword (violet emissive blade), no helmet | dual swords, no helmet |
| Lantern | 0xffc477 | 0xa855f7 | 0x7dd3fc |
| Max HP / per level | 125 / +18 | 80 / +10 | 90 / +13 |
| Melee dmg mult | ×1.15 | ×0.85 | ×1.0 |
| Attack speed | ×1.0 | ×1.0 | ×1.12 (combo `time`/`hitAt` ×0.89) |
| Move speed | 6.3 | 6.8 | 7.5 |
| Roll cooldown | 1.4 s | 1.4 s | 1.0 s |
| Max mana / per level | 40 / +4 | 70 / +7 | 55 / +5 |
| Mana regen | 3.0/s | 6.0/s | 4.5/s |

`hero.damage = Math.round((14 + level*3) * classDef.dmgMult)` — level 1: Sentinel 20, Stormcaller 14, Shade 17. HP-per-level replaces the flat +14 in `gainXp()`; level-up refills HP and mana.

**Skill unlocks:** slot 1 at start; slot 2 at level 3 **or** Quest 2 reward, whichever first; slot 3 at level 5 **or** Quest 3 reward. Locked slots keep `.locked` styling + "Lv 3"/"Lv 5" label. `hero.unlockSkill(i)` is the shared hook.

### Skills (keys 1/2/3, edge-triggered `Digit1..3` in input.ts; blocked during roll/death; `dmg` = per-class `hero.damage`)

All skill damage routes through one shared `game.applySkillHits(hits)` reusing the `onStrike` floating-text/hitstop/shake/kill pipeline, hitting the same `Hittable` list (enemies + unwarded totems). Enemies gain `applyStagger(seconds)` (forces stagger state with custom duration; elites take 40% of it).

**SENTINEL** *(Leap Attack / Whirlwind / War Cry homages)*
1. **Sunder** — 12 mana · 5 s CD. Leap to aim (clamp 8 u), 0.5 s parabola (peak 3 u, hero state `'leap'`, invulnerable airborne). Landing AoE r=3.2, `2.2×dmg` (44 @ lvl 1), `applyStagger(0.8)`. VFX: telegraph-ring recipe in amber 0xf59e0b scaling 0.3→3.2 over 0.35 s + 6 gray dust spheres. SFX: `tone(160,0.35,'sine',0.06,500)`; land `tone(60,0.25,'sawtooth',0.12,35)` + shake 0.35 + hitstop 0.06.
2. **Steelstorm** — 18 mana · 8 s CD. Channel 1.6 s (state `'spin'`): move 4.2 u/s steered by WASD; every 0.27 s hit all within 2.6 u for `0.6×dmg` (12/tick, 72 total). Dodge cancels. VFX: spin model 18 rad/s + counter-rotating white additive torus (1.9, 0.05) at y 1.1, opacity 0.35. SFX per tick: `tone(120+tick*15,0.06,'square',0.04,80)`.
3. **Warcall** — 20 mana · 12 s CD. Instant shout r=5.5, `0.7×dmg` (14) to all, `applyStagger(2.0)` (elites 0.8 s). VFX: two expanding gold rings (0xfacc15, 0→5.5 over 0.4 s, second delayed 0.12 s) + shake 0.3. SFX: `tone(90,0.5,'square',0.12,70)` + `tone(135,0.5,'square',0.08,100,0.02)`.

**STORMCALLER** *(Bolt / Nova / Teleport homages)*
1. **Warp Bolt** — 8 mana · 0.6 s CD. Projectile toward aim: speed 16, range 14, hit radius 0.35, `1.4×dmg` direct (20) + `0.7×dmg` (10) splash r=1.2. VFX: additive sphere 0xc084fc r=0.16 + 3 ghost-sphere trail every 40 ms fading 0.25 s (no per-bolt PointLight). Impact: 0.8 u violet ring, 0.2 s. SFX: cast `tone(760,0.12,'sine',0.06,240)`; impact `tone(300,0.08,'sawtooth',0.05,90)`.
2. **Stormburst** — 22 mana · 6 s CD. Ring expands 0→6 u over 0.45 s; each enemy hit once as the 0.8 u band passes: `1.8×dmg` (25) + `applyStagger(0.4)` (per-cast `Set<Enemy>`). VFX: telegraph-ring mesh in cyan 0x22d3ee additive, opacity 0.6→0; hit enemies flash cyan (add color param to `setFlash`). SFX: `tone(900,0.35,'sawtooth',0.07,140)`.
3. **Riftstep** — 15 mana · 4 s CD. Instant blink to aim (clamp 9 u; validate with `resolveCollision` so walls veto). 0.15 s post-blink i-frames. VFX: violet ring + 5 rising additive spheres at origin and destination, fading 0.3 s. SFX: `tone(500,0.1,'sine',0.05,1200)` then `tone(1200,0.12,'sine',0.05,400,0.08)`.

**SHADE** *(Multishot / trap / Charge homages)*
1. **Fan of Blades** — 10 mana · 2.5 s CD. 5 projectiles in a 50° fan (±25°): speed 20, range 10, hit radius 0.3, no pierce, `0.8×dmg` each (14). VFX: elongated additive spheres 0xe2e8f0 (0.12 scaled (0.6,0.6,2.2)). SFX: `tone(880,0.05,'square',0.035,660,i*0.03)` for i in 0..2.
2. **Sting Trap** — 18 mana · 9 s CD. Deploy at aim (max 7 u): zaps nearest enemy within 4 u every 0.8 s for `0.9×dmg` (15), lifetime 6 s (~105 total). Max 2 active; third replaces oldest. Untargetable. VFX: dark cone (0.18, 0.5) + red tip sphere; zap = thin cyan additive cylinder stretched trap→target, alive 0.08 s. SFX: deploy `tone(220,0.1,'triangle',0.06,330)`; zap `tone(1400,0.07,'sawtooth',0.045,500)`.
3. **Phase Strike** — 14 mana · 6 s CD. Dash 6 u toward aim over 0.22 s (state `'dash'`, full i-frames, reuse roll movement); every enemy within 0.9 + its radius of the swept segment takes `1.5×dmg` (26) once. VFX: 4 fading blue-gray rings along the path. SFX: `tone(340,0.18,'sine',0.07,90)` + hitstop 0.05 on hit.

**Balance sanity (level 1, tier 1: skeleton 34 HP, demon 175):** Sunder one-shots a skeleton pack, 4 hits on a demon; full Steelstorm 72; 2 Warp Bolts per skeleton; point-blank Fan lands 70 on a demon. Nothing outclasses the basic combo (17–20 ×3 with 1.8× finisher) — skills are burst/AoE/utility spikes gated by mana + CD.

---

## 7. Mana & UI additions

- **Blue mana globe** mirroring the red health globe, **right of the action bar** (health left — the dual-globe flanking layout is the homage). Markup mirrors `#health-fill`/`#health-text`: `#mana-fill` (bottom-anchored height %, gradient `#1d4ed8 → #60a5fa`), `#mana-text`; same CSS, right-positioned.
- `hero.mana`/`hero.maxMana`; flat per-class regen/s, ticked in `Hero.update` (regens during everything except death). Respawn and level-up refill both globes.
- `hero.spendMana(cost): boolean` — on failure: no cast, 0.3 s blue globe pulse (CSS class), `tone(160, 0.12, 'sine', 0.04, 110)` dry click.
- **Skill slots 1/2/3:** each gets a `.cd` overlay driven exactly like `setDodge` (height % = remaining/max) + a `.no-mana` class (desaturated blue dim) when `hero.mana < cost`. New `hud.setSkillSlot(i, cdRemaining, cdMax, manaOk, unlocked)`. Icons: unicode glyphs per class — ⤵ ⟳ ◉ / ✦ ◎ ⌁ / ⋔ ▲ ➤. Locked slots show "Lv 3"/"Lv 5".
- **Other HUD:** `#quest-tracker` (section 5), `hud.setMarker` persistent world-projected labels (E-prompts, !/? markers, door tease), `.boss` banner variant (red/gold), thin "THE WARPHEART" bar, death overlay text change, top-bar zone name + `Spires: n`.
- Banners/dialogue/zone text move to system serif (`Georgia, 'Palatino', serif`), letter-spaced, dark gold `#c8a35a`. No Exocet-lookalike fonts.

---

## 8. Homage checklist (MUST items shipped by this spec)

| # | D2 signature | Where in this spec |
|---|---|---|
| M1 | Encampment palisade → gate → danger rhythm | Emberwatch, one gate arc, tiered moor (§1–2) |
| M2 | The camp fire at the heart | Campfire = spawn/respawn point (§2) |
| M3 | Elder by the fire, "listen" cadence (original words) | Old Marek (§4) |
| M4 | Dual red/blue globes flanking the skill bar | Mana globe (§7) |
| M5 | Kill-the-source instinct (Fallen Shaman) | Warded Warpspires + guard packs (§3) |
| M6 | Den-of-Evil act cadence: cull → mechanic → dungeon climax | 3-quest chain (§5) |
| M7 | Named unique + epithet banner | Gorthul, Warden of the First Warp (§3) |
| M8 | Dungeon darkness / light radius | Hollow Barrow lighting snap + hero lantern (§1–2) |
| M9 | Death → return to the town fire | Respawn at campfire, overlay text (§1) |
| M10 | Class identity, skills on hotkeys, mana-costed | 3 Orders × 3 skills (§6) |
| M11 | Zone-entry name text | ZoneDirector banners (§2) |

---

## 9. Module / file breakdown (~10 new modules, one session)

**New (10):**
| File | Contents | ~lines |
|---|---|---|
| `zones.ts` | ZoneId, `zoneAt`, `dangerTier`, ZoneDirector + lighting table | 130 |
| `town.ts` | palisade, campfire, tent, stall, well, beacon stones, scatter | 200 |
| `moor.ts` | old road, 3 nests, gallows tree, barrowfield, ambient roamer packs | 180 |
| `dungeon.ts` | barrow mound + door trigger, interior rooms, wall AABBs, torches, exit stairs, Act II door | 160 |
| `totem.ts` | WarpSpire class (Hittable), ward, cracks, destruction, seal decals; replaces warp.ts spawning (keep ring/core/mote builders) | 180 |
| `npc.ts` | NPC class (knight recolor, face-hero), dialogue panel DOM, E-interaction | 140 |
| `quest.ts` | QuestLog chapters 0–4, notify(), tracker UI wiring, localStorage `wt.save` | 120 |
| `classes.ts` | CLASS_DEFS data (stats + SkillDef[3], all constants), class-select DOM screen, `wt.class` | 150 |
| `skills.ts` | SkillSystem.cast/update (dispatch on kind), cooldowns, projectile pool, traps, nova rings | 220 |
| `vfx.ts` | `spawnRing(scene, pos, color, fromR, toR, time)` (generalizes spawnTelegraphRing), puffs, trails, chunk bursts | 80 |

**Touched (9):** `world.ts` (constants, `resolveCollision`, moon-follows-hero, scatter rejection zones), `game.ts` (delete rift loop, ZoneDirector, quest/skill/totem wiring, `applySkillHits`, Hittable list), `hero.ts` (classDef ctor param, mana + `spendMana`, states `leap|spin|dash`, per-class combo timing/speed/HP, dual-sword/no-helmet/lantern, `unlockSkill`, `resolveHits(Hittable[])`, spawn at TOWN_CENTER, collision via `resolveCollision`, town regen ×5), `enemy.ts` (`applyStagger`, `setFlash(color)`, `name` field, town leash + no-path rule, tier-based `r`, leash-to-anchor, Gorthul nova), `input.ts` (KeyE, Digit1–3 edge triggers), `hud.ts` (`setMana`, `setSkillSlot`, `setMarker`, boss banner class, Warpheart bar, zone label), `audio.ts` (~12 one-line `tone()` recipes from §3–6), `index.html` (mana globe, quest tracker, dialogue panel, class-select cards, slot icons), `style.css` (all of the above + serif banner pass).

**Implementation order (dependency-safe):** world constants + collision + moon fix → zones → town + npc (walkable hub) → totem + moor (combat world) → quest + hud additions → dungeon → classes + mana + skills + vfx → Hunt loop + polish audio.

Bundle impact ≈ 0 new assets, ~1,600 lines of TS/CSS. Every visual is 1–6 primitives with existing materials plus canvas (0x6b5a44) and earth (0x1a1f16).

## Cut for scope (v0.4 candidates)

Kael/Bram the gate-scout NPC (Serra already stands at the gate; one fewer dialogue set)
Vessa the Forsworn named-unique quest + The Gibbet landmark (requires a new knight-model enemy variant; fold into v0.4 as quest 2 of Act I-B)
Well of Light heal mechanic (well stays as decor; Vess already full-heals — two heal fountains is redundant)
Warpstone town-portal channel (T key, 3s interrupt-on-damage) — earns its keep only after the map grows again
Health potion drops / Q-to-chug gradual heal (proto-loot loop; deferred with itemization to v0.4)
Rain + wind ambience (THREE.Points + noise bed) — pure polish, first thing to cut
Fireside crackle noise-buffer audio helper (campfire is visual-only this release)
Run-lean posture tilt (one line, but zero-priority polish)
HUD compass arrow to active quest target (old-road ground patches are the navigation system)
Trickle-spawning totems (homage lens variant) — rejected in favor of warded totem + fixed guard pack, which matches the user's "not auto-spawners" direction
Two-class fallback (homage lens Blademaster/Embermage) — superseded by the three full Orders; if the session runs long, ship Sentinel first and gate the other two cards as "coming soon"
Functional waypoint/beacon-stone fast travel (stones remain as dormant decor hook)
Mana potions, loot/itemization, stat/skill points, hireling, stash, gamble vendor, music — v0.4+
Per-room parapet wall-height tuning beyond the single fallback rule (playtest-time decision, not spec)
Dungeon door gating on quest 3 accept (dungeon always open; danger tier self-gates and retroactive credit keeps the quest honest)
