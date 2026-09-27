"use client";

// Surges away from the three hubs (spec §8.4): episodes of dispatch events with no hub_id that are forecast or in
// progress. The bundled feed only covers the hubs, so this is expected to be empty; it reads as a status line.
import { useMemo } from "react";
import { EmptyState } from "@/components/EmptyState";
import { SeverityBadge } from "@/components/SeverityBadge";
import { SourceNote } from "@/components/SourceNote";
import { FEED_SOURCE } from "@/data/feed";
import { fmtIndex, fmtWindow } from "@/lib/format";
import { useSimNow } from "@/lib/live/clock";
import { episodePhase, useEpisodes } from "@/lib/live/episodes";

export function AwayEvents() {
  const episodes = useEpisodes();
  const nowMs = useSimNow(1000);
  const away = useMemo(
    () => episodes.filter((ep) => ep.hub_id === null && Number.isFinite(nowMs) && episodePhase(ep, nowMs) !== "RESOLVED"),
    [episodes, nowMs],
  );

  if (away.length === 0) {
    return <EmptyState title="None right now" description="No surges away from the three hubs right now." />;
  }
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col divide-y">
        {away.map((ep) => (
          <li key={ep.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="font-semibold">{ep.place}</span>
            <span>{fmtWindow(ep.startMs, ep.endMs)}</span>
            {ep.peakIndex !== null && <span>peak {fmtIndex(ep.peakIndex)}</span>}
            {ep.severity && <SeverityBadge severity={ep.severity} active={episodePhase(ep, nowMs) === "ACTIVE"} className="ml-auto" />}
          </li>
        ))}
      </ul>
      <SourceNote source={FEED_SOURCE} />
    </div>
  );
}
