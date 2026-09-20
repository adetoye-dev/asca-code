# Brand artwork — candidates

The app icon and runtime mark are a hand-authored stand-in
(`.tauri/icon-source.svg`, `public/logos/acsa.svg`). These are three directions
for replacing it, derived from a reference the owner supplied.

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

## What any final mark still needs

1. **A monochrome variant.** All three are gradient-only, which breaks in the
   Finder list view, notifications, a README, or print.
2. **A simplified small size.** Standard practice: the plate and the leaf belong
   to the large lockup; 16px gets the spine alone.
3. **The plate pair preserved.** macOS wants a full-bleed square with no
   transparency for the icon; the in-app mark stays transparent. The current
   assets already do this correctly and the replacement must too.
4. **Vector, authored.** Not rasterised, and not image-generated.

## Regenerating

```bash
# the app icon set, from the chosen mark on a plate
npx tauri icon .tauri/icon-source.svg
```
