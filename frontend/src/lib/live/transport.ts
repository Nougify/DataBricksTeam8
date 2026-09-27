// The live connection talks to a transport, not to WebSocket directly, so mock mode can plug in an
// in-browser fake (spec §11.4, §12.3). Messages are delivered as parsed JSON; validation happens upstream.

export type TransportStatus = "connecting" | "open" | "closed";

export interface TransportHandlers {
  onMessage(msg: unknown): void;
  onStatus(status: TransportStatus): void;
}

export interface SimTransport {
  connect(handlers: TransportHandlers): void;
  close(): void;
}

/** Called once per connection attempt. May be async so the mock transport can be code-split. */
export type TransportFactory = () => SimTransport | Promise<SimTransport>;

/** A misconfiguration that retrying can't fix (e.g. a ws:// URL on an https page). */
export class TransportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportConfigError";
  }
}
