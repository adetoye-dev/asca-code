/**
 * DesktopRequiredBanner.tsx — explains the browser preview.
 *
 * `npm run dev` opens the UI in a browser, where there is no engine to talk to.
 * That used to be papered over by a Vite middleware that reimplemented the whole
 * backend in TypeScript, so the browser looked fully functional and the packaged
 * app kept surprising us. The bridge is gone, which means the browser is now
 * honestly limited — and this says so once, at the top, instead of leaving each
 * feature to fail on its own terms.
 */

import { useState } from "react";
import { Icon } from "./ui/Icon";
import { AlertTriangle, X } from "lucide-react";

export function DesktopRequiredBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-950/70 border-b border-amber-800/60 text-[11px] text-amber-200 shrink-0 font-sans">
      <Icon icon={AlertTriangle} className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span className="truncate">
        Browser preview — no backend, so files, the terminal, the agent and your settings
        are unavailable. Run{" "}
        <code className="font-mono bg-black/40 px-1 rounded">npm run dev:app</code> for the
        real thing.
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-auto shrink-0 p-0.5 rounded hover:bg-amber-800/50 transition-colors cursor-pointer"
        title="Dismiss"
      >
        <Icon icon={X} className="w-3 h-3" />
      </button>
    </div>
  );
}
