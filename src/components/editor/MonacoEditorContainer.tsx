/**
 * MonacoEditorContainer.tsx — Real Monaco Editor Component for ACSA Code
 *
 * Integrates @monaco-editor/react with:
 * 1. Syntax highlighting & TextMate tokenization for all major languages.
 * 2. VS Code settings (minimap, bracket colorization, indentation guides).
 * 3. Copilot-style AI inline completions (ghost text) with FIM.
 * 4. Cmd+S / Ctrl+S keyboard shortcuts to save to physical disk.
 */

import { useRef, useEffect } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as MonacoType from "monaco-editor";
import { registerAiInlineCompletions } from "../../services/aiAutocomplete";
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
    <div className="h-full w-full bg-workbench overflow-hidden">
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
