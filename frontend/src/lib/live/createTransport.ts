// Picks the live transport: the in-browser fake in mock mode (code-split so it never ships otherwise),
// the real WebSocket client against ENV.wsUrl otherwise. Used as the connection's TransportFactory.
import { ENV } from "@/config/env";
import { TransportConfigError, type SimTransport } from "./transport";
import { createWsTransport } from "./wsTransport";
import { useSim } from "./store";

/** Returns an error message when the page is served over https but the WebSocket URL isn't wss://. */
export function mixedContentError(pageProtocol: string, wsUrl: string): string | null {
  if (pageProtocol !== "https:" || wsUrl.startsWith("wss:")) return null;
  return `This page is served over HTTPS, so the live connection needs a wss:// URL, but NEXT_PUBLIC_WS_URL is "${wsUrl}". Set it to a wss:// address and rebuild.`;
}

export async function createTransport(): Promise<SimTransport> {
  if (ENV.useMocks) return (await import("@/mocks/ws/fakeTransport")).createFakeTransport();

  const error = typeof window === "undefined" ? null : mixedContentError(window.location.protocol, ENV.wsUrl);
  if (error) {
    useSim.getState().setConfigError(error);
    throw new TransportConfigError(error);
  }
  return createWsTransport(ENV.wsUrl);
}
