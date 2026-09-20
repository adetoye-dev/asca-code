/**
 * Fail the build when a utility class in the source has no rule in the CSS.
 *
 * Why this exists
 * ───────────────
 * Tailwind silently drops classes it cannot generate, and a dropped class is
 * invisible: the element just renders with whatever the browser defaults to.
 * Thirteen of them shipped — `bg-workbench/60` on the settings text fields (white
 * boxes with white text), `bg-modal/95` on every modal (transparent, so the page
 * showed through), `bg-hairline/80`, `bg-accent/10` — and nothing said a word. The
 * cause was an opacity modifier on a `var()` colour, which Tailwind cannot
 * resolve; it emits no rule rather than a wrong one.
 *
 * Scope is deliberately the app's own design tokens rather than every class in
 * the codebase. Those are the ones defined as CSS variables, so they are the ones
 * that fail quietly; and a broad check would be all false positives, because
 * plenty of strings that look like classes are not classes.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const TOKENS =
  "canvas|workbench|panel|overlay|modal|elevated|surface-[a-z-]+|border-hairline|border-accent|border-focus" +
  "|primary-action|hairline|accent|primary|secondary|muted|subtle|strong|focus" +
  // The app's greys and violets go through `token()` too, so their `/opacity`
  // forms are var-based and can be dropped the same way. `border-zinc-800/80`
  // alone is used 38 times.
  "|zinc-\\d{2,3}|purple-\\d{2,3}";
const PREFIXES = "bg|text|border|ring|from|to|via|divide|outline|fill|stroke|accent|caret|decoration|placeholder";
/** Only the opacity form is fragile; a bare `bg-workbench` always resolves. */
const PATTERN = new RegExp(`\\b(?:${PREFIXES})-(?:${TOKENS})\\/\\d+\\b`, "g");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const sources = walk("src").filter((p) => [".ts", ".tsx"].includes(extname(p)));
const used = new Set();
for (const file of sources) {
  for (const match of readFileSync(file, "utf8").matchAll(PATTERN)) used.add(match[0]);
}

if (used.size === 0) {
  console.log("generated-classes: nothing to check");
  process.exit(0);
}

// The built CSS escapes `/` and `:` — `bg-workbench/60` becomes `.bg-workbench\/60`.
// Variants are stripped first, because `hover:bg-x/90` is generated as
// `.hover\:bg-x\/90:hover` and the base name is what has to appear.
const css = walk("dist/assets")
  .filter((p) => extname(p) === ".css")
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

const escape = (name) => name.replace(/[/:[\].%]/g, (c) => `\\${c}`);
const missing = [...used].filter((name) => {
  const base = name.slice(name.lastIndexOf(":") + 1);
  return !css.includes(escape(base));
});

if (missing.length > 0) {
  console.error(
    `generated-classes: ${missing.length} class(es) are used but have no rule in the CSS.\n` +
      `Tailwind dropped them, so the elements render unstyled:\n\n` +
      missing.map((m) => `  ${m}`).join("\n") +
      `\n\nUsually this is an opacity modifier on a token defined as a CSS variable.\n` +
      `Fix the token (see the \`token()\` helper in tailwind.config.js) rather than the call site.`,
  );
  process.exit(1);
}

console.log(`generated-classes: ${used.size} token utilities, all generated`);
