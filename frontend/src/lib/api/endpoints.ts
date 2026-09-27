// One typed function per endpoint in ../../message.txt. Paths are relative to ENV.apiBaseUrl (/api/v1).
import { apiGet, apiSend, type QueryParams, type RequestOptions } from "./client";
import {
  AdditionalTrip,
  Backtest,
  Bus,
  BusList,
  Clock,
  EventList,
  Findings,
  Forecast,
  HubList,
  HubStatus,
  HourlyProfile,
  LateNight,
  Meta,
  Origins,
  Overview,
  RecommendationList,
  RouteCrowding,
  RouteDetail,
  RouteList,
  RouteLoadList,
  DispatchEvent,
  DispatchEventList,
  StateResponse,
  SurgeList,
  Timeline,
  TripList,
  Validation,
  type DayType,
  type EventStatus,
  type OriginsBasis,
  type SurgePhase,
  type SurgeStatus,
} from "./schemas";

const seg = (id: string) => encodeURIComponent(id);

// ---------- simulation state and clock ----------

/** GET /state: the full snapshot, fetched at startup, after `system.reset` and after every reconnect. */
export const getState = (opts?: RequestOptions) => apiGet("/state", StateResponse, undefined, opts);

/** GET /simulation */
export const getSimulation = (opts?: RequestOptions) => apiGet("/simulation", Clock, undefined, opts);

/** POST /clock/seek: seek. Returns the Clock with the new epoch; `system.reset` follows on the WebSocket. */
export const seekSimulation = (currentTime: string) =>
  apiSend("POST", "/clock/seek", { time: currentTime }, Clock);

/** POST /clock/speed */
export const setSimulationSpeed = (speed: number) => apiSend("POST", "/clock/speed", { speed }, Clock);

/** PUT /simulation/settings */
export const updateSimulationSettings = (settings: { auto_pause_on_proposal: boolean }) =>
  apiSend("PUT", "/simulation/settings", settings, Clock);

/** POST /clock/pause */
export const pauseSimulation = () => apiSend("POST", "/clock/pause", undefined, Clock);

/** POST /clock/resume */
export const resumeSimulation = () => apiSend("POST", "/clock/resume", undefined, Clock);

// ---------- dispatch events, buses, trips ----------

export interface DispatchEventFilters extends QueryParams {
  from?: string;
  to?: string;
  hub_id?: string;
  status?: EventStatus;
  at?: string;
}

export const getDispatchEvents = (filters?: DispatchEventFilters, opts?: RequestOptions) =>
  apiGet("/dispatch-events", DispatchEventList, filters, opts);

export const getDispatchEvent = (eventId: string, opts?: RequestOptions) =>
  apiGet(`/dispatch-events/${seg(eventId)}`, DispatchEvent, undefined, opts);

export const getSurges = (
  filters?: { hub_id?: string; phase?: SurgePhase; status?: SurgeStatus },
  opts?: RequestOptions,
) => apiGet("/surges", SurgeList, filters, opts);

export const getBuses = (opts?: RequestOptions) => apiGet("/buses", BusList, undefined, opts);
export const getBus = (busId: string, opts?: RequestOptions) => apiGet(`/buses/${seg(busId)}`, Bus, undefined, opts);

export const getAdditionalTrips = (opts?: RequestOptions) => apiGet("/additional-trips", TripList, undefined, opts);
export const getTrips = getAdditionalTrips;

/** GET /additional-trips/{id}: every trip field plus bus location, stop progress and the full surge. */
export const getAdditionalTrip = (tripId: string, opts?: RequestOptions) =>
  apiGet(`/additional-trips/${seg(tripId)}`, AdditionalTrip, undefined, opts);
export const getTripDetail = getAdditionalTrip;

/** POST /additional-trips/{id}/approve. A 409 throws ApiError carrying `trip`. */
export const approveTrip = (tripId: string) =>
  apiSend("POST", `/additional-trips/${seg(tripId)}/approve`, undefined, AdditionalTrip);

/** POST /additional-trips/{id}/reject. A 409 throws ApiError carrying `trip`. */
export const rejectTrip = (tripId: string) =>
  apiSend("POST", `/additional-trips/${seg(tripId)}/reject`, undefined, AdditionalTrip);

// ---------- routes ----------

export const getRoutes = (params?: { hub_id?: string; include_shape?: boolean }, opts?: RequestOptions) =>
  apiGet("/routes", RouteList, params, opts);

/** GET /routes/{id}. Without params the backend uses the sim date and a window of 1 h before to 3 h after. */
export const getRoute = (
  routeId: string,
  params?: { date?: string; from?: string; to?: string },
  opts?: RequestOptions,
) => apiGet(`/routes/${seg(routeId)}`, RouteDetail, params, opts);

/** GET /routes/load: need vs spare for the current period. */
export const getRouteLoad = (params?: { at?: string; hub_id?: string }, opts?: RequestOptions) =>
  apiGet("/routes/load", RouteLoadList, params, opts);

// ---------- static and reference data ----------

export const getMeta = (opts?: RequestOptions) => apiGet("/meta", Meta, undefined, opts);

export const getHubs = (opts?: RequestOptions) => apiGet("/hubs", HubList, undefined, opts);

export const getTimeline = (params?: { from?: string; to?: string }, opts?: RequestOptions) =>
  apiGet("/timeline", Timeline, params, opts);

export const getEvents = (params?: { from?: string; to?: string; hub_id?: string }, opts?: RequestOptions) =>
  apiGet("/events", EventList, params, opts);

export const getFindings = (opts?: RequestOptions) => apiGet("/findings", Findings, undefined, opts);

export const getBacktest = (opts?: RequestOptions) => apiGet("/backtest", Backtest, undefined, opts);

export const getValidation = (opts?: RequestOptions) => apiGet("/validation", Validation, undefined, opts);

// ---------- per hub ----------

export const getHubStatus = (hubId: string, params?: { at?: string }, opts?: RequestOptions) =>
  apiGet(`/hubs/${seg(hubId)}/status`, HubStatus, params, opts);

export const getForecast = (
  hubId: string,
  params: { at?: string; horizon_hours: number; history_hours: number },
  opts?: RequestOptions,
) => apiGet(`/hubs/${seg(hubId)}/forecast`, Forecast, params, opts);

export const getOrigins = (hubId: string, params: { at?: string; basis: OriginsBasis }, opts?: RequestOptions) =>
  apiGet(`/hubs/${seg(hubId)}/origins`, Origins, params, opts);

export const getLateNight = (hubId: string, params?: { at?: string }, opts?: RequestOptions) =>
  apiGet(`/hubs/${seg(hubId)}/late-night`, LateNight, params, opts);

export const getHourlyProfile = (hubId: string, dayType: DayType, opts?: RequestOptions) =>
  apiGet(`/hubs/${seg(hubId)}/hourly-profile`, HourlyProfile, { day_type: dayType }, opts);

export const getHubOverview = (hubId: string, opts?: RequestOptions) =>
  apiGet(`/hubs/${seg(hubId)}/overview`, Overview, undefined, opts);

export const getRouteCrowding = (hubId: string, opts?: RequestOptions) =>
  apiGet(`/hubs/${seg(hubId)}/route-crowding`, RouteCrowding, undefined, opts);

export const getRecommendations = (hubId: string, opts?: RequestOptions) =>
  apiGet(`/hubs/${seg(hubId)}/recommendations`, RecommendationList, undefined, opts);
