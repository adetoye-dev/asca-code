import type { CSSProperties } from "react";
import { ICON_SIZE_MAP } from "./Icon";

export type LogoSize = "xs" | "sm" | "md" | "lg" | "xl" | number;

export const LOGO_SIZE_MAP: Record<Exclude<LogoSize, number>, number> = ICON_SIZE_MAP;

export function resolveLogoSize(size?: LogoSize): number | undefined {
  if (size === undefined) return undefined;
  if (typeof size === "number") return size;
  return LOGO_SIZE_MAP[size] ?? 16;
}

export function computeLogoStyle(
  size?: LogoSize,
  style?: CSSProperties
): CSSProperties | undefined {
  const px = resolveLogoSize(size);
  if (px === undefined) return style;
  return {
    width: px,
    height: px,
    minWidth: px,
    minHeight: px,
    objectFit: "contain",
    ...style,
  };
}