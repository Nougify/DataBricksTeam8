"use client";

// The map key (spec §7.3 "Legend", DESIGN §8.2 "Key"), bottom-left. It is a registry renderer: each layer module
// in layers/registry.ts declares its own `Legend` rows, and the key shows the rows of the layers that are on,
// topmost layer first, in the same notation as the charts. On phones it collapses behind a "Key" button.
import { useId, useState } from "react";
import { useSim } from "@/lib/live/store";
import { cn } from "@/lib/utils";
import { isModuleOn, MAP_LAYERS } from "./layers/registry";

// Topmost first: what you see on top is explained first.
const LEGEND_MODULES = [...MAP_LAYERS].filter((m) => m.Legend).sort((a, b) => b.slot - a.slot);

export function MapLegend() {
  const layers = useSim((s) => s.layers);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const modules = LEGEND_MODULES.filter((m) => isModuleOn(m, layers));
  if (modules.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-24px)] flex-col-reverse items-start gap-2">
      <button
        type="button"
        className="pointer-events-auto h-9 rounded-xl border bg-card px-3 text-sm font-medium text-foreground shadow-float md:hidden"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        Key
      </button>
      <section
        id={bodyId}
        aria-label="Map key"
        className={cn(
          "pointer-events-auto w-max max-w-[260px] divide-y rounded-xl border bg-card px-3 py-1 text-xs leading-4 text-foreground shadow-float",
          open ? "block" : "hidden md:block",
        )}
      >
        {modules.map(({ id, Legend }) =>
          Legend ? (
            <ul key={id} className="space-y-1.5 py-2 empty:hidden">
              <Legend />
            </ul>
          ) : null,
        )}
      </section>
    </div>
  );
}
