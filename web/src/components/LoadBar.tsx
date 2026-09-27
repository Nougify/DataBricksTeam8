import { cn } from "@/lib/utils";

/** The fixed scale every load bar uses, so bars compare across routes and never truncate silently. */
export const LOAD_SCALE_MAX = 125;
const DEFAULT_CROWDED_FROM = 85;

export type LoadTone = "need" | "spare" | "neutral";

export interface LoadBarProps {
  /** Load as % of vehicle capacity (`load_pct`, or `load_before_pct` on a proposal). Drawn solid (actual). */
  value: number;
  /** Load after the proposed change (`load_after_pct`). Drawn as an outline box (plan notation). */
  after?: number | null;
  /** `need` for the target / overcrowded route, `spare` for the donor / spare route, `neutral` otherwise. */
  tone?: LoadTone;
  /** Where the crowded zone starts (`/meta.route_load_thresholds.overcrowded_pct`). Default 85. */
  crowdedFrom?: number;
  /** What the bar describes, for screen readers: "Route 99 load". */
  label: string;
  /** Show "104% → 91%" to the right. Default true. */
  showValue?: boolean;
  className?: string;
}

// Static class maps: Tailwind can't see classes built from template strings.
const FILL: Record<LoadTone, string> = { need: "bg-need", spare: "bg-spare", neutral: "bg-typical" };
const OUTLINE: Record<LoadTone, string> = { need: "border-need", spare: "border-spare", neutral: "border-typical" };

const pos = (pct: number) => (Math.min(Math.max(pct, 0), LOAD_SCALE_MAX) / LOAD_SCALE_MAX) * 100;
/** Loads read as whole percents ("104% → 91%", DESIGN.md §7.2). */
const fmtLoad = (pct: number | null | undefined) =>
  typeof pct === "number" && Number.isFinite(pct) ? `${Math.round(pct)}%` : "—";

/**
 * Route load on a fixed 0–125% scale (DESIGN.md §7.2). The crowded zone (≥ 85% by default) is hatched, with
 * ink ticks at the threshold and at 100%, so it reads without colour. Before is a solid fill; after is an
 * outline box a little taller than the track, so its edge stays visible over the fill.
 */
export function LoadBar({
  value,
  after = null,
  tone = "neutral",
  crowdedFrom = DEFAULT_CROWDED_FROM,
  label,
  showValue = true,
  className,
}: LoadBarProps) {
  const hasAfter = typeof after === "number" && Number.isFinite(after);
  const text = hasAfter ? `${fmtLoad(value)} → ${fmtLoad(after)}` : fmtLoad(value);
  const overScale = value > LOAD_SCALE_MAX || (hasAfter && after > LOAD_SCALE_MAX);
  const aria = `${label}: ${hasAfter ? `${fmtLoad(value)} now, ${fmtLoad(after)} after` : fmtLoad(value)}. Crowded from ${crowdedFrom}%.`;

  return (
    <div role="img" aria-label={aria} className={cn("flex min-w-0 items-center gap-2", className)}>
      <div className="relative h-3.5 min-w-16 flex-1" aria-hidden>
        <div className="absolute inset-x-0 top-[3px] h-2 overflow-hidden rounded-sm bg-muted">
          {/* Crowded zone: 45° hatch in `need` at 30%. */}
          <div
            className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(-45deg,var(--need)_0_1.5px,transparent_1.5px_4px)] opacity-30"
            style={{ left: `${pos(crowdedFrom)}%` }}
          />
          <div className={cn("absolute inset-y-0 left-0 rounded-sm", FILL[tone])} style={{ width: `${pos(value)}%` }} />
        </div>
        {[crowdedFrom, 100].map((tick) => (
          <div key={tick} className="absolute top-0.5 h-2.5 w-px bg-foreground" style={{ left: `${pos(tick)}%` }} />
        ))}
        {hasAfter && (
          <div
            className={cn("absolute inset-y-0 left-0 rounded-sm border-2", OUTLINE[tone])}
            style={{ width: `${pos(after)}%` }}
          />
        )}
        {overScale && (
          <span className="absolute top-1/2 -right-2.5 -translate-y-1/2 text-xs leading-none text-foreground">▸</span>
        )}
      </div>
      {showValue && (
        <span className={cn("shrink-0 text-sm whitespace-nowrap", overScale && "pl-1.5")} aria-hidden>
          {text}
        </span>
      )}
    </div>
  );
}
