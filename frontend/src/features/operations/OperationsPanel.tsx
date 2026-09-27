"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSim, type HubTab } from "@/lib/live/store";
import { EventsView, FleetView, ProposalsView, SummaryStrip, TripsView } from "./components";
import { selectOperations } from "./selectors";

const TAB_LABELS: Record<HubTab, string> = {
  events: "Events",
  proposals: "Proposals",
  trips: "Trips",
  fleet: "Fleet",
};

/** Shared operational workspace. A hub narrows event-linked records; null shows the whole network. */
export function OperationsPanel({ hubId = null }: { hubId?: string | null }) {
  const tab = useSim((state) => state.tab);
  const setTab = useSim((state) => state.setTab);
  const dispatchEvents = useSim((state) => state.dispatchEvents);
  const tripsById = useSim((state) => state.trips);
  const busesById = useSim((state) => state.buses);
  const data = selectOperations(dispatchEvents, tripsById, busesById, hubId);

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as HubTab)} className="min-h-0 flex-1 gap-3">
      <SummaryStrip {...data.counts} />
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList aria-label="Operations views" className="min-w-full" variant="line">
          {(Object.keys(TAB_LABELS) as HubTab[]).map((key) => (
            <TabsTrigger key={key} value={key}>{TAB_LABELS[key]}</TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-4">
        <TabsContent value="events"><EventsView events={data.events} /></TabsContent>
        <TabsContent value="proposals"><ProposalsView proposals={data.proposals} events={dispatchEvents} buses={busesById} /></TabsContent>
        <TabsContent value="trips"><TripsView trips={data.trips} events={dispatchEvents} /></TabsContent>
        <TabsContent value="fleet"><FleetView buses={data.buses} trips={tripsById} /></TabsContent>
      </div>
    </Tabs>
  );
}
