import type { ComponentType } from "react";
import type { LayerKey } from "@/lib/live/store";
import type { MapTheme } from "../theme";

export interface MapLayerProps {
  /**
   * The layer's toggle is on (always true for layers without a toggle). GL layers hide with
   * `layout.visibility: "none"`; they never unmount (see the ordering note in registry.ts).
   */
  visible: boolean;
  /** A proposal is being previewed: multiply opacities by `dimFactor(dimmed, inPreviewSet)` (dim.ts). */
  dimmed: boolean;
  /** Theme name + resolved token colours for paint properties. Changes together with the basemap style. */
  theme: MapTheme;
}

/** One map layer (spec §7.3). A module can draw in GL, in HTML markers, or both. */
export interface MapLayerModule {
  /** Stable id; also the prefix of its GL source and layer ids (`ov-<id>...`). */
  id: string;
  /** Row in spec §7.3, 1 = bottom. Documentation only: the draw order is the order of MAP_LAYERS. */
  slot: number;
  /** The layer-menu toggle that shows it, or null when it's always on (hub markers). */
  toggle: LayerKey | null;
  /** `<Source>` + `<Layer>` children of <Map>. Always mounted, in MAP_LAYERS order. */
  Gl?: ComponentType<MapLayerProps>;
  /** `<Marker>` children (focusable HTML). They sit above the canvas regardless of order. */
  Html?: ComponentType<MapLayerProps>;
  /** Key rows (`<LegendRow>`s) shown while the layer is on. */
  Legend?: ComponentType;
}
