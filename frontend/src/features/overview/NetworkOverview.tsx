"use client";

// Network overview (spec §8, DECISIONS.md "v3" and "2b answers"): the side panel when no hub is selected.
//   1. Hub cards: last full hour vs typical (bundled forecast, arrivals), surge index, the current or next surge
//      episode (dispatch events), pending proposals and active extra trips.
//   2. Approval queue: every PROPOSED trip, soonest expiry first, with Approve and Reject (Preview arrives in M3).
//   3. Active extra trips, with progress and the next milestone.
//   4. Surges away from the hubs (dispatch events without a hub; expected to be empty).
//   5. Scorecard strip: model.surge_model_metrics at 60 min lead.
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { StateBoundary } from "@/components/StateBoundary";
import { usePresetJump } from "@/features/topbar/actions";
import { PRESETS } from "@/config/scenario";
import { useSim } from "@/lib/live/store";
import { HubCards } from "./HubCards";
import { ApprovalQueue } from "./ApprovalQueue";
import { ActiveTrips } from "./ActiveTrips";
import { AwayEvents } from "./AwayEvents";
import { ScorecardStrip } from "./ScorecardStrip";

export function OverviewSection({ title, id, children, aside }: { title: string; id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="font-heading text-lg leading-tight font-semibold">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function NetworkOverview() {
  const hasClock = useSim((s) => s.clock !== null);
  const { jumpToPreset, isPending } = usePresetJump();
  const ubcPreset = PRESETS.find((p) => p.id === "ubc-exam-weekend");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 md:px-4">
      <h2 className="pr-10 font-heading text-2xl leading-7 font-semibold">Network overview</h2>
      <p className="mt-1 text-sm text-muted-foreground">Select a hub for its forecast, origins and dispatch.</p>
      <div className="mt-5 flex flex-col gap-6">
        <OverviewSection title="Hubs" id="ov-hubs">
          <HubCards />
        </OverviewSection>
        <OverviewSection title="Approval queue" id="ov-queue">
          <StateBoundary status={hasClock ? "ready" : "loading"}>
            <ApprovalQueue
              empty={
                <EmptyState
                  title="No proposals waiting"
                  description="The engine proposes a bus when it forecasts a surge."
                  action={
                    ubcPreset
                      ? { label: `Jump to ${ubcPreset.label}`, onClick: () => jumpToPreset(ubcPreset), disabled: isPending || !hasClock }
                      : undefined
                  }
                />
              }
            />
          </StateBoundary>
        </OverviewSection>
        <OverviewSection title="Active extra trips" id="ov-active">
          <StateBoundary status={hasClock ? "ready" : "loading"}>
            <ActiveTrips />
          </StateBoundary>
        </OverviewSection>
        <OverviewSection title="Surges away from the hubs" id="ov-away">
          <StateBoundary status={hasClock ? "ready" : "loading"}>
            <AwayEvents />
          </StateBoundary>
        </OverviewSection>
        <ScorecardStrip />
      </div>
    </div>
  );
}
