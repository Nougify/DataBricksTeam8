import { describe, expect, it, vi } from "vitest";
import type { TransportStatus } from "@/lib/live/transport";
import { MockSim } from "@/mocks/sim/mockSim";
import { createFakeTransport } from "./fakeTransport";

vi.mock("@/mocks/sim/instance", () => ({ getMockSim: () => undefined }));

const flush = () => new Promise((r) => setTimeout(r, 20));

async function readySim() {
  const sim = new MockSim({ now: () => 0 });
  await sim.whenReady();
  return sim;
}

describe("fake WebSocket transport", () => {
  it("opens asynchronously, sends the /state snapshot first, then JSON copies in order, and closes on dropConnections", async () => {
    const sim = await readySim();
    const transport = createFakeTransport(sim);
    const statuses: TransportStatus[] = [];
    const received: unknown[] = [];
    transport.connect({ onStatus: (s) => statuses.push(s), onMessage: (m) => received.push(m) });
    expect(statuses).toEqual([]);
    await flush();
    expect(statuses).toEqual(["connecting", "open"]);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ epoch: 0, last_seq: 0, simulation: { status: "PAUSED" } });

    sim.setSpeed(300);
    sim.resume();
    expect(received).toHaveLength(1);
    await flush();
    const envelopes = received.slice(1) as { seq: number; type: string; data: { reason: string } }[];
    expect(envelopes.map((m) => [m.type, m.data.reason])).toEqual([
      ["clock.updated", "SPEED"],
      ["clock.updated", "RESUMED"],
    ]);
    expect(envelopes.map((m) => m.seq)).toEqual([1, 2]);

    sim.dropConnections();
    expect(statuses.at(-1)).toBe("closed");
    sim.pause();
    await flush();
    expect(received).toHaveLength(3);
  });

  it("stops delivering after close()", async () => {
    const sim = await readySim();
    const transport = createFakeTransport(sim);
    const received: unknown[] = [];
    transport.connect({ onStatus: () => {}, onMessage: (m) => received.push(m) });
    await flush();
    transport.close();
    sim.setSpeed(900);
    await flush();
    expect(received).toHaveLength(1);
  });
});
