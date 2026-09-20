/**
 * A wiring tripwire, not a behaviour test.
 *
 * The flicker the user reported came from an object identity: `watermarkComponent`
 * was an inline arrow, dockview treats a new arrow as a new component *type*, and
 * so the empty-state panel unmounted and remounted on every keystroke. The panel
 * map had the same shape and quietly re-ran `updateOptions` (plus a full layout
 * pass) on every render.
 *
 * Both live in one file, both are invisible to a unit test of anything else, and
 * both are the kind of thing that comes back one line at a time. Behaviour for the
 * panel map is covered in WorkbenchPanels.test.tsx against a real dockview; this
 * pins the two call sites in the layout itself.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./IdeLayout.tsx", import.meta.url)), "utf8");

describe("IdeLayout → dockview wiring", () => {
  it("hands dockview a module-level panel map, not one rebuilt per render", () => {
    // A `const components = { … }` in the render body is the regression: every
    // render then produces new component types for every panel.
    expect(source).not.toMatch(/const\s+components\s*=\s*\{/);
    expect(source).toContain("components={WORKBENCH_PANELS}");
  });

  it("passes a memoised watermark component, so the empty state is not remounted", () => {
    // `updateOptions({createWatermarkComponent})` makes dockview refresh the
    // watermark in every group — remove, recreate, remount.
    expect(source).toContain("watermarkComponent={watermarkComponent}");
    expect(source).not.toMatch(/watermarkComponent=\{\(\)\s*=>/);
  });

  it("keeps the live-state provider above the dockview surface", () => {
    // Panel components are captured at panel creation and can only see current
    // state through context, so the provider must wrap the dockview element.
    const provider = source.indexOf("<WorkbenchProvider value={live}>");
    const dockview = source.indexOf("<DockviewReact");
    const closing = source.indexOf("</WorkbenchProvider>");
    expect(provider).toBeGreaterThan(-1);
    expect(dockview).toBeGreaterThan(provider);
    expect(closing).toBeGreaterThan(dockview);
  });
});
