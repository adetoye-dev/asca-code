/**
 * TradeOffSliders.tsx — Visual Architectural Steering Panel
 *
 * Three reactive slider controls that let non-technical users steer the
 * system's code generation strategy via plain-English labels. Every slider
 * adjustment dispatches a unified SliderConfig payload back to the parent
 * controller, which passes it to the Tauri backend when the pipeline runs.
 *
 * Styling: Tailwind CSS utility classes — zero external component libraries.
 */

import { useState, useCallback, useEffect, useRef } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export type SliderLevel = "low" | "medium" | "high";

export interface SliderConfig {
  budget_vs_scale: SliderLevel;
  speed_vs_precision: SliderLevel;
  simplicity_vs_futureproof: SliderLevel;
}

interface SliderDescriptor {
  id: keyof SliderConfig;
  title: string;
  subtitle: string;
  icon: string;
  labels: Record<SliderLevel, { name: string; detail: string; color: string }>;
}

interface TradeOffSlidersProps {
  initialConfig?: SliderConfig;
  onChange: (config: SliderConfig) => void;
  disabled?: boolean;
}

// ── Slider Definitions ──────────────────────────────────────────────────────

const SLIDER_DEFS: SliderDescriptor[] = [
  {
    id: "budget_vs_scale",
    title: "Operating Cost vs. User Capacity",
    subtitle: "How much infrastructure should the generated system handle?",
    icon: "⚖️",
    labels: {
      low: {
        name: "Low Cost · Embedded",
        detail:
          "SQLite in-process database. Ideal for prototypes, internal tools, or ≤ 100 users. Hosting under $5/mo.",
        color: "text-emerald-400",
      },
      medium: {
        name: "Balanced · Managed DB",
        detail:
          "PostgreSQL with connection pooling. Handles 1,000–10,000 concurrent users. Hosting ~$25/mo.",
        color: "text-sky-400",
      },
      high: {
        name: "Enterprise · Scaled Cluster",
        detail:
          "Distributed database with read replicas and caching layers. 50,000+ users. Hosting $100+/mo.",
        color: "text-violet-400",
      },
    },
  },
  {
    id: "speed_vs_precision",
    title: "Instant Updates vs. Bulletproof Accuracy",
    subtitle: "Trade raw throughput speed for transactional integrity?",
    icon: "⚡",
    labels: {
      low: {
        name: "Relaxed · Eventual Consistency",
        detail:
          "WebSocket push with optimistic updates. Fastest perceived speed, but brief data staleness possible.",
        color: "text-emerald-400",
      },
      medium: {
        name: "Balanced · Confirmed Writes",
        detail:
          "Async message queue with write acknowledgment. Good latency with reliable delivery guarantees.",
        color: "text-sky-400",
      },
      high: {
        name: "Strict · ACID Transactions",
        detail:
          "Synchronous database commits with full ACID guarantees. Highest data integrity, higher latency.",
        color: "text-violet-400",
      },
    },
  },
  {
    id: "simplicity_vs_futureproof",
    title: "System Modularity",
    subtitle: "How decoupled should the generated architecture be?",
    icon: "🧱",
    labels: {
      low: {
        name: "Streamlined · Monolith",
        detail:
          "Single deployable unit. Fastest to ship, easiest to debug. Best for small teams and MVPs.",
        color: "text-emerald-400",
      },
      medium: {
        name: "Balanced · Layered Modules",
        detail:
          "Separated concerns with clean internal boundaries. Modules can be extracted later if needed.",
        color: "text-sky-400",
      },
      high: {
        name: "Future-Proof · Decoupled Services",
        detail:
          "Independent sub-modules with defined API contracts. Ready for team scaling and independent deployment.",
        color: "text-violet-400",
      },
    },
  },
];

const LEVELS: SliderLevel[] = ["low", "medium", "high"];

// ── Utility ─────────────────────────────────────────────────────────────────

function levelToIndex(level: SliderLevel): number {
  return LEVELS.indexOf(level);
}

function indexToLevel(index: number): SliderLevel {
  return LEVELS[Math.max(0, Math.min(index, 2))];
}

// ── Individual Slider ───────────────────────────────────────────────────────

interface SingleSliderProps {
  descriptor: SliderDescriptor;
  value: SliderLevel;
  onValueChange: (id: keyof SliderConfig, value: SliderLevel) => void;
  disabled: boolean;
}

function SingleSlider({
  descriptor,
  value,
  onValueChange,
  disabled,
}: SingleSliderProps) {
  const currentLabel = descriptor.labels[value];
  const index = levelToIndex(value);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newLevel = indexToLevel(parseInt(e.target.value, 10));
      onValueChange(descriptor.id, newLevel);
    },
    [descriptor.id, onValueChange]
  );

  // Track color for the filled portion of the slider
  const fillPercent = (index / 2) * 100;
  const trackGradient = disabled
    ? "from-zinc-600 to-zinc-600"
    : "from-emerald-500 via-sky-500 to-violet-500";

  return (
    <div
      className={`
        rounded-2xl border border-zinc-700/50 bg-zinc-800/60 p-6
        backdrop-blur-sm transition-all duration-200
        ${disabled ? "opacity-50 pointer-events-none" : "hover:border-zinc-600/70 hover:bg-zinc-800/80"}
      `}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl" role="img" aria-label={descriptor.title}>
              {descriptor.icon}
            </span>
            <h3 className="text-sm font-semibold text-zinc-200 tracking-wide uppercase">
              {descriptor.title}
            </h3>
          </div>
          <p className="text-xs text-zinc-500">{descriptor.subtitle}</p>
        </div>
      </div>

      {/* Slider Track */}
      <div className="relative mb-4">
        <div className="relative h-2 rounded-full bg-zinc-700/80 overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${trackGradient} transition-all duration-300`}
            style={{ width: `${fillPercent}%` }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={2}
          step={1}
          value={index}
          onChange={handleChange}
          disabled={disabled}
          aria-label={descriptor.title}
          aria-valuetext={currentLabel.name}
          className={`
            absolute inset-0 w-full h-2 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-black/30
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-400
            [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150
            [&::-webkit-slider-thumb]:hover:scale-125
            [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-zinc-400
          `}
        />

        {/* Tick marks */}
        <div className="flex justify-between mt-2 px-0.5">
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => onValueChange(descriptor.id, level)}
              disabled={disabled}
              className={`
                text-[10px] font-medium transition-colors duration-200 hover:text-zinc-300
                ${level === value ? "text-zinc-200" : "text-zinc-600"}
              `}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Active Label Card */}
      <div
        className={`
          rounded-xl border border-zinc-700/40 bg-zinc-900/50 px-4 py-3
          transition-all duration-300
        `}
      >
        <div className={`text-sm font-semibold ${currentLabel.color} mb-1`}>
          {currentLabel.name}
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          {currentLabel.detail}
        </p>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SliderConfig = {
  budget_vs_scale: "medium",
  speed_vs_precision: "medium",
  simplicity_vs_futureproof: "medium",
};

export function TradeOffSliders({
  initialConfig,
  onChange,
  disabled = false,
}: TradeOffSlidersProps) {
  const [config, setConfig] = useState<SliderConfig>(
    initialConfig ?? DEFAULT_CONFIG
  );

  // Debounce timer to batch rapid slider adjustments into a single dispatch
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSliderChange = useCallback(
    (id: keyof SliderConfig, value: SliderLevel) => {
      setConfig((prev) => {
        const next = { ...prev, [id]: value };
        return next;
      });
    },
    []
  );

  // Dispatch unified payload when config stabilizes (150ms debounce)
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onChange(config);
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [config, onChange]);

  return (
    <section aria-label="Trade-off Configuration" className="w-full">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-zinc-100 tracking-tight">
          System Configuration
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Adjust these sliders to shape the architecture of the generated code.
          Changes are applied automatically.
        </p>
      </div>

      <div className="grid gap-4">
        {SLIDER_DEFS.map((descriptor) => (
          <SingleSlider
            key={descriptor.id}
            descriptor={descriptor}
            value={config[descriptor.id]}
            onValueChange={handleSliderChange}
            disabled={disabled}
          />
        ))}
      </div>

      {/* Active Configuration Summary */}
      <div className="mt-4 rounded-xl border border-zinc-700/30 bg-zinc-900/40 px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <div
            className={`w-2 h-2 rounded-full ${disabled ? "bg-zinc-600" : "bg-emerald-400 animate-pulse"}`}
          />
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Active Profile
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {SLIDER_DEFS.map((def) => {
            const label = def.labels[config[def.id]];
            return (
              <span
                key={def.id}
                className={`inline-flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium ${label.color}`}
              >
                {def.icon} {label.name.split("·")[0].trim()}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default TradeOffSliders;
