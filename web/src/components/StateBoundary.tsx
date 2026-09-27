"use client";

import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmptyState, type EmptyStateProps } from "./EmptyState";
import { StaleNote, useStaleness } from "./StaleNote";

// The four states every data view handles (spec §4.2 rule 1, DESIGN.md §7.2):
// loading → skeleton; empty → why + one action; error → inline, what failed, Retry; stale → data + note.

export type ViewStatus = "loading" | "empty" | "error" | "ready";

export interface ViewError {
  /** What failed, as a noun phrase: "the UBC forecast" → "Couldn't load the UBC forecast." */
  what: string;
  /** The underlying message ("Couldn't reach the server."). */
  message?: string | null;
  onRetry?: () => void;
  /** True while the retry runs: the button says "Retrying…" and is disabled. */
  retrying?: boolean;
}

/** Inline error where the data would be: says what failed and offers Retry. Never a blank panel. */
export function InlineError({
  what,
  message,
  onRetry,
  retrying = false,
  verb = "load",
  className,
}: ViewError & { verb?: "load" | "refresh"; className?: string }) {
  return (
    <Alert className={className}>
      <CircleAlert aria-hidden className="text-destructive!" />
      <AlertTitle>
        Couldn&rsquo;t {verb} {what}.
      </AlertTitle>
      <AlertDescription>
        {message || "Something went wrong."}
        {verb === "refresh" && " Showing the last data loaded."}
      </AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

/** A generic static skeleton: a title line, two text lines and a block. Pass a shaped one when you can. */
export function DefaultSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export interface StateBoundaryProps {
  status: ViewStatus;
  /** Shaped like the final content. Defaults to DefaultSkeleton. */
  skeleton?: ReactNode;
  /** Required for views that can be empty. */
  empty?: EmptyStateProps;
  /** Required for views that can fail. */
  error?: ViewError;
  /** Data is shown, but the latest refresh failed: adds a small "Couldn't refresh" alert above it. */
  refreshError?: ViewError | null;
  /** Showing the previous sim hour's data while the next loads (`isPlaceholderData`). */
  updating?: boolean;
  /**
   * Live views (tied to the sim clock or the store) show a stale note while the connection is down.
   * Pass false for static data (findings, backtest, planner profile), which doesn't go stale. Default true.
   */
  live?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Renders one of the four required states for data that doesn't come from a single query (e.g. the store). */
export function StateBoundary({
  status,
  skeleton,
  empty,
  error,
  refreshError,
  updating = false,
  live = true,
  className,
  children,
}: StateBoundaryProps) {
  const { stale, asOf } = useStaleness();
  const showStale = live && stale && (status === "ready" || status === "empty");

  let body: ReactNode;
  if (status === "loading") body = skeleton ?? <DefaultSkeleton />;
  else if (status === "error")
    body = <InlineError what={error?.what ?? "this view"} message={error?.message} onRetry={error?.onRetry} retrying={error?.retrying} />;
  else if (status === "empty")
    body = empty ? <EmptyState {...empty} /> : <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;
  else body = children;

  return (
    <div className={cn("relative flex flex-col gap-3", className)} aria-busy={status === "loading" || updating}>
      {showStale && <StaleNote asOf={asOf} />}
      {refreshError && status === "ready" && <InlineError verb="refresh" {...refreshError} />}
      {updating && status === "ready" && (
        // Absolutely placed so it never shifts the content (DESIGN.md principle 5); no spinner.
        <span className="pointer-events-none absolute top-0 right-0 z-10 rounded-sm bg-background/85 px-1.5 text-xs text-muted-foreground">
          Updating…
        </span>
      )}
      {body}
    </div>
  );
}

type QueryLike<T> = Pick<UseQueryResult<T, Error>, "data" | "error" | "status" | "isPlaceholderData" | "isFetching" | "refetch">;

export interface QueryStateProps<T> extends Omit<StateBoundaryProps, "status" | "error" | "refreshError" | "updating" | "children"> {
  /** A TanStack query result (useForecast(...), useMeta(), ...). */
  query: QueryLike<T>;
  /** What the query loads, for the error: "the UBC forecast". */
  what: string;
  /** Decides whether loaded data counts as empty (e.g. `(d) => d.rows.length === 0`). */
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}

/**
 * The four states for one TanStack query. Loading shows the skeleton, a failure with no data shows an inline
 * error with Retry, empty data shows the EmptyState, and loaded data renders `children(data)`, with a stale
 * note while disconnected, "Updating…" while the previous hour's data stands in, and a small refresh error if
 * a refetch failed after data had loaded.
 */
export function QueryState<T>({ query, what, isEmpty, children, ...rest }: QueryStateProps<T>) {
  const { data, error, status, isPlaceholderData, isFetching, refetch } = query;
  const retry = () => void refetch();
  const viewError: ViewError = { what, message: error?.message, onRetry: retry, retrying: isFetching };

  if (data === undefined) {
    return <StateBoundary {...rest} status={status === "error" ? "error" : "loading"} error={viewError} />;
  }
  const empty = isEmpty?.(data) ?? false;
  return (
    <StateBoundary
      {...rest}
      status={empty ? "empty" : "ready"}
      error={viewError}
      refreshError={status === "error" ? viewError : null}
      updating={isPlaceholderData}
    >
      {empty ? null : children(data)}
    </StateBoundary>
  );
}
