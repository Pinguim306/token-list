# FWA — Brand Assets

Source-of-truth brand assets for **Fake World Assets** on RobinhoodChain.

## Figma library

[**FWA — Design System**](https://www.figma.com/design/hk4CJfj7jnqzrymQpWfP0c) mirrors
this kit as Figma variables, text styles and components:

| In Figma | Contents |
|---|---|
| `FWA Color Light` / `FWA Color Dark` | 40 colour variables, values taken **from `fwa-app/src/app/globals.css`** (the code is the source of truth). Two collections rather than one with two modes — the Figma Starter plan caps collections at a single mode. |
| Text styles | `Display/XL·L·M` (Bungee), `Body/Large·Base·Small`, `Label/Medium·Semibold`, `Eyebrow` (Inter). |
| Components | `Button/Primary`, `Button/Secondary`, `Eyebrow/Pill`, `Stat/Tile`, `Card/Base` — fills bound to the colour variables. |

When a token changes in `globals.css`, update the Figma variable to match — not
the other way around.

## Design tokens

| Token | Value | Use |
|---|---|---|
| Near-black | `#17120f` | Badge/background, dark theme, `theme_color` |
| Off-white (cream) | `#faf6f2` | Light theme background |
| Rose accent | `#e5647f` (hover `#f0798f`) | Primary accent, gems, CTAs |
| Display font | **Bungee** | Wordmark / headlines |
| Body font | **Inter** | UI / body copy |

## Files

| File | What it is |
|---|---|
| `fwa-brand-board.svg` / `.png` | **Brand board** — the one-page reference: palette (with hex + roles), Bungee/Inter type specimens, emblem, and usage notes. Mirror these values when setting up the Canva Brand Kit. |
| `fwa-emblem.svg` | **Source** of the square app icon — geometric white "FWA" on a near-black badge with a rose glow, accent shelf, and gem. No font dependency (letters are vector paths). |
| `fwa-emblem-512.png` | 512px raster of the emblem (reference). |
| `fwa-launch-twitter-1600x900.png` | Launch/announcement banner for X/Twitter (Canva). |

## Regenerating the app icon from source

The favicon / PWA icons in `fwa-app` are rasterized from `fwa-emblem.svg`
with [`sharp`](https://sharp.pixelplumbing.com/):

```js
const sharp = require("sharp");
const svg = require("fs").readFileSync("docs/brand/fwa-emblem.svg");
await sharp(svg, { density: 384 }).resize(512, 512).png()
  .toFile("fwa-app/src/app/icon.png");        // favicon (App Router auto-wires)
await sharp(svg, { density: 192 }).resize(180, 180).png()
  .toFile("fwa-app/src/app/apple-icon.png");  // apple-touch-icon
await sharp(svg, { density: 192 }).resize(192, 192).png()
  .toFile("fwa-app/public/icon-192.png");      // PWA manifest
await sharp(svg, { density: 384 }).resize(512, 512).png()
  .toFile("fwa-app/public/icon-512.png");      // PWA manifest (any + maskable)
```

The PWA manifest itself lives at `fwa-app/src/app/manifest.ts`.

> The larger FWA wordmark logo (`fwa-app/public/logo.png`) and the 1200×630
> Open Graph card (`fwa-app/public/og.png`) were produced in Canva and are
> wired via `fwa-app/src/app/layout.tsx` metadata.
