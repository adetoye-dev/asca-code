/**
 * MonacoEditorContainer.tsx — Real Monaco Editor Component for ACSA Code
 *
 * Integrates @monaco-editor/react with:
 * 1. Syntax highlighting & TextMate tokenization for all major languages.
 * 2. VS Code settings (minimap, bracket colorization, indentation guides).
 * 3. Copilot-style AI inline completions (ghost text) with FIM.
 * 4. Cmd+S / Ctrl+S keyboard shortcuts to save to physical disk.
 */

import { useRef, useEffect, useState } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as MonacoType from "monaco-editor";
import { registerAiInlineCompletions, executeInlineEdit } from "../../services/aiAutocomplete";
import { applyMonacoTheme } from "../../services/themeManager";
import type { AISettings } from "../SettingsModal";

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
}: MonacoEditorContainerProps) {
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoType | null>(null);
  const aiDisposableRef = useRef<MonacoType.IDisposable | null>(null);
  const selectionDisposableRef = useRef<MonacoType.IDisposable | null>(null);
  const settingsRef = useRef(aiSettings);

  useEffect(() => {
    settingsRef.current = aiSettings;
  }, [aiSettings]);

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
    try {
      const codeToEdit = selectedCode || model.getLineContent(selection.startLineNumber);
      const replacement = await executeInlineEdit({
        instruction: inlinePrompt,
        selectedCode: codeToEdit,
        surroundingPrefix: prefix,
        surroundingSuffix: suffix,
        settings: settingsRef.current,
      });

      if (replacement && monacoRef.current) {
        const editRange = selectedCode.length > 0
          ? selection
          : new monacoRef.current.Range(
              selection.startLineNumber,
              1,
              selection.startLineNumber,
              model.getLineMaxColumn(selection.startLineNumber)
            );
        editor.executeEdits("copilot-inline", [{ range: editRange, text: replacement }]);
        setIsInlinePromptOpen(false);
        setInlinePrompt("");
        editor.focus();
      }
    } catch (err) {
      console.error("Inline edit failed:", err);
    } finally {
      setIsInlineLoading(false);
    }
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
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
      aiDisposableRef.current = registerAiInlineCompletions(monaco, () => settingsRef.current);
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

    // Register Cmd+K / Ctrl+K inline Copilot prompt
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
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
      {/* Floating Copilot Cmd+K Prompt Overlay */}
      {isInlinePromptOpen && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[540px] max-w-[92%] bg-[#18181b]/95 backdrop-blur-xl border border-purple-500/50 rounded-xl shadow-2xl p-2.5 z-50 animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
              <span>✨</span>
              <span>Copilot Inline Edit</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-mono">
                {settingsRef.current.model || "Active AI"}
              </span>
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">Cmd+K</span>
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
                  setIsInlinePromptOpen(false);
                  editorRef.current?.focus();
                }
              }}
              placeholder="Describe changes or ask AI to edit code... (Enter to apply, Esc to cancel)"
              className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-purple-500 transition-colors"
              autoFocus
              disabled={isInlineLoading}
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
              onClick={() => {
                setIsInlinePromptOpen(false);
                editorRef.current?.focus();
              }}
              disabled={isInlineLoading}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors shrink-0"
            >
              Cancel
            </button>
          </div>
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
        }}
        onChange={(val) => onChange(val || "")}
        onMount={handleEditorDidMount}
        options={{
          fontSize: 13,
          fontFamily: "var(--ide-font-family, 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace)",
          lineNumbers: "on",
          renderWhitespace: "selection",
          renderLineHighlight: "all",
          renderLineHighlightOnlyWhenFocus: false,
          tabSize: 4,
          insertSpaces: true,
          wordWrap: "off",
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
