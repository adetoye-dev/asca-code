import React, { forwardRef } from "react";
import { LucideIcon } from "lucide-react";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | number;

export const ICON_SIZE_MAP: Record<"xs" | "sm" | "md" | "lg" | "xl", number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export function resolveIconSize(size?: IconSize): number {
  if (size === undefined) return 16;
  if (typeof size === "number") return size;
  return ICON_SIZE_MAP[size] ?? 16;
}

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "size" | "icon"> {
  icon: LucideIcon;
  size?: IconSize;
  strokeWidth?: number;
  color?: string;
  className?: string;
  title?: string;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
  const { icon: LucideIconComponent, size = "md", strokeWidth = 1.5, color = "currentColor", className = "", title, style, ...rest } = props;
  const pixelSize = resolveIconSize(size);
  return (
    <LucideIconComponent
      ref={ref}
      size={pixelSize}
      strokeWidth={strokeWidth}
      color={color}
      className={className}
      style={{ width: pixelSize, height: pixelSize, minWidth: pixelSize, minHeight: pixelSize, ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    />
  );
});
Icon.displayName = "Icon";
