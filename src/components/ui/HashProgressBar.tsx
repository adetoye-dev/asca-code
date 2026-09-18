/**
 * HashProgressBar.tsx — Sleek Squared Gradient Progress Bar
 *
 * Modernized progress display:
 * - Taller, squared-edge gradient bar that evokes classic terminal block loaders.
 * - Bold, high-contrast byte and percentage metrics (e.g., 4211 MB / 4466 MB (94%)).
 * - Clean status description with animated "Working…" heartbeat indicator.
 */

interface HashProgressBarProps {
  percent: number;
  statusText: string;
  className?: string;
}

export function HashProgressBar({
  percent,
  statusText,
  className = "",
}: HashProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  const cleanStatus = (statusText || "Processing…")
    // Control characters are the point: this strips ANSI colour codes.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .trim();

  // Check if statusText contains byte progress: e.g. "pulling 60e05f210007: 4211 MB / 4466 MB (94%)"
  // or "Downloading: 120 MB / 800 MB (15%)"
  const byteMetricMatch = cleanStatus.match(
    /^(.*?)(?::\s*|\s+-\s+)?(\d+(?:\.\d+)?\s*(?:MB|GB|KB|B)\s*\/\s*\d+(?:\.\d+)?\s*(?:MB|GB|KB|B)\s*\(\d+%\))(.*)$/i
  );

  let prefixText = cleanStatus;
  let metricText = `${clamped}%`;

  if (byteMetricMatch) {
    prefixText = byteMetricMatch[1] || "Downloading";
    metricText = byteMetricMatch[2];
  }

  return (
    <div className={`space-y-2.5 p-3.5 rounded-xl bg-zinc-950 border border-zinc-800/90 font-mono ${className}`}>
      {/* Taller, Squared-Edge Gradient Loading Bar */}
      <div className="w-full h-3 rounded-[2px] bg-zinc-900 border border-zinc-800/80 overflow-hidden shadow-inner">
        <div
          className="h-full bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 rounded-[2px] transition-all duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>

      {/* Progress Meta Row */}
      <div className="flex items-center justify-between gap-3 text-xs select-none">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-[11px] text-zinc-400">
            {prefixText}
          </span>
          {clamped > 0 && clamped < 100 && (
            <span className="text-zinc-500 shrink-0 text-[10px] animate-pulse font-sans">
              · Working…
            </span>
          )}
        </div>

        {/* Bolder, Prominent Byte/Percentage Metric */}
        <span className="text-white font-bold text-xs shrink-0 tracking-tight">
          {metricText}
        </span>
      </div>
    </div>
  );
}

export default HashProgressBar;
