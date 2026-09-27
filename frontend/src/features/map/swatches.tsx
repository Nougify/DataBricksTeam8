// Inline-SVG samples for the map key and the layer menu (DESIGN §8.2 "Key"): 28 × 14 px, drawn in the same
// notation as the map and the charts. Colours are token classes (fill-*, stroke-*), passed in as literal
// strings so Tailwind can see them. Every sample is decorative: the text next to it carries the meaning.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const W = 28;
const H = 14;

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" className={cn("shrink-0 overflow-visible", className)}>
      {children}
    </svg>
  );
}

/** A route, arc or path sample. `casing` draws the map-land casing underneath (DESIGN §4.3). */
export function LineSwatch({
  strokeClass,
  width = 3,
  dash,
  casing = false,
  opacity = 1,
}: {
  strokeClass: string;
  width?: number;
  /** In multiples of the line width, like MapLibre's line-dasharray. */
  dash?: readonly [number, number];
  casing?: boolean;
  opacity?: number;
}) {
  const y = H / 2;
  return (
    <Svg>
      {casing && <line x1={2} x2={W - 2} y1={y} y2={y} strokeWidth={width + 3} strokeLinecap="round" className="stroke-map-land" />}
      <line
        x1={3}
        x2={W - 3}
        y1={y}
        y2={y}
        strokeWidth={width}
        strokeLinecap={dash ? "butt" : "round"}
        strokeDasharray={dash ? `${dash[0] * width} ${dash[1] * width}` : undefined}
        strokeOpacity={opacity}
        className={strokeClass}
      />
    </Svg>
  );
}

/** Point marks: ring = UPCOMING / forecast, disc = ACTIVE / actual, faded = RESOLVED (DESIGN §8.2 surges). */
export function PointSwatch({
  variant,
  fillClass,
  strokeClass,
  r = 5,
}: {
  variant: "ring" | "disc" | "faded";
  fillClass: string;
  strokeClass: string;
  r?: number;
}) {
  const c = { cx: W / 2, cy: H / 2, r };
  if (variant === "ring") {
    return (
      <Svg>
        <circle {...c} strokeWidth={2.5} fillOpacity={0.85} className={cn("fill-map-land", strokeClass)} />
      </Svg>
    );
  }
  if (variant === "disc") {
    return (
      <Svg>
        <circle {...c} strokeWidth={2} className={cn("stroke-map-land", fillClass)} />
      </Svg>
    );
  }
  return (
    <Svg>
      <circle {...c} strokeWidth={1} fillOpacity={0.3} className={cn("stroke-typical", fillClass)} />
    </Svg>
  );
}

/** A hub halo in one tone: tinted fill, ring and the ink core. */
export function HaloSwatch({ fillClass, strokeClass }: { fillClass: string; strokeClass: string }) {
  return (
    <Svg>
      <circle cx={W / 2} cy={H / 2} r={6} fillOpacity={0.3} className={fillClass} />
      <circle cx={W / 2} cy={H / 2} r={6} fill="none" strokeWidth={1.5} className={strokeClass} />
      <circle cx={W / 2} cy={H / 2} r={2} className="fill-foreground" />
    </Svg>
  );
}

/** Halo size scale: a small halo (just above 1.0×) growing to a full one (1.75× or more). */
export function HaloScaleSwatch() {
  return (
    <Svg>
      <circle cx={6} cy={H / 2} r={3.5} fillOpacity={0.12} className="fill-foreground" />
      <circle cx={6} cy={H / 2} r={3.5} fill="none" strokeWidth={1} strokeOpacity={0.5} className="stroke-foreground" />
      <circle cx={6} cy={H / 2} r={1.5} className="fill-foreground" />
      <circle cx={20} cy={H / 2} r={6.5} fillOpacity={0.12} className="fill-foreground" />
      <circle cx={20} cy={H / 2} r={6.5} fill="none" strokeWidth={1.25} strokeOpacity={0.55} className="stroke-foreground" />
      <circle cx={20} cy={H / 2} r={1.5} className="fill-foreground" />
    </Svg>
  );
}

/** An area outline, e.g. a hub catchment: faint fill, hairline edge. */
export function AreaSwatch({ fillClass = "fill-foreground", strokeClass = "stroke-foreground" }: { fillClass?: string; strokeClass?: string }) {
  return (
    <Svg>
      <circle cx={W / 2} cy={H / 2} r={6} fillOpacity={0.08} className={fillClass} />
      <circle cx={W / 2} cy={H / 2} r={6} fill="none" strokeWidth={1} strokeOpacity={0.45} className={strokeClass} />
    </Svg>
  );
}

/**
 * The bus glyph (rounded body, pointed front), pointing right. Solid: `fillClass` body on a map-land edge.
 * Outline: map-land body with a `strokeClass` edge (RESERVED, DEADHEADING, WAITING).
 */
export function BusSwatch({ variant, fillClass, strokeClass }: { variant: "solid" | "outline"; fillClass: string; strokeClass: string }) {
  const d = "M7 3.5h10.5a1.5 1.5 0 0 1 1.2.6l3 3.4-3 3.4a1.5 1.5 0 0 1-1.2.6H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Z";
  return (
    <Svg>
      <path d={d} strokeWidth={3} strokeLinejoin="round" className="fill-none stroke-map-land" />
      <path
        d={d}
        strokeWidth={1.5}
        strokeLinejoin="round"
        className={variant === "solid" ? cn("stroke-map-land", fillClass) : cn("fill-map-land", strokeClass)}
      />
    </Svg>
  );
}

/** One key entry: sample left, words right (ink, never coloured). */
export function LegendRow({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="flex h-4 shrink-0 items-center">{swatch}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
