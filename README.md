# Warptracker

**A fully open source, community-driven action RPG in the browser.**

Streams of evil — *warps* — are tearing into the world. You are the **Tracker**: an agent sworn to hunt them down and seal them, one rift at a time.

**Play it now: [warptracker.com](https://warptracker.com)** — no install, no account, no ads. Just click.

![MIT License](https://img.shields.io/badge/license-MIT-a855f7) ![Three.js](https://img.shields.io/badge/three.js-r185-white) ![Vite](https://img.shields.io/badge/vite-8-646cff)

## What is this?

A Diablo-style isometric ARPG built with [Three.js](https://threejs.org), TypeScript, and Vite — inspired by community-built games like *World of Claudecraft* proving that open, community-driven game development works.

Three founding principles:

1. **Fully open source.** MIT licensed, forever. The whole game — engine code, game design, balance numbers — lives in this repo.
2. **Fully free assets.** Every asset is either generated procedurally in code or licensed CC0/public domain. Nothing in this repo can ever be encumbered. (Characters are CC0 [Quaternius](https://quaternius.com) models; the world, VFX, and sound are procedural.)
3. **Community driven.** The roadmap is issues and discussions. If you want a feature, propose it or build it.

## The game

Action combat — not click-and-wait:

- **WASD** to move, **mouse** to aim.
- **Click** to attack; chain clicks (or hold) for a 3-hit combo with a heavy finisher.
- **SPACE** to dodge roll — full invincibility frames, short cooldown.
- Enemies **telegraph** their attacks (red flash, ground rings). Everything is dodgeable.
- **Warps** pour out warpspawn — skeletons, bats, dashing ghosts — and every warp's final spawn is an elite demon guardian. Kill everything a warp births and it collapses.
- **Seal every warp** to clear the rift. Each rift is harder. Level up, get stronger, go deeper.

## Development

```sh
bun install       # or npm/pnpm install
bun run dev       # local dev server
bun run build     # typecheck + production build to dist/
```

Deployment is a Cloudflare Worker serving static assets (`bun run deploy`).

## Project layout

```
src/
  main.ts          entry point
  game/
    game.ts        game loop, rift progression, orchestration
    world.ts       battlefield, lighting, procedural decoration
    hero.ts        the Tracker: movement, combat, leveling
    enemy.ts       warpspawn AI
    warp.ts        warp portals: spawning and sealing
    input.ts       click-to-move / targeting raycasts
    hud.ts         DOM HUD, floating combat text
    audio.ts       procedural WebAudio sound effects
    rng.ts         seeded RNG for stable world decor
```

## Contributing

All contributions welcome — code, game design, balance tuning, art (CC0 only), sound, docs. See [CONTRIBUTING.md](CONTRIBUTING.md).

Good first ideas: new enemy types, hero abilities, loot drops, boss warps, gamepad support, mobile controls, better VFX.

## Roadmap (community-shaped)

- [ ] Loot & itemization (weapons, armor, affixes)
- [ ] Hero abilities & skill choices per level
- [ ] Boss warps with mechanics
- [ ] Persistent progression (local save)
- [ ] Co-op multiplayer
- [ ] Soundtrack (CC0 / originally composed & donated)

## License

[MIT](LICENSE) — do anything you want with it. Assets policy: see [ASSETS.md](ASSETS.md).
