// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { memo, useState } from "react";
import { DockviewReact } from "dockview-react";
import type { DockviewApi } from "dockview-react";
import type { WorkbenchLive } from "./WorkbenchContext";

// dockview-core constructs a ResizeObserver per grid node; jsdom has none.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

/** How many times each editor surface was rendered. */
const renders = vi.hoisted(() => ({ byPath: {} as Record<string, number> }));

vi.mock("../../services/engineBridge", () => ({
  DESKTOP_REQUIRED_MESSAGE: "ACSA Code desktop app required",
}));
vi.mock("../editor/AssetPreview", () => ({ AssetPreview: () => <div /> }));
// The real editor mounts Monaco. What is under test here is the `content` it is
// handed and how often it is asked to render, so it renders that as text — and
// is memoised like the real one, so an untouched tab must pass identical props.
vi.mock("../editor/MonacoEditorContainer", () => ({
  MonacoEditorContainer: memo(function MonacoEditorContainer({
    path,
    content,
  }: {
    path: string;
    content: string;
  }) {
    renders.byPath[path] = (renders.byPath[path] ?? 0) + 1;
    return <div data-testid={`editor:${path}`}>{content}</div>;
  }),
}));

const { WORKBENCH_PANELS } = await import("./WorkbenchPanels");
const { WorkbenchProvider } = await import("./WorkbenchContext");

const A = "/work/a.ts";
const B = "/work/b.ts";
const noop = () => undefined;

// Stable across renders, the way the settings object is in the app: a new one
// per render would defeat the editor's memo, so the harness must not do that.
const SETTINGS = {} as WorkbenchLive["aiSettings"];

function liveFor(tabs: { path: string; content: string }[]): WorkbenchLive {
  return {
    openTabs: tabs.map((t) => ({
      path: t.path,
      name: t.path.split("/").pop() ?? t.path,
      content: t.content,
      originalContent: t.content,
      isDirty: false,
    })),
    updateTabContent: noop,
    saveFile: noop,
    aiSettings: SETTINGS,
    themeId: "github-dark",
    targetEditorLine: null,
    onSelectionChange: noop,
    projectRoot: "/work",
    isTauriAvailable: true,
    currentDiff: "",
    setCurrentDiff: noop,
    applyPatchToTab: noop,
    refreshProjectFiles: noop,
    refreshBranch: noop,
  };
}

function Harness({
  tabs,
  onApi,
}: {
  tabs: { path: string; content: string }[];
  onApi: (api: DockviewApi) => void;
}) {
  return (
    <div style={{ width: 600, height: 400 }}>
      <WorkbenchProvider value={liveFor(tabs)}>
        <DockviewReact
          components={WORKBENCH_PANELS}
          onReady={(event) => {
            onApi(event.api);
            tabs.forEach((tab, index) => {
              if (event.api.getPanel(tab.path)) return;
              event.api.addPanel({
                id: tab.path,
                component: "editor",
                title: tab.path,
                params: { filePath: tab.path },
                // Side by side, so both editors are in a visible group and both
                // actually render their content.
                ...(index === 0 ? {} : { position: { direction: "right" as const } }),
              });
            });
          }}
        />
      </WorkbenchProvider>
    </div>
  );
}

/** Owns the open tabs the way usePipeline does, so changing one is a re-render. */
function Page({ onApi }: { onApi: (api: DockviewApi) => void }) {
  const [tabs, setTabs] = useState([
    { path: A, content: "v1" },
    { path: B, content: "untouched" },
  ]);
  (globalThis as { __rewriteA?: (next: string) => void }).__rewriteA = (next: string) =>
    setTabs((prev) => prev.map((t) => (t.path === A ? { ...t, content: next } : t)));
  return <Harness tabs={tabs} onApi={onApi} />;
}

afterEach(() => {
  cleanup();
  renders.byPath = {};
});

const textOf = (path: string) => document.querySelector(`[data-testid="editor:${path}"]`)?.textContent;

describe("dockview workbench panels", () => {
  it("shows the current revision of an already-open file, not the one it opened with", async () => {
    let api: DockviewApi | null = null;
    render(<Page onApi={(a) => { api = a; }} />);
    expect(api).not.toBeNull();
    await waitFor(() => expect(textOf(A)).toBe("v1"), { timeout: 5000 });

    // The agent rewrites the file: the tab's content changes in state while the
    // panel is already open. Dockview froze the component it was handed at panel
    // creation, so this only works if the panel reads the live context.
    await act(async () => {
      (globalThis as { __rewriteA?: (next: string) => void }).__rewriteA?.("v2 — agent rewrite");
    });

    await waitFor(() => expect(textOf(A)).toBe("v2 — agent rewrite"), { timeout: 5000 });
  });

  it("does not re-register its panel factory on every workbench render", async () => {
    let api: DockviewApi | null = null;
    render(<Page onApi={(a) => { api = a; }} />);
    await waitFor(() => expect(textOf(A)).toBe("v1"), { timeout: 5000 });

    const touched: string[] = [];
    const instance = api as unknown as { updateOptions: (o: Record<string, unknown>) => unknown };
    const original = instance.updateOptions.bind(instance);
    instance.updateOptions = (options: Record<string, unknown>) => {
      touched.push(Object.keys(options).join(","));
      return original(options);
    };

    await act(async () => {
      (globalThis as { __rewriteA?: (next: string) => void }).__rewriteA?.("v3");
    });
    await waitFor(() => expect(textOf(A)).toBe("v3"), { timeout: 5000 });

    // Re-registering `createComponent` re-runs updateOptions and a full layout
    // pass; with a stable component map there is nothing to re-register.
    expect(touched.filter((keys) => keys.includes("createComponent"))).toEqual([]);
  });

  it("leaves an editor whose file did not change completely alone", async () => {
    render(<Page onApi={() => undefined} />);
    await waitFor(() => expect(textOf(A)).toBe("v1"), { timeout: 5000 });
    await waitFor(() => expect(textOf(B)).toBe("untouched"), { timeout: 5000 });

    const before = renders.byPath[B];

    // One file is rewritten. The other editor's props are identical afterwards,
    // so it must not be re-rendered at all — this is what stops a keystroke in
    // one tab from re-rendering every other open editor.
    await act(async () => {
      (globalThis as { __rewriteA?: (next: string) => void }).__rewriteA?.("v4");
    });
    await waitFor(() => expect(textOf(A)).toBe("v4"), { timeout: 5000 });

    expect(renders.byPath[B]).toBe(before);
  });
});
