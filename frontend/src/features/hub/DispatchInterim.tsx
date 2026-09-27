"use client";

// Dispatch tab until milestone 3 (DECISIONS.md "2b answers"): this hub's proposals with Approve / Reject and its
// active extra trips, so the demo can act on a proposal. M3 replaces it with proposal cards, Preview and history.
import { EmptyState } from "@/components/EmptyState";
import { hubName } from "@/config/hubs";
import { PRESETS } from "@/config/scenario";
import { ActiveTrips } from "@/features/overview/ActiveTrips";
import { ApprovalQueue } from "@/features/overview/ApprovalQueue";
import { OverviewSection } from "@/features/overview/NetworkOverview";
import { usePresetJump } from "@/features/topbar/actions";

export function DispatchInterim({ hubId }: { hubId: string }) {
  const name = hubName(hubId);
  const { jumpToPreset, isPending } = usePresetJump();
  const preset = PRESETS.find((p) => p.hub_id === hubId && p.id !== "saturday-late-night");
  return (
    <div className="flex flex-col gap-6">
      <OverviewSection title="Proposals" id="dispatch-proposals">
        <ApprovalQueue
          hubId={hubId}
          empty={
            <EmptyState
              title={`No proposals for ${name}`}
              description="The engine proposes a bus when it forecasts a surge."
              action={preset ? { label: `Jump to ${preset.label}`, onClick: () => jumpToPreset(preset), disabled: isPending } : undefined}
            />
          }
        />
      </OverviewSection>
      <OverviewSection title="Active extra trips" id="dispatch-active">
        <ActiveTrips hubId={hubId} />
      </OverviewSection>
      <p className="text-sm text-muted-foreground">
        Proposal cards with Preview on the map, evidence and trip history arrive in milestone 3.
      </p>
    </div>
  );
}
