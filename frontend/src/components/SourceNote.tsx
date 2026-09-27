import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SourceNoteProps {
  /** What the number comes from, e.g. "Rogers pings", "Forecast model", "TransLink TSPR 2025". */
  source: ReactNode;
  /** Appends "Mock" (with the same flask glyph as the top bar's Mock data badge) for placeholder numbers. */
  mock?: boolean;
  /** Optional link for the source name (About's data sources). */
  href?: string | null;
  className?: string;
}

/** The small "Source: …" line under every KPI, chart and evidence item (spec §1, §4.2 rule 2). */
export function SourceNote({ source, mock = false, href, className }: SourceNoteProps) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Source:{" "}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {source}
        </a>
      ) : (
        source
      )}
      {mock && (
        <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap">
          <FlaskConical aria-hidden className="size-3" />
          Mock
        </span>
      )}
    </p>
  );
}
