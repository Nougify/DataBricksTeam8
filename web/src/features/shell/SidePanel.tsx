"use client";

import { useSim } from "@/lib/live/store";
import { HubPanelSlot, NetworkOverviewSlot } from "./slots";

/**
 * The side panel's content: the network overview when no hub is selected, the hub panel when one is
 * (spec §8, §9). The Console decides where it sits (column, drawer or stacked); this fills whatever box it gets.
 */
export function SidePanel() {
  const selectedHubId = useSim((s) => s.selectedHubId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selectedHubId ? <HubPanelSlot key={selectedHubId} hubId={selectedHubId} /> : <NetworkOverviewSlot />}
    </div>
  );
}
