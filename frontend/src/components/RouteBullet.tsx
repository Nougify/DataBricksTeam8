"use client";

import type { RouteRef } from "@/lib/api/schemas";
import { useThemeTokens } from "@/lib/theme/tokens";
import { cn } from "@/lib/utils";
import { contrastRatio, normaliseHex } from "./color";

export interface RouteBulletProps {
  route: Pick<RouteRef, "short_name" | "long_name" | "color" | "text_color">;
  /** 18 px tall for dense rows (queues, tables); 20 px otherwise. */
  dense?: boolean;
  className?: string;
}

/**
 * A route plate (DESIGN.md §7.2): the route's own GTFS colours, never a semantic token, because a plate names
 * a thing and state sits beside it. Missing colours fall back to ink on paper. Plates that don't reach 3:1
 * against the panel (white or yellow routes) get a faint inset ring so their edge stays visible.
 */
export function RouteBullet({ route, dense = false, className }: RouteBulletProps) {
  const tokens = useThemeTokens();
  const bg = normaliseHex(route.color);
  const fg = normaliseHex(route.text_color);
  const hasOwnColours = bg !== null && fg !== null;
  const lowContrast = hasOwnColours && (contrastRatio(bg, tokens.background) ?? 21) < 3;

  return (
    <span
      title={route.long_name ?? route.short_name}
      className={cn(
        "inline-flex min-w-7 shrink-0 items-center justify-center rounded-sm px-1.5 font-heading text-sm leading-none font-bold whitespace-nowrap",
        dense ? "h-[18px]" : "h-5",
        !hasOwnColours && "bg-foreground text-background",
        lowContrast && "ring-1 ring-foreground/20 ring-inset",
        className,
      )}
      style={hasOwnColours ? { backgroundColor: bg, color: fg } : undefined}
    >
      <span className="sr-only">Route </span>
      {route.short_name}
    </span>
  );
}
