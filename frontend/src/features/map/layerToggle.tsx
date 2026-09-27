"use client";

// Layer toggle (spec §7.3), top-left. Bound to the store's `layers` (lib/url/state.ts mirrors it into the URL).
// A Radix dropdown with checkbox items: keyboard-operable, and it stays open so several layers can be switched.
import type { ReactNode } from "react";
import { LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSim, type LayerKey } from "@/lib/live/store";
import { AreaSwatch, BusSwatch, LineSwatch, PointSwatch } from "./swatches";

const ITEMS: readonly { key: LayerKey; label: string; swatch: ReactNode }[] = [
  { key: "origins", label: "Origins", swatch: <LineSwatch strokeClass="stroke-access-transfer" width={3} casing /> },
  {
    key: "origin-dots",
    label: "Origin arcs & dots",
    swatch: <PointSwatch variant="disc" fillClass="fill-access-transfer/40" strokeClass="stroke-access-transfer" />,
  },
  {
    key: "surges",
    label: "Surges",
    swatch: <PointSwatch variant="ring" fillClass="fill-surge-high" strokeClass="stroke-surge-high" />,
  },
  {
    key: "buses",
    label: "Buses & trips",
    swatch: <BusSwatch variant="solid" fillClass="fill-trip-active" strokeClass="stroke-trip-active" />,
  },
  { key: "routes", label: "Routes (need/spare)", swatch: <LineSwatch strokeClass="stroke-need" width={4} casing /> },
  { key: "catchments", label: "Hub catchments", swatch: <AreaSwatch /> },
];

export function LayerToggle() {
  const layers = useSim((s) => s.layers);
  const toggleLayer = useSim((s) => s.toggleLayer);

  return (
    <div className="absolute left-3 top-3 z-10">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-9 rounded-xl bg-card px-3 text-sm shadow-float dark:bg-card dark:hover:bg-muted"
            aria-label={`Map layers, ${layers.length} of ${ITEMS.length} on`}
          >
            <LayersIcon aria-hidden="true" />
            Layers
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60 rounded-xl">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Show on the map</DropdownMenuLabel>
          {ITEMS.map((item) => (
            <DropdownMenuCheckboxItem
              key={item.key}
              checked={layers.includes(item.key)}
              onCheckedChange={() => toggleLayer(item.key)}
              // Keep the menu open so several layers can be switched in one go.
              onSelect={(e) => e.preventDefault()}
              className="gap-2.5 py-1.5"
            >
              {item.swatch}
              {item.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
