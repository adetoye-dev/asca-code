/**
 * aiReview.ts — Copilot-style file review
 *
 * Scans the currently open file and returns structured findings: bugs, logic
 * errors, edge cases, security problems and refactor suggestions. Findings are
 * rendered as editor markers (squiggles) plus a review panel.
 */

export interface ReviewIssue {
  line: number;
  severity: "error" | "warning" | "info";
  title: string;
  detail: string;
  suggestion?: string;
}

export interface ReviewResponse {
  ok: boolean;
  issues: ReviewIssue[];
  model?: string;
  provider?: string;
  /** Set when the configured provider was unusable and we fell back to local. */
  note?: string;
  /** Set when the model produced something we could not parse as findings. */
  warning?: string;
  error?: string;
}

export interface ReviewSettings {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

const REVIEWABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".cpp", ".cc", ".h", ".hpp", ".cs", ".kt", ".swift",
  ".css", ".scss", ".html", ".vue", ".svelte", ".sql", ".sh",
]);

export function isReviewableFile(path: string): boolean {
  const lower = (path || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && REVIEWABLE_EXTENSIONS.has(lower.slice(dot));
}

export async function reviewFile(params: {
  path: string;
  content: string;
  language?: string;
  settings: ReviewSettings;
  signal?: AbortSignal;
}): Promise<ReviewResponse> {
  const { path, content, language = "", settings, signal } = params;
  try {
    const res = await fetch("/api/ai/review-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        content,
        language,
        provider: settings.provider,
        model: settings.model,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
      }),
      signal,
    });
    if (!res.ok) {
      return { ok: false, issues: [], error: `Review failed (HTTP ${res.status})` };
    }
    const data = await res.json();
    return {
      ok: Boolean(data.ok),
      issues: Array.isArray(data.issues) ? data.issues : [],
      model: data.model,
      provider: data.provider,
      note: data.note,
      warning: data.warning,
      error: data.error,
    };
  } catch (err: any) {
    return { ok: false, issues: [], error: err?.message || "Review request failed" };
  }
}
