"use client";

// The side panel's two views: the network overview (spec §8) and the hub panel with its tabs (spec §9). Each view
// owns its scrolling: SidePanel gives it a column of fixed height on desktop and tablet, so a header and tab strip
// can stay pinned above a scrolling body; on phone the page scrolls instead.
import { HubPanel } from "@/features/hub/HubPanel";
import { NetworkOverview } from "@/features/overview/NetworkOverview";

export function NetworkOverviewSlot() {
  return <NetworkOverview />;
}

export function HubPanelSlot({ hubId }: { hubId: string }) {
  return <HubPanel hubId={hubId} />;
}
