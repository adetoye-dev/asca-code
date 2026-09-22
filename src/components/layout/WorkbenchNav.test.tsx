// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkbenchNav, type ScreenId } from "./WorkbenchNav";

function setup(overrides: Partial<React.ComponentProps<typeof WorkbenchNav>> = {}) {
  const handlers = {
    onSelectScreen: vi.fn<(screen: ScreenId) => void>(),
    onToggleExplorer: vi.fn(),
    onPinnedChange: vi.fn(),
    onToggleChat: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenCommandPalette: vi.fn(),
  };
  const props = {
    screen: "editor" as ScreenId,
    explorerOpen: true,
    pinned: false,
    chatOpen: true,
    projectName: "acsa-code",
    projectPath: "/work/acsa-code",
    ...handlers,
    ...overrides,
  };
  const view = render(<WorkbenchNav {...props} />);
  // Re-render with the same props, so state a handler would have changed in the
  // real app can be simulated by the test.
  const setProps = (next: Partial<React.ComponentProps<typeof WorkbenchNav>>) =>
    view.rerender(<WorkbenchNav {...props} {...next} />);
  return { ...handlers, setProps };
}

const panel = () => screen.getByTestId("nav-panel");
const surface = () => screen.getByTestId("workbench-nav");
const shown = () => panel().getAttribute("aria-hidden") === "false";

/** Pointing at the rail, which is what reveals the panel. */
const hover = () => fireEvent.mouseOver(screen.getByTestId("nav-rail"));
const leave = () => fireEvent.mouseOut(screen.getByTestId("nav-rail"));

afterEach(cleanup);

describe("the workbench nav", () => {
  it("stays out of the way until it is asked for", () => {
    setup();
    expect(shown()).toBe(false);
    // Nothing inside a hidden panel may be reachable by keyboard.
    expect(panel().hasAttribute("inert")).toBe(true);
  });

  it("shows its sections and rows on hover, and puts them away after", () => {
    setup();
    hover();
    expect(shown()).toBe(true);
    expect(panel().hasAttribute("inert")).toBe(false);
    // Grouped, the way the reference layouts are: sections, then their rows.
    for (const label of ["Workspace", "Code", "AI", "Platform"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    for (const item of ["Editor", "Repository", "Code map", "Models & providers", "Marketplace"]) {
      expect(screen.getByText(item)).toBeTruthy();
    }

    leave();
    expect(shown()).toBe(false);
  });

  it("closes itself once something has been chosen", () => {
    const { onSelectScreen } = setup();
    hover();
    fireEvent.click(screen.getByTestId("nav-item-git"));
    expect(onSelectScreen).toHaveBeenCalledWith("git");
    // The pointer is still on the rail; the panel still gets out of the way.
    expect(shown()).toBe(false);
  });

  it("keeps the chosen screen selected, and marks it as the current page", () => {
    const { setProps } = setup();
    setProps({ screen: "codeMap" });
    hover();
    expect(screen.getByTestId("nav-item-codeMap").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("nav-item-git").getAttribute("aria-current")).toBeNull();
  });

  it("stays open when it is pinned, including after a choice", () => {
    const { onSelectScreen } = setup({ pinned: true });
    expect(shown()).toBe(true);
    fireEvent.click(screen.getByTestId("nav-item-marketplace"));
    expect(onSelectScreen).toHaveBeenCalledWith("marketplace");
    expect(shown()).toBe(true);
  });

  it("lets the pin be changed from the panel and from the mark", () => {
    const { onPinnedChange } = setup();
    hover();
    fireEvent.click(screen.getByTestId("nav-pin"));
    expect(onPinnedChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText("ACSA Code menu"));
    expect(onPinnedChange).toHaveBeenCalledWith(true);
  });

  it("closes — and unpins — on Escape", () => {
    const { onPinnedChange } = setup({ pinned: true });
    fireEvent.keyDown(surface(), { key: "Escape" });
    expect(onPinnedChange).toHaveBeenCalledWith(false);
  });

  it("treats the active Editor row as the file tree's switch", () => {
    // The screen you are asking for is the one you are already on, so the row is
    // a toggle for its pane instead — the old activity bar's behaviour.
    const { onToggleExplorer, onSelectScreen } = setup({ screen: "editor" });
    hover();
    fireEvent.click(screen.getByTestId("nav-item-editor"));
    expect(onToggleExplorer).toHaveBeenCalledTimes(1);
    expect(onSelectScreen).not.toHaveBeenCalled();
  });

  it("does not leave the app's own surfaces behind on the rail", () => {
    const { onToggleChat, onOpenSettings, onOpenCommandPalette } = setup();
    fireEvent.click(screen.getByTestId("nav-rail-chat"));
    expect(onToggleChat).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("nav-rail-settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    hover();
    fireEvent.click(screen.getByTestId("nav-command-palette"));
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
  });
});
