/**
 * MonacoEditorContainer.tsx — Real Monaco Editor Component for ACSA Code
 *
 * Integrates @monaco-editor/react with:
 * 1. Syntax highlighting & TextMate tokenization for all major languages.
 * 2. VS Code settings (minimap, bracket colorization, indentation guides).
 * 3. AI inline completions (ghost text) via fill-in-the-middle.
 * 4. Cmd+S / Ctrl+S keyboard shortcuts to save to physical disk.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as MonacoType from "monaco-editor";
import "../../monacoSetup";
import { AlertCircle, ChevronDown, ChevronRight, Sparkles, X } from "lucide-react";
import { Icon } from "../ui/Icon";
import {
  registerAiInlineCompletions,
  executeInlineEdit,
  validateReplacement,
} from "../../services/aiAutocomplete";
import { reviewFile, isReviewableFile, type ReviewIssue } from "../../services/aiReview";
import { configureMonacoTypeScript } from "../../services/monacoTsConfig";
import { applyMonacoTheme } from "../../services/themeManager";
import { getAutoSelectedLocalWorker, resolveEditorAiConfig } from "../../services/aiModelManager";
import type { AISettings } from "../SettingsModal";

/**
 * Upper bound for a single inline review thread. A card is never this tall, so
 * anything larger is a measurement bug — clamping it keeps one bad number from
 * pushing the whole file off screen.
 */
const MAX_REVIEW_CARD_HEIGHT = 2400;

interface MonacoEditorContainerProps {
  path: string;
  content: string;
  onChange: (newContent: string) => void;
  onSave: (path: string) => void;
  aiSettings: AISettings;
  themeId?: string;
  targetLine?: number;
  targetColumn?: number;
  revealTrigger?: number;
  onSelectionChange?: (selection: string) => void;
  projectRoot?: string;
}

export function MonacoEditorContainer({
  path,
  content,
  onChange,
  onSave,
  aiSettings,
  themeId = "github-dark",
  targetLine,
  targetColumn,
  revealTrigger,
  onSelectionChange,
  projectRoot = "",
}: MonacoEditorContainerProps) {
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoType | null>(null);
  const aiDisposableRef = useRef<MonacoType.IDisposable | null>(null);
  const selectionDisposableRef = useRef<MonacoType.IDisposable | null>(null);
  const settingsRef = useRef(aiSettings);

  useEffect(() => {
    settingsRef.current = aiSettings;
  }, [aiSettings]);

  // Apply editor preferences live, so changing them in Settings takes effect
  // immediately instead of on the next time a file is opened.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const size = aiSettings?.fontSize ?? 13;
    editor.updateOptions({
      fontSize: size,
      lineHeight: aiSettings?.lineHeight ? Math.round(aiSettings.lineHeight * size) : 0,
      fontLigatures: aiSettings?.enableLigatures ?? true,
      tabSize: aiSettings?.tabSize ?? 4,
      insertSpaces: aiSettings?.insertSpaces ?? true,
      wordWrap: aiSettings?.wordWrap ? "on" : "off",
    });
  }, [
    aiSettings?.fontSize,
    aiSettings?.lineHeight,
    aiSettings?.enableLigatures,
    aiSettings?.tabSize,
    aiSettings?.insertSpaces,
    aiSettings?.wordWrap,
  ]);

  useEffect(() => {
    if (monacoRef.current) {
      applyMonacoTheme(monacoRef.current, themeId);
    }
  }, [themeId]);

  const getLanguage = (filePath: string): string => {
    if (filePath.endsWith(".py")) return "python";
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
    if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) return "javascript";
    if (filePath.endsWith(".json")) return "json";
    if (filePath.endsWith(".md")) return "markdown";
    if (filePath.endsWith(".rs")) return "rust";
    if (filePath.endsWith(".html")) return "html";
    if (filePath.endsWith(".css")) return "css";
    if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "yaml";
    if (filePath.endsWith(".sh")) return "shell";
    return "plaintext";
  };

  const [isInlinePromptOpen, setIsInlinePromptOpen] = useState(false);
  const [inlinePrompt, setInlinePrompt] = useState("");
  const [isInlineLoading, setIsInlineLoading] = useState(false);
  /** Surfaced when an AI edit is refused (e.g. an implausible replacement). */
  const [inlineError, setInlineError] = useState("");
  const inlineAbortControllerRef = useRef<AbortController | null>(null);

  const handleInlineSubmit = async () => {
    if (!inlinePrompt.trim() || !editorRef.current || isInlineLoading) return;
    const editor = editorRef.current;
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!model || !selection) return;

    const selectedCode = model.getValueInRange(selection);
    const prefix = model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: selection.startLineNumber,
      endColumn: selection.startColumn,
    });
    const suffix = model.getValueInRange({
      startLineNumber: selection.endLineNumber,
      startColumn: selection.endColumn,
      endLineNumber: model.getLineCount(),
      endColumn: model.getLineMaxColumn(model.getLineCount()),
    });

    setIsInlineLoading(true);
    const controller = new AbortController();
    inlineAbortControllerRef.current = controller;
    try {
      const codeToEdit = selectedCode || model.getLineContent(selection.startLineNumber);
      const inlineAi = resolveEditorAiConfig(settingsRef.current);
      let result = await executeInlineEdit({
        instruction: inlinePrompt,
        selectedCode: codeToEdit,
        surroundingPrefix: prefix,
        surroundingSuffix: suffix,
        settings: inlineAi,
        signal: controller.signal,
      });
      if (!result.ok && inlineAi.provider !== "ollama") {
        // Cloud key rejected (expired/revoked): retry locally instead of failing.
        result = await executeInlineEdit({
          instruction: inlinePrompt,
          selectedCode: codeToEdit,
          surroundingPrefix: prefix,
          surroundingSuffix: suffix,
          settings: {
            provider: "ollama",
            model: getAutoSelectedLocalWorker(),
            apiKey: "",
            baseUrl: "",
          },
          signal: controller.signal,
        });
      }
      if (!result.ok) {
        setInlineError(result.reason || "Inline edit failed.");
        return;
      }
      const replacement = result.replacement;

      if (replacement && monacoRef.current) {
        // Guard the selection too: a runaway answer would be inserted at the
        // cursor and wreck the file.
        const verdict = validateReplacement(replacement, codeToEdit);
        if (!verdict.ok) {
          setInlineError(verdict.reason);
          return;
        }
        const editRange = selectedCode.length > 0
          ? selection
          : new monacoRef.current.Range(
              selection.startLineNumber,
              1,
              selection.startLineNumber,
              model.getLineMaxColumn(selection.startLineNumber)
            );
        editor.executeEdits("acsa-inline", [{ range: editRange, text: replacement }]);
        setIsInlinePromptOpen(false);
        setInlinePrompt("");
        setInlineError("");
        editor.focus();
      }
    } catch (err) {
      console.error("Inline edit failed:", err);
    } finally {
      inlineAbortControllerRef.current = null;
      setIsInlineLoading(false);
    }
  };

  // ── ACSA file review ──────────────────────────────────────────────────
  const [reviewIssues, setReviewIssues] = useState<ReviewIssue[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  /** Provider/model that produced the last review, so degradation is visible. */
  const [reviewModel, setReviewModel] = useState("");
  const [reviewClean, setReviewClean] = useState(false);
  const [fixingIndex, setFixingIndex] = useState<number | null>(null);
  // Findings render as collapsible threads anchored at their line (CodeRabbit
  // style) instead of one panel listing everything. Each entry maps a finding
  // index to a Monaco view zone + its DOM node; heights are measured, not guessed.
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set());
  const [findingCursor, setFindingCursor] = useState(0);
  const reviewZoneIdsRef = useRef<Map<number, string>>(new Map());
  const reviewZoneNodesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const reviewZoneHeightsRef = useRef<Map<number, number>>(new Map());
  /** Measured height of a collapsed thread, reused for still-unmeasured ones. */
  const collapsedZoneHeightRef = useRef<number | null>(null);
  const [zoneEpoch, setZoneEpoch] = useState(0);

  const clearReviewMarkers = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (monaco && model) {
      monaco.editor.setModelMarkers(model, "acsa-review", []);
    }
  };

  /** Removes every inline finding thread from the editor. */
  const clearReviewZones = useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.changeViewZones((accessor) => {
        reviewZoneIdsRef.current.forEach((zoneId) => {
          try {
            accessor.removeZone(zoneId);
          } catch {}
        });
      });
    }
    reviewZoneIdsRef.current.clear();
    reviewZoneNodesRef.current.clear();
    reviewZoneHeightsRef.current.clear();
  }, []);

  /** Drops all review state (findings, squiggles, inline threads). */
  const clearReview = useCallback(() => {
    clearReviewZones();
    clearReviewMarkers();
    setReviewIssues([]);
    setExpandedFindings(new Set());
  }, [clearReviewZones]);

  const handleReviewFile = async () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || isReviewing) return;
    setIsReviewing(true);
    setReviewError("");
    try {
      const ai = resolveEditorAiConfig(settingsRef.current);
      let result = await reviewFile({
        path,
        content: editor.getValue(),
        language: getLanguage(path),
        settings: ai,
      });
      // A configured cloud key can still be rejected (expired / revoked / out of
      // credit). Rather than dead-ending the review, retry on the local worker —
      // and report the downgrade so it is never silent.
      if (!result.ok && ai.provider !== "ollama") {
        const localModel = getAutoSelectedLocalWorker();
        const retry = await reviewFile({
          path,
          content: editor.getValue(),
          language: getLanguage(path),
          settings: { provider: "ollama", model: localModel, apiKey: "", baseUrl: "" },
        });
        if (retry.ok) {
          result = {
            ...retry,
            note: `${ai.provider} request failed (${result.error || "error"}) — reviewed with local ${localModel} instead.`,
          };
        }
      }
      if (!result.ok) {
        clearReview();
        setReviewNote("");
        setReviewError(result.error || "Review failed.");
        return;
      }
      clearReviewZones();
      setExpandedFindings(new Set());
      setReviewIssues(result.issues);
      setReviewNote(result.note || "");
      setReviewModel(result.model ? `${result.provider || ""}/${result.model}` : "");
      if (result.warning) {
        // An unparseable response almost always means a small local model was
        // used; say so instead of leaving the user guessing.
        setReviewError(
          `${result.warning} ${result.model ? `Model: ${result.model}.` : ""}${
            result.note ? ` ${result.note}` : ""
          } A larger local or cloud model is needed for structured review output.`
        );
      }
      const hasFindings = result.issues.length > 0;
      setReviewClean(!hasFindings && !result.warning);
      if (!hasFindings && !result.warning) {
        window.setTimeout(() => setReviewClean(false), 3500);
      }
      // Findings render inline at their line, so bring the first one into view
      // (otherwise a review of a long file looks like it did nothing).
      if (hasFindings) {
        setFindingCursor(0);
        const firstIssue = result.issues[0];
        window.setTimeout(() => revealFinding(firstIssue.line, 0), 80);
      }

      const model = editor.getModel();
      if (model) {
        const lineCount = model.getLineCount();
        const markers = result.issues.map((issue) => {
          const line = Math.min(Math.max(1, issue.line || 1), lineCount);
          return {
            severity:
              issue.severity === "error"
                ? monaco.MarkerSeverity.Error
                : issue.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
            startLineNumber: line,
            startColumn: 1,
            endLineNumber: line,
            endColumn: model.getLineMaxColumn(line),
            message: `${issue.title}${issue.detail ? ` — ${issue.detail}` : ""}${
              issue.suggestion ? `\nFix: ${issue.suggestion}` : ""
            }`,
            source: "ACSA",
          };
        });
        monaco.editor.setModelMarkers(model, "acsa-review", markers);
      }
    } finally {
      setIsReviewing(false);
    }
  };

  const closeInlinePrompt = () => {
    inlineAbortControllerRef.current?.abort();
    inlineAbortControllerRef.current = null;
    setIsInlinePromptOpen(false);
    setIsInlineLoading(false);
    setInlineError("");
    editorRef.current?.focus();
  };

  /** Ask the model to fix a single review finding and apply the result. */
  const handleFixIssue = async (issue: ReviewIssue, index: number) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model || fixingIndex !== null) return;

    const lineCount = model.getLineCount();
    const line = Math.min(Math.max(1, issue.line || 1), lineCount);
    const start = Math.max(1, line - 10);
    const end = Math.min(lineCount, line + 10);
    const range = new monaco.Range(start, 1, end, model.getLineMaxColumn(end));
    const selectedCode = model.getValueInRange(range);
    const prefix = model.getValueInRange(new monaco.Range(1, 1, start, 1));
    const suffix = model.getValueInRange(
      new monaco.Range(end, model.getLineMaxColumn(end), lineCount, model.getLineMaxColumn(lineCount))
    );

    const instruction = [
      `Fix this reported issue on line ${line}: ${issue.title}.`,
      issue.detail ? `Why it is a problem: ${issue.detail}` : "",
      issue.suggestion ? `Suggested fix: ${issue.suggestion}` : "",
      "Change only what is required to fix this issue; preserve the surrounding code exactly.",
    ]
      .filter(Boolean)
      .join("\n");

    setFixingIndex(index);
    try {
      const fixAi = resolveEditorAiConfig(settingsRef.current);
      let result = await executeInlineEdit({
        instruction,
        selectedCode,
        surroundingPrefix: prefix.slice(-800),
        surroundingSuffix: suffix.slice(0, 800),
        settings: fixAi,
      });
      if (!result.ok && fixAi.provider !== "ollama") {
        result = await executeInlineEdit({
          instruction,
          selectedCode,
          surroundingPrefix: prefix.slice(-800),
          surroundingSuffix: suffix.slice(0, 800),
          settings: {
            provider: "ollama",
            model: getAutoSelectedLocalWorker(),
            apiKey: "",
            baseUrl: "",
          },
        });
      }
      if (result.ok && result.replacement && result.replacement.trim()) {
        // Never let a runaway answer (e.g. the whole file) land on a 21-line
        // range — that is what mangled the file. Validate first, and say why
        // when it is refused.
        const verdict = validateReplacement(result.replacement, selectedCode);
        if (!verdict.ok) {
          setReviewError(verdict.reason);
          setReviewNote("");
          return;
        }
        editor.executeEdits("acsa-fix", [{ range, text: result.replacement }]);
        // Line numbers of the other findings are no longer valid after this
        // edit, so drop them (and their inline threads) instead of acting on
        // stale offsets.
        clearReview();
        setReviewError("");
        setReviewNote("Applied a fix. Run Review again for the updated file.");
      } else if (!result.ok && result.reason) {
        setReviewError(result.reason);
      }
    } finally {
      setFixingIndex(null);
    }
  };

  // ── Inline finding threads (Monaco view zones) ────────────────────────
  const toggleFinding = (index: number) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  /**
   * Scrolls to a finding and opens its thread. Takes the line directly rather
   * than an index so it can be called right after a review completes, before
   * the new findings are visible to any callback closure.
   */
  const revealFinding = useCallback((line: number, index?: number) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !line) return;
    const target = Math.min(Math.max(1, line), model.getLineCount());
    editor.revealLineInCenter(target);
    editor.setPosition({ lineNumber: target, column: 1 });
    if (index !== undefined) {
      setExpandedFindings((prev) => new Set(prev).add(index));
    }
  }, []);

  const dismissFinding = (index: number) => {
    setReviewIssues((prev) => prev.filter((_, i) => i !== index));
    setExpandedFindings((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  /** Cheap first guess; the real height is measured once the card renders. */
  const estimateFindingHeight = (issue: ReviewIssue, expanded: boolean): number => {
    if (!expanded) return collapsedZoneHeightRef.current ?? 38;
    const chars = (issue.detail?.length || 0) + (issue.suggestion?.length || 0);
    return Math.min(MAX_REVIEW_CARD_HEIGHT, 38 + 150 + Math.ceil(chars / 55) * 15);
  };

  /**
   * Monaco owns the DOM node for a view zone, so the node must exist before the
   * render that portals the card into it (creating it in an effect would happen
   * one render too late and the portal would never mount).
   */
  const ensureReviewZoneNode = (index: number): HTMLDivElement => {
    let node = reviewZoneNodesRef.current.get(index);
    if (!node) {
      node = document.createElement("div");
      node.className = "acsa-review-zone";
      reviewZoneNodesRef.current.set(index, node);
    }
    return node;
  };

  const applyReviewZones = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const lineCount = model.getLineCount();
    editor.changeViewZones((accessor) => {
      reviewZoneIdsRef.current.forEach((zoneId) => {
        try {
          accessor.removeZone(zoneId);
        } catch {}
      });
      reviewZoneIdsRef.current.clear();

      const liveIndexes = new Set(reviewIssues.map((_, index) => index));
      reviewZoneNodesRef.current.forEach((_, index) => {
        if (!liveIndexes.has(index)) reviewZoneNodesRef.current.delete(index);
      });

      reviewIssues.forEach((issue, index) => {
        const node = ensureReviewZoneNode(index);
        const line = Math.min(Math.max(1, issue.line || 1), lineCount);
        const stored = reviewZoneHeightsRef.current.get(index);
        const height = Math.min(
          stored && stored <= MAX_REVIEW_CARD_HEIGHT
            ? stored
            : estimateFindingHeight(issue, expandedFindings.has(index)),
          MAX_REVIEW_CARD_HEIGHT
        );
        const zoneId = accessor.addZone({
          afterLineNumber: line,
          heightInPx: height,
          domNode: node,
        });
        reviewZoneIdsRef.current.set(index, zoneId);
      });

    });
  }, [reviewIssues, expandedFindings, collapsedZoneHeightRef]);

  /**
   * Measures the cards Monaco has actually laid out and records their height.
   * Runs on the next frame after zones are added (Monaco attaches the node
   * during its own render) and again on scroll, so a card that scrolls into
   * view is sized correctly too.
   */
  const measureVisibleZones = useCallback(() => {
    let changed = false;
    reviewZoneNodesRef.current.forEach((node, index) => {
      if (!node.isConnected || node.style.display === "none") return;
      // Measure the card itself, never the wrapper. The wrapper is absolutely
      // positioned and full-height, so measuring it returned the zone's own
      // height — and adding the gap each pass turned the measurement into a
      // feedback loop that grew a zone to ~90,000px and pushed the file off
      // screen.
      const card =
        (node.querySelector(".acsa-review-card") as HTMLElement | null) ||
        (node.firstElementChild as HTMLElement | null);
      if (!card) return;
      const measured = Math.ceil(card.getBoundingClientRect().height) + 6;
      if (measured <= 8) return; // not laid out yet
      // A single thread is never this tall; ignore anything implausible rather
      // than letting it ratchet.
      if (measured > MAX_REVIEW_CARD_HEIGHT) return;
      const previous = reviewZoneHeightsRef.current.get(index);
      if (previous === undefined || Math.abs(previous - measured) > 2) {
        reviewZoneHeightsRef.current.set(index, measured);
        if (!expandedFindings.has(index)) collapsedZoneHeightRef.current = measured;
        changed = true;
      }
    });
    return changed;
  }, [expandedFindings]);

  // Re-run whenever findings/expansion change; a late measurement also bumps
  // zoneEpoch to re-apply with the corrected heights.
  useEffect(() => {
    applyReviewZones();
    const frame = window.requestAnimationFrame(() => {
      if (measureVisibleZones()) setZoneEpoch((epoch) => epoch + 1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [applyReviewZones, measureVisibleZones, zoneEpoch, path]);

  // Zones scrolled into view were never measurable while hidden; size them now.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let timer: number | undefined;
    const subscription = editor.onDidScrollChange(() => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (measureVisibleZones()) setZoneEpoch((epoch) => epoch + 1);
      }, 120);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      subscription.dispose();
    };
  }, [measureVisibleZones]);

  // Highlight each finding's line and let the gutter glyph toggle its thread.
  const decorationIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    const lineCount = model.getLineCount();

    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      reviewIssues.map((issue) => {
        const line = Math.min(Math.max(1, issue.line || 1), lineCount);
        return {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: `acsa-review-line acsa-review-line-${issue.severity}`,
          },
        };
      })
    );

    const subscription = editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = event.target.position?.lineNumber;
      if (!line) return;
      const index = reviewIssues.findIndex(
        (issue) => Math.min(Math.max(1, issue.line || 1), lineCount) === line
      );
      if (index >= 0) toggleFinding(index);
    });
    return () => subscription.dispose();
  }, [reviewIssues]);

  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor && decorationIdsRef.current.length) {
        editor.deltaDecorations(decorationIdsRef.current, []);
        decorationIdsRef.current = [];
      }
      clearReviewZones();
    };
  }, [clearReviewZones]);

  // Escape always closes the inline prompt, even when the editor has focus.
  useEffect(() => {
    if (!isInlinePromptOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeInlinePrompt();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInlinePromptOpen]);

  // Drop stale findings and markers when the editor switches files.
  useEffect(() => {
    clearReview();
    setReviewError("");
    setReviewNote("");
  }, [path, clearReview]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    // The TypeScript contribution (and its worker) only exists once a JS/TS
    // model has been created, so configure it here rather than in beforeMount.
    configureMonacoTypeScript(monaco, projectRoot);

    editorRef.current = editor;
    monacoRef.current = monaco;

    selectionDisposableRef.current = editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      onSelectionChange?.(selection && model ? model.getValueInRange(selection) : "");
    });

    // Apply active theme
    applyMonacoTheme(monaco, themeId);

    // Register AI Ghost Text Autocomplete
    if (!aiDisposableRef.current) {
      aiDisposableRef.current = registerAiInlineCompletions(monaco, () =>
        resolveEditorAiConfig(settingsRef.current)
      );
    }

    // Reveal target line if provided
    if (targetLine && targetLine > 0) {
      editor.revealLineInCenter(targetLine);
      editor.setPosition({
        lineNumber: targetLine,
        column: targetColumn && targetColumn > 0 ? targetColumn : 1,
      });
    }

    // Register Cmd+S / Ctrl+S save shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave(path);
    });

    // Register Cmd+K / Ctrl+K inline edit prompt
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      setInlineError("");
      setIsInlinePromptOpen(true);
    });

    editor.focus();
  };

  useEffect(() => {
    if (editorRef.current && targetLine && targetLine > 0) {
      editorRef.current.revealLineInCenter(targetLine);
      editorRef.current.setPosition({
        lineNumber: targetLine,
        column: targetColumn && targetColumn > 0 ? targetColumn : 1,
      });
      editorRef.current.focus();
    }
  }, [targetLine, targetColumn, revealTrigger, path]);

  useEffect(() => {
    return () => {
      if (aiDisposableRef.current) {
        aiDisposableRef.current.dispose();
        aiDisposableRef.current = null;
      }
      selectionDisposableRef.current?.dispose();
      selectionDisposableRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-full w-full bg-workbench overflow-hidden">
      {/* ── AI Review Controls ──────────────────────────────────────── */}
      <div className="absolute top-2 right-3 z-40 flex items-center gap-2">
        <button
          type="button"
          onClick={handleReviewFile}
          disabled={isReviewing || !isReviewableFile(path)}
          title={
            isReviewableFile(path)
              ? "Review this file for bugs, errors and refactor opportunities"
              : "This file type is not reviewable"
          }
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-zinc-800/85 hover:bg-zinc-700 border border-zinc-700/70 text-zinc-200 backdrop-blur-sm transition-colors disabled:opacity-40"
        >
          {isReviewing ? (
            <span className="w-3 h-3 rounded-full border border-zinc-300 border-t-transparent animate-spin" />
          ) : (
            <span>🔍</span>
          )}
          <span>{isReviewing ? "Reviewing…" : reviewClean ? "✓ Clean" : "Review"}</span>
        </button>
        {!isReviewing && reviewModel && (
          <span
            className="px-1.5 py-1 rounded-md text-[10px] font-mono bg-zinc-800/85 border border-zinc-700/70 text-zinc-400"
            title={`Review ran on ${reviewModel}`}
          >
            {reviewModel.split("/").pop()}
          </span>
        )}
        {!isReviewing && reviewIssues.length > 0 && (
          <button
            type="button"
            title="Jump to the next finding"
            onClick={() => {
              const index = findingCursor % reviewIssues.length;
              revealFinding(reviewIssues[index]?.line, index);
              setFindingCursor((cursor) => cursor + 1);
            }}
            className="px-1.5 py-1 rounded-md text-[11px] font-mono bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 backdrop-blur-sm transition-colors"
          >
            {reviewIssues.length} ↓
          </button>
        )}
        {reviewIssues.length > 0 && (
          <button
            type="button"
            onClick={clearReview}
            title="Clear all review findings"
            className="px-2 py-1 rounded-md text-[11px] bg-zinc-800/85 hover:bg-zinc-700 border border-zinc-700/70 text-zinc-300"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Review status (errors / notes) ───────────────────────── */}
      {(reviewError || reviewNote) && (
        <div
          className={`absolute top-11 right-3 z-40 max-w-[320px] px-2.5 py-1.5 rounded-md text-[11px] leading-snug backdrop-blur-sm border ${
            reviewError
              ? "bg-red-500/10 border-red-500/30 text-red-300"
              : "bg-amber-500/10 border-amber-500/30 text-amber-300"
          }`}
        >
          {reviewError || reviewNote}
        </div>
      )}

      {/* ── Inline finding threads, anchored at each finding's line ── */}
      {reviewIssues.map((issue, index) => {
        const node = ensureReviewZoneNode(index);
        const expanded = expandedFindings.has(index);
        return createPortal(
          <div className="acsa-review-card-wrap absolute inset-x-0 top-0">
            <div
              className={`acsa-review-card rounded-lg border shadow-lg overflow-hidden font-sans ${
                issue.severity === "error"
                  ? "border-red-500/40 bg-[#1b1315]"
                  : issue.severity === "warning"
                  ? "border-amber-500/40 bg-[#1b1710]"
                  : "border-sky-500/40 bg-[#111820]"
              }`}
            >
              <button
                type="button"
                onClick={() => toggleFinding(index)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-white/[0.04] transition-colors"
                title={expanded ? "Collapse" : "Expand"}
              >
                <span
                  className={`text-[9px] font-mono px-1 py-0.5 rounded shrink-0 ${
                    issue.severity === "error"
                      ? "bg-red-500/25 text-red-300"
                      : issue.severity === "warning"
                      ? "bg-amber-500/25 text-amber-300"
                      : "bg-sky-500/25 text-sky-300"
                  }`}
                >
                  {issue.severity}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono shrink-0">L{issue.line}</span>
                <span className="flex-1 min-w-0 truncate text-[11px] font-medium text-zinc-200">
                  {issue.title}
                </span>
                <Icon
                  icon={expanded ? ChevronDown : ChevronRight}
                  size="xs"
                  className="text-zinc-400 shrink-0"
                />
                <span
                  role="button"
                  tabIndex={0}
                  title="Dismiss this finding"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismissFinding(index);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.stopPropagation();
                      dismissFinding(index);
                    }
                  }}
                  className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/10 shrink-0"
                >
                  <Icon icon={X} size="xs" />
                </span>
              </button>
              {expanded && (
                <div className="px-2.5 pb-2 space-y-1.5 border-t border-white/[0.06] pt-1.5">
                  {issue.detail && (
                    <p className="text-[11px] text-zinc-400 leading-snug whitespace-pre-wrap m-0">
                      {issue.detail}
                    </p>
                  )}
                  {issue.suggestion && (
                    <p className="text-[11px] text-emerald-300/90 leading-snug whitespace-pre-wrap m-0">
                      Fix: {issue.suggestion}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      disabled={fixingIndex !== null}
                      onClick={() => handleFixIssue(issue, index)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-600/80 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
                    >
                      <Icon icon={Sparkles} size="xs" />
                      {fixingIndex === index ? "Fixing…" : "Fix with AI"}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissFinding(index)}
                      className="px-2 py-0.5 rounded text-[10px] bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          node,
          `finding-${index}`
        );
      })}

      {/* Click-away backdrop so the inline prompt can always be dismissed */}
      {isInlinePromptOpen && (
        <div className="absolute inset-0 z-40" onMouseDown={closeInlinePrompt} />
      )}

      {/* Floating Cmd+K Inline Edit Overlay */}
      {isInlinePromptOpen && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[540px] max-w-[92%] bg-[#18181b]/95 backdrop-blur-xl border border-purple-500/50 rounded-xl shadow-2xl p-2.5 z-50 animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
              <span>✨</span>
              <span>ACSA Inline Edit</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-mono">
                {resolveEditorAiConfig(settingsRef.current).model || "Active AI"}
              </span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 font-mono">Cmd+K</span>
              <button
                type="button"
                onClick={closeInlinePrompt}
                title="Close (Esc)"
                className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inlinePrompt}
              onChange={(e) => setInlinePrompt(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  await handleInlineSubmit();
                } else if (e.key === "Escape") {
                  inlineAbortControllerRef.current?.abort();
                  setIsInlinePromptOpen(false);
                  editorRef.current?.focus();
                }
              }}
              placeholder="Describe changes or ask AI to edit code... (Enter to apply, Esc to cancel)"
              className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-purple-500 transition-colors"
              autoFocus
            />
            <button
              type="button"
              onClick={handleInlineSubmit}
              disabled={isInlineLoading || !inlinePrompt.trim()}
              className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium transition-colors shrink-0 flex items-center gap-1.5"
            >
              {isInlineLoading && <span className="w-2.5 h-2.5 rounded-full border border-white border-t-transparent animate-spin" />}
              <span>{isInlineLoading ? "Generating..." : "Apply"}</span>
            </button>
            <button
              type="button"
              onClick={closeInlinePrompt}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors shrink-0"
            >
              Cancel
            </button>
          </div>
          {inlineError && (
            <div className="mt-1.5 flex items-start gap-1.5 px-1 text-[11px] text-amber-300">
              <Icon icon={AlertCircle} className="w-3 h-3 shrink-0 mt-0.5" />
              <span className="leading-snug">{inlineError}</span>
            </div>
          )}
        </div>
      )}

      <Editor
        path={path}
        height="100%"
        width="100%"
        language={getLanguage(path)}
        value={content}
        theme={themeId}
        beforeMount={(monaco) => {
          applyMonacoTheme(monaco, themeId);
          configureMonacoTypeScript(monaco, projectRoot);
        }}
        onChange={(val) => onChange(val || "")}
        onMount={handleEditorDidMount}
        options={{
          // Editor preferences from Settings. These were previously hardcoded
          // here, which is why the Font and Code Style panes appeared to save
          // values that changed nothing.
          fontSize: aiSettings?.fontSize ?? 13,
          lineHeight: aiSettings?.lineHeight ? Math.round((aiSettings.lineHeight) * (aiSettings?.fontSize ?? 13)) : 0,
          fontLigatures: aiSettings?.enableLigatures ?? true,
          fontFamily: "var(--ide-font-family, 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace)",
          lineNumbers: "on",
          renderWhitespace: "selection",
          renderLineHighlight: "all",
          renderLineHighlightOnlyWhenFocus: false,
          tabSize: aiSettings?.tabSize ?? 4,
          insertSpaces: aiSettings?.insertSpaces ?? true,
          wordWrap: aiSettings?.wordWrap ? "on" : "off",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          minimap: { enabled: true, maxColumn: 80 },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          inlineSuggest: { enabled: true },
          suggest: {
            preview: true,
            showMethods: true,
            showFunctions: true,
            showConstructors: true,
            showFields: true,
            showVariables: true,
            showClasses: true,
            showStructs: true,
            showInterfaces: true,
            showModules: true,
            showProperties: true,
          },
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}

export default MonacoEditorContainer;
