// Zod schemas for every object, response and WebSocket message in ../../../../backendspec.md (contract v3).
// TS types are inferred from these. backendspec.md wins on names and shapes; don't adapt silently.
//
// Fields backendspec.md lists are required. Extra fields the real backend (backend/app) sends are optional or
// nullable, and the UI uses them when present (DECISIONS.md "Contract (zod)"). Enums follow the real backend
// where it is a superset of the spec (EventStatus adds NO_ACTION_REQUIRED and REJECTED).
import { z } from "zod";

// ---------- primitives ----------

/** ISO 8601 with an explicit offset, e.g. 2025-12-06T10:00:00-08:00 (fractional seconds allowed). */
export const IsoTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, "ISO time with offset");
/** YYYY-MM-DD. */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const Hour = z.number().int().min(0).max(23);

export const GeoPoint = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
export type GeoPoint = z.infer<typeof GeoPoint>;

export const Position = z.tuple([z.number(), z.number()]);
export const LineString = z.object({ type: z.literal("LineString"), coordinates: z.array(Position).min(2) });
export type LineString = z.infer<typeof LineString>;
export const MultiLineString = z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(Position).min(2)).min(1) });
export const RouteShape = z.union([LineString, MultiLineString]);
export type RouteShape = z.infer<typeof RouteShape>;

// ---------- routes ----------

export const TransitMode = z.enum(["Bus", "SkyTrain", "SeaBus", "West Coast Express"]);
export type TransitMode = z.infer<typeof TransitMode>;

export const RouteRef = z.object({
  route_id: z.string().min(1),
  line_key: z.string().min(1),
  short_name: z.string().min(1),
  long_name: z.string().nullable(),
  mode: TransitMode,
  color: z.string().nullable(),
  text_color: z.string().nullable(),
});
export type RouteRef = z.infer<typeof RouteRef>;

/** GET /routes item: RouteRef, plus `shape` when include_shape=true. */
export const RouteListItem = RouteRef.extend({ shape: RouteShape.nullable().optional() });
export type RouteListItem = z.infer<typeof RouteListItem>;
export const RouteList = z.array(RouteListItem);

/** GET /routes/{id}. */
export const RouteDetail = RouteRef.extend({ shape: RouteShape.nullable() });
export type RouteDetail = z.infer<typeof RouteDetail>;

// ---------- dispatch events (§5) ----------

export const RecommendationCandidate = z.object({
  route_id: z.string(),
  pattern_id: z.string(),
  source_stop_id: z.string(),
  destination_stop_id: z.string(),
  source_stop_sequence: z.number().int(),
  destination_stop_sequence: z.number().int(),
  direction_id: z.number().int().nullable(),
  requested_service_date: LocalDate,
  feed_service_date: LocalDate,
  representative_service: z.boolean(),
  scheduled_trip_ids: z.array(z.string()),
});
export type RecommendationCandidate = z.infer<typeof RecommendationCandidate>;

export const MappingStatus = z.enum(["UNRESOLVED", "RESOLVED", "INVALID"]);
export type MappingStatus = z.infer<typeof MappingStatus>;

export const EventRecommendation = z.object({
  destination: z.string().min(1),
  destination_share: z.number().min(0).max(100),
  route_id: z.string().nullable(),
  source_route: z.string().min(1),
  extra_bus_trips_est: z.number().min(0),
  priority_score: z.number().min(0),
  scheduled_trips_that_hour: z.number().int().nullable(),
  extra_people_on_route: z.number().nullable(),
  avg_daily_boardings: z.number().nullable(),
  pct_trips_overcrowded: z.number().nullable(),
  // Real-backend extras: how the backend resolved the recommendation against its GTFS index.
  mapping_status: MappingStatus.optional(),
  failure_code: z.string().nullable().optional(),
  failure_reason: z.string().nullable().optional(),
  candidates: z.array(RecommendationCandidate).optional(),
});
export type EventRecommendation = z.infer<typeof EventRecommendation>;

export const EventMode = z.enum(["REACTIVE", "PROACTIVE"]);
export type EventMode = z.infer<typeof EventMode>;

export const EventStatus = z.enum([
  "PENDING",
  "NO_ACTION_REQUIRED",
  "AWAITING_APPROVAL",
  "DISPATCHED",
  "COMPLETED",
  "NO_MATCHING_ROUTE",
  "NO_BUS_AVAILABLE",
  "EXPIRED",
  "REJECTED",
  "INVALID_SOURCE",
]);
export type EventStatus = z.infer<typeof EventStatus>;

export const DispatchEvent = z.object({
  id: z.string().min(1),
  hub_id: z.string().nullable(),
  source_location: z.string().min(1),
  location: GeoPoint.nullable(),
  available_at: IsoTime.nullable(),
  actionable_at: IsoTime,
  event_time: IsoTime,
  mode: EventMode,
  surge_type: z.string().nullable(),
  predicted_people: z.number().min(0),
  normal_people: z.number().min(0),
  surge_ratio: z.number().nullable(),
  suggested_extra_buses: z.number().int().min(0),
  priority_score: z.number().min(0),
  recommendations: z.array(EventRecommendation),
  status: EventStatus,
  additional_trip_ids: z.array(z.string()),
  source: z.object({
    split: z.string().nullable(),
    direction: z.string().nullable(),
    link: z.string().nullable(),
    version: z.string().nullable(),
    generated_at: IsoTime.nullable().optional(),
  }),
});
export type DispatchEvent = z.infer<typeof DispatchEvent>;
export const DispatchEventList = z.array(DispatchEvent);

// ---------- clock ----------

export const SPEEDS = [1, 60, 300, 900, 3600] as const;
export const Speed = z.union(SPEEDS.map((s) => z.literal(s)) as [z.ZodLiteral<1>, ...z.ZodLiteral<(typeof SPEEDS)[number]>[]]);
export type Speed = (typeof SPEEDS)[number];

export const ClockStatus = z.enum(["RUNNING", "PAUSED"]);
export type ClockStatus = z.infer<typeof ClockStatus>;
export const ApprovalMode = z.enum(["MANUAL", "AUTOMATIC"]);

export const Clock = z.object({
  current_time: IsoTime,
  speed: Speed,
  status: ClockStatus,
  min_time: IsoTime,
  max_time: IsoTime,
  epoch: z.number().int().min(0),
  // Real-backend extras.
  local_date: LocalDate.optional(),
  hour: Hour.optional(),
  approval_mode: ApprovalMode.optional(),
  auto_pause_on_proposal: z.boolean().optional(),
});
export type Clock = z.infer<typeof Clock>;

// ---------- buses ----------

export const BusStatus = z.enum(["AVAILABLE", "RESERVED", "DEADHEADING", "WAITING", "IN_SERVICE", "RETURNING", "REPOSITIONING"]);
export type BusStatus = z.infer<typeof BusStatus>;

export const BusSource = z.object({
  type: z.enum(["ROUTE", "DEPOT"]),
  route: RouteRef.nullable(),
  depot_name: z.string().nullable(),
});
export type BusSource = z.infer<typeof BusSource>;

export const Bus = z.object({
  id: z.string().min(1),
  status: BusStatus,
  location: GeoPoint,
  capacity: z.number().int().positive(),
  assigned_trip_id: z.string().nullable(),
  proposed_trip_id: z.string().nullable(),
  // Real-backend extras.
  heading_deg: z.number().min(0).lt(360).nullable().optional(),
  source: BusSource.optional(),
});
export type Bus = z.infer<typeof Bus>;
export const BusList = z.array(Bus);

// ---------- additional trips ----------

export const TripStatus = z.enum(["PROPOSED", "APPROVED", "BUS_EN_ROUTE", "IN_SERVICE", "COMPLETED", "REJECTED", "EXPIRED", "CANCELLED"]);
export type TripStatus = z.infer<typeof TripStatus>;

export const RoutingProvenance = z.object({
  provider: z.string(),
  is_approximation: z.boolean(),
  method: z.string(),
  speed_kph: z.number().nullable(),
});

export const MovementLeg = z.object({
  kind: z.enum(["DEADHEAD", "SERVICE", "RETURN"]),
  path: LineString,
  distance_m: z.number().min(0),
  duration_seconds: z.number().int().min(0),
  provenance: RoutingProvenance,
});
export type MovementLeg = z.infer<typeof MovementLeg>;

export const MovementPlan = z.object({
  route_id: z.string(),
  pattern_id: z.string(),
  source_stop_id: z.string(),
  destination_stop_id: z.string(),
  reference_scheduled_trip_id: z.string(),
  mode: EventMode,
  deadhead: MovementLeg,
  service: MovementLeg,
  return_leg: MovementLeg,
  dispatch_time: IsoTime,
  estimated_arrival_time: IsoTime,
  service_departure_time: IsoTime,
  estimated_completion_time: IsoTime,
  estimated_return_time: IsoTime,
  waiting_seconds: z.number().int().min(0),
  arrival_lateness_seconds: z.number().int().min(0),
  total_distance_m: z.number().min(0),
});
export type MovementPlan = z.infer<typeof MovementPlan>;

export const AdditionalTrip = z.object({
  id: z.string().min(1),
  dispatch_event_id: z.string().min(1),
  bus_id: z.string().min(1),
  route_id: z.string().min(1),
  status: TripStatus,
  proposed_at: IsoTime,
  approval_expires_at: IsoTime,
  dispatch_time: IsoTime.nullable(),
  target_event_time: IsoTime,
  estimated_arrival_time: IsoTime.nullable(),
  service_departure_time: IsoTime.nullable(),
  estimated_completion_time: IsoTime.nullable(),
  added_capacity: z.number().int().positive(),
  rationale: z.string().min(1),
  source_priority: z.number().min(0),
  // Real-backend extras.
  source_route: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  selected_candidate: RecommendationCandidate.nullable().optional(),
  movement_plan: MovementPlan.nullable().optional(),
});
export type AdditionalTrip = z.infer<typeof AdditionalTrip>;
export const TripList = z.array(AdditionalTrip);

// ---------- responses ----------

export const StateResponse = z.object({
  epoch: z.number().int().min(0),
  last_seq: z.number().int().min(0),
  simulation: Clock,
  dispatch_events: z.array(DispatchEvent),
  buses: z.array(Bus),
  additional_trips: z.array(AdditionalTrip),
});
export type StateResponse = z.infer<typeof StateResponse>;

/** GET /meta. backendspec.md §8 lists what it reports but not its shape; this is the real backend's. */
export const Meta = z.object({
  data_mode: z.enum(["fixture", "exported_events", "databricks"]),
  source_identity: z.string().nullable(),
  source_version: z.string().nullable(),
  integration_status: z.string(),
  integration_error: z.string().nullable(),
  event_window: z.object({
    source_identity: z.string().nullable().optional(),
    source_version: z.string().nullable().optional(),
    window_start: IsoTime,
    window_end: IsoTime,
    loaded_at: IsoTime.nullable().optional(),
    row_count: z.number().int().nullable().optional(),
    provenance: z.string().nullable().optional(),
  }),
  simulation_bounds: z.object({ min_time: IsoTime, max_time: IsoTime }),
  supported_speeds: z.array(Speed),
  gtfs_version: z.string(),
  fleet: z.object({
    size: z.number().int(),
    total_capacity: z.number().int(),
    source: z.string(),
    max_buses_per_event: z.number().int(),
  }),
  approval_mode: ApprovalMode,
});
export type Meta = z.infer<typeof Meta>;

// ---------- errors ----------

/** `{error:{code,message}}`. The real backend sends codes like HTTP_ERROR, NOT_FOUND and VALIDATION_ERROR. */
export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ErrorBody = z.infer<typeof ErrorBody>;

// ---------- request bodies ----------

export const SpeedBody = z.object({ speed: Speed });
export const SeekBody = z.object({ time: IsoTime });

// ---------- WebSocket (§9) ----------

export const ClockReason = z.enum(["PAUSED", "RESUMED", "SPEED", "SETTINGS", "AUTO_PAUSE_PROPOSAL"]);
export type ClockReason = z.infer<typeof ClockReason>;

/** Envelope fields shared by every message. `data` is validated per type below. */
export const Envelope = z.object({
  type: z.string(),
  seq: z.number().int(),
  epoch: z.number().int(),
  simulation_time: IsoTime,
  data: z.unknown(),
});
export type Envelope = z.infer<typeof Envelope>;

const env = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({ type: z.literal(type), seq: z.number().int(), epoch: z.number().int(), simulation_time: IsoTime, data });

export const WsMessage = z.discriminatedUnion("type", [
  env("clock.updated", Clock.extend({ reason: ClockReason.nullable().optional() })),
  env("dispatch_event.updated", DispatchEvent),
  env("proposal.created", AdditionalTrip),
  env("proposal.updated", AdditionalTrip),
  env("trip.updated", AdditionalTrip),
  env("bus.updated", Bus),
  env("system.reset", z.object({ epoch: z.number().int(), reason: z.string() })),
  env("system.error", z.object({ message: z.string() })),
]);
export type WsMessage = z.infer<typeof WsMessage>;
export type WsMessageType = WsMessage["type"];
export type WsMessageOf<T extends WsMessageType> = Extract<WsMessage, { type: T }>;

/** Message types we know. Anything else is ignored, not a contract error. */
export const KNOWN_WS_TYPES: ReadonlySet<string> = new Set<WsMessageType>([
  "clock.updated",
  "dispatch_event.updated",
  "proposal.created",
  "proposal.updated",
  "trip.updated",
  "bus.updated",
  "system.reset",
  "system.error",
]);
