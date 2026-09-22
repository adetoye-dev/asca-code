// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkbenchNav, type ScreenId } from "./WorkbenchNav";

function setup(overrides: Partial<React.ComponentProps<typeof WorkbenchNav>> = {}) {
  const handlers = {
    onSelectScreen: vi.fn<(screen: ScreenId) => void>(),
    onToggleExplorer: vi.fn(),
    onPinnedChange: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenCommandPalette: vi.fn(),
  };
  const props = {
    screen: "editor" as ScreenId,
    explorerOpen: true,
    pinned: false,
    ...handlers,
    ...overrides,
  };
  const view = render(<WorkbenchNav {...props} />);
  const setProps = (next: Partial<React.ComponentProps<typeof WorkbenchNav>>) =>
    view.rerender(<WorkbenchNav {...props} {...next} />);
  return { ...handlers, setProps };
}

const nav = () => screen.getByTestId("workbench-nav");
/** Expanded and collapsed are a width, so that is what the test reads. */
const width = () => Number.parseInt(nav().style.width, 10);
const brandName = () => screen.getByText("ACSA Code");

/** Pointing at the sidebar opens it — after the hover intent, so it is awaited. */
const hover = () => fireEvent.mouseOver(nav());
const leave = () => fireEvent.mouseOut(nav());
const expandedWidth = () => waitFor(() => expect(width()).toBeGreaterThan(100));

afterEach(cleanup);

describe("the workbench sidebar", () => {
  it("is one element, collapsed, with the icon showing and the name not", () => {
    setup();
    expect(screen.getAllByTestId("workbench-nav")).toHaveLength(1);
    expect(width()).toBeLessThan(100);
    // The brand mark is always there; the name is hidden from the tree while
    // there is no room for it.
    expect(brandName().getAttribute("aria-hidden")).toBe("true");
  });

  it("expands in place on hover and collapses when the pointer leaves", async () => {
    setup();
    const collapsed = width();
    hover();
    await expandedWidth();
    expect(brandName().getAttribute("aria-hidden")).toBe("false");

    leave();
    expect(width()).toBe(collapsed);
  });

  it("does not open for a cursor that is only passing through", async () => {
    // A pointer crossing the sidebar on its way somewhere else must not shove
    // the editor across and back.
    setup();
    hover();
    expect(width()).toBeLessThan(100);
    leave();
    await new Promise((r) => setTimeout(r, 250));
    expect(width()).toBeLessThan(100);
  });

  it("shows its groups and rows, which are the same rows as when collapsed", async () => {
    // One list, not two: every row exists in both states, and what changes is
    // whether its label can be seen.
    setup();
    const rowsWhenCollapsed = screen.getAllByTestId(/^nav-item-/).length;
    hover();
    await expandedWidth();
    for (const label of ["Workspace", "Code", "AI", "Platform"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByTestId(/^nav-item-/)).toHaveLength(rowsWhenCollapsed);
  });

  it("closes itself once something has been chosen", async () => {
    const { onSelectScreen } = setup();
    hover();
    await expandedWidth();
    fireEvent.click(screen.getByTestId("nav-item-git"));
    expect(onSelectScreen).toHaveBeenCalledWith("git");
    // The pointer is still on it; it still gets out of the way.
    expect(width()).toBeLessThan(100);
  });

  it("stays open when it is pinned, including after a choice", () => {
    const { onSelectScreen } = setup({ pinned: true });
    expect(width()).toBeGreaterThan(100);
    fireEvent.click(screen.getByTestId("nav-item-marketplace"));
    expect(onSelectScreen).toHaveBeenCalledWith("marketplace");
    expect(width()).toBeGreaterThan(100);
  });

  it("marks the current screen as the page", async () => {
    setup({ screen: "codeMap" });
    hover();
    await expandedWidth();
    expect(screen.getByTestId("nav-item-codeMap").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("nav-item-git").getAttribute("aria-current")).toBeNull();
  });

  it("lets the pin be changed from the mark and from the pin", async () => {
    const { onPinnedChange } = setup();
    fireEvent.click(screen.getByTestId("nav-brand"));
    expect(onPinnedChange).toHaveBeenCalledWith(true);

    hover();
    await expandedWidth();
    fireEvent.click(screen.getByTestId("nav-pin"));
    expect(onPinnedChange).toHaveBeenCalledWith(true);
  });

  it("closes — and unpins — on Escape", () => {
    const { onPinnedChange } = setup({ pinned: true });
    fireEvent.keyDown(nav(), { key: "Escape" });
    expect(onPinnedChange).toHaveBeenCalledWith(false);
  });

  it("treats the active Editor row as the file tree's switch", async () => {
    const { onToggleExplorer, onSelectScreen } = setup({ screen: "editor" });
    hover();
    await expandedWidth();
    fireEvent.click(screen.getByTestId("nav-item-editor"));
    expect(onToggleExplorer).toHaveBeenCalledTimes(1);
    expect(onSelectScreen).not.toHaveBeenCalled();
  });

  it("has one settings row, and no chat row at all", () => {
    // Chat is a panel toggle, not a screen: it belongs to the titlebar and ⌘L.
    // It had been offered twice in the sidebar, which is what this guards.
    const { onOpenSettings, onOpenCommandPalette } = setup();
    expect(screen.queryByText("Chat")).toBeNull();
    fireEvent.click(screen.getByTestId("nav-settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("nav-command-palette"));
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
  });
});
