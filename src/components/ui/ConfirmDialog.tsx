import { useEffect, useRef } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Icon } from "./Icon";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
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
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isDestructive = true,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
      return;
    }

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity duration-200">
      <div 
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm bg-modal backdrop-blur-xl shadow-elevation-3 border-hairline rounded-modal p-6 transform transition-all duration-200 scale-100 opacity-100 flex flex-col gap-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-full ${isDestructive ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'} shrink-0 mt-0.5`}>
            {isDestructive ? <Icon icon={AlertTriangle} size={20} /> : <Icon icon={HelpCircle} size={20} />}
          </div>
          <div className="flex-1">
            <h3 id="confirm-dialog-title" className="text-base font-semibold text-content-strong mb-1">
              {title}
            </h3>
            <p className="text-[13px] leading-relaxed text-content-subtle tracking-[-0.011em]">
              {message}
            </p>
          </div>
        </div>
        
        <div className="flex items-center justify-end gap-3 mt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-[13px] font-medium text-content hover:bg-surface-hover hover:text-content-strong active:bg-surface-active transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-md text-[13px] font-medium transition-colors ${
              isDestructive 
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 active:bg-red-500/30' 
                : 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 active:bg-blue-500/30'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
