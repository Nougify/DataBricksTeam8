// One typed function per endpoint in ../../../../backendspec.md §8 (v3). Paths are relative to ENV.apiBaseUrl
// (/api/v1). The analytics views read bundled snapshots (src/data), not these endpoints.
import { apiGet, apiSend, type RequestOptions } from "./client";
import {
  AdditionalTrip,
  Bus,
  BusList,
  Clock,
  DispatchEvent,
  DispatchEventList,
  Meta,
  RouteDetail,
  RouteList,
  StateResponse,
  TripList,
  type EventStatus,
  type Speed,
} from "./schemas";

const seg = (id: string) => encodeURIComponent(id);

// ---------- reference ----------

export const getMeta = (opts?: RequestOptions) => apiGet("/meta", Meta, undefined, opts);

// ---------- simulation state and clock ----------

/** GET /state: the atomic snapshot, fetched at startup, after `system.reset` and after every reconnect. */
export const getState = (opts?: RequestOptions) => apiGet("/state", StateResponse, undefined, opts);

/** POST /clock/pause */
export const pauseClock = () => apiSend("POST", "/clock/pause", undefined, Clock);

/** POST /clock/resume */
export const resumeClock = () => apiSend("POST", "/clock/resume", undefined, Clock);

/** POST /clock/speed */
export const setClockSpeed = (speed: Speed) => apiSend("POST", "/clock/speed", { speed }, Clock);

/** POST /clock/seek. Returns the paused Clock with the new epoch; `system.reset` follows on the WebSocket. */
export const seekClock = (time: string) => apiSend("POST", "/clock/seek", { time }, Clock);

// ---------- dispatch events ----------

/** GET /dispatch-events: only events already actionable at the sim time. */
export const getDispatchEvents = (
  filters?: { from?: string; to?: string; hub_id?: string; status?: EventStatus },
  opts?: RequestOptions,
) => apiGet("/dispatch-events", DispatchEventList, filters, opts);

export const getDispatchEvent = (eventId: string, opts?: RequestOptions) =>
  apiGet(`/dispatch-events/${seg(eventId)}`, DispatchEvent, undefined, opts);

// ---------- buses and trips ----------

export const getBuses = (opts?: RequestOptions) => apiGet("/buses", BusList, undefined, opts);

export const getBus = (busId: string, opts?: RequestOptions) => apiGet(`/buses/${seg(busId)}`, Bus, undefined, opts);

export const getTrips = (opts?: RequestOptions) => apiGet("/additional-trips", TripList, undefined, opts);

export const getTrip = (tripId: string, opts?: RequestOptions) =>
  apiGet(`/additional-trips/${seg(tripId)}`, AdditionalTrip, undefined, opts);

/** POST /additional-trips/{id}/approve. A 409 throws ApiError; see tripConflictMessage. */
export const approveTrip = (tripId: string) =>
  apiSend("POST", `/additional-trips/${seg(tripId)}/approve`, undefined, AdditionalTrip);

/** POST /additional-trips/{id}/reject. A 409 throws ApiError; see tripConflictMessage. */
export const rejectTrip = (tripId: string) =>
  apiSend("POST", `/additional-trips/${seg(tripId)}/reject`, undefined, AdditionalTrip);

// ---------- routes ----------

export const getRoutes = (params?: { hub_id?: string; include_shape?: boolean }, opts?: RequestOptions) =>
  apiGet("/routes", RouteList, params, opts);

export const getRoute = (routeId: string, opts?: RequestOptions) =>
  apiGet(`/routes/${seg(routeId)}`, RouteDetail, undefined, opts);
