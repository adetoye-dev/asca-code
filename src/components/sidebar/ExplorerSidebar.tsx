/**
 * ExplorerSidebar.tsx — VS Code Explorer View Component
 */

import { FileTree, FileNode } from "../FileTree";

interface ExplorerSidebarProps {
  projectName: string;
  projectPath: string;
  files: FileNode[];
  activeFilePath: string | null;
  onSelectFile: (file: FileNode) => void;
  onCreateFile: (parentPath: string, name: string, isDir: boolean) => void;
  onDeleteFile: (path: string) => void;
  onRefresh: () => void;
  onOpenFolder: () => void;
  touchedPaths?: string[];
}

export function ExplorerSidebar({
  projectName,
  projectPath,
  files,
  activeFilePath,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onRefresh,
  onOpenFolder,
  touchedPaths,
}: ExplorerSidebarProps) {
  return (
    <div className="flex flex-col h-full w-full bg-[#18181b] select-none text-xs">
      <FileTree
        files={files}
        activeFilePath={activeFilePath}
        onSelectFile={onSelectFile}
        onCreateFile={onCreateFile}
        onDeleteFile={onDeleteFile}
        onRefresh={onRefresh}
        onOpenFolder={onOpenFolder}
        projectName={projectName}
        projectPath={projectPath}
        touchedPaths={touchedPaths}
      />
    </div>
  );
}

export default ExplorerSidebar;
