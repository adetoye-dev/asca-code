/**
 * DataPane.tsx — the four actions that make a local-first app survivable.
 *
 * Nothing here is backed by a server, so "the app lost my work" can only have
 * one answer: a file on the user's disk and a way to put it back. The pane is
 * deliberately explicit about what a backup contains and what a support bundle
 * omits, because that is the trade-off the user is being asked to make when
 * they hand a file to someone else.
 */

import { useEffect, useState } from "react";
import { Icon } from "../ui/Icon";
import {
  AlertCircle,
  Check,
  Download,
  FileWarning,
  FolderOpen,
  Loader2,
  Upload,
} from "lucide-react";
import {
  createSupportBundle,
  dataFolderInfo,
  exportBackup,
  importBackup,
  revealDataFolder,
  type ActionOutcome,
} from "../../services/backupRestore";

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; detail?: string; path?: string }
  | { kind: "failed"; detail: string };

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function PaneButton({
  label,
  icon,
  busy,
  onClick,
  primary,
}: {
  label: string;
  icon: typeof Download;
  busy: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-xs font-medium transition disabled:opacity-60 cursor-pointer ${
        primary
          ? "bg-purple-600 hover:bg-purple-500 text-white"
          : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
      }`}
    >
      <Icon icon={busy ? Loader2 : icon} className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

export function DataPane() {
  const [folder, setFolder] = useState<{ dataDir: string; dbPath: string } | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});

  useEffect(() => {
    void dataFolderInfo().then(setFolder);
  }, []);

  const run = async (action: string, work: () => Promise<ActionOutcome>) => {
    setStatus((previous) => ({ ...previous, [action]: { kind: "busy" } }));
    const outcome = await work();
    setStatus((previous) => ({
      ...previous,
      // A cancelled picker leaves no trace: the user already knows they closed it.
      [action]: outcome.kind === "cancelled" ? { kind: "idle" } : outcome,
    }));
  };

  const feedback = (action: string) => {
    const current = status[action];
    if (!current || current.kind === "idle" || current.kind === "busy") return null;
    if (current.kind === "failed") {
      return (
        <span className="text-[11px] text-amber-300 flex items-start gap-1.5 break-all">
          <Icon icon={AlertCircle} className="w-3 h-3 mt-0.5 shrink-0 text-amber-400" />
          {current.detail}
        </span>
      );
    }
    return (
      <span className="text-[11px] text-zinc-400 flex items-start gap-1.5 break-all">
        <Icon icon={Check} className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
        <span>
          {current.path ? <span className="text-zinc-300">{basename(current.path)}</span> : null}
          {current.detail ? <span className="ml-1">{current.detail}</span> : null}
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">Data &amp; backups</h3>
        <p className="text-[11px] text-zinc-400 mt-0.5">
          Your projects, chats and settings live in one database on this machine. Nothing is uploaded
          anywhere.
        </p>
      </div>

      <div className="bg-surface border border-hairline rounded-panel p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-zinc-200">Where your data is</span>
          <PaneButton
            label="Reveal data folder"
            icon={FolderOpen}
            busy={status.reveal?.kind === "busy"}
            onClick={() => void run("reveal", revealDataFolder)}
          />
        </div>
        <div className="text-[11px] font-mono text-zinc-500 truncate" title={folder?.dataDir ?? ""}>
          {folder?.dataDir ?? "Locating…"}
        </div>
        {feedback("reveal")}
        <div className="pt-1 border-t border-hairline">
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            If the app is misbehaving, a support bundle is the file to send us: versions, paths, row
            counts and the last crashes — never your API keys or chat history.
          </p>
          <div className="mt-2">
            <PaneButton
              label="Create support bundle"
              icon={FileWarning}
              busy={status.support?.kind === "busy"}
              onClick={() => void run("support", createSupportBundle)}
            />
          </div>
          <div className="mt-2">{feedback("support")}</div>
        </div>
      </div>

      <div className="bg-surface border border-hairline rounded-panel p-4 space-y-3">
        <span className="text-xs font-medium text-zinc-200">Backup &amp; restore</span>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          A backup is the whole database — projects, chats, settings and your model configuration.
          API keys are <span className="text-zinc-300">left out</span> so the file is safe to store
          anywhere; add them again on the new machine.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <PaneButton
            label="Export backup…"
            icon={Download}
            primary
            busy={status.export?.kind === "busy"}
            onClick={() => void run("export", exportBackup)}
          />
          <PaneButton
            label="Import backup…"
            icon={Upload}
            busy={status.import?.kind === "busy"}
            onClick={() => void run("import", importBackup)}
          />
        </div>
        {feedback("export")}
        {feedback("import")}
      </div>
    </div>
  );
}
