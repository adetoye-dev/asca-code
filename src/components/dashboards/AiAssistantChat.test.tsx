// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// jsdom implements neither of these; the transcript scrolls its tail into view on
// every append, and the send button measures nothing.
Element.prototype.scrollIntoView = () => undefined;

/**
 * The transcript renders a provider badge per assistant message. Counting those
 * renders is the signal this test uses: the badge is inside the memoised
 * transcript, so if a keystroke in the composer re-renders the transcript, the
 * count climbs — and if the memo holds, it does not. The composer renders this
 * same component for the *active* model, so the count is keyed by provider id to
 * keep the two apart.
 */
const counted = vi.hoisted(() => ({ byProvider: {} as Record<string, number> }));

vi.mock("../ui/BrandLogos", () => ({
  ProviderLogo: ({ providerId }: { providerId?: string }) => {
    const key = providerId ?? "?";
    counted.byProvider[key] = (counted.byProvider[key] ?? 0) + 1;
    return <span data-testid={`logo:${key}`} />;
  },
}));

const SEEDED = [
  {
    id: "m1",
    role: "user" as const,
    content: "add a health endpoint",
    timestamp: 1,
  },
  {
    id: "m2",
    role: "assistant" as const,
    content: "Done — it is on `/health`.",
    provider: "deepseek",
    model: "deepseek-flash",
    timestamp: 2,
  },
];

vi.mock("../../services/aiChatPersistence", () => ({
  loadChatHistory: () => SEEDED,
  saveChatHistory: () => undefined,
  clearChatHistory: () => undefined,
  subscribeChatHistory: () => () => undefined,
}));

vi.mock("../../services/aiModelManager", () => ({
  getConfiguredModelsList: () => [],
  ensureProvidersHydrated: async () => undefined,
  resolveInitialSelectedModel: () => null,
  saveActiveSelectedModel: () => undefined,
  getActiveSelectedModel: () => null,
  loadAllProviders: () => ({}),
  getAutoSelectedLocalWorker: () => "",
  isModelVisionCapable: () => false,
  findBestAvailableVisionModel: () => null,
  syncOllamaModels: () => undefined,
}));

vi.mock("../../services/ollamaSetup", () => ({
  openAiManagementDashboard: () => undefined,
  checkOllamaStatus: async () => ({ running: false, models: [] }),
  EVENT_START_CODING_WITH_OLLAMA: "acsa:start-coding-with-ollama",
}));

const { AiAssistantChat } = await import("./AiAssistantChat");
const { chatDraft } = await import("../../services/chatDraft");

const baseProps = {
  status: "idle" as const,
  activityLog: [],
  onRunPipeline: () => undefined,
  onCancelPipeline: () => undefined,
  projectRoot: "/work/acsa-code",
  isWide: true,
};

afterEach(() => {
  cleanup();
  counted.byProvider = {};
  chatDraft.clear();
});

const transcriptRenders = () => counted.byProvider["deepseek"] ?? 0;

describe("the chat transcript's render boundary", () => {
  it("draws the conversation", () => {
    render(<AiAssistantChat {...baseProps} />);
    expect(screen.getByText(/Done — it is on/)).toBeTruthy();
    expect(transcriptRenders()).toBeGreaterThan(0);
  });

  it("is re-rendered when something it shows changes", () => {
    // The control: proves the counter below is actually measuring this component
    // rather than standing still for some unrelated reason.
    const { rerender } = render(<AiAssistantChat {...baseProps} />);
    const before = transcriptRenders();

    rerender(<AiAssistantChat {...baseProps} streamingAnswer="streaming…" status="running" />);

    expect(transcriptRenders()).toBeGreaterThan(before);
  });

  it("is left alone while a prompt is being typed", () => {
    // The point of the boundary. The composer's text lives outside this component
    // tree now, so typing wakes the composer and nothing else.
    let hostRenders = 0;
    function Host() {
      hostRenders += 1; // stands in for the workbench above the chat
      return <AiAssistantChat {...baseProps} />;
    }
    render(<Host />);
    const before = hostRenders;
    const transcriptBefore = transcriptRenders();

    const box = screen.getByRole("textbox");
    for (const text of ["h", "he", "hel", "hell", "hello"]) {
      fireEvent.change(box, { target: { value: text } });
    }

    expect((box as HTMLTextAreaElement).value).toBe("hello");
    expect(hostRenders).toBe(before);
    expect(transcriptRenders()).toBe(transcriptBefore);
  });

  it("keeps a half-typed prompt when the panel is closed and reopened", () => {
    // Closing the chat unmounts it, so the draft cannot live in its state — the
    // text would vanish. It lives in the store instead; this pins that.
    const first = render(<AiAssistantChat {...baseProps} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "half a thought" } });
    first.unmount();

    render(<AiAssistantChat {...baseProps} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("half a thought");
  });
});
