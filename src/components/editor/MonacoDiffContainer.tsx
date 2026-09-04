/**
 * MonacoDiffContainer.tsx — Real Monaco Diff Inspector
 *
 * Renders unified or side-by-side git diffs using @monaco-editor/react's <DiffEditor />.
 * Allows developers to review autonomous agent patches with exact VS Code diff decorations.
 */

import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Check, X, Split, AlignJustify } from "lucide-react";

interface MonacoDiffContainerProps {
  originalContent: string;
  modifiedContent: string;
  filePath: string;
  onAccept?: () => void;
  onReject?: () => void;
}

export function MonacoDiffContainer({
  originalContent,
  modifiedContent,
  filePath,
  onAccept,
  onReject,
}: MonacoDiffContainerProps) {
  const [renderSideBySide, setRenderSideBySide] = useState(true);

  const getLanguage = (path: string): string => {
    if (path.endsWith(".py")) return "python";
    if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
    if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
    if (path.endsWith(".json")) return "json";
    if (path.endsWith(".md")) return "markdown";
    if (path.endsWith(".rs")) return "rust";
    return "plaintext";
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e1e] overflow-hidden select-none">
      {/* Diff Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#333333] text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-300">Diff Review:</span>
          <span className="font-mono text-zinc-400">{filePath || "patch.diff"}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle Side-by-side vs Inline */}
          <button
            type="button"
            onClick={() => setRenderSideBySide(!renderSideBySide)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#2d2d2d] hover:bg-[#383838] border border-[#404040] text-zinc-300 text-xs transition-colors"
            title={renderSideBySide ? "Switch to Inline View" : "Switch to Side-by-Side View"}
          >
            {renderSideBySide ? (
              <>
                <AlignJustify className="w-3.5 h-3.5" />
                <span>Inline</span>
              </>
            ) : (
              <>
                <Split className="w-3.5 h-3.5" />
                <span>Side-by-Side</span>
              </>
            )}
          </button>

          {onReject && (
            <button
              type="button"
              onClick={onReject}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-300 text-xs font-medium transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reject</span>
            </button>
          )}

          {onAccept && (
            <button
              type="button"
              onClick={onAccept}
              className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Accept Patch</span>
            </button>
          )}
        </div>
      </div>

      {/* Monaco Diff Editor Surface */}
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          height="100%"
          width="100%"
          language={getLanguage(filePath)}
          original={originalContent}
          modified={modifiedContent}
          theme="vs-dark"
          options={{
            renderSideBySide,
            fontSize: 13,
            fontFamily: "var(--ide-font-family, 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace)",
            lineNumbers: "on",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            readOnly: true,
            minimap: { enabled: false },
          }}
        />
      </div>
    </div>
  );
}

export default MonacoDiffContainer;
