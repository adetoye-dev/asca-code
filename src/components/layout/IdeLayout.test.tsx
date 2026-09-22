// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UsePipelineReturn } from "../../hooks/usePipeline";

// jsdom has neither of these; the shell's grid and its scroll containers want them.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = () => undefined;

// The shell is what is under test, so the surfaces it hosts are stubs — each has
// its own suite. Everything that talks to the machine is stubbed too.
vi.mock("../panels/BottomPanel", () => ({ BottomPanel: () => <div data-testid="terminal" /> }));
vi.mock("../dashboards/AiAssistantChat", () => ({ AiAssistantChat: () => <div data-testid="chat-dock" /> }));
vi.mock("../sidebar/MarketplaceSidebar", () => ({
  MarketplaceSidebar: () => <div data-testid="marketplace-page" />,
}));
vi.mock("./UpdateButton", () => ({ UpdateButton: () => null }));
vi.mock("../../services/engineBridge", () => ({
  DESKTOP_REQUIRED_MESSAGE: "the desktop app is required",
  hasIpc: () => true,
  engineCall: async () => ({}),
}));
vi.mock("../../services/projectSetup", () => ({
  fetchProjectStatus: async () => null,
  runInProjectTerminal: async () => undefined,
}));
vi.mock("../../services/themeManager", () => ({
  applyAccent: () => undefined,
  applyGlobalWorkbenchTheme: () => undefined,
  DEFAULT_ACCENT: "indigo",
}));
vi.mock("../../services/systemMetricsService", () => ({
  systemMetricsService: {
    subscribe: () => () => undefined,
    getMetrics: () => null,
    fetchMetrics: async () => null,
    isHealthy: () => false,
  },
}));
vi.mock("../../services/ollamaSetup", () => ({
  openOllamaSetupWizard: () => undefined,
  openAiManagementDashboard: () => undefined,
  checkOllamaStatus: async () => ({ running: false, models: [] }),
  syncOllamaModels: () => undefined,
  EVENT_OPEN_AI_MANAGEMENT: "acsa:open-ai-management",
  EVENT_START_CODING_WITH_OLLAMA: "acsa:start-coding-with-ollama",
}));
vi.mock("../../services/aiModelManager", () => ({
  getDefaultProvider: () => ({ id: "ollama", selectedModel: "m", apiKey: "", baseUrl: "" }),
}));
vi.mock("../../services/gitClient", () => ({
  gitFetch: async () =>
    new Response(
      JSON.stringify({ isGit: true, branch: "feature/nav", ahead: 0, behind: 0, staged: [], unstaged: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ),
}));

const { IdeLayout } = await import("./IdeLayout");

/** Only the fields the shell touches; the pipeline has its own suites. */
function pipeline(): UsePipelineReturn {
  const noop = () => undefined;
  return {
    activeProject: { name: "acsa-code", path: "/work/acsa-code" },
    projectFiles: [],
    openTabs: [],
    activeTabPath: null,
    currentDiff: "",
    setCurrentDiff: noop,
    applyPatchToTab: noop,
    touchedPaths: [],
    turnChanges: [],
    openDiff: async () => undefined,
    reviewDiff: null,
    clearReviewDiff: noop,
    isProjectModalOpen: false,
    setIsProjectModalOpen: noop,
    isSettingsModalOpen: false,
    setIsSettingsModalOpen: noop,
    aiSettings: {},
    setAiSettings: noop,
    pickFolder: async () => null,
    openFolder: async () => undefined,
    openFile: async () => undefined,
    closeTab: noop,
    selectTab: noop,
    updateTabContent: noop,
    saveFile: async () => undefined,
    createFileOrFolder: async () => undefined,
    deleteFile: async () => undefined,
    createProject: async () => undefined,
    refreshProjectFiles: async () => [],
    indexStatus: { indexed: false, totalSymbols: 0, profile: null },
    isIndexing: false,
    syncIndex: async () => undefined,
    noFileChanges: false,
    waitingForUser: "",
    prompt: "",
    setPrompt: noop,
    status: "idle",
    activityLog: [],
    runPipeline: noop,
    cancelPipeline: async () => undefined,
    clearLog: noop,
    isTauriAvailable: true,
    streamingAnswer: "",
    streamingThought: "",
    agentSteps: [],
    failureDetail: "",
    pendingApproval: null,
    pendingQuestion: null,
    respondToQuestion: async () => undefined,
    respondToApproval: async () => undefined,
  } as unknown as UsePipelineReturn;
}

afterEach(cleanup);

const renderShell = () => render(<IdeLayout {...pipeline()} />);

describe("the workbench shell", () => {
  it("paints the navigation, the editor and its file tree, the terminal and the chat", async () => {
    renderShell();
    expect(screen.getByTestId("workbench-nav")).toBeTruthy();
    expect(screen.getByTestId("workbench-nav")).toBeTruthy();
    // The explorer is part of the editor screen now, not the whole workbench:
    // its own empty state is on screen.
    expect(screen.getByText("No files in directory.")).toBeTruthy();
    // Both are behind a lazy boundary, so they arrive a tick later.
    expect(await screen.findByTestId("terminal")).toBeTruthy();
    expect(screen.getByTestId("chat-dock")).toBeTruthy();
  });

  it("gives the canvas to a page, and puts the editor's dock back on the way home", async () => {
    renderShell();

    // Choose Repository from the panel.
    fireEvent.mouseOver(screen.getByTestId("workbench-nav"));
    fireEvent.click(screen.getByTestId("nav-item-git"));

    // The page is up — its commit box is the anchor, since the branch also shows
    // in the titlebar — and the editor's furniture has stepped aside for it.
    expect(await screen.findByTestId("git-commit-message")).toBeTruthy();
    // The page's own header, and the way back out of it.
    expect(screen.getByLabelText("Back to the editor")).toBeTruthy();
    expect(screen.queryByTestId("terminal")).toBeNull();
    expect(screen.queryByTestId("chat-dock")).toBeNull();

    // Escape is the way back, and the dock returns with it.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("terminal")).toBeTruthy());
    expect(screen.getByTestId("chat-dock")).toBeTruthy();
  });

  it("pins the sidebar with Cmd+B, so it stops hiding", async () => {
    renderShell();
    const width = () => Number.parseInt(screen.getByTestId("workbench-nav").style.width, 10);
    expect(width()).toBeLessThan(100);

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    await waitFor(() => expect(width()).toBeGreaterThan(100));

    // And the choice sticks: moving the pointer away does not close it.
    fireEvent.mouseOut(screen.getByTestId("workbench-nav"));
    expect(width()).toBeGreaterThan(100);
  });

  it("keeps the file tree toggle in the titlebar to the editor screen", async () => {
    renderShell();
    const treeToggle = () => screen.queryByTitle("Toggle File Tree (Cmd+Shift+E)");
    expect(treeToggle()).toBeTruthy();

    fireEvent.mouseOver(screen.getByTestId("workbench-nav"));
    fireEvent.click(screen.getByTestId("nav-item-marketplace"));
    await waitFor(() => expect(screen.getByTestId("marketplace-page")).toBeTruthy());
    // A page has no file tree or terminal to toggle.
    expect(treeToggle()).toBeNull();
    expect(screen.queryByTitle("Toggle Bottom Panel (Cmd+J / Ctrl+`)")).toBeNull();
  });
});
