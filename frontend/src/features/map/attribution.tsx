"use client";

// Compact attribution (spec §7.1, DESIGN §8.1), bottom-right: always © OpenStreetMap contributors, plus © CARTO
// (online) or © Protomaps (offline extract). MapLibre's own control is off, so the text doesn't depend on what
// each style's sources declare. A short note says when the basemap is degraded.
//
// Desktop (xl, ≥ 1280 px) shows the text in full. Below that the shell puts its own buttons along the bottom
// edge of the map (from 48 px in from the right), so the attribution collapses to an ⓘ button in the corner
// that opens the same text above that bottom row of buttons.
import { useId, useState } from "react";
import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BasemapKind } from "./basemap";

const NOTE: Partial<Record<BasemapKind, string>> = {
  pmtiles: "Offline basemap",
  plain: "Basemap unavailable",
};

const NOTE_DETAIL: Partial<Record<BasemapKind, string>> = {
  pmtiles: "The online basemap didn't load, so the bundled Metro Vancouver extract is shown.",
  plain: "The online basemap didn't load and no offline extract is installed. Hubs and overlays still draw.",
};

const PILL = "rounded-lg bg-card/90 px-2 py-0.5 text-xs leading-4 text-muted-foreground";
const LINK = "underline-offset-2 hover:text-foreground hover:underline";

function Credits({ kind, note }: { kind: BasemapKind; note: string | undefined }) {
  return (
    <>
      {note && (
        <span className="font-semibold text-foreground" title={NOTE_DETAIL[kind]}>
          {note}
        </span>
      )}
      <a className={LINK} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
      {kind === "online" && (
        <a className={LINK} href="https://carto.com/attributions" target="_blank" rel="noreferrer">
          © CARTO
        </a>
      )}
      {kind === "pmtiles" && (
        <a className={LINK} href="https://protomaps.com" target="_blank" rel="noreferrer">
          © Protomaps
        </a>
      )}
    </>
  );
}

export function MapAttribution({ kind, probing, right = 0 }: { kind: BasemapKind; probing: boolean; right?: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const note = probing ? undefined : NOTE[kind];

  return (
    <div className="absolute bottom-3 z-10 flex justify-end" style={{ right: 12 + right, maxWidth: `calc(100% - ${24 + right}px)` }}>
      {/* Desktop: always visible. */}
      <div className={cn(PILL, "hidden flex-wrap items-center justify-end gap-x-2 xl:flex")}>
        <Credits kind={kind} note={note} />
      </div>

      {/* Tablet and phone: compact. */}
      <div className="relative xl:hidden">
        <button
          type="button"
          className={cn(
            "flex size-6 items-center justify-center rounded-full bg-card/90 text-muted-foreground hover:text-foreground",
            note && "text-foreground ring-1 ring-foreground/40",
          )}
          aria-label={note ? `Map attribution. ${note}` : "Map attribution"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <InfoIcon className="size-4" aria-hidden="true" />
        </button>
        <div
          id={panelId}
          className={cn(
            PILL,
            "absolute bottom-[calc(100%+32px)] right-0 w-max max-w-[min(20rem,calc(100vw-48px))] flex-wrap items-center justify-end gap-x-2 shadow-float",
            open ? "flex" : "hidden",
          )}
        >
          <Credits kind={kind} note={note} />
        </div>
      </div>
    </div>
  );
}
