// MSW handlers for every REST endpoint in backendspec.md §8 (v3), backed by the MockSim singleton. Errors use the
// real backend's `{ error: { code, message } }` bodies and messages (DECISIONS.md "2a answers").
import { http, HttpResponse, type JsonBodyType } from "msw";
import { ENV } from "@/config/env";
import { SeekBody, SpeedBody, type EventStatus } from "@/lib/api/schemas";
import { getMockSim } from "@/mocks/sim/instance";
import { listRoutes, routeDetail } from "@/mocks/sim/network";
import { MockApiError } from "@/mocks/sim/types";

const BASE = ENV.apiBaseUrl.replace(/\/+$/, "");
const api = (path: string) => `${BASE}${path}`;

function errorResponse(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

const notFound = (what: string) => errorResponse(404, "NOT_FOUND", `${what} not found`);
const validationError = () => errorResponse(422, "VALIDATION_ERROR", "Request validation failed");

function fail(err: unknown) {
  if (err instanceof MockApiError) return errorResponse(err.status, err.code, err.message);
  console.error("Mock handler failed", err);
  return errorResponse(500, "INTERNAL_ERROR", "Internal server error");
}

/** Brings MockSim up to wall time (like the backend's pump), runs `fn` and returns its JSON. */
function run(fn: () => unknown) {
  try {
    const sim = getMockSim();
    sim.step();
    return HttpResponse.json(fn() as JsonBodyType);
  } catch (err) {
    return fail(err);
  }
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}

const param = (url: URL, key: string) => url.searchParams.get(key) ?? undefined;

export const simHandlers = [
  http.get(api("/meta"), () => run(() => getMockSim().getMeta())),

  http.get(api("/state"), () => run(() => getMockSim().getState())),

  http.get(api("/dispatch-events"), ({ request }) => {
    const url = new URL(request.url);
    return run(() =>
      getMockSim().listDispatchEvents({
        from: param(url, "from"),
        to: param(url, "to"),
        hub_id: param(url, "hub_id"),
        status: param(url, "status") as EventStatus | undefined,
      }),
    );
  }),

  http.get(api("/dispatch-events/:id"), ({ params }) => {
    const event = getMockSim().getDispatchEvent(String(params.id));
    return event ? HttpResponse.json(event as JsonBodyType) : notFound("dispatch event");
  }),

  http.get(api("/buses"), () => run(() => getMockSim().listBuses())),

  http.get(api("/buses/:id"), ({ params }) => {
    getMockSim().step();
    const bus = getMockSim().getBus(String(params.id));
    return bus ? HttpResponse.json(bus as JsonBodyType) : notFound("bus");
  }),

  http.get(api("/additional-trips"), () => run(() => getMockSim().listTrips())),

  http.get(api("/additional-trips/:id"), ({ params }) => {
    const trip = getMockSim().getTrip(String(params.id));
    return trip ? HttpResponse.json(trip as JsonBodyType) : notFound("additional trip");
  }),

  http.post(api("/additional-trips/:id/approve"), ({ params }) => run(() => getMockSim().approve(String(params.id)))),

  http.post(api("/additional-trips/:id/reject"), ({ params }) => run(() => getMockSim().reject(String(params.id)))),

  http.get(api("/routes"), ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json(listRoutes(param(url, "hub_id") ?? null, param(url, "include_shape") === "true") as JsonBodyType);
  }),

  http.get(api("/routes/:id"), ({ params }) => {
    const route = routeDetail(String(params.id));
    return route ? HttpResponse.json(route as JsonBodyType) : notFound("route");
  }),

  http.post(api("/clock/pause"), () => run(() => getMockSim().pause())),

  http.post(api("/clock/resume"), () => run(() => getMockSim().resume())),

  http.post(api("/clock/speed"), async ({ request }) => {
    const body = SpeedBody.safeParse(await readBody(request));
    if (!body.success) return validationError();
    return run(() => getMockSim().setSpeed(body.data.speed));
  }),

  http.post(api("/clock/seek"), async ({ request }) => {
    const body = SeekBody.safeParse(await readBody(request));
    if (!body.success) return validationError();
    try {
      return HttpResponse.json((await getMockSim().seek(body.data.time)) as JsonBodyType);
    } catch (err) {
      return fail(err);
    }
  }),
];
