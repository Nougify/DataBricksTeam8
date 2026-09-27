// Runtime schemas for the backend API. Operational state and WebSocket models mirror backend/app.
// Retired dashboard schemas remain for read-only screens and the legacy mock simulator.
import { z } from "zod";

// ---------- primitives ----------

/** ISO 8601 with an explicit America/Vancouver offset, e.g. 2025-12-06T10:00:00-08:00. */
export const IsoTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, "ISO time with offset");
/** YYYY-MM-DD local date. */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const Hour = z.number().int().min(0).max(23);
export const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();
export type LatLon = z.infer<typeof LatLon>;

export const HubId = z.string(); // "ubc" | "waterfront" | "park-royal" (kept open so new hubs don't break parsing)
export type HubId = z.infer<typeof HubId>;
export const DayType = z.enum(["mf", "sat", "sun_hol"]);
export type DayType = z.infer<typeof DayType>;

export const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export const LineString = z.object({ type: z.literal("LineString"), coordinates: z.array(Position) }).strict();
export type LineString = z.infer<typeof LineString>;
export const MultiLineString = z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(Position)) });
export const RouteShape = z.union([LineString, MultiLineString]);
export type RouteShape = z.infer<typeof RouteShape>;

// ---------- shared objects (§0.1) ----------

export const Mode = z.enum(["Bus", "SkyTrain", "SeaBus", "West Coast Express"]);
export const RouteRef = z.object({
  route_id: z.string(),
  line_key: z.string(),
  short_name: z.string(),
  long_name: z.string().nullable(),
  mode: Mode,
  color: z.string().nullable(),
  text_color: z.string().nullable(),
}).strict();
export type RouteRef = z.infer<typeof RouteRef>;

export const ClockStatus = z.enum(["RUNNING", "PAUSED"]);
export const Clock = z.object({
  current_time: IsoTime,
  local_date: LocalDate,
  hour: Hour,
  speed: z.union([z.literal(1), z.literal(60), z.literal(300), z.literal(900), z.literal(3600)]),
  status: ClockStatus,
  min_time: IsoTime,
  max_time: IsoTime,
  approval_mode: z.enum(["MANUAL", "AUTOMATIC"]),
  auto_pause_on_proposal: z.boolean(),
  epoch: z.number().int().min(0),
}).strict();
export type Clock = z.infer<typeof Clock>;

export const Severity = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type Severity = z.infer<typeof Severity>;

export const HubStatus = z.object({
  hub_id: HubId,
  as_of: IsoTime,
  current_hour: z.object({
    local_date: LocalDate,
    hour: Hour,
    pings_so_far: z.number(),
    typical_pings_so_far: z.number(),
    complete: z.boolean(),
  }),
  last_full_hour: z.object({
    local_date: LocalDate,
    hour: Hour,
    pings: z.number(),
    typical_pings: z.number(),
    surge_index: z.number(),
    is_surge: z.boolean(),
  }),
  next_surge: z
    .object({
      surge_id: z.string(),
      window_start: IsoTime,
      surge_index: z.number(),
      severity: Severity,
    })
    .nullable(),
  active_trip_count: z.number().int(),
  pending_proposal_count: z.number().int(),
});
export type HubStatus = z.infer<typeof HubStatus>;

export const DriverType = z.enum(["EXAM", "HOLIDAY", "SPORTS", "CONCERT", "FESTIVAL", "NIGHTLIFE", "WEATHER", "OTHER"]);
export type DriverType = z.infer<typeof DriverType>;

export const PredictedDestination = z.object({
  origin: z.string(),
  location: LatLon.nullable(),
  share_pct: z.number(),
  expected_pings: z.number(),
});
export type PredictedDestination = z.infer<typeof PredictedDestination>;

export const SurgeStatus = z.enum(["PENDING", "AWAITING_APPROVAL", "DISPATCHED", "NO_MATCHING_ROUTE", "NO_BUS_AVAILABLE", "EXPIRED"]);
export type SurgeStatus = z.infer<typeof SurgeStatus>;
export const SurgePhase = z.enum(["UPCOMING", "ACTIVE", "RESOLVED"]);
export type SurgePhase = z.infer<typeof SurgePhase>;

export const Surge = z.object({
  id: z.string(),
  hub_id: HubId.nullable(),
  location_name: z.string(),
  location: LatLon,
  detected_at: IsoTime,
  predicted_window: z.object({ start: IsoTime, end: IsoTime }),
  lead_time_minutes: z.number(),
  magnitude: z.object({
    predicted_pings: z.number(),
    typical_pings: z.number(),
    surge_index: z.number(),
    lower_80: z.number(),
    upper_80: z.number(),
  }),
  severity: Severity,
  drivers: z.array(z.object({ type: DriverType, label: z.string(), event_id: z.string().nullable() })),
  predicted_destinations: z.array(PredictedDestination),
  status: SurgeStatus,
  phase: SurgePhase,
  additional_trip_ids: z.array(z.string()),
  actual: z.object({ pings: z.number(), surge_index: z.number() }).nullable(),
});
export type Surge = z.infer<typeof Surge>;

export const BusStatus = z.enum(["AVAILABLE", "RESERVED", "DEADHEADING", "WAITING", "IN_SERVICE", "RETURNING", "REPOSITIONING"]);
export type BusStatus = z.infer<typeof BusStatus>;

export const Bus = z.object({
  id: z.string().trim().min(1),
  status: BusStatus,
  location: LatLon,
  heading_deg: z.number().min(0).lt(360).nullable(),
  capacity: z.number().int().positive(),
  source: z.object({
    type: z.enum(["ROUTE", "DEPOT"]),
    route: RouteRef.nullable(),
    depot_name: z.string().nullable(),
  }).strict(),
  assigned_trip_id: z.string().nullable(),
  proposed_trip_id: z.string().nullable(),
}).strict().superRefine((bus, ctx) => {
  const routeSource = bus.source.type === "ROUTE" && bus.source.route !== null && bus.source.depot_name === null;
  const depotSource = bus.source.type === "DEPOT" && bus.source.route === null && bus.source.depot_name !== null;
  if (!routeSource && !depotSource) ctx.addIssue({ code: "custom", message: "bus source discriminator is inconsistent" });
  const links = Number(bus.assigned_trip_id !== null) + Number(bus.proposed_trip_id !== null);
  if (links > 1 || (bus.status === "AVAILABLE" && links > 0) || (bus.status === "RESERVED" && links !== 1)) {
    ctx.addIssue({ code: "custom", message: "bus trip links conflict with status" });
  }
});
export type Bus = z.infer<typeof Bus>;

// ---------- operational dispatch contract (v3) ----------

const NonEmpty = z.string().trim().min(1);
const NonNegative = z.number().min(0);
const NonNegativeInt = z.number().int().min(0);
const PositiveInt = z.number().int().positive();

export const EventMode = z.enum(["REACTIVE", "PROACTIVE"]);
export type EventMode = z.infer<typeof EventMode>;
export const EventStatus = z.enum([
  "PENDING", "NO_ACTION_REQUIRED", "AWAITING_APPROVAL", "DISPATCHED", "COMPLETED",
  "NO_MATCHING_ROUTE", "NO_BUS_AVAILABLE", "EXPIRED", "REJECTED", "INVALID_SOURCE",
]);
export type EventStatus = z.infer<typeof EventStatus>;
export const RecommendationMappingStatus = z.enum(["UNRESOLVED", "RESOLVED", "INVALID"]);
export const RecommendationFailureCode = z.enum([
  "UNKNOWN_HUB", "UNKNOWN_ROUTE", "AMBIGUOUS_ROUTE", "ROUTE_NOT_SERVING_HUB",
  "UNKNOWN_DESTINATION", "DESTINATION_NOT_ON_ROUTE", "UNKNOWN_DIRECTION",
  "INCOMPATIBLE_DIRECTION", "NO_DISPATCH_ELIGIBLE_PATTERN", "NO_SERVICE_ON_DATE",
]);

export const RecommendationCandidate = z.object({
  route_id: NonEmpty,
  pattern_id: NonEmpty,
  source_stop_id: NonEmpty,
  destination_stop_id: NonEmpty,
  source_stop_sequence: NonNegativeInt,
  destination_stop_sequence: NonNegativeInt,
  direction_id: z.number().int().nullable(),
  requested_service_date: LocalDate,
  feed_service_date: LocalDate,
  representative_service: z.boolean(),
  scheduled_trip_ids: z.array(NonEmpty).min(1),
}).strict().refine((candidate) => candidate.destination_stop_sequence > candidate.source_stop_sequence, {
  message: "candidate destination must follow source",
});
export type RecommendationCandidate = z.infer<typeof RecommendationCandidate>;

export const EventRecommendation = z.object({
  destination: NonEmpty,
  destination_share: z.number().min(0).max(100),
  route_id: NonEmpty.nullable(),
  source_route: NonEmpty,
  extra_bus_trips_est: NonNegative,
  priority_score: NonNegative,
  scheduled_trips_that_hour: NonNegativeInt.nullable().default(null),
  extra_people_on_route: NonNegative.nullable().default(null),
  avg_daily_boardings: NonNegative.nullable().default(null),
  pct_trips_overcrowded: NonNegative.nullable().default(null),
  mapping_status: RecommendationMappingStatus.default("UNRESOLVED"),
  failure_code: RecommendationFailureCode.nullable().default(null),
  failure_reason: NonEmpty.nullable().default(null),
  candidates: z.array(RecommendationCandidate).default([]),
}).strict().superRefine((recommendation, ctx) => {
  const hasFailure = recommendation.failure_code !== null && recommendation.failure_reason !== null;
  const hasAnyFailure = recommendation.failure_code !== null || recommendation.failure_reason !== null;
  if (recommendation.mapping_status === "UNRESOLVED" && (hasAnyFailure || recommendation.candidates.length > 0)) {
    ctx.addIssue({ code: "custom", message: "unresolved recommendation has mapping output" });
  }
  if (recommendation.mapping_status === "RESOLVED" &&
      (recommendation.route_id === null || recommendation.candidates.length === 0 || hasAnyFailure)) {
    ctx.addIssue({ code: "custom", message: "resolved recommendation requires route and candidates without a failure" });
  }
  if (recommendation.mapping_status === "INVALID" && (!hasFailure || recommendation.candidates.length > 0)) {
    ctx.addIssue({ code: "custom", message: "invalid recommendation requires one typed failure" });
  }
});
export type EventRecommendation = z.infer<typeof EventRecommendation>;

export const EventSourceMetadata = z.object({
  split: NonEmpty.nullable().default(null),
  direction: NonEmpty.nullable().default(null),
  link: NonEmpty.nullable().default(null),
  version: NonEmpty.nullable().default(null),
  generated_at: IsoTime.nullable().default(null),
}).strict();
export type EventSourceMetadata = z.infer<typeof EventSourceMetadata>;

export const DispatchEvent = z.object({
  id: NonEmpty,
  hub_id: NonEmpty.nullable(),
  source_location: NonEmpty,
  location: LatLon.nullable().default(null),
  available_at: IsoTime.nullable(),
  actionable_at: IsoTime,
  event_time: IsoTime,
  mode: EventMode,
  surge_type: NonEmpty.nullable(),
  predicted_people: NonNegative,
  normal_people: NonNegative,
  surge_ratio: NonNegative.nullable(),
  suggested_extra_buses: NonNegativeInt,
  priority_score: NonNegative,
  recommendations: z.array(EventRecommendation).min(1),
  status: EventStatus.default("PENDING"),
  additional_trip_ids: z.array(NonEmpty).default([]),
  source: EventSourceMetadata,
}).strict().superRefine((event, ctx) => {
  const expectedActionable = event.available_at ?? event.event_time;
  const expectedMode = event.available_at !== null && Date.parse(event.available_at) < Date.parse(event.event_time)
    ? "PROACTIVE"
    : "REACTIVE";
  if (event.actionable_at !== expectedActionable || event.mode !== expectedMode) {
    ctx.addIssue({ code: "custom", message: "event availability fields are inconsistent" });
  }
  if (new Set(event.additional_trip_ids).size !== event.additional_trip_ids.length) {
    ctx.addIssue({ code: "custom", message: "trip links must be unique" });
  }
  const ordered = [...event.recommendations].sort((a, b) =>
    b.priority_score - a.priority_score || a.source_route.localeCompare(b.source_route) || a.destination.localeCompare(b.destination));
  if (ordered.some((recommendation, index) => recommendation !== event.recommendations[index])) {
    ctx.addIssue({ code: "custom", message: "recommendations must be ordered by priority" });
  }
});
export type DispatchEvent = z.infer<typeof DispatchEvent>;

export const RoutingProvenance = z.object({
  provider: NonEmpty,
  is_approximation: z.boolean(),
  method: NonEmpty,
  speed_kph: z.number().positive().nullable(),
}).strict();
export type RoutingProvenance = z.infer<typeof RoutingProvenance>;
export const MovementLegKind = z.enum(["DEADHEAD", "SERVICE", "RETURN"]);
export const MovementLeg = z.object({
  kind: MovementLegKind,
  path: LineString.refine((path) => path.coordinates.length >= 2, "movement path requires at least two positions"),
  distance_m: NonNegative,
  duration_seconds: NonNegativeInt,
  provenance: RoutingProvenance,
}).strict();
export type MovementLeg = z.infer<typeof MovementLeg>;
export const MovementPlan = z.object({
  route_id: NonEmpty,
  pattern_id: NonEmpty,
  source_stop_id: NonEmpty,
  destination_stop_id: NonEmpty,
  reference_scheduled_trip_id: NonEmpty,
  mode: EventMode,
  deadhead: MovementLeg,
  service: MovementLeg,
  return_leg: MovementLeg,
  dispatch_time: IsoTime,
  estimated_arrival_time: IsoTime,
  service_departure_time: IsoTime,
  estimated_completion_time: IsoTime,
  estimated_return_time: IsoTime,
  waiting_seconds: NonNegativeInt,
  arrival_lateness_seconds: NonNegativeInt,
  total_distance_m: NonNegative,
}).strict().superRefine((plan, ctx) => {
  if (plan.deadhead.kind !== "DEADHEAD" || plan.service.kind !== "SERVICE" || plan.return_leg.kind !== "RETURN") {
    ctx.addIssue({ code: "custom", message: "movement plan legs are out of order" });
  }
  const times = [plan.dispatch_time, plan.estimated_arrival_time, plan.service_departure_time,
    plan.estimated_completion_time, plan.estimated_return_time].map(Date.parse);
  if (times.some((time, index) => index > 0 && time < times[index - 1])) {
    ctx.addIssue({ code: "custom", message: "movement plan timestamps must be chronological" });
  }
  const distance = plan.deadhead.distance_m + plan.service.distance_m + plan.return_leg.distance_m;
  if (Math.abs(plan.total_distance_m - distance) > 1e-6) {
    ctx.addIssue({ code: "custom", message: "movement plan total distance is inconsistent" });
  }
});
export type MovementPlan = z.infer<typeof MovementPlan>;

export const TripStatus = z.enum(["PROPOSED", "APPROVED", "BUS_EN_ROUTE", "IN_SERVICE", "COMPLETED", "REJECTED", "EXPIRED", "CANCELLED"]);
export type TripStatus = z.infer<typeof TripStatus>;
export const AdditionalTripStatus = TripStatus;
export type AdditionalTripStatus = TripStatus;

export const RouteWithLoad = RouteRef.extend({ load_before_pct: z.number(), load_after_pct: z.number() });
export type RouteWithLoad = z.infer<typeof RouteWithLoad>;

export const Evidence = z.object({ label: z.string(), value: z.string(), source: z.string() });
export type Evidence = z.infer<typeof Evidence>;

export const LegacyAdditionalTrip = z.object({
  id: z.string(),
  surge_id: z.string(),
  hub_id: HubId.nullable(),
  bus: z.object({ id: z.string() }),
  route: RouteWithLoad,
  donor_route: RouteWithLoad.nullable(),
  status: TripStatus,
  proposed_at: IsoTime,
  approval_expires_at: IsoTime,
  dispatch_time: IsoTime,
  arrival_at_surge_time: IsoTime,
  arrives_before_surge: z.boolean(),
  departure_time: IsoTime,
  estimated_completion_time: IsoTime,
  surge_location: LatLon,
  predicted_destinations: z.array(PredictedDestination),
  deadhead_path: LineString,
  service_path: LineString,
  impact: z.object({ added_capacity: z.number(), deadhead_minutes: z.number(), deadhead_km: z.number() }),
  rationale: z.string(),
  evidence: z.array(Evidence),
  replaces_trip_id: z.string().nullable(),
  progress: z.object({ percent_complete: z.number() }),
});
export type LegacyAdditionalTrip = z.infer<typeof LegacyAdditionalTrip>;

/** GET /additional-trips/{id}: every AdditionalTrip field plus detail-only fields (§5). */
export const LegacyAdditionalTripDetail = LegacyAdditionalTrip.extend({
  bus: z.object({ id: z.string(), current_location: LatLon }),
  surge: Surge,
  progress: z.object({
    percent_complete: z.number(),
    current_stop_id: z.string().nullable(),
    next_stop_id: z.string().nullable(),
  }),
});
export type LegacyAdditionalTripDetail = z.infer<typeof LegacyAdditionalTripDetail>;

export const AdditionalTrip = z.object({
  id: NonEmpty,
  dispatch_event_id: NonEmpty,
  bus_id: NonEmpty,
  route_id: NonEmpty,
  status: TripStatus,
  proposed_at: IsoTime,
  approval_expires_at: IsoTime,
  dispatch_time: IsoTime.nullable().default(null),
  target_event_time: IsoTime,
  estimated_arrival_time: IsoTime.nullable().default(null),
  service_departure_time: IsoTime.nullable().default(null),
  estimated_completion_time: IsoTime.nullable().default(null),
  added_capacity: PositiveInt,
  rationale: NonEmpty,
  source_priority: NonNegative,
  source_route: NonEmpty.nullable().default(null),
  destination: NonEmpty.nullable().default(null),
  selected_candidate: RecommendationCandidate.nullable().default(null),
  movement_plan: MovementPlan.nullable().default(null),
}).strict().superRefine((trip, ctx) => {
  if (Date.parse(trip.approval_expires_at) <= Date.parse(trip.proposed_at)) {
    ctx.addIssue({ code: "custom", message: "approval expiry must follow proposal" });
  }
  const times = [trip.dispatch_time, trip.estimated_arrival_time, trip.service_departure_time,
    trip.estimated_completion_time].filter((time): time is string => time !== null).map(Date.parse);
  if (times.some((time, index) => index > 0 && time < times[index - 1])) {
    ctx.addIssue({ code: "custom", message: "trip lifecycle times must be chronological" });
  }
});
export type AdditionalTrip = z.infer<typeof AdditionalTrip>;
export const AdditionalTripDetail = AdditionalTrip;
export type AdditionalTripDetail = AdditionalTrip;

// ---------- errors ----------

export const ErrorCode = z.string(); // TRIP_EXPIRED | TRIP_REJECTED | TRIP_NOT_PROPOSED | STALE_EPOCH | OUT_OF_RANGE | INVALID_SPEED | ...
export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
  trip: AdditionalTrip.optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

// ---------- responses ----------

export const LegacyStateResponse = z.object({
  epoch: z.number().int(),
  last_seq: z.number().int(),
  simulation: Clock,
  hubs: z.array(HubStatus),
  surges: z.array(Surge),
  buses: z.array(Bus),
  additional_trips: z.array(LegacyAdditionalTrip),
});
export type LegacyStateResponse = z.infer<typeof LegacyStateResponse>;

export const StateResponse = z.object({
  epoch: NonNegativeInt,
  last_seq: NonNegativeInt,
  simulation: Clock,
  dispatch_events: z.array(DispatchEvent),
  buses: z.array(Bus),
  additional_trips: z.array(AdditionalTrip),
}).strict();
export type StateResponse = z.infer<typeof StateResponse>;

export const SurgeList = z.array(Surge);
export const BusList = z.array(Bus);
export const TripList = z.array(AdditionalTrip);
export const DispatchEventList = z.array(DispatchEvent);

export const RouteListItem = RouteRef.extend({
  serves_hub_ids: z.array(HubId),
  shape: RouteShape.nullable(),
});
export type RouteListItem = z.infer<typeof RouteListItem>;
export const RouteList = z.array(RouteListItem);

export const RouteDetail = RouteRef.extend({
  stops: z.array(z.object({ id: z.string(), name: z.string(), location: LatLon })),
  shape: RouteShape.nullable(),
  scheduled_departures: z.array(z.object({ trip_id: z.string(), departure_time: IsoTime, stop_id: z.string().nullable() })),
});
export type RouteDetail = z.infer<typeof RouteDetail>;

export const Preset = z.object({
  id: z.string(),
  label: z.string(),
  hub_id: HubId.nullable(),
  time: IsoTime,
  description: z.string(),
});
export type Preset = z.infer<typeof Preset>;

export const Source = z.object({ name: z.string(), url: z.string().nullable().optional(), used_for: z.string() });
export type Source = z.infer<typeof Source>;

const LegacyMeta = z.object({
  timezone: z.string(),
  data_start: LocalDate,
  data_end: LocalDate,
  default_start_time: IsoTime,
  allowed_speeds: z.array(z.number()),
  forecast_horizons_hours: z.array(z.number()),
  surge_threshold: z.number(),
  severity_bands: z.object({ LOW: z.number(), MEDIUM: z.number(), HIGH: z.number() }),
  late_night: z.object({ start_hour: Hour, end_hour_exclusive: z.number().int() }),
  route_load_thresholds: z.object({ overcrowded_pct: z.number(), spare_pct: z.number() }),
  day_types: z.array(z.object({ id: DayType, label: z.string() })),
  presets: z.array(Preset),
  sources: z.array(Source),
  pipeline_refreshed_at: IsoTime.nullable(),
});

const BackendMeta = z
  .object({
    data_mode: z.enum(["fixture", "exported_events", "databricks"]),
    source_identity: z.string().nullable(),
    source_version: z.string().nullable(),
    integration_status: z.string(),
    integration_error: z.string().nullable(),
    event_window: z.object({
      window_start: IsoTime,
      window_end: IsoTime,
      loaded_at: IsoTime,
      provenance: z.string(),
    }),
    simulation_bounds: z.object({ min_time: IsoTime, max_time: IsoTime }),
    supported_speeds: z.array(z.number()),
    gtfs_version: z.string(),
    fleet: z.object({
      size: z.number().int(),
      total_capacity: z.number().int(),
      source: z.string(),
      max_buses_per_event: z.number().int(),
    }),
    approval_mode: z.enum(["MANUAL", "AUTOMATIC"]),
  })
  .transform((meta) => ({
    timezone: "America/Vancouver",
    data_start: meta.event_window.window_start.slice(0, 10),
    data_end: meta.event_window.window_end.slice(0, 10),
    default_start_time: meta.simulation_bounds.min_time,
    allowed_speeds: meta.supported_speeds,
    forecast_horizons_hours: [],
    surge_threshold: 1.25,
    severity_bands: { LOW: 1.25, MEDIUM: 1.5, HIGH: 1.75 },
    late_night: { start_hour: 22, end_hour_exclusive: 5 },
    route_load_thresholds: { overcrowded_pct: 85, spare_pct: 50 },
    day_types: [
      { id: "mf" as const, label: "Weekday" },
      { id: "sat" as const, label: "Saturday" },
      { id: "sun_hol" as const, label: "Sunday / holiday" },
    ],
    presets: [],
    sources: [{ name: meta.source_identity ?? meta.data_mode, used_for: meta.event_window.provenance }],
    pipeline_refreshed_at: meta.event_window.loaded_at,
  }));

export const Meta = z.union([LegacyMeta, BackendMeta]);
export type Meta = z.infer<typeof Meta>;

export const Hub = z.object({
  id: HubId,
  name: z.string(),
  location_name: z.string(),
  location: LatLon,
  catchment_m: z.number(),
  description: z.string(),
  lines_serving: z.number(),
});
export type Hub = z.infer<typeof Hub>;
export const HubList = z.array(Hub);

export const ForecastRowKind = z.enum(["HISTORY", "CURRENT", "FORECAST"]);
export const ForecastRow = z.object({
  time: IsoTime,
  local_date: LocalDate,
  hour: Hour,
  kind: ForecastRowKind,
  actual_pings: z.number().nullable(),
  hour_complete: z.boolean().optional(),
  forecast_pings: z.number().nullable(),
  forecast_issued_at: IsoTime.nullable(),
  lower_80: z.number().nullable(),
  upper_80: z.number().nullable(),
  typical_pings: z.number(),
  surge_index: z.number().nullable(),
  is_surge: z.boolean(),
});
export type ForecastRow = z.infer<typeof ForecastRow>;
export const Forecast = z.object({
  hub_id: HubId,
  issued_at: IsoTime,
  horizon_hours: z.number(),
  surge_threshold: z.number(),
  typical_basis: z.string(),
  model: z.object({ name: z.string(), trained_through: IsoTime, granularity: z.string() }),
  rows: z.array(ForecastRow),
});
export type Forecast = z.infer<typeof Forecast>;

export const AccessType = z.enum(["ONE_SEAT_RIDE", "TRANSFER_REQUIRED", "LOCAL", "VISITOR"]);
export type AccessType = z.infer<typeof AccessType>;
export const OriginRow = z.object({
  origin: z.string(),
  region: z.string(),
  location: LatLon.nullable(),
  pings: z.number(),
  share_pct: z.number(),
  share_of_local_pct: z.number().nullable(),
  avg_dwell_min: z.number().nullable(),
  access_type: AccessType,
  direct_lines: z.array(z.string()),
  n_direct_lines: z.number().int(),
});
export type OriginRow = z.infer<typeof OriginRow>;
export const OriginsBasis = z.enum(["actual", "typical"]);
export type OriginsBasis = z.infer<typeof OriginsBasis>;
export const Origins = z.object({
  hub_id: HubId,
  basis: OriginsBasis,
  window: z.object({ start: IsoTime, end: IsoTime }),
  day_type: DayType,
  total_pings: z.number(),
  low_sample: z.boolean(),
  origins: z.array(OriginRow),
});
export type Origins = z.infer<typeof Origins>;

export const TimelineHubDay = z.object({ pings: z.number(), daily_surge_index: z.number().nullable(), is_surge: z.boolean() });
export const TimelineDay = z.object({
  local_date: LocalDate,
  weekday: z.string(),
  day_type: DayType,
  hubs: z.record(HubId, TimelineHubDay),
});
export type TimelineDay = z.infer<typeof TimelineDay>;
export const Timeline = z.object({ note: z.string(), days: z.array(TimelineDay) });
export type Timeline = z.infer<typeof Timeline>;

export const Event = z.object({
  id: z.string(),
  label: z.string(),
  category: DriverType,
  start: IsoTime,
  end: IsoTime,
  hub_ids: z.array(HubId),
  source_name: z.string(),
  source_url: z.string().nullable(),
});
export type Event = z.infer<typeof Event>;
export const EventList = z.array(Event);

export const LoadBasis = z.enum(["TSPR_2025_TYPICAL", "MODEL_ESTIMATE"]);
export const LoadClass = z.enum(["OVERCROWDED", "SPARE", "NORMAL"]);
export type LoadClass = z.infer<typeof LoadClass>;
export const RouteLoad = z.object({
  route: RouteRef,
  time_period: z.string(),
  load_pct: z.number(),
  load_basis: LoadBasis,
  tspr_peak_load_pct: z.number().nullable(),
  pct_trips_overcrowded_2025: z.number().nullable(),
  classification: LoadClass,
  spare_buses_available: z.number().int(),
});
export type RouteLoad = z.infer<typeof RouteLoad>;
export const RouteLoadList = z.array(RouteLoad);

export const LateNightHour = z.object({
  local_date: LocalDate,
  hour: Hour,
  actual_pings: z.number().nullable(),
  forecast_pings: z.number().nullable(),
  typical_pings: z.number(),
  share_of_daily_pct: z.number().nullable(),
  departures_typical: z.number(),
  lines_running: z.number().int(),
  lines: z.array(RouteRef),
});
export type LateNightHour = z.infer<typeof LateNightHour>;
export const LateNight = z.object({
  hub_id: HubId,
  night_date: LocalDate,
  window: z.object({ start: IsoTime, end: IsoTime }),
  hours: z.array(LateNightHour),
  share_of_daily_pct: z.number().nullable(),
  departures_basis: z.string(),
  top_nights: z.array(
    z.object({ night_date: LocalDate, pings_00_05: z.number(), departures_typical: z.number(), surge_index: z.number().nullable() }),
  ),
});
export type LateNight = z.infer<typeof LateNight>;

export const GapStatus = z.enum(["UNDERSERVED", "OVERSERVED", "BALANCED", "NO_SERVICE"]);
export type GapStatus = z.infer<typeof GapStatus>;
export const HourlyProfileRow = z.object({
  hour: Hour,
  avg_pings: z.number(),
  departures: z.number(),
  bus_departures: z.number(),
  skytrain_departures: z.number(),
  seabus_departures: z.number(),
  lines_running: z.number(),
  status: GapStatus,
  time_period: z.string().nullable(),
  peak_load_pct: z.number(),
  most_crowded_line: z.string().nullable(),
});
export type HourlyProfileRow = z.infer<typeof HourlyProfileRow>;
export const HourlyProfile = z.object({
  hub_id: HubId,
  day_type: DayType,
  season_label: z.string(),
  rows: z.array(HourlyProfileRow),
});
export type HourlyProfile = z.infer<typeof HourlyProfile>;

export const Kpi = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  period: z.string(),
  comparison: z.object({ label: z.string(), value: z.string() }).nullable(),
  source: z.string(),
});
export type Kpi = z.infer<typeof Kpi>;
export const Overview = z.object({ hub_id: HubId, kpis: z.array(Kpi) });
export type Overview = z.infer<typeof Overview>;

export const RouteCrowdingRow = z.object({
  route: RouteRef,
  pct_trips_overcrowded: z.number().nullable(),
  avg_peak_load_factor: z.number().nullable(),
  pct_bunching: z.number().nullable(),
  pct_on_time: z.number().nullable(),
  avg_weekday_boardings: z.number().nullable(),
  weekly_trips_at_hub: z.number().nullable(),
  source: z.string(),
});
export type RouteCrowdingRow = z.infer<typeof RouteCrowdingRow>;
export const RouteCrowding = z.array(RouteCrowdingRow);

export const RecommendationLink = z.object({
  label: z.string(),
  hub_id: HubId,
  local_date: LocalDate,
  hour: Hour,
  route_id: z.string().nullable(),
});
export type RecommendationLink = z.infer<typeof RecommendationLink>;
export const Recommendation = z.object({
  id: z.string(),
  priority: z.number().int(),
  category: z.string(),
  recommendation: z.string(),
  evidence: z.string(),
  links: z.array(RecommendationLink),
});
export type Recommendation = z.infer<typeof Recommendation>;
export const RecommendationList = z.array(Recommendation);

export const Verdict = z.enum(["RESCHEDULE", "INVEST"]);
export const FindingsHub = z.object({
  hub_id: HubId,
  mismatch_pct: z.number(),
  pings_in_underserved_hours_pct: z.number(),
  underserved_hours: z.number().int(),
  busiest_line_load_pct: z.number(),
  rebalance: z.object({ moved: z.number(), total: z.number(), mismatch_after_pct: z.number() }),
  add_service: z.object({ added: z.number(), window: z.string().nullable(), mismatch_after_pct: z.number() }),
  verdict: Verdict,
});
export type FindingsHub = z.infer<typeof FindingsHub>;
export const Findings = z.object({
  day_type: DayType,
  hubs: z.array(FindingsHub),
  facts: z.array(z.object({ label: z.string(), value: z.string(), source: z.string() })),
});
export type Findings = z.infer<typeof Findings>;

export const Backtest = z.object({
  period: z.object({ start: LocalDate, end: LocalDate }),
  surge_threshold: z.number(),
  method: z.string(),
  by_hub: z.array(
    z.object({
      hub_id: HubId,
      actual_surge_hours: z.number(),
      predicted_surge_hours: z.number(),
      precision_pct: z.number(),
      recall_pct: z.number(),
      median_lead_time_minutes: z.number(),
    }),
  ),
  by_horizon: z.array(z.object({ horizon_hours: z.number(), mape_pct: z.number(), coverage_80_pct: z.number() })),
});
export type Backtest = z.infer<typeof Backtest>;

export const Validation = z.object({
  hub_id: HubId,
  r: z.number(),
  r_shifted_3h: z.number(),
  rows: z.array(z.object({ hour: Hour, pings_pct: z.number(), skytrain_pct: z.number() })),
  source: z.string(),
});
export type Validation = z.infer<typeof Validation>;

// ---------- request bodies ----------

export const SeekBody = z.object({ current_time: IsoTime });
export const SpeedBody = z.object({ speed: z.number() });
export const SettingsBody = z.object({ auto_pause_on_proposal: z.boolean() });
export const ApproveBody = z.object({ epoch: z.number().int() });
export const RejectBody = z.object({ epoch: z.number().int(), reason: z.string().optional() });

// ---------- WebSocket (§12) ----------

export const StateChangedReason = z.enum(["PAUSED", "RESUMED", "SPEED", "SETTINGS", "AUTO_PAUSE_PROPOSAL"]);
export type StateChangedReason = z.infer<typeof StateChangedReason>;

export const BusPosition = z.object({ bus_id: z.string(), location: LatLon, heading_deg: z.number(), status: BusStatus });
export type BusPosition = z.infer<typeof BusPosition>;

/** Envelope fields shared by every message. `data` is validated per type below. */
export const Envelope = z.object({
  type: z.string(),
  seq: z.number().int().positive(),
  epoch: NonNegativeInt,
  simulation_time: IsoTime,
  data: z.unknown(),
}).strict();
export type Envelope = z.infer<typeof Envelope>;

const env = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({ type: z.literal(type), seq: z.number().int().positive(), epoch: NonNegativeInt, simulation_time: IsoTime, data }).strict();

export const WsMessage = z.discriminatedUnion("type", [
  env("clock.updated", Clock.extend({ reason: StateChangedReason.nullable() })),
  env("dispatch_event.updated", DispatchEvent),
  env("proposal.created", AdditionalTrip),
  env("proposal.updated", AdditionalTrip),
  env("trip.updated", AdditionalTrip),
  env("bus.updated", Bus),
  env("system.reset", z.object({ epoch: NonNegativeInt, reason: z.literal("SEEK") }).strict()),
  env("system.error", z.object({ message: NonEmpty }).strict()),
]);
export type WsMessage = z.infer<typeof WsMessage>;
export type WsMessageType = WsMessage["type"];
export type WsMessageOf<T extends WsMessageType> = Extract<WsMessage, { type: T }>;

/** Message types we know. Anything else (e.g. retired `surge.detected`) is ignored, not a contract error. */
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

// Explicit schemas used only by the retired in-browser v2 simulator.
export const LegacyWsMessage = z.discriminatedUnion("type", [
  env("simulation.tick", z.object({ current_time: IsoTime, local_date: LocalDate, hour: Hour })),
  env("simulation.state_changed", Clock.extend({ reason: StateChangedReason })),
  env("state.reset", z.object({ epoch: z.number().int(), reason: z.string() })),
  env("surge.updated", Surge),
  env("dispatch.proposed", LegacyAdditionalTrip),
  env("dispatch.approved", LegacyAdditionalTrip),
  env("dispatch.rejected", LegacyAdditionalTrip),
  env("trip.updated", LegacyAdditionalTrip),
  env("bus.updated", Bus),
  env("bus.positions_updated", z.object({ positions: z.array(BusPosition) })),
  env("hub.demand_updated", HubStatus),
]);
export type LegacyWsMessage = z.infer<typeof LegacyWsMessage>;
export type LegacyWsMessageType = LegacyWsMessage["type"];
export type LegacyWsMessageOf<T extends LegacyWsMessageType> = Extract<LegacyWsMessage, { type: T }>;
