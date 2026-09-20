/**
 * workspaceSearch.ts — search and replace across the open project.
 *
 * Served by the engine (`fs search` / `fs replace`) over IPC. The Search view
 * used to call `/api/fs/*` directly, which only ever worked while a Vite dev
 * server was up — in a packaged build the whole panel returned nothing.
 */

import { desktopRequired, engineCall, hasIpc } from "./engineBridge";

export interface SearchMatch {
  lineNumber: number;
  column: number;
  lineContent: string;
  matchStart: number;
  matchLength: number;
}

export interface SearchFileResult {
  filePath: string;
  fileName: string;
  relativeDir: string;
  relativeFilePath: string;
  matches: SearchMatch[];
}

export interface SearchResponse {
  success?: boolean;
  results?: SearchFileResult[];
  totalMatches?: number;
  totalFiles?: number;
  capped?: boolean;
  error?: string;
}

export interface ReplaceResponse {
  success?: boolean;
  updatedFiles?: Array<{ filePath: string; newContent: string; count: number }>;
  totalReplaced?: number;
  error?: string;
}

export interface SearchParams {
  projectRoot: string;
  query: string;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  useRegex?: boolean;
  includePattern?: string;
  excludePattern?: string;
  maxResults?: number;
}

export interface ReplaceParams {
  projectRoot: string;
  query: string;
  replaceText: string;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  useRegex?: boolean;
  preserveCase?: boolean;
  /** Omit to replace across the whole workspace. */
  filePath?: string;
  /** Omit to replace every occurrence in the target files. */
  lineNumbers?: number[];
}

async function call<T>(action: string, payload: unknown): Promise<T> {
  if (hasIpc()) {
    return engineCall<T>("fs", [action, JSON.stringify(payload)]);
  }
  throw desktopRequired(action === "search" ? "Workspace search" : "Workspace replace");
}

export async function searchWorkspace(params: SearchParams): Promise<SearchResponse> {
  try {
    return await call<SearchResponse>("search", params);
  } catch (error) {
    return { error: String((error as Error)?.message || error), results: [] };
  }
}

export async function replaceInWorkspace(params: ReplaceParams): Promise<ReplaceResponse> {
  try {
    return await call<ReplaceResponse>("replace", params);
  } catch (error) {
    return { error: String((error as Error)?.message || error), updatedFiles: [] };
  }
}
