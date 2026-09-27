import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceNote } from "@/components/SourceNote";
import { cn } from "@/lib/utils";

export interface KpiProps {
  /** What is measured, in sentence case: "Pings", "Surge index", "Next surge". */
  label: string;
  /**
   * The period the value covers, appended to the label: "12:00–13:00" → "Pings, 12:00–13:00".
   * Every KPI has one (spec §4.2 rule 2); pass null only when the label already says it.
   */
  period: string | null;
  /** The formatted value ("3,920", "1.79"). Format through @/lib/format. */
  value: ReactNode;
  /** Unit shown after the value in muted text ("pings", "×"). Pass null only when the value carries it ("3 h"). */
  unit: string | null;
  /** The comparison, in ink: "vs 2,614 typical (+50.0%)", "vs 1.25× surge line". Omit when none exists. */
  comparison?: ReactNode;
  /** Where the number comes from: "Rogers pings", "computed", "Forecast model". */
  source: ReactNode;
  /** Placeholder numbers: the source line gets "Mock". */
  mock?: boolean;
  /** A state badge beside the value (e.g. severity). Never colour the number itself. */
  badge?: ReactNode;
  /** Shows a static skeleton shaped like the KPI (the label stays, so the reader knows what's coming). */
  loading?: boolean;
  className?: string;
}

/**
 * One KPI, unboxed (DESIGN.md §7.2): label with period, big value with a muted unit, the comparison, and a
 * source line. Values change in place with no count-up; heights are fixed so live updates never shift layout.
 */
export function Kpi({ label, period, value, unit, comparison, source, mock, badge, loading = false, className }: KpiProps) {
  const heading = period ? `${label}, ${period}` : label;

  if (loading) {
    return (
      <div className={cn("flex min-w-0 flex-col gap-1", className)} aria-busy="true">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-0.5 h-3 w-20" />
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <p className="text-sm text-muted-foreground">{heading}</p>
      <p className="flex min-h-8 flex-wrap items-baseline gap-x-1 gap-y-1">
        <span className="font-heading text-3xl leading-8 font-semibold">{value}</span>
        {unit && <span className="text-base text-muted-foreground">{unit}</span>}
        {badge && <span className="ml-1 self-center">{badge}</span>}
      </p>
      {comparison != null && comparison !== false && <p className="text-sm">{comparison}</p>}
      <SourceNote source={source} mock={mock} />
    </div>
  );
}

/**
 * The KPI row: a 2-column grid split by hairlines instead of boxes (DESIGN.md §7.2). Rows after the first
 * get a top rule; the right column gets a left rule. Cells are padded rather than gapped, so the rules meet.
 */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "-mb-4 grid grid-cols-2 [&>*]:pb-4",
        "[&>*:nth-child(odd)]:pr-4 [&>*:nth-child(even)]:border-l [&>*:nth-child(even)]:pl-4",
        "[&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:pt-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
