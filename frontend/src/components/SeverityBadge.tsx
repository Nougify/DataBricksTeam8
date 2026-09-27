import { Badge } from "@/components/ui/badge";
import type { Severity } from "@/config/scenario";
import { cn } from "@/lib/utils";

export const SEVERITY_WORD: Record<Severity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

// Static class maps: Tailwind can't see `fill-${x}`.
const FILL: Record<Severity, string> = { LOW: "fill-surge-low", MEDIUM: "fill-surge-medium", HIGH: "fill-surge-high" };
const STROKE: Record<Severity, string> = {
  LOW: "stroke-surge-low",
  MEDIUM: "stroke-surge-medium",
  HIGH: "stroke-surge-high",
};

/**
 * The severity mark (DESIGN.md §7.2): a ring for a forecast (UPCOMING) surge, a disc for an ACTIVE one, in the
 * severity colour. The same mark as the map. Decorative: the word next to it carries the meaning.
 */
export function SeverityMark({ severity, variant, className }: { severity: Severity; variant: "ring" | "disc"; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" className={cn("size-3 shrink-0", className)}>
      {variant === "ring" ? (
        <circle cx={6} cy={6} r={4.25} strokeWidth={2.5} className={cn("fill-none", STROKE[severity])} />
      ) : (
        <circle cx={6} cy={6} r={5} className={FILL[severity]} />
      )}
    </svg>
  );
}

/** "○ High" for a forecast surge, "● High" for one in progress. Text in ink; colour sits on the mark. */
export function SeverityBadge({
  severity,
  active,
  className,
}: {
  severity: Severity;
  /** In progress (disc) rather than forecast (ring). */
  active: boolean;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-semibold", className)}>
      <SeverityMark severity={severity} variant={active ? "disc" : "ring"} />
      {SEVERITY_WORD[severity]}
      <span className="sr-only">{active ? " surge in progress" : " surge forecast"}</span>
    </Badge>
  );
}
