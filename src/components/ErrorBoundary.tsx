/**
 * ErrorBoundary.tsx — Robust React Error Boundary for ACSA Code
 *
 * Prevents unhandled render errors from unmounting the React tree into a blank screen.
 * Displays an authentic IDE error dialog with stack trace and recovery actions.
 */

import { Component, ErrorInfo, ReactNode } from "react";
import { Trash2, ChevronRight, ChevronDown, RefreshCw, AlertCircle, X } from "lucide-react";
import { Icon } from "./ui/Icon";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, showDetails: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ACSA Code ErrorBoundary Caught Error]:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  private handleClearStorageAndReload = () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("aide_ai_settings");
        localStorage.removeItem("ide_ai_settings");
        localStorage.removeItem("aide_active_project");
      } catch {}
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans text-zinc-200 select-none">
          <div className="w-[620px] max-w-[95vw] rounded-xl bg-workbench border border-hairline/40 shadow-[0_20px_50px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="h-11 bg-workbench border-b border-hairline px-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-400 font-semibold text-xs">
                <Icon icon={AlertCircle} className="w-4 h-4 text-red-400" />
                <span>{this.props.fallbackTitle || "Workbench Component Error"}</span>
              </div>
              <button
                type="button"
                onClick={this.handleReset}
                className="p-1 text-zinc-400 hover:text-zinc-200 rounded transition cursor-pointer"
                title="Dismiss"
              >
                <Icon icon={X} className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 text-xs">
              <div>
                <p className="text-zinc-300 mb-1.5 font-medium">
                  An error occurred while rendering this interface. The workbench protected your workspace from crashing.
                </p>
                <div className="p-3 rounded bg-red-950/40 border border-red-800/40 text-red-300 font-mono text-[11px] break-words">
                  {this.state.error?.message || String(this.state.error)}
                </div>
              </div>

              {/* Stack Trace Collapsible */}
              <div>
                <button
                  type="button"
                  onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                  className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer font-medium"
                >
                  {this.state.showDetails ? (
                    <Icon icon={ChevronDown} className="w-3.5 h-3.5" />
                  ) : (
                    <Icon icon={ChevronRight} className="w-3.5 h-3.5" />
                  )}
                  <span>{this.state.showDetails ? "Hide Error Details" : "Show Error Details"}</span>
                </button>

                {this.state.showDetails && (
                  <div className="mt-2 p-3 rounded bg-workbench border border-zinc-800 font-mono text-[10px] text-zinc-400 max-h-48 overflow-y-auto whitespace-pre-wrap select-text">
                    {this.state.error?.stack || "No stack trace available"}
                    {this.state.errorInfo?.componentStack && (
                      <div className="mt-2 text-zinc-500 border-t border-zinc-800 pt-2">
                        {this.state.errorInfo.componentStack}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="h-12 bg-workbench border-t border-hairline px-4 flex items-center justify-between">
              <button
                type="button"
                onClick={this.handleClearStorageAndReload}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-red-400 hover:bg-zinc-800/60 transition cursor-pointer"
                title="Reset corrupted preferences and reload"
              >
                <Icon icon={Trash2} className="w-3.5 h-3.5" />
                <span>Reset Cache & Reload</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="px-3.5 py-1.5 rounded bg-workbench hover:bg-surface-hover text-zinc-200 text-xs font-medium transition cursor-pointer"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-primary-action hover:bg-primary-action text-white text-xs font-semibold shadow-sm transition cursor-pointer"
                >
                  <Icon icon={RefreshCw} className="w-3.5 h-3.5" />
                  <span>Reload Workbench</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
