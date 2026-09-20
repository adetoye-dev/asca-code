# Brand artwork

**Chosen: Apex.** The apex on a plane. It is what ships — `.tauri/icon-source.svg`
for the app icon (plate) and `public/logos/acsa.svg` for the app itself
(transparent) — and the icon set in `.tauri/icons/` is generated from it.

The two things the size test forced:

1. **The plane is solid, not translucent.** At 45% opacity it turned into a
   smudge below 32px, and 16px is a size the Finder list and the Dock both
   render. Flat `#6366f1` under a near-white `#eef2ff` A is a *value* contrast,
   so it survives any size.
2. **A monochrome variant exists** (`apex-mono.svg`) — one colour, with the
   plane as a stroke rather than a second block of tone — for anywhere a
   background cannot be guaranteed: the Finder list view, notifications, a
   README, print.

## What is here

The app icon and runtime mark are a hand-authored stand-in
(`.tauri/icon-source.svg`, `public/logos/acsa.svg`). These are three directions
for replacing it, derived from a reference the owner supplied.

| File | What it is |
| --- | --- |
| `apex.svg` | The direction as proposed: translucent plane. Kept for the record — the opacity is why it lost to the flat version. |
| `apex-mark.svg` | **What ships in the app.** Transparent, two flat tones. |
| `apex-icon.svg` | **Source for the app icon.** Same mark on the squircle plate. |
| `apex-mono.svg` | One-colour form, for print, notifications and READMEs. |
| `flow.svg`, `shoot.svg` | The two directions not taken. |
| `size-grid.png` | Every candidate at 16–64px on the app's panel colour. |
| `grid2.svg`, `apex-grid.svg`, `icon-grid.svg` | The size tests themselves, so the evidence can be regenerated. |

## Regenerating

```bash
cd .tauri && ../node_modules/.bin/tauri icon icon-source.svg -o icons
```

It must run from `.tauri` — `tauri` looks for the config in the current
directory — and it writes variants for Windows Store, Android and iOS that this
project does not target, so delete `Square*.png`, `StoreLogo.png`, `android/` and
`ios/` afterwards.

## What was taken from the reference, and what was not

The reference is a third-party image, so nothing is traced and no artwork is
reproduced. What is used is its **structural vocabulary**, which is not
copyrightable:

- a sharp apex,
- a plane underneath it,
- one leg that sweeps rather than stands,
- and an organic element — a leaf — inside the counter.

That vocabulary is worth having; the reference's *density* is not. It carries
four ideas and fine interior detail, which is why it would fail at 16px. Each
candidate takes one or two of the ideas and drops the rest.

## The three

| | Idea | Renders as |
| --- | --- | --- |
| `apex.svg` | Solid and grounded: the apex on an isometric plane. | Distinctive large, muddy small — the translucent plate turns to a smudge below 32px. |
| `flow.svg` | Drawn, not built: one leg curves, so the A reads as movement. | **The only one that survives 16px.** Monoline, one idea, no interior detail. |
| `shoot.svg` | Growth: the leaf kept inside the counter. | The leaf dies below 32px, where it reads as a hole rather than a leaf. |

`size-grid.svg` (rendered to `size-grid.png`) is the evidence: every candidate at
16, 24, 32, 48 and 64px on the app's own panel colour.
