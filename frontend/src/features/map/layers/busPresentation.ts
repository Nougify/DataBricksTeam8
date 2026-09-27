import type { BusStatus } from "@/lib/api/schemas";

export interface BusVisual {
  variant: "solid" | "outline";
  token: "trip-proposed" | "trip-active" | "trip-done" | "typical";
  size: number;
  opacity: number;
}

export function busVisual(status: BusStatus): BusVisual {
  switch (status) {
    case "RESERVED":
      return { variant: "outline", token: "trip-proposed", size: 20, opacity: 1 };
    case "DEADHEADING":
    case "WAITING":
      return { variant: "outline", token: "trip-active", size: 20, opacity: 1 };
    case "IN_SERVICE":
      return { variant: "solid", token: "trip-active", size: 20, opacity: 1 };
    case "RETURNING":
    case "REPOSITIONING":
      return { variant: "solid", token: "trip-done", size: 20, opacity: 1 };
    case "AVAILABLE":
      return { variant: "solid", token: "typical", size: 16, opacity: 0.7 };
  }
}
