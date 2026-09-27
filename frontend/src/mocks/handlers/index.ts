// Every MSW handler for mock mode. Analytics views read bundled snapshots (src/data) directly, so only the v3
// backend endpoints are mocked.
import { simHandlers } from "./sim";

export const handlers = [...simHandlers];
