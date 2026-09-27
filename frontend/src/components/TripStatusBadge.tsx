import { Bus, CircleCheck, CircleDashed, CircleX, Navigation, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TripStatus } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

const STATUS: Record<TripStatus, { label: string; icon: LucideIcon; tone: string }> = {
  PROPOSED: { label: "Proposed", icon: CircleDashed, tone: "text-trip-proposed" },
  APPROVED: { label: "Approved", icon: Navigation, tone: "text-trip-active" },
  BUS_EN_ROUTE: { label: "En route", icon: Navigation, tone: "text-trip-active" },
  IN_SERVICE: { label: "In service", icon: Bus, tone: "text-trip-active" },
  COMPLETED: { label: "Completed", icon: CircleCheck, tone: "text-trip-done" },
  REJECTED: { label: "Rejected", icon: CircleX, tone: "text-trip-failed" },
  EXPIRED: { label: "Expired", icon: CircleX, tone: "text-trip-failed" },
  CANCELLED: { label: "Cancelled", icon: CircleX, tone: "text-trip-failed" },
};

export const tripStatusLabel = (status: TripStatus) => STATUS[status].label;

/** Trip status (DESIGN.md §7.2): a lucide icon in the trip colour plus the label in ink. */
export function TripStatusBadge({ status, className }: { status: TripStatus; className?: string }) {
  const { label, icon: Icon, tone } = STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5", className)}>
      <Icon aria-hidden className={tone} />
      {label}
    </Badge>
  );
}
