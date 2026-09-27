"use client";

// The side panel with a hub selected (spec §9): "All hubs", the hub name and a status line, then the tabs. Header
// and tab strip stay pinned while the body scrolls (desktop, tablet); on phone the page scrolls and the tab strip
// scrolls sideways. Milestone 2b builds Now and Origins; the other tabs say when they arrive.
import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hubName } from "@/config/hubs";
import { fmtIndex, fmtWindow } from "@/lib/format";
import { useSimNow } from "@/lib/live/clock";
import { useLastFullHour } from "@/lib/live/demand";
import { currentOrNextEpisode, episodePhase, useEpisodes } from "@/lib/live/episodes";
import { HUB_TABS, useSim, type HubTab } from "@/lib/live/store";
import { tripHub } from "@/lib/live/trips";
import { NowTab } from "./now/NowTab";
import { OriginsTab } from "./origins/OriginsTab";
import { DispatchInterim } from "./DispatchInterim";

const TAB_LABELS: Record<HubTab, string> = {
  now: "Now",
  origins: "Origins",
  dispatch: "Dispatch",
  routes: "Routes",
  "late-night": "Late night",
  planner: "Planner",
  findings: "Findings",
};

const LATER: Partial<Record<HubTab, { milestone: string; what: string }>> = {
  routes: { milestone: "4", what: "Routes that need relief next to routes with spare capacity, and the TSPR 2025 crowding table" },
  "late-night": { milestone: "4", what: "Pings after midnight against the typical NightBus timetable" },
  planner: { milestone: "4", what: "The what-if schedule planner, ported from the AppKit app" },
  findings: { milestone: "4", what: "Hub profile, the reschedule-or-invest verdict, recommendations and surge days" },
};

function useStatusLine(hubId: string): string {
  const last = useLastFullHour("arrivals")[hubId];
  const episodes = useEpisodes();
  const nowMs = useSimNow(1000);
  const ep = Number.isFinite(nowMs) ? currentOrNextEpisode(episodes, hubId, nowMs) : null;
  const index = last?.row?.actual_index ?? null;
  const parts = [index !== null ? `${fmtIndex(index)} typical in the last hour` : "No hourly pings for the last hour"];
  if (ep) parts.push(`surge ${episodePhase(ep, nowMs) === "ACTIVE" ? "now" : "forecast"} ${fmtWindow(ep.startMs, ep.endMs)}`);
  return parts.join("; ");
}

export function HubPanel({ hubId }: { hubId: string }) {
  const selectHub = useSim((s) => s.selectHub);
  const tab = useSim((s) => s.tab);
  const setTab = useSim((s) => s.setTab);
  const trips = useSim((s) => s.trips);
  const events = useSim((s) => s.events);
  const name = hubName(hubId);
  const status = useStatusLine(hubId);
  const proposed = useMemo(
    () => Object.values(trips).filter((t) => t.status === "PROPOSED" && tripHub(t, events) === hubId).length,
    [trips, events, hubId],
  );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as HubTab)} className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="shrink-0 border-b px-3 pt-3 md:px-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => selectHub(null)}>
          <ChevronLeft aria-hidden />
          All hubs
        </Button>
        <h2 className="mt-1 pr-10 font-heading text-2xl leading-7 font-semibold">{name}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground" aria-live="off">
          {status}
        </p>
        <div className="-mx-3 mt-3 overflow-x-auto px-3 pb-[5px] [scrollbar-width:none] md:-mx-4 md:px-4">
          <TabsList variant="line" className="h-9 w-max justify-start gap-3 p-0" aria-label={`${name} views`}>
            {HUB_TABS.map((t) => (
              <TabsTrigger key={t} value={t} className="h-9 flex-none px-0.5">
                {TAB_LABELS[t]}
                {t === "dispatch" && proposed > 0 && (
                  <Badge className="h-4.5 min-w-4.5 px-1 tabular-nums" aria-label={`${proposed} proposed`}>
                    {proposed}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-4">
        <TabsContent value="now">
          <NowTab hubId={hubId} />
        </TabsContent>
        <TabsContent value="origins">
          <OriginsTab hubId={hubId} />
        </TabsContent>
        <TabsContent value="dispatch">
          <DispatchInterim hubId={hubId} />
        </TabsContent>
        {HUB_TABS.filter((t) => LATER[t]).map((t) => (
          <TabsContent key={t} value={t}>
            <EmptyState
              title={`${TAB_LABELS[t]} arrives in milestone ${LATER[t]!.milestone}`}
              description={`${LATER[t]!.what}.`}
              action={{ label: "Open Now", onClick: () => setTab("now") }}
            />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
