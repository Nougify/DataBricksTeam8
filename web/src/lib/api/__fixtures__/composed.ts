// Examples in message.txt that use `"...": "..."` placeholders, completed from the other examples.
// The *.template.json files are the verbatim examples; everything else in this folder is copied verbatim
// from message.txt and used as is.
import additionalTrip from "./additional-trip.json";
import bus from "./bus.json";
import clock from "./clock.json";
import hubStatus from "./hub-status.json";
import routeRef from "./route-ref.json";
import surge from "./surge.json";
import stateTemplate from "./state.template.json";
import tripDetailTemplate from "./additional-trip-detail.template.json";
import error409Template from "./error-409.template.json";
import routeLoadTemplate from "./route-load.template.json";
import lateNightTemplate from "./late-night.template.json";
import routeCrowdingTemplate from "./route-crowding.template.json";

/** Drops the `"..."` placeholder key from a template object. */
function withoutPlaceholder<T extends object>(template: T): Omit<T, "..."> {
  const copy: Record<string, unknown> = { ...(template as Record<string, unknown>) };
  delete copy["..."];
  return copy as Omit<T, "...">;
}

/** §1 GET /state: the §0.1 Clock, HubStatus, Surge, Bus and AdditionalTrip examples in the template's slots. */
export const state = {
  ...stateTemplate,
  simulation: clock,
  hubs: [hubStatus],
  surges: [surge],
  buses: [bus],
  additional_trips: [additionalTrip],
};

/** §2–§4 list endpoints: arrays of the §0.1 examples. */
export const surgeList = [surge];
export const busList = [bus];
export const tripList = [additionalTrip];

/** §5 GET /additional-trips/{id}: every §0.1 AdditionalTrip field, then the template's detail fields and the §0.1 Surge. */
export const tripDetail = {
  ...additionalTrip,
  ...withoutPlaceholder(tripDetailTemplate),
  surge,
};

/** §8, §8b, §9, §10, §11, §11b responses: the §0.1 Clock, adjusted to what each endpoint describes. */
export const clockResponses = {
  simulation: clock,
  seek: { ...clock, epoch: clock.epoch + 1 }, // "with the new epoch"
  speed: clock,
  pause: { ...clock, status: "PAUSED" },
  resume: { ...clock, status: "RUNNING" },
  settings: clock,
};

/** §9b 409 body: the template's error with the §0.1 AdditionalTrip, in the state the error code implies. */
export const error409 = {
  ...error409Template,
  trip: { ...additionalTrip, status: "EXPIRED" },
};

/** §20 GET /routes/load: the §0.1 RouteRef (route 99, matching the 104% load) in the `route` slot. */
export const routeLoad = routeLoadTemplate.map((row) => ({ ...row, route: routeRef }));

/**
 * §21 GET /hubs/{id}/late-night: the template's `lines` slot says "RouteRef, e.g. N17". The ids and names
 * below are illustrative, in the §0.1 RouteRef shape.
 */
const n17 = {
  route_id: "6682",
  line_key: "N17",
  short_name: "N17",
  long_name: "Downtown / UBC (NightBus)",
  mode: "Bus",
  color: null,
  text_color: null,
};
export const lateNight = {
  ...lateNightTemplate,
  hours: lateNightTemplate.hours.map((h) => ({ ...h, lines: [n17] })),
};

/** §24 GET /hubs/{id}/route-crowding: the §0.1 RouteRef (route 99, matching the 20.3% overcrowded) in the `route` slot. */
export const routeCrowding = routeCrowdingTemplate.map((row) => ({ ...row, route: routeRef }));
