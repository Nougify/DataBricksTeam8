"use client";

// Milestone 1 placeholders for the side panel's two views. Milestone 2 replaces them with the network
// overview (spec §8) and the hub panel with its tabs (spec §9). Each slot owns its scrolling: SidePanel gives
// it a column of fixed height on desktop and tablet, so a header and tab strip can stay pinned above a
// scrolling body; on phone the page scrolls instead.
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { hubDisplayName } from "@/lib/live/effects";
import { useSim } from "@/lib/live/store";

export function NetworkOverviewSlot() {
  const selectHub = useSim((s) => s.selectHub);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 md:px-4">
      <h2 className="pr-10 font-heading text-lg leading-tight font-semibold">Network overview</h2>
      <EmptyState
        className="mt-4"
        title="Hub cards and the approval queue are on the way"
        description="The network overview arrives in the next build step. Until then, select a hub to open its panel."
        action={{ label: "Select UBC", onClick: () => selectHub("ubc") }}
      />
    </div>
  );
}

export function HubPanelSlot({ hubId }: { hubId: string }) {
  const selectHub = useSim((s) => s.selectHub);
  const name = hubDisplayName(hubId);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 md:px-4">
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => selectHub(null)}>
        <ChevronLeft aria-hidden />
        All hubs
      </Button>
      <h2 className="mt-1 pr-10 font-heading text-2xl leading-7 font-semibold">{name}</h2>
      <EmptyState
        className="mt-4"
        title={`The ${name} panel is on the way`}
        description="The Now, Origins, Dispatch, Routes, Late night, Planner and Findings tabs arrive in the next build step."
      />
    </div>
  );
}
