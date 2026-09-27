// Every MSW handler for mock mode: simulation endpoints (MockSim) first, then the read endpoints (synthesis).
import { readHandlers } from "./read";
import { simHandlers } from "./sim";

export const handlers = [...simHandlers, ...readHandlers];
