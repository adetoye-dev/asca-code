/**
 * FileIcon.tsx — Authentic Language, Tech & File Type Icons
 *
 * Provides official, unaltered brand vector icons directly preserved from
 * source-of-truth registries (bablubambal/All_logo_and_pictures, official repos)
 * via TechLogo, integrated with ACSA Code design system size tokens and folders.
 */

import { FileText, Key, Lock, Image as ImageIcon, BookOpen, Settings, Folder, FolderOpen } from "lucide-react";
import { Icon } from "../ui/Icon.js";
import { TechLogo, resolveTechId, computeLogoStyle, type LogoSize } from "./TechLogos.js";

export interface FileIconProps {
  fileName: string;
  isDir?: boolean;
  isOpen?: boolean;
  className?: string;
  size?: LogoSize;
}

export function FileIcon({
  fileName,
  isDir = false,
  isOpen = false,
  className = "w-4 h-4 shrink-0",
  size,
}: FileIconProps) {
  const lower = fileName.toLowerCase();
  const basename = fileName.split(/[/\\]/).pop()?.toLowerCase() || lower;
  const folderStyle = computeLogoStyle(size);

  // ── Special Folder Icons ──────────────────────────────────────────────────
  if (isDir) {
    if (basename === "src") {
      return (
        <span
          className={`inline-flex items-center justify-center text-blue-400 ${className}`}
          style={folderStyle}
        >
          {isOpen ? <Icon icon={FolderOpen} className="w-full h-full" /> : <Icon icon={Folder} className="w-full h-full" />}
        </span>
      );
    }
    if (basename === "node_modules") {
      return (
        <span
          className={`inline-flex items-center justify-center text-emerald-500 ${className}`}
          style={folderStyle}
        >
          {isOpen ? <Icon icon={FolderOpen} className="w-full h-full" /> : <Icon icon={Folder} className="w-full h-full" />}
        </span>
      );
    }
    if (basename === ".git" || basename === ".github") {
      return (
        <span
          className={`inline-flex items-center justify-center text-orange-400 ${className}`}
          style={folderStyle}
        >
          {isOpen ? <Icon icon={FolderOpen} className="w-full h-full" /> : <Icon icon={Folder} className="w-full h-full" />}
        </span>
      );
    }
    if (basename === "dist" || basename === "build" || basename === "out") {
      return (
        <span
          className={`inline-flex items-center justify-center text-purple-400 ${className}`}
          style={folderStyle}
        >
          {isOpen ? <Icon icon={FolderOpen} className="w-full h-full" /> : <Icon icon={Folder} className="w-full h-full" />}
        </span>
      );
    }
    if (basename === "core-engine" || basename === "compiler" || basename === "gauntlet") {
      return (
        <span
          className={`inline-flex items-center justify-center text-amber-400 ${className}`}
          style={folderStyle}
        >
          {isOpen ? <Icon icon={FolderOpen} className="w-full h-full" /> : <Icon icon={Folder} className="w-full h-full" />}
        </span>
      );
    }
    if (basename === "models" || basename === "cache" || basename === ".tauri") {
      return (
        <span
          className={`inline-flex items-center justify-center text-sky-400 ${className}`}
          style={folderStyle}
        >
          {isOpen ? <Icon icon={FolderOpen} className="w-full h-full" /> : <Icon icon={Folder} className="w-full h-full" />}
        </span>
      );
    }

    // Default Folder (Crisp amber/slate)
    return (
      <span className={`inline-flex items-center justify-center ${className}`} style={folderStyle}>
        {isOpen ? (
          <Icon icon={FolderOpen} className="w-full h-full text-amber-400/90" />
        ) : (
          <Icon icon={Folder} className="w-full h-full text-amber-400/90" />
        )}
      </span>
    );
  }

  // ── Exact Non-Tech File Matches ───────────────────────────────────────────
  if (basename === ".env" || basename.startsWith(".env.")) {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} style={folderStyle}>
        <Icon icon={Key} className="w-full h-full text-yellow-400" />
      </span>
    );
  }

  if (basename === "license" || basename.startsWith("license.") || basename.startsWith("licence")) {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} style={folderStyle}>
        <Icon icon={BookOpen} className="w-full h-full text-amber-400" />
      </span>
    );
  }

  if (
    basename.endsWith(".png") ||
    basename.endsWith(".jpg") ||
    basename.endsWith(".jpeg") ||
    basename.endsWith(".gif") ||
    basename.endsWith(".svg") ||
    basename.endsWith(".webp") ||
    basename.endsWith(".ico")
  ) {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} style={folderStyle}>
        <Icon icon={ImageIcon} className="w-full h-full text-violet-400" />
      </span>
    );
  }

  // ── Official Tech Logo Matching ───────────────────────────────────────────
  // Resolves official tech logos, including tech-specific lockfiles (cargo.lock, gemfile.lock, etc.)
  const techId = resolveTechId(fileName);
  if (techId) {
    return <TechLogo techId={techId} size={size} className={className} />;
  }

  // Generic Non-tech Lock files
  if (basename.endsWith(".lock")) {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} style={folderStyle}>
        <Icon icon={Lock} className="w-full h-full text-zinc-400" />
      </span>
    );
  }

  // Generic Configs / Fallbacks
  if (basename.endsWith(".yaml") || basename.endsWith(".yml") || basename.endsWith(".toml")) {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} style={folderStyle}>
        <Icon icon={Settings} className="w-full h-full text-purple-400" />
      </span>
    );
  }

  // Default Generic File
  return (
    <span className={`inline-flex items-center justify-center ${className}`} style={folderStyle}>
      <Icon icon={FileText} className="w-full h-full text-zinc-400" />
    </span>
  );
}

export default FileIcon;
