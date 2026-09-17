/**
 * ProjectSetupCard.tsx — "what do I do next?" for a fresh project.

 * Shown in the empty-editor surface right after scaffolding, where the user
 * lands. A brand new project cannot run until its dependencies are installed,
 * and previously nothing said so.
 */
import React from "react";
import { Download, Play, Hammer, Loader2 } from "lucide-react";
import { Icon } from "../ui/Icon";
import type { ProjectStatus } from "../../services/projectSetup";

export interface ProjectSetupCardProps {
  status: ProjectStatus | null;
  busyCommand: string | null;
  onRun: (label: string, command: string) => void;
}

interface SetupAction {
  label: string;
  command: string;
  icon: typeof Download;
  primary?: boolean;
}

export const ProjectSetupCard: React.FC<ProjectSetupCardProps> = ({ status, busyCommand, onRun }) => {
  if (!status || !status.hasPackageJson) return null;

  const actions: SetupAction[] = [];
  if (status.needsInstall) {
    actions.push({
      label: `Install dependencies (${status.manager})`,
      command: status.installCommand || "npm install",
      icon: Download,
      primary: true,
    });
  } else {
    if (status.devCommand) actions.push({ label: "Run dev server", command: status.devCommand, icon: Play, primary: true });
    if (status.buildCommand) actions.push({ label: "Build", command: status.buildCommand, icon: Hammer });
  }
  if (!actions.length) return null;

  const busy = busyCommand !== null;

  return (
    <div className="w-72 max-w-full mb-5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="text-[11px] font-semibold text-zinc-300 mb-1">
        {status.needsInstall ? "This project needs its dependencies installed" : "This project is ready to run"}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500 mb-3">
        {status.needsInstall
          ? "It was just scaffolded, so the packages it depends on are not downloaded yet. Nothing will run until they are."
          : "Dependencies are installed. Start the dev server to see your project in the browser."}
      </p>
      <div className="flex flex-col gap-1.5">
        {actions.map((action) => {
          const isBusy = busyCommand === action.command;
          return (
            <button
              key={action.command}
              type="button"
              disabled={busy}
              onClick={() => onRun(action.label, action.command)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-default ${
                action.primary
                  ? "bg-sky-600 hover:bg-sky-500 text-white"
                  : "bg-white/[0.04] hover:bg-white/[0.07] text-zinc-200 border border-white/[0.06]"
              }`}
            >
              <Icon icon={isBusy ? Loader2 : action.icon} className={`w-3.5 h-3.5 ${isBusy ? "animate-spin" : ""}`} />
              <span>{isBusy ? `${action.label}…` : action.label}</span>
              <code className="ml-auto text-[10px] font-mono opacity-60">{action.command}</code>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-600 mt-2">
        Runs in the terminal below so you can watch the output.
      </p>
    </div>
  );
};

export default ProjectSetupCard;
