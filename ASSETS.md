# Asset policy

Warptracker is **fully free**: every asset must be usable by anyone, for anything, forever, with no strings attached.

## The rule

An asset may be included only if it is one of:

1. **Procedural** — generated in code in this repo (this is the default and the preference; 100% of current assets are procedural).
2. **CC0 / public domain** — no attribution required, no usage restrictions.
3. **Originally created and donated** — made by the contributor and explicitly dedicated CC0 in the PR description.

## Explicitly not allowed

- CC-BY, CC-BY-SA, or anything requiring attribution or share-alike
- "Free for personal/non-commercial use" assets
- Anything extracted from another game (yes, including Diablo)
- AI-generated assets trained to imitate a specific copyrighted style or franchise

## Good CC0 sources

- [Kenney](https://kenney.nl) — CC0 game assets
- [Quaternius](https://quaternius.com) — CC0 low-poly 3D models
- [Poly Haven](https://polyhaven.com) — CC0 HDRIs/textures/models
- [OpenGameArt](https://opengameart.org) — filter by CC0
- [freesound](https://freesound.org) — filter by CC0

Every non-procedural asset added must be listed in this file with its source link and license confirmation.

## Current asset manifest

| Asset | Source | License |
|---|---|---|
| All 3D models, VFX, world decor | procedural (`src/game/*.ts`) | MIT (code) |
| All sound effects | procedural WebAudio (`src/game/audio.ts`) | MIT (code) |
| Favicon | inline SVG (`index.html`) | MIT (code) |
