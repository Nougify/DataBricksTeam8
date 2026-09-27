// Live connection (spec §11.4). Startup, repeated after every reconnect:
//   1. open the transport and buffer incoming messages;
//   2. fetch /state and apply it (epoch, last_seq);
//   3. replay buffered messages from that epoch with seq > last_seq;
//   4. apply live.
// A `system.reset` (after a seek) re-runs steps 2–3 on the open transport. Reconnects back off
// exponentially with jitter, from 0.5 s to 10 s.
import type { QueryClient } from "@tanstack/react-query";
import { getState } from "@/lib/api/endpoints";
import { isTimeDependentKey } from "@/lib/api/queryKeys";
import { Envelope, KNOWN_WS_TYPES, StateResponse, WsMessage } from "@/lib/api/schemas";
import { reportContractIssue } from "@/lib/api/contractIssues";
import { ENV } from "@/config/env";
import { handleSimEffects } from "./effects";
import { useSim, type ConnectionState } from "./store";
import { TransportConfigError, type SimTransport, type TransportFactory, type TransportStatus } from "./transport";

export const MIN_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 10_000;
/** Consecutive failed attempts before the status reads "offline" instead of "reconnecting". */
export const OFFLINE_AFTER_FAILURES = 5;
/** Upper bound on messages held while /state is in flight; the oldest are the ones the snapshot covers. */
const MAX_BUFFER = 5_000;

export interface LiveConnection {
  stop(): void;
  /** Refetch /state now (e.g. after a STALE_EPOCH error), buffering live messages meanwhile. */
  resync(): void;
}

export interface StartLiveConnectionOptions {
  queryClient: QueryClient;
  transportFactory: TransportFactory;
}

/** Delay before reconnect attempt `attempt` (0-based): 0.5 s doubling to 10 s, ±25% jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.max(0, attempt));
  const jittered = base * (0.75 + random() * 0.5);
  return Math.round(Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, jittered)));
}

/** Validates an incoming message. Unknown types (e.g. retired `surge.detected`) are ignored, not errors. */
export function parseWsMessage(raw: unknown): WsMessage | null {
  const envelope = Envelope.safeParse(raw);
  if (!envelope.success) {
    if (ENV.isDev) {
      console.error("Contract mismatch: WS envelope", envelope.error.issues);
      reportContractIssue("WS envelope");
    }
    return null;
  }
  if (!KNOWN_WS_TYPES.has(envelope.data.type)) return null;
  const message = WsMessage.safeParse(raw);
  if (message.success) return message.data;
  if (ENV.isDev) {
    console.error(`Contract mismatch: WS ${envelope.data.type}`, message.error.issues);
    reportContractIssue(`WS ${envelope.data.type}`);
  }
  return null;
}

let active: LiveConnection | null = null;

/** Resyncs the running connection, if any. */
export function resyncNow(): void {
  active?.resync();
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

export function startLiveConnection({ queryClient, transportFactory }: StartLiveConnectionOptions): LiveConnection {
  active?.stop();

  let stopped = false;
  /** Bumped per transport; callbacks from an older transport are ignored. */
  let generation = 0;
  /** Bumped per /state fetch; only the latest result is applied. */
  let syncToken = 0;
  let transport: SimTransport | null = null;
  let open = false;
  let mode: "buffering" | "live" = "buffering";
  let buffer: WsMessage[] = [];
  let failures = 0;
  let everSynced = false;
  let fallbackLoading = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const store = () => useSim.getState();
  const setConnection = (c: ConnectionState) => store().setConnection(c);

  const invalidateTimeDependent = () =>
    void queryClient.invalidateQueries({ predicate: (q) => isTimeDependentKey(q.queryKey) });

  function clearReconnectTimer() {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function dropTransport() {
    generation++;
    syncToken++;
    open = false;
    mode = "buffering";
    buffer = [];
    const t = transport;
    transport = null;
    t?.close();
  }

  function connect() {
    if (stopped) return;
    clearReconnectTimer();
    dropTransport();
    const gen = generation;

    const attach = (t: SimTransport) => {
      if (stopped || gen !== generation) {
        t.close();
        return;
      }
      transport = t;
      t.connect({
        onMessage: (raw) => {
          if (gen === generation) onMessage(raw);
        },
        onStatus: (status) => {
          if (gen === generation) onStatus(status);
        },
      });
    };
    const fail = (err: unknown) => {
      if (stopped || gen !== generation) return;
      if (err instanceof TransportConfigError) {
        // Retrying can't fix configuration; show what /state has and stay offline.
        setConnection("offline");
        loadFallbackSnapshot();
        return;
      }
      console.error("Couldn't create the live transport", err);
      onFailure();
    };

    try {
      const created = transportFactory();
      if (created instanceof Promise) created.then(attach, fail);
      else attach(created);
    } catch (err) {
      fail(err);
    }
  }

  function onStatus(status: TransportStatus) {
    if (status === "open") {
      if (open) return;
      open = true;
      void sync("startup");
    } else if (status === "closed") {
      dropTransport();
      onFailure();
    }
  }

  function onFailure() {
    if (stopped) return;
    failures++;
    setConnection(isOffline() || failures >= OFFLINE_AFTER_FAILURES ? "offline" : "reconnecting");
    if (!everSynced) loadFallbackSnapshot();
    clearReconnectTimer();
    reconnectTimer = setTimeout(connect, backoffDelay(failures - 1));
  }

  function onMessage(raw: unknown) {
    const bootstrap = StateResponse.safeParse(raw);
    if (bootstrap.success) {
      try {
        store().setSnapshot(bootstrap.data);
        buffer = [];
        mode = "live";
        failures = 0;
        everSynced = true;
        setConnection("live");
      } catch (err) {
        console.error("Couldn't apply the WebSocket bootstrap", err);
      }
      return;
    }
    const msg = parseWsMessage(raw);
    if (!msg) return;
    if (mode === "live") {
      applyLive([msg]);
      return;
    }
    buffer.push(msg);
    if (buffer.length > MAX_BUFFER) buffer.shift();
  }

  function applyLive(msgs: WsMessage[]) {
    if (msgs.length === 0) return;
    const result = tryApply(msgs);
    if (!result) return;
    try {
      handleSimEffects(result.effects, { queryClient });
    } catch (err) {
      console.error("Couldn't show a live notification", err);
    }
    if (result.effects.some((e) => e.kind === "reset")) {
      buffer = [...result.remaining];
      void sync("reset");
    }
  }

  // A message that passed the envelope check but not its schema is still applied (see validateContract);
  // if it breaks the reducer, skip it rather than stopping the live feed.
  function tryApply(msgs: WsMessage[]) {
    try {
      return store().applyMessages(msgs);
    } catch (err) {
      console.error("Couldn't apply a live update", err);
      return null;
    }
  }

  async function sync(reason: "startup" | "reset" | "manual") {
    const token = ++syncToken;
    mode = "buffering";
    let state: StateResponse;
    try {
      state = await getState();
    } catch (err) {
      if (stopped || token !== syncToken) return;
      console.error("Couldn't load /state", err);
      // Treat it like a dropped connection: start over, with backoff, from a fresh transport.
      dropTransport();
      onFailure();
      return;
    }
    if (stopped || token !== syncToken) return;

    try {
      store().setSnapshot(state);
    } catch (err) {
      console.error("Couldn't apply /state", err);
      dropTransport();
      onFailure();
      return;
    }
    // Newer-epoch messages mean another seek landed meanwhile; the reducer turns them into another resync.
    const replay = buffer.filter((m) => m.epoch > state.epoch || (m.epoch === state.epoch && m.seq > state.last_seq));
    buffer = [];
    mode = "live";
    failures = 0;
    setConnection("live");
    const firstSync = !everSynced;
    everSynced = true;
    if (reason !== "startup" || !firstSync) invalidateTimeDependent();
    applyLive(replay);
  }

  /** Before the first sync, show /state even if the live channel can't connect (e.g. WS blocked, REST fine). */
  function loadFallbackSnapshot() {
    if (fallbackLoading || everSynced) return;
    fallbackLoading = true;
    getState()
      .then((state) => {
        if (!stopped && !everSynced && mode !== "live") store().setSnapshot(state);
      })
      .catch(() => {
        // The connection status already says we're not live.
      })
      .finally(() => {
        fallbackLoading = false;
      });
  }

  const onOnline = () => {
    if (stopped || open) return;
    failures = 0;
    setConnection("reconnecting");
    connect();
  };
  // A socket that stays up (e.g. to localhost) outlives the browser's offline flag; its close handles the rest.
  const onOffline = () => {
    if (!stopped && !open) setConnection("offline");
  };

  const connection: LiveConnection = {
    stop() {
      if (stopped) return;
      stopped = true;
      clearReconnectTimer();
      dropTransport();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      }
      if (active === connection) active = null;
    },
    resync() {
      if (stopped) return;
      if (open) {
        void sync("manual");
        return;
      }
      // No live channel: no messages to buffer, so apply /state directly unless a reconnect gets there first.
      getState()
        .then((state) => {
          if (!stopped && !open) store().setSnapshot(state);
        })
        .catch((err: unknown) => console.error("Couldn't load /state", err));
    },
  };

  active = connection;
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }
  setConnection("connecting");
  connect();
  return connection;
}
