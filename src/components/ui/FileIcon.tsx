/**
 * FileIcon.tsx — Authentic Language & File Type Icons
 *
 * Provides crisp, recognizable icons matching VS Code / JetBrains / Seti
 * for all programming languages, configurations, frameworks, and special folders.
 */

import {
  Folder,
  FolderOpen,
  FileText,
  Lock,
  Key,
  Sliders,
  Terminal,
  Database,
  Image,
  Package,
  Settings2,
  BookOpen,
  FileCode2,
  FileJson2,
} from "lucide-react";

interface FileIconProps {
  fileName: string;
  isDir?: boolean;
  isOpen?: boolean;
  className?: string;
}

export function FileIcon({
  fileName,
  isDir = false,
  isOpen = false,
  className = "w-4 h-4 shrink-0",
}: FileIconProps) {
  const lower = fileName.toLowerCase();

  // ── Special Folder Icons ──────────────────────────────────────────────────
  if (isDir) {
    if (lower === "src") {
      return (
        <span className={`inline-flex items-center justify-center text-blue-400 ${className}`}>
          {isOpen ? <FolderOpen className="w-full h-full" /> : <Folder className="w-full h-full" />}
        </span>
      );
    }
    if (lower === "node_modules") {
      return (
        <span className={`inline-flex items-center justify-center text-emerald-500 ${className}`}>
          {isOpen ? <FolderOpen className="w-full h-full" /> : <Folder className="w-full h-full" />}
        </span>
      );
    }
    if (lower === ".git" || lower === ".github") {
      return (
        <span className={`inline-flex items-center justify-center text-orange-400 ${className}`}>
          {isOpen ? <FolderOpen className="w-full h-full" /> : <Folder className="w-full h-full" />}
        </span>
      );
    }
    if (lower === "dist" || lower === "build" || lower === "out") {
      return (
        <span className={`inline-flex items-center justify-center text-purple-400 ${className}`}>
          {isOpen ? <FolderOpen className="w-full h-full" /> : <Folder className="w-full h-full" />}
        </span>
      );
    }
    if (lower === "core-engine" || lower === "compiler" || lower === "gauntlet") {
      return (
        <span className={`inline-flex items-center justify-center text-amber-400 ${className}`}>
          {isOpen ? <FolderOpen className="w-full h-full" /> : <Folder className="w-full h-full" />}
        </span>
      );
    }
    if (lower === "models" || lower === "cache" || lower === ".tauri") {
      return (
        <span className={`inline-flex items-center justify-center text-sky-400 ${className}`}>
          {isOpen ? <FolderOpen className="w-full h-full" /> : <Folder className="w-full h-full" />}
        </span>
      );
    }

    // Default Folder (Crisp amber/slate)
    return isOpen ? (
      <FolderOpen className={`text-amber-400/90 ${className}`} />
    ) : (
      <Folder className={`text-amber-400/90 ${className}`} />
    );
  }

  // ── Exact File Matches ────────────────────────────────────────────────────
  if (lower === "package.json" || lower === "package-lock.json") {
    // Red NPM cube
    return (
      <span className={`inline-flex items-center justify-center text-red-500 font-bold ${className}`} title="npm">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M1 4h22v16H1V4zm2 2v12h5V8h4v8h9V6H3z" />
        </svg>
      </span>
    );
  }

  if (lower === "cargo.toml" || lower === "cargo.lock") {
    // Rust Cargo crate
    return <Package className={`text-orange-500 ${className}`} />;
  }

  if (lower === "tsconfig.json" || lower === "vite.config.ts" || lower === "vite.config.js") {
    return <Settings2 className={`text-blue-400 ${className}`} />;
  }

  if (lower.startsWith(".env")) {
    return <Key className={`text-yellow-400 ${className}`} />;
  }

  if (lower === ".gitignore" || lower === ".gitattributes") {
    return (
      <span className={`inline-flex items-center justify-center text-orange-500 ${className}`} title="Git">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M19 13.5a3.5 3.5 0 0 0-2.4 1l-3.3-2a3.5 3.5 0 0 0 .2-.9c0-.3 0-.6-.1-.9l3.3-2A3.5 3.5 0 1 0 15 5c0 .3 0 .6.1.9l-3.3 2a3.5 3.5 0 1 0 0 6.2l3.3 2c-.1.3-.1.6-.1.9a3.5 3.5 0 1 0 4-3.5z" />
        </svg>
      </span>
    );
  }

  if (lower === "dockerfile" || lower.startsWith("docker-compose")) {
    return (
      <span className={`inline-flex items-center justify-center text-sky-400 ${className}`} title="Docker">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M22.5 12.3c-.3-.2-.8-.2-1.1 0-.4.3-.8.7-1.3.8-1.2.2-2.3-.5-2.7-1.7-.1-.3-.3-.5-.6-.5-.3 0-.5.2-.6.5-.4 1.2-1.5 1.9-2.7 1.7-.5-.1-.9-.5-1.3-.8-.3-.2-.8-.2-1.1 0-.4.3-.8.7-1.3.8-1.2.2-2.3-.5-2.7-1.7-.1-.3-.3-.5-.6-.5-.4 0-.6.2-.7.5C0 17 3 20.5 7.5 20.5c5 0 8.5-3 14.5-3 .3 0 .7 0 1-.1.4-.1.8-.4 1-.8.2-.4.1-.9-.1-1.2l-1.4-3.1zM5 8h2v2H5V8zm3 0h2v2H8V8zm3 0h2v2h-2V8zm-6 3h2v2H5v-2zm3 0h2v2H8v-2zm3 0h2v2h-2v-2zm3 0h2v2h-2v-2zm3 0h2v2h-2v-2z" />
        </svg>
      </span>
    );
  }

  // ── Language Extension Matches ────────────────────────────────────────────

  // TypeScript / TSX
  if (lower.endsWith(".tsx")) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-[3px] bg-[#3178c6]/20 text-[#3178c6] border border-[#3178c6]/40 font-mono text-[9px] font-black px-0.5 leading-none shrink-0 ${className}`}
        title="React TypeScript (TSX)"
      >
        TSX
      </span>
    );
  }

  if (lower.endsWith(".ts")) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-[3px] bg-[#3178c6] text-white font-mono text-[9px] font-black px-0.5 leading-none shrink-0 ${className}`}
        title="TypeScript (TS)"
      >
        TS
      </span>
    );
  }

  // JavaScript / JSX
  if (lower.endsWith(".jsx")) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-[3px] bg-[#f7df1e]/20 text-[#f7df1e] border border-[#f7df1e]/40 font-mono text-[9px] font-black px-0.5 leading-none shrink-0 ${className}`}
        title="React JavaScript (JSX)"
      >
        JSX
      </span>
    );
  }

  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-[3px] bg-[#f7df1e] text-black font-mono text-[9px] font-black px-0.5 leading-none shrink-0 ${className}`}
        title="JavaScript (JS)"
      >
        JS
      </span>
    );
  }

  // Python
  if (lower.endsWith(".py")) {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 ${className}`} title="Python">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5">
          <path
            fill="#3776AB"
            d="M11.9 2c-3.1 0-4.9 1.4-4.9 3.3v2.2h5v.6H4.7c-2 0-3.7 1.4-3.7 3.6 0 2.2 1.6 3.6 3.7 3.6h1.7v-2.2c0-1.9 1.8-3.3 4.9-3.3h5v-.6c0-1.9-1.8-3.6-4.4-3.6V2zm-2.4 1.7a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z"
          />
          <path
            fill="#FFD43B"
            d="M12.1 22c3.1 0 4.9-1.4 4.9-3.3v-2.2h-5v-.6h7.3c2 0 3.7-1.4 3.7-3.6 0-2.2-1.6-3.6-3.7-3.6h-1.7v2.2c0 1.9-1.8 3.3-4.9 3.3h-5v.6c0 1.9 1.8 3.6 4.4 3.6V22zm2.4-1.7a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6z"
          />
        </svg>
      </span>
    );
  }

  // Rust
  if (lower.endsWith(".rs")) {
    return (
      <span className={`inline-flex items-center justify-center text-[#DEA584] shrink-0 ${className}`} title="Rust">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.9h-2v-1.8h2zm0-3.6h-2V7.1h2z" />
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
        </svg>
      </span>
    );
  }

  // JSON
  if (lower.endsWith(".json")) {
    return <FileJson2 className={`text-amber-400 ${className}`} />;
  }

  // Markdown
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return (
      <span className={`inline-flex items-center justify-center text-blue-400 shrink-0 ${className}`} title="Markdown">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M2 4h20a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm3 12h2v-5l2 2.5 2-2.5v5h2V8h-2l-2 2.5L7 8H5v8zm11 0h2v-4h2l-3-3.5L14 12h2v4z" />
        </svg>
      </span>
    );
  }

  // HTML
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return <FileCode2 className={`text-orange-500 ${className}`} />;
  }

  // CSS / SCSS / LESS
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".sass") || lower.endsWith(".less")) {
    return (
      <span className={`inline-flex items-center justify-center text-sky-400 font-mono font-bold text-xs ${className}`}>
        #
      </span>
    );
  }

  // YAML / TOML
  if (lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".toml")) {
    return <Sliders className={`text-purple-400 ${className}`} />;
  }

  // Shell / Bash / Zsh
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) {
    return <Terminal className={`text-emerald-400 ${className}`} />;
  }

  // SQL
  if (lower.endsWith(".sql")) {
    return <Database className={`text-cyan-400 ${className}`} />;
  }

  // Images
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".ico")
  ) {
    return <Image className={`text-violet-400 ${className}`} />;
  }

  // Locks
  if (lower.endsWith(".lock")) {
    return <Lock className={`text-zinc-400 ${className}`} />;
  }

  // License / Docs
  if (lower === "license" || lower.startsWith("license.")) {
    return <BookOpen className={`text-amber-400 ${className}`} />;
  }

  // Default File
  return <FileText className={`text-zinc-400 ${className}`} />;
}

export default FileIcon;
