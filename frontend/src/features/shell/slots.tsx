"use client";

import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperationsPanel } from "@/features/operations";
import { hubDisplayName } from "@/lib/live/effects";
import { useSim } from "@/lib/live/store";

export function NetworkOverviewSlot() {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-4 md:px-4">
      <h2 className="pr-10 font-heading text-lg leading-tight font-semibold">Network overview</h2>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">Live operational decisions across all dispatch locations.</p>
      <OperationsPanel />
    </div>
  );
}

export function HubPanelSlot({ hubId }: { hubId: string }) {
  const selectHub = useSim((s) => s.selectHub);
  const name = hubDisplayName(hubId);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-4 md:px-4">
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => selectHub(null)}>
        <ChevronLeft aria-hidden />
        All hubs
      </Button>
      <h2 className="mt-1 pr-10 font-heading text-2xl leading-7 font-semibold">{name}</h2>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">Dispatch events and service actions for this hub.</p>
      <OperationsPanel hubId={hubId} />
    </div>
  );
}
