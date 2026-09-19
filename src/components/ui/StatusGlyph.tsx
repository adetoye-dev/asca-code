/**
 * StatusGlyph.tsx — 5-Glyph Universal Lifecycle Taxonomy Primitive
 *
 * Implements the universal state indicators for ACSA Code:
 * 1. "success": Emerald checkmark (#10b981) — Done, passed, synced, active healthy
 * 2. "in-progress" / "progress": Sky clock (#0284c7) — Running, building, pulling, syncing
 * 3. "needs-action" / "action": Magenta pie (#d946ef) — Unstaged diffs, conflict, approval required
 * 4. "pending": Amber crescent (#f59e0b) — Queued, behind remote, waiting, paused
 * 5. "open": Gray dashed ring (#71717a) — Idle, empty, unassigned, clean
 */

import React from "react";
import { resolveIconSize, type IconSize } from "./Icon.js";

export type LifecycleStatus =
  | "success"
  | "in-progress"
  | "progress"
  | "needs-action"
  | "action"
  | "pending"
  | "open";

export interface StatusGlyphProps extends React.SVGProps<SVGSVGElement> {
  status: LifecycleStatus;
  size?: IconSize;
  className?: string;
  pulse?: boolean;
  spin?: boolean;
}

export const STATUS_META: Record<
  "success" | "progress" | "action" | "pending" | "open",
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  success: {
    label: "Success",
    color: "#10b981",
    bgColor: "rgba(16, 185, 129, 0.12)",
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  progress: {
    label: "In Progress",
    color: "#0284c7",
    bgColor: "rgba(2, 132, 199, 0.12)",
    borderColor: "rgba(2, 132, 199, 0.25)",
  },
  action: {
    label: "Needs Action",
    color: "#d946ef",
    bgColor: "rgba(217, 70, 239, 0.12)",
    borderColor: "rgba(217, 70, 239, 0.25)",
  },
  pending: {
    label: "Pending",
    color: "#f59e0b",
    bgColor: "rgba(245, 158, 11, 0.12)",
    borderColor: "rgba(245, 158, 11, 0.25)",
  },
  open: {
    label: "Open",
    color: "#71717a",
    bgColor: "rgba(113, 113, 122, 0.12)",
    borderColor: "rgba(113, 113, 122, 0.25)",
  },
};

function normalizeStatus(status: LifecycleStatus): "success" | "progress" | "action" | "pending" | "open" {
  if (status === "in-progress") return "progress";
  if (status === "needs-action") return "action";
  return status;
}

export function StatusGlyph({
  status,
  size = "sm",
  className = "",
  pulse = false,
  spin = false,
  style,
  ...rest
}: StatusGlyphProps) {
  const norm = normalizeStatus(status);
  const meta = STATUS_META[norm];
  const px = resolveIconSize(size);

  const svgStyle: React.CSSProperties = {
    width: px,
    height: px,
    minWidth: px,
    minHeight: px,
    ...style,
  };

  const animClass = spin || (norm === "progress" && pulse) ? "animate-spin" : pulse ? "animate-pulse" : "";

  // 1. Success — Emerald Checkmark
  if (norm === "success") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={svgStyle}
        className={`shrink-0 ${animClass} ${className}`}
        role="img"
        aria-label={meta.label}
        {...rest}
      >
        <circle cx="8" cy="8" r="7" fill={meta.bgColor} stroke={meta.color} strokeWidth="1.2" />
        <path
          d="M5 8.2L7 10.2L11.2 6"
          stroke={meta.color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 2. In-Progress — Sky Clock
  if (norm === "progress") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={svgStyle}
        className={`shrink-0 ${animClass} ${className}`}
        role="img"
        aria-label={meta.label}
        {...rest}
      >
        <circle cx="8" cy="8" r="7" fill={meta.bgColor} stroke={meta.color} strokeWidth="1.2" />
        <path
          d="M8 4.5V8L10.5 9.5"
          stroke={meta.color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 3. Needs Action — Magenta Pie
  if (norm === "action") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={svgStyle}
        className={`shrink-0 ${animClass} ${className}`}
        role="img"
        aria-label={meta.label}
        {...rest}
      >
        <circle cx="8" cy="8" r="7" fill={meta.bgColor} stroke={meta.borderColor} strokeWidth="1.2" />
        {/* 3-quarter filled pie wedge in vivid magenta */}
        <path
          d="M8 8V2.5A5.5 5.5 0 1 1 2.5 8H8Z"
          fill={meta.color}
        />
      </svg>
    );
  }

  // 4. Pending — Amber Crescent
  if (norm === "pending") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={svgStyle}
        className={`shrink-0 ${animClass} ${className}`}
        role="img"
        aria-label={meta.label}
        {...rest}
      >
        <circle cx="8" cy="8" r="7" fill={meta.bgColor} stroke={meta.borderColor} strokeWidth="1.2" />
        {/* Crescent moon shape in amber */}
        <path
          d="M9.5 4C7.01472 4 5 6.01472 5 8.5C5 10.9853 7.01472 13 9.5 13C8.11929 13 7 11.8807 7 10.5C7 9.11929 8.11929 8 9.5 8C8.80964 8 8.25 7.44036 8.25 6.75C8.25 5.23122 9.5 4 9.5 4Z"
          fill={meta.color}
        />
      </svg>
    );
  }

  // 5. Open — Gray Dashed Ring
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={svgStyle}
      className={`shrink-0 ${animClass} ${className}`}
      role="img"
      aria-label={meta.label}
      {...rest}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke={meta.color}
        strokeWidth="1.4"
        strokeDasharray="2.5 2.5"
      />
    </svg>
  );
}

/**
 * Interactive Status Chip with concentric curvature and badge styling.
 */
export interface StatusChipProps extends React.HTMLAttributes<HTMLDivElement> {
  status: LifecycleStatus;
  label?: string;
  size?: "xs" | "sm" | "md";
  pulse?: boolean;
  spin?: boolean;
}

export function StatusChip({ status, label, size = "sm", className = "", pulse, spin, ...rest }: StatusChipProps) {
  const norm = normalizeStatus(status);
  const meta = STATUS_META[norm];
  const displayLabel = label ?? meta.label;

  const sizeClasses = {
    xs: "px-1.5 py-0.5 text-3xs gap-1 rounded-md",
    sm: "px-2 py-0.5 text-xs gap-1.5 rounded-lg",
    md: "px-2.5 py-1 text-body gap-2 rounded-lg",
  }[size];

  return (
    <div
      className={`inline-flex items-center font-medium border transition-colors ${sizeClasses} ${className}`}
      style={{
        backgroundColor: meta.bgColor,
        borderColor: meta.borderColor,
        color: meta.color,
      }}
      {...rest}
    >
      <StatusGlyph status={norm} size={size === "xs" ? 10 : 12} pulse={pulse} spin={spin} />
      <span>{displayLabel}</span>
    </div>
  );
}

export default StatusGlyph;
