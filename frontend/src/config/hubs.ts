// The three hubs (spec §3). In v3 the backend has no /hubs endpoint, so hubs live in frontend config
// (DECISIONS.md "Where data comes from"). Ids match the backend's hub ids and the dispatch feed's hub_id.

export type HubId = "ubc" | "waterfront" | "park-royal";

export interface HubConfig {
  id: HubId;
  name: string;
  /** location_name in the Rogers data and the hub column in hub_pulse / model tables. */
  location_name: string;
  location: { lat: number; lon: number };
  catchment_m: number;
  description: string;
}

export const HUBS: readonly HubConfig[] = [
  {
    id: "ubc",
    name: "UBC",
    location_name: "UBC",
    location: { lat: 49.2606, lon: -123.246 },
    catchment_m: 800,
    description: "University campus and UBC Exchange, the region's largest bus-only exchange",
  },
  {
    id: "waterfront",
    name: "Waterfront Station",
    location_name: "Waterfront Station",
    location: { lat: 49.2857, lon: -123.1115 },
    catchment_m: 300,
    description: "Expo and Canada Line SkyTrain, SeaBus, West Coast Express and downtown buses",
  },
  {
    id: "park-royal",
    name: "Park Royal",
    location_name: "Park Royal Mall",
    location: { lat: 49.3265, lon: -123.138 },
    catchment_m: 300,
    description: "North Shore retail hub and bus exchange at the Lions Gate Bridge",
  },
];

export const HUB_IDS: readonly HubId[] = HUBS.map((h) => h.id);

export function hubConfig(hubId: string | null | undefined): HubConfig | undefined {
  return HUBS.find((h) => h.id === hubId);
}

/** Display name for a hub id; falls back to the id itself for anything unknown. */
export function hubName(hubId: string | null | undefined): string {
  return hubConfig(hubId)?.name ?? hubId ?? "";
}
