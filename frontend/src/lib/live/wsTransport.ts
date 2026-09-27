// SimTransport over a real WebSocket. Each text frame is JSON-parsed; validation happens in the connection.
import type { SimTransport, TransportHandlers } from "./transport";

export function createWsTransport(url: string): SimTransport {
  let socket: WebSocket | null = null;

  const detach = (ws: WebSocket) => {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
  };

  return {
    connect(handlers: TransportHandlers) {
      if (socket) {
        detach(socket);
        socket.close();
        socket = null;
      }
      handlers.onStatus("connecting");

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        // Invalid URL or a blocked scheme (e.g. ws:// from an https page).
        console.error(`Couldn't open WebSocket ${url}`, err);
        queueMicrotask(() => handlers.onStatus("closed"));
        return;
      }
      socket = ws;

      ws.onopen = () => handlers.onStatus("open");
      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        let msg: unknown;
        try {
          msg = JSON.parse(event.data);
        } catch {
          console.warn("Ignoring a WebSocket message that isn't JSON");
          return;
        }
        handlers.onMessage(msg);
      };
      // An error event is always followed by close, which is where we report it.
      ws.onerror = () => {};
      ws.onclose = () => {
        detach(ws);
        if (socket === ws) socket = null;
        handlers.onStatus("closed");
      };
    },

    close() {
      if (!socket) return;
      const ws = socket;
      socket = null;
      detach(ws);
      ws.close(1000, "client closed");
    },
  };
}
