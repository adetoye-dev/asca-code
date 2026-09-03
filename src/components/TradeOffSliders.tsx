/**
 * TradeOffSliders.tsx — Visual Architectural Steering Panel
 *
 * Three reactive slider controls that let non-technical users steer the
 * system's code generation strategy via plain-English labels.
 * Supports standard mode and compact dockable mode for sidebar panels.
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
  compact?: boolean;
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
        name: "Enterprise · Distributed",
        detail:
          "Horizontal sharding, read replicas, Redis caching. 100,000+ users with failover. Hosting $200+/mo.",
        color: "text-purple-400",
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
        name: "Rapid · Eventual Consistency",
        detail:
          "Optimistic updates with background reconciliation. Max throughput, non-blocking writes.",
        color: "text-amber-400",
      },
      medium: {
        name: "Balanced · Confirmed Writes",
        detail:
          "Async message queue with write acknowledgment. Good latency with reliable delivery guarantees.",
        color: "text-sky-400",
      },
      high: {
        name: "Bulletproof · Strict ACID",
        detail:
          "Full distributed locking, two-phase commits. Zero data loss guarantee for financial/audit workloads.",
        color: "text-emerald-400",
      },
    },
  },
  {
    id: "simplicity_vs_futureproof",
    title: "System Modularity",
    subtitle: "How decoupled should the generated architecture be?",
    icon: "📦",
    labels: {
      low: {
        name: "Simple · Monolith",
        detail:
          "Single deployable unit. Direct function calls, shared memory. Fastest to build and debug.",
        color: "text-zinc-300",
      },
      medium: {
        name: "Balanced · Layered Modules",
        detail:
          "Separated concerns with clean internal boundaries. Modules can be extracted later if needed.",
        color: "text-sky-400",
      },
      high: {
        name: "Decoupled · Micro-Services",
        detail:
          "Independent services with gRPC / REST contracts. Maximum team scale, higher ops complexity.",
        color: "text-purple-400",
      },
    },
  },
];

const LEVELS: SliderLevel[] = ["low", "medium", "high"];

function levelToIndex(level: SliderLevel): number {
  return LEVELS.indexOf(level);
}

function indexToLevel(index: number): SliderLevel {
  return LEVELS[Math.max(0, Math.min(index, 2))];
}

// ── Single Slider Row ───────────────────────────────────────────────────────

function SingleSlider({
  descriptor,
  value,
  onValueChange,
  disabled,
  compact = false,
}: {
  descriptor: SliderDescriptor;
  value: SliderLevel;
  onValueChange: (id: keyof SliderConfig, value: SliderLevel) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const currentLabel = descriptor.labels[value];
  const index = levelToIndex(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLevel = indexToLevel(parseInt(e.target.value, 10));
    onValueChange(descriptor.id, newLevel);
  };

  const fillPercent = (index / 2) * 100;
  const trackGradient = disabled
    ? "from-zinc-600 to-zinc-600"
    : "from-emerald-500 via-sky-500 to-violet-500";

  if (compact) {
    return (
      <div className="space-y-1.5 p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-zinc-300 truncate">
            {descriptor.icon} {descriptor.title.split(" vs")[0]}
          </span>
          <span className={`text-[11px] font-bold ${currentLabel.color}`}>
            {currentLabel.name.split("·")[0].trim()}
          </span>
        </div>
        <input
          type="range"
          aria-label={descriptor.title}
          min={0}
          max={2}
          step={1}
          value={index}
          onChange={handleChange}
          disabled={disabled}
          className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-sky-500 disabled:opacity-40"
        />
        <div className="text-[10px] text-zinc-400 truncate leading-tight">
          {currentLabel.detail}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`
        rounded-2xl border border-zinc-700/50 bg-zinc-800/60 p-5
        backdrop-blur-sm transition-all duration-200
        ${disabled ? "opacity-50 pointer-events-none" : "hover:border-zinc-600/70"}
      `}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-lg">{descriptor.icon}</span>
            <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wide">
              {descriptor.title}
            </h3>
          </div>
          <p className="text-xs text-zinc-500">{descriptor.subtitle}</p>
        </div>
      </div>

      <div className="relative mb-3">
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
          className="w-full h-2 appearance-none bg-transparent cursor-pointer accent-white absolute inset-0 disabled:opacity-40"
        />
        <div className="flex justify-between text-[10px] text-zinc-500 mt-1 font-mono">
          <span>Low</span>
          <span>Medium</span>
          <span>High</span>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/50 px-3.5 py-2.5">
        <div className={`text-xs font-semibold ${currentLabel.color} mb-0.5`}>
          {currentLabel.name}
        </div>
        <p className="text-[11px] text-zinc-400 leading-relaxed">
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
  compact = false,
}: TradeOffSlidersProps) {
  const [config, setConfig] = useState<SliderConfig>(
    initialConfig ?? DEFAULT_CONFIG
  );

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

  if (compact) {
    return (
      <div className="space-y-2">
        {SLIDER_DEFS.map((descriptor) => (
          <SingleSlider
            key={descriptor.id}
            descriptor={descriptor}
            value={config[descriptor.id]}
            onValueChange={handleSliderChange}
            disabled={disabled}
            compact={true}
          />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Trade-off Configuration" className="w-full">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-zinc-100 tracking-tight">
          System Configuration
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Adjust these sliders to shape the architecture of the generated code.
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
            compact={false}
          />
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-zinc-700/30 bg-zinc-900/40 px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <div
            className={`w-2 h-2 rounded-full ${
              disabled ? "bg-zinc-600" : "bg-emerald-400 animate-pulse"
            }`}
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
