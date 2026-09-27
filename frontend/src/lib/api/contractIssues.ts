// Contract mismatches seen at runtime (REST responses and WebSocket messages that fail the zod schemas).
// The dev-only banner reads this store. Validation never blocks the UI: on a mismatch the raw data is
// still used, so the console keeps working while the banner points at the endpoint to fix.
import { create } from "zustand";
import type { z } from "zod";
import { ENV } from "@/config/env";

interface ContractIssuesState {
  /** Endpoint labels with at least one mismatch, in first-seen order, e.g. "GET /hubs/ubc/forecast". */
  endpoints: string[];
  clear(): void;
}

export const useContractIssues = create<ContractIssuesState>()((set) => ({
  endpoints: [],
  clear: () => set({ endpoints: [] }),
}));

export function reportContractIssue(endpoint: string): void {
  const { endpoints } = useContractIssues.getState();
  if (!endpoints.includes(endpoint)) useContractIssues.setState({ endpoints: [...endpoints, endpoint] });
}

/**
 * Validates `data` against `schema`. Returns the parsed value when it matches; otherwise returns the raw
 * data unchanged (degrading gracefully) and, in dev, logs the issues and flags the endpoint for the banner.
 */
export function validateContract<T>(label: string, schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  if (ENV.isDev) {
    console.error(`Contract mismatch: ${label}`, result.error.issues);
    reportContractIssue(label);
  }
  return data as T;
}
