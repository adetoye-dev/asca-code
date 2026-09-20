/**
 * WorkbenchContext — the live workbench state that dockview panels read.
 *
 * Why this exists rather than plain props or closures:
 *
 * Dockview resolves a panel's component *once*, when the panel is created, and
 * keeps that exact function for the panel's whole life. Anything such a
 * component reads from a closure is therefore frozen at creation time. That is
 * invisible for a component that only reads its own panel params, and wrong for
 * one that reads workbench state: an editor panel created while `App.tsx` held
 * one revision kept rendering that revision after the agent rewrote the file,
 * and its Save handler kept writing the stale buffer to disk.
 *
 * React context does propagate into dockview's portals — the portals are
 * rendered inside this provider's subtree — so current state has to travel this
 * way. The panel components in WorkbenchPanels.tsx read it; IdeLayout provides
 * it.
 */
import { createContext, useContext } from "react";
import type { AISettings } from "../SettingsModal";
import type { OpenFileTab } from "../../types/workbench";

/** Where the editor should put the cursor, and a token to re-trigger it. */
export interface TargetEditorLine {
  path: string;
  line: number;
  column?: number;
  ts: number;
}

export interface WorkbenchLive {
  openTabs: OpenFileTab[];
  updateTabContent: (path: string, newContent: string) => void;
  saveFile: (path: string) => void | Promise<void>;
  aiSettings: AISettings;
  themeId: string;
  targetEditorLine: TargetEditorLine | null;
  onSelectionChange: (selection: string) => void;
  projectRoot: string;
  isTauriAvailable: boolean;
  currentDiff: string;
  setCurrentDiff: (diff: string) => void;
  applyPatchToTab: (path: string, newContent: string) => void;
  refreshProjectFiles: () => void | Promise<unknown>;
  refreshBranch: () => void | Promise<unknown>;
}

const WorkbenchContext = createContext<WorkbenchLive | null>(null);

export const WorkbenchProvider = WorkbenchContext.Provider;

/**
 * Read the live workbench state. Only valid inside a dockview panel component,
 * which is the one place where a closure would go stale.
 */
export function useWorkbench(): WorkbenchLive {
  const live = useContext(WorkbenchContext);
  if (!live) {
    throw new Error("useWorkbench must be used inside the workbench provider");
  }
  return live;
}
