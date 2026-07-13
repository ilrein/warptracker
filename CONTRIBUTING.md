# Contributing to Warptracker

Thanks for wanting to help seal the warps. This project is community driven — contributions of every kind are welcome.

## Ground rules

1. **Everything is MIT.** By contributing you agree your contribution is MIT licensed.
2. **Assets must be free.** Procedural (generated in code) is preferred. Otherwise CC0/public domain only — see [ASSETS.md](ASSETS.md). No CC-BY, no "free for non-commercial", no rips from other games. Ever.
3. **Keep it playable.** `bun run build` must pass (it typechecks). The game must load and run before and after your change.
4. **Small PRs merge fast.** One feature or fix per PR beats a mega-branch.

## Getting started

```sh
git clone https://github.com/ilrein/warptracker
cd warptracker
bun install
bun run dev
```

## What to work on

- Check open issues, especially ones tagged `good first issue`.
- Game design ideas (new enemies, abilities, loot, bosses) → open an issue or discussion first so we can align before you build.
- Bug fixes and performance improvements → just send the PR.

## Code style

- TypeScript, strict mode. No `any` unless there is truly no alternative.
- Keep game systems in their own modules under `src/game/`.
- Prefer plain Three.js primitives and procedural generation over asset files.
- Balance numbers (damage, HP, XP curves) live as named constants — tune, don't bury magic numbers.

## Design pillars

When in doubt, contributions should push toward these:

1. **Instant play** — loads in seconds, playable in one click, no accounts.
2. **Readable darkness** — gothic and moody, but you can always see what's happening.
3. **The warp fantasy** — you are an agent *tracking* invading evil. Systems should reinforce hunting, sealing, and escalating rifts.
