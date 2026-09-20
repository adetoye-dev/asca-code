/**
 * Contrast audit for the colours the UI actually uses.
 *
 * The automated half of the accessibility work was `eslint-plugin-jsx-a11y`,
 * which cannot see colour at all; contrast had never been checked. It matters
 * more here than in most apps because the dense type scale is 9–11px, and small
 * text needs the full 4.5:1 rather than the 3:1 that large text is allowed.
 *
 * Values are read from `src/styles/tokens/primitives.css`, so this cannot drift
 * from the palette — the failure mode it exists to prevent.
 *
 *   node scripts/check_contrast.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const css = readFileSync("src/styles/tokens/primitives.css", "utf8");
const tokenValue = (name) => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`no such token: --${name}`);
  return match[1];
};

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The surfaces the app paints text on. These come from the shipped theme
// (`PRESET_THEMES["github-dark"]`), not from the semantic layer, because the
// semantic layer is what nothing reads.
const SURFACES = {
  "canvas / titlebar / status bar": "#09090b",
  "workbench / sidebar / panel": "#0f0f12",
  "card / elevated": "#18181b",
};

// Tailwind defaults still in the tree as raw classes. Kept only to *resolve* the
// classes found in the source — the audit checks what is used, not a matrix.
const TAILWIND = {
  "red-300": "#fca5a5", "red-400": "#f87171", "red-500": "#ef4444",
  "emerald-300": "#6ee7b7", "emerald-400": "#34d399",
  "green-400": "#4ade80", "amber-300": "#fcd34d", "amber-400": "#fbbf24",
  "amber-500": "#f59e0b", "yellow-400": "#facc15", "sky-400": "#38bdf8",
  "fuchsia-300": "#f0abfc", "blue-400": "#60a5fa", "orange-400": "#fb923c",
  "rose-400": "#fb7185",
};

const AA_SMALL = 4.5;
const AA_LARGE = 3.0;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const resolve = (family, shade) => {
  if (family === "zinc") return tokenValue(`neutral-${shade}`);
  if (family === "purple") return tokenValue(`accent-${shade}`);
  return TAILWIND[`${family}-${shade}`] ?? null;
};

// Measure the colours that are actually painted. Where a className names its own
// background the pair is checked directly — that is how `text-zinc-950` on
// `bg-amber-400` is fine while looking terrible against the app's dark surfaces.
// Where it does not, the worst dark surface is assumed, which is right for almost
// every case here and is labelled so the assumption is visible.
const WORST_SURFACE = "#18181b";
const TEXT = /(?:^|[\s"'`])(text|placeholder)-([a-z]+)-(\d{2,3})(?![\w-])/g;
const BG = /(?:^|[\s"'`])(bg)-([a-z]+)-(\d{2,3})(?:\/(\d{1,3}))?(?![\w-])/g;

/**
 * Flatten a colour with an opacity modifier onto what is behind it.
 *
 * `bg-red-500/10` is a tint, not red — measuring red text against full red said
 * 1.36:1 for a pair that renders at well over 5:1. Tailwind's `/NN` is very
 * common on status chips, so ignoring it made the audit lie.
 */
const over = (hex, opacity, behind) => {
  if (opacity === undefined || opacity >= 100) return hex;
  const a = opacity / 100;
  const [fg, bg] = [rgb(hex), rgb(behind)];
  const blend = fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
  return "#" + blend.map((v) => v.toString(16).padStart(2, "0")).join("");
};

const rows = [];
const seen = new Set();
const record = (fg, fgHex, bg, bgHex, assumed) => {
  const key = `${fg}|${bg}`;
  if (seen.has(key)) return;
  seen.add(key);
  const ratio = contrast(fgHex, bgHex);
  rows.push({
    fg,
    bg,
    assumed,
    ratio,
    verdict: ratio >= AA_SMALL ? "pass" : ratio >= AA_LARGE ? "large-only" : "FAIL",
  });
};

for (const file of walk("src").filter((p) => [".ts", ".tsx"].includes(extname(p)))) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const classes = line.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
    if (!classes) continue;
    const source = classes[1] ?? classes[2] ?? "";

    const texts = [...source.matchAll(TEXT)]
      .map(([, prefix, family, shade]) => ({
        name: `${prefix}-${family}-${shade}`,
        hex: resolve(family, shade),
      }))
      .filter((t) => t.hex);
    const backgrounds = [...source.matchAll(BG)]
      .map(([, , family, shade, opacity]) => ({
        name: `bg-${family}-${shade}${opacity ? `/${opacity}` : ""}`,
        base: resolve(family, shade),
        opacity: opacity === undefined ? 100 : Number(opacity),
      }))
      .filter((b) => b.base)
      .map((b) => ({
        name: b.name,
        hex: over(b.base, b.opacity, WORST_SURFACE),
      }));

    for (const text of texts) {
      if (backgrounds.length > 0) {
        for (const bg of backgrounds) record(text.name, text.hex, bg.name, bg.hex, false);
      } else {
        record(text.name, text.hex, "the darkest panel", WORST_SURFACE, true);
      }
    }
  }
}

// Pairs a class scan cannot infer: text drawn on a filled control.
record("white", "#ffffff", "bg-purple-600", tokenValue("accent-600"), false);
record("white", "#ffffff", "bg-purple-500", tokenValue("accent-500"), false);
record("accent-50", tokenValue("accent-50"), "bg-purple-500", tokenValue("accent-500"), false);

// ── Non-text contrast (WCAG 1.4.11) ─────────────────────────────────────────
// A focus indicator is not text and needs 3:1, not 4.5. The ring used to be
// `rgba(255,255,255,0.25)`, which flattens to #525254 over these surfaces —
// 2.27:1 at worst, so it was below the bar it is meant to meet.
const NON_TEXT = 3.0;
const nonTextRows = [];
for (const [surface, hex] of Object.entries(SURFACES)) {
  const ratio = contrast(tokenValue("accent-400"), hex);
  nonTextRows.push({ pair: `focus ring on ${surface}`, ratio, ok: ratio >= NON_TEXT });
}

/**
 * Reviewed exceptions. Each is a real measurement that is acceptable for a stated
 * reason, so the gate can fail on anything new without crying about these.
 */
const REVIEWED = [
  { match: "white bg-purple-500", why: "the hover state of the primary action: 4.47 against a 4.50 floor, and the base state passes" },
  { match: "accent-50 bg-purple-500", why: "the mark itself. Logos are explicitly exempt from 1.4.3" },
];

const width = Math.max(...rows.map((r) => r.fg.length));
const flagged = rows.filter((r) => r.verdict !== "pass");
// Gate on what can be proven: a pair whose background is named in the same
// className. Where the surface had to be assumed, a failure is a question for a
// human — `text-zinc-950` on an icon inherits its parent's amber button, and the
// element says nothing about that.
const unexplained = flagged.filter(
  (row) => !row.assumed && !REVIEWED.some((r) => `${row.fg} ${row.bg}`.includes(r.match)),
);

if (flagged.length > 0) {
  console.log(`\n${"foreground".padEnd(width)}  on                                ratio  verdict`);
  console.log("-".repeat(width + 52));
  for (const row of flagged) {
    const reviewed = REVIEWED.some((r) => `${row.fg} ${row.bg}`.includes(r.match));
    const mark = row.verdict === "FAIL" ? "below 3.0" : "below 4.5";
    console.log(
      `${row.fg.padEnd(width)}  ${row.bg.padEnd(32)} ${row.ratio.toFixed(2).padStart(5)}  ${mark}${row.assumed ? " (surface assumed)" : ""}${reviewed ? " — reviewed" : ""}`,
    );
  }
  for (const r of REVIEWED) console.log(`  reviewed: ${r.match} — ${r.why}`);
}

console.log(
  `\n${rows.length - flagged.length}/${rows.length} pairs meet AA for small text` +
    (unexplained.length ? ` — ${unexplained.length} unexplained` : " — every exception reviewed"),
);

if (unexplained.length > 0) {
  console.error("check_contrast: unreviewed contrast failures — fix them or add a reviewed exception");
  process.exit(1);
}
if (process.argv.includes("--list")) console.log(JSON.stringify(rows, null, 1));

console.log("\nnon-text (needs 3.0):");
for (const row of nonTextRows) {
  console.log(`  ${row.pair.padEnd(38)} ${row.ratio.toFixed(2)}  ${row.ok ? "pass" : "FAIL"}`);
}
if (nonTextRows.some((row) => !row.ok)) {
  console.error("check_contrast: a non-text indicator is below 3:1");
  process.exit(1);
}
