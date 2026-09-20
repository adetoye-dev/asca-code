import React, { useRef } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Icon } from "./Icon";
import { useDialogA11y } from "../../hooks/useDialogA11y";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string | React.ReactNode;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  detail,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isDestructive = true,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Escape, focus-in and focus-restore were hand-rolled here; the Tab trap was
  // missing from every dialog, so they now all share one implementation.
  useDialogA11y(dialogRef, onCancel, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 backdrop-blur-md p-4 select-none animate-in fade-in duration-150">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-[420px] bg-zinc-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 font-sans animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="flex items-start gap-3.5">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${
              isDestructive
                ? "bg-rose-500/15 border-rose-500/30 text-rose-400"
                : "bg-purple-950/40 border-purple-500/40 text-purple-300"
            }`}
          >
            <Icon icon={isDestructive ? AlertTriangle : HelpCircle} className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="confirm-dialog-title" className="text-sm font-semibold text-zinc-100 mb-1">
              {title}
            </h3>
            <div className="text-xs leading-relaxed text-zinc-400">
              {message}
            </div>
            {detail && (
              <div
                className="mt-2.5 px-2.5 py-1.5 bg-black/40 border border-white/5 rounded-lg text-2xs font-mono text-zinc-300 truncate max-w-full select-all"
                title={detail}
              >
                {detail}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 transition-colors cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm cursor-pointer outline-none ${
              isDestructive
                ? "bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white focus:ring-2 focus:ring-rose-500/40"
                : "bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white focus:ring-2 focus:ring-purple-500/40"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
