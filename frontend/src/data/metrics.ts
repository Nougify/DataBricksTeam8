// Surge-classifier scorecard, rgersxdatabricks_hackathon.model.surge_model_metrics (see README.md "metrics").
// The strip and badges use the 60 min lead; About shows 30 / 60 / 120 min (DECISIONS.md "Where data comes from").
import metricsJson from "./metrics.json";

export const METRICS_SOURCE = "Databricks · model.surge_model_metrics";
export const DEFAULT_LEAD_MINUTES = 60;

export interface ModelMetricsRow {
  lead_minutes: number;
  /** null for the "All hubs" row. */
  hub_id: string | null;
  hub: string;
  surge_slots: number;
  slots: number;
  auc: number;
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  rule_precision: number;
  rule_recall: number;
  rule_f1: number;
  surge_ratio: number;
  slot_minutes: number;
  source_version: string;
}

export const modelMetrics = metricsJson as ModelMetricsRow[];

export const LEAD_MINUTES: readonly number[] = [...new Set(modelMetrics.map((r) => r.lead_minutes))].sort((a, b) => a - b);

/** The row for a lead time and hub (null hubId = all hubs). */
export function metricsFor(leadMinutes: number, hubId: string | null): ModelMetricsRow | undefined {
  return modelMetrics.find((r) => r.lead_minutes === leadMinutes && r.hub_id === hubId);
}
