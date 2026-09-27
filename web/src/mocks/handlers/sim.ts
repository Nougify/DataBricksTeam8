// MSW handlers for the simulation endpoints (message.txt §1–§5, §8–§11b), backed by the MockSim singleton.
// MockApiError becomes the contract's `{ error: { code, message }, trip? }` body with its HTTP status.
import { http, HttpResponse, type JsonBodyType } from "msw";
import { ENV } from "@/config/env";
import { ApproveBody, RejectBody, SeekBody, SettingsBody, SpeedBody } from "@/lib/api/schemas";
import { getMockSim } from "@/mocks/sim/instance";
import { MockApiError } from "@/mocks/sim/types";

const BASE = ENV.apiBaseUrl.replace(/\/+$/, "");
const api = (path: string) => `${BASE}${path}`;

function errorResponse(status: number, code: string, message: string, trip?: unknown) {
  const body: Record<string, unknown> = { error: { code, message } };
  if (trip !== undefined) body.trip = trip;
  return HttpResponse.json(body as JsonBodyType, { status });
}

/** Runs a MockSim call and turns its errors into contract error bodies. */
function run(fn: () => unknown) {
  try {
    return HttpResponse.json(fn() as JsonBodyType);
  } catch (err) {
    if (err instanceof MockApiError) return errorResponse(err.status, err.code, err.message, err.trip);
    console.error("Mock handler failed", err);
    return errorResponse(500, "INTERNAL", err instanceof Error ? err.message : "Mock handler failed.");
  }
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}

const badRequest = (message: string) => errorResponse(400, "BAD_REQUEST", message);

const param = (url: URL, key: string) => url.searchParams.get(key) ?? undefined;

export const simHandlers = [
  http.get(api("/state"), () => run(() => getMockSim().getState())),

  http.get(api("/simulation"), () => run(() => getMockSim().getClock())),

  http.put(api("/simulation/time"), async ({ request }) => {
    const body = SeekBody.safeParse(await readBody(request));
    if (!body.success) return badRequest("Body must be { current_time: ISO 8601 with offset }.");
    return run(() => getMockSim().seek(body.data.current_time));
  }),

  http.put(api("/simulation/speed"), async ({ request }) => {
    const body = SpeedBody.safeParse(await readBody(request));
    if (!body.success) return errorResponse(400, "INVALID_SPEED", "Body must be { speed: number }.");
    return run(() => getMockSim().setSpeed(body.data.speed));
  }),

  http.put(api("/simulation/settings"), async ({ request }) => {
    const body = SettingsBody.safeParse(await readBody(request));
    if (!body.success) return badRequest("Body must be { auto_pause_on_proposal: boolean }.");
    return run(() => getMockSim().setSettings(body.data));
  }),

  http.post(api("/simulation/pause"), () => run(() => getMockSim().pause())),

  http.post(api("/simulation/resume"), () => run(() => getMockSim().resume())),

  http.get(api("/surges"), ({ request }) => {
    const url = new URL(request.url);
    const hub = param(url, "hub_id");
    const phase = param(url, "phase");
    const status = param(url, "status");
    return run(() =>
      getMockSim()
        .listSurges()
        .filter((s) => (!hub || s.hub_id === hub) && (!phase || s.phase === phase) && (!status || s.status === status)),
    );
  }),

  http.get(api("/buses"), () => run(() => getMockSim().listBuses())),

  http.get(api("/additional-trips"), ({ request }) => {
    const url = new URL(request.url);
    const status = param(url, "status");
    const hub = param(url, "hub_id");
    const surge = param(url, "surge_id");
    return run(() =>
      getMockSim()
        .listTrips()
        .filter((t) => (!status || t.status === status) && (!hub || t.hub_id === hub) && (!surge || t.surge_id === surge)),
    );
  }),

  http.get(api("/additional-trips/:id"), ({ params }) => {
    const id = String(params.id);
    const detail = getMockSim().getTripDetail(id);
    if (!detail) return errorResponse(404, "TRIP_NOT_FOUND", `No trip ${id}.`);
    return HttpResponse.json(detail as JsonBodyType);
  }),

  http.post(api("/additional-trips/:id/approve"), async ({ request, params }) => {
    const body = ApproveBody.safeParse(await readBody(request));
    if (!body.success) return badRequest("Body must be { epoch: integer }.");
    return run(() => getMockSim().approve(String(params.id), body.data.epoch));
  }),

  http.post(api("/additional-trips/:id/reject"), async ({ request, params }) => {
    const body = RejectBody.safeParse(await readBody(request));
    if (!body.success) return badRequest("Body must be { epoch: integer, reason?: string }.");
    return run(() => getMockSim().reject(String(params.id), body.data.epoch, body.data.reason));
  }),
];
