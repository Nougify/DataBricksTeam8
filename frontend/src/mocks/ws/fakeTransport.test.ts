import { describe, expect, it, vi } from "vitest";
import type { TransportStatus } from "@/lib/live/transport";
import { MockSim } from "@/mocks/sim/mockSim";
import { createFakeTransport } from "./fakeTransport";

vi.mock("@/mocks/sim/instance", () => ({ getMockSim: () => undefined }));

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("fake WebSocket transport", () => {
  it("opens asynchronously, delivers JSON copies in order, and closes on dropConnections", async () => {
    const sim = new MockSim({ now: () => 0 });
    const transport = createFakeTransport(sim);
    const statuses: TransportStatus[] = [];
    const received: unknown[] = [];
    transport.connect({ onStatus: (s) => statuses.push(s), onMessage: (m) => received.push(m) });
    expect(statuses).toEqual([]);
    await flush();
    expect(statuses).toEqual(["connecting", "open"]);

    sim.setSpeed(300);
    sim.pause();
    sim.setSettings({ auto_pause_on_proposal: false });
    expect(received).toHaveLength(0);
    await flush();
    const seqs = received.map((m) => (m as { seq: number }).seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(received.map((m) => (m as { type: string }).type)).toEqual([
      "simulation.state_changed",
      "simulation.state_changed",
    ]);

    sim.dropConnections();
    expect(statuses.at(-1)).toBe("closed");
    sim.setSpeed(60);
    await flush();
    expect(received).toHaveLength(2);
  });

  it("stops delivering after close()", async () => {
    const sim = new MockSim({ now: () => 0 });
    const transport = createFakeTransport(sim);
    const received: unknown[] = [];
    transport.connect({ onStatus: () => {}, onMessage: (m) => received.push(m) });
    await flush();
    sim.setSpeed(900);
    transport.close();
    await flush();
    expect(received).toHaveLength(0);
  });
});
