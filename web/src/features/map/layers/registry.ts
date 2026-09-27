// Every map layer, in spec §7.3 order, bottom to top. ConsoleMapImpl draws the GL parts in this order and the
// key (legend.tsx) shows the Legend of each module whose toggle is on.
//
// Draw order without beforeId
// ---------------------------
// MapLibre stacks layers in the order they're added, and react-map-gl re-adds our <Source>/<Layer> children
// after every setStyle (theme switch, online → offline basemap). We never pass `beforeId`, because the layer
// ids we could anchor to differ between CARTO, Protomaps and the plain style, and a missing anchor breaks
// addLayer. Instead the order is guaranteed by construction:
//
//   1. Every GL module is mounted once, up front, in this array's order, and never unmounted. A layer that's
//      toggled off or has no data yet keeps its <Source> (empty FeatureCollection) and hides with
//      `layout.visibility: "none"`. (Mounting later would append it on top of everything.)
//   2. Each module owns its <Source>, and its <Layer>s are that Source's children, bottom to top.
//   3. After a style swap, each <Source> re-adds itself (and then its child layers) from a `styledata`
//      listener registered at mount, so in mount order = this array's order. Layers are only created once
//      their source exists, so no module's layers can land below an earlier module's.
//
// So: to add a layer, add its module to the right slot below; don't mount GL layers conditionally anywhere.
// HTML markers (hubs, labels) always sit above the canvas, whatever their position here.
// Trade-off: our GL overlays draw above the basemap's own labels (DESIGN §8.1 would put rows 1–4 under them).
import { CatchmentsLayer, CatchmentsLegend } from "./CatchmentsLayer";
import { HubHaloLegend, HubMarkers } from "./HubMarkers";
import type { LayerKey } from "@/lib/live/store";
import type { MapLayerModule } from "./types";

export const MAP_LAYERS: readonly MapLayerModule[] = [
  // 1 Routes (M3): RoutesLayer, toggle "routes" (also shown in preview). Legend: need (5 px, casing) / spare (3.5 px).
  { id: "catchments", slot: 2, toggle: "catchments", Gl: CatchmentsLayer, Legend: CatchmentsLegend },
  // 3 Origin arcs (M2): OriginArcsLayer, toggle "origins". Legend: transfer required (thick, emphasised) / one-seat ride.
  // 4 Origin bubbles (M2): OriginBubblesLayer, toggle "origins" (the arcs' legend covers both).
  { id: "hubs", slot: 5, toggle: null, Html: HubMarkers, Legend: HubHaloLegend },
  // 6 Surges (M3): SurgesLayer, toggle "surges". Legend: UPCOMING ring / ACTIVE filled / RESOLVED faded.
  // 7 Trip paths (M3): TripPathsLayer, toggle "buses". Legend: deadhead dashed / service solid.
  // 8 Buses (M4): BusesLayer, toggle "buses". Legend: bus glyph by status (solid / outline).
];

/** Whether a module is shown with the current layer toggles (modules without a toggle are always on). */
export const isModuleOn = (m: Pick<MapLayerModule, "toggle">, layers: readonly LayerKey[]) =>
  m.toggle === null || layers.includes(m.toggle);
