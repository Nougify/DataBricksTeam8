import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateAction {
  /** Says exactly what the button does, e.g. "Jump to UBC exam weekend". */
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface EmptyStateProps {
  /** Short statement of what's missing, e.g. "No proposals waiting". */
  title: string;
  /** One sentence on why, e.g. "The engine proposes a bus when it forecasts a surge." */
  description: string;
  /** The one next action. Leave it out for lists that are expected to be empty (they read as a status line). */
  action?: EmptyStateAction;
  /** Optional 20 px muted icon. Leave it out for expected-empty lists. */
  icon?: LucideIcon;
  className?: string;
}

/**
 * Shown in place of the rows when a view has nothing to show (DESIGN.md §7.2): left-aligned, no box or
 * illustration: an optional muted icon, a title, one sentence, and one outline button.
 */
export function EmptyState({ title, description, action, icon: Icon, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-start gap-1 py-2", className)}>
      {Icon && <Icon aria-hidden className="mb-1 size-5 text-muted-foreground" />}
      <p className="text-base leading-snug font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
      {action && (
        <Button variant="outline" size="sm" className="mt-2" onClick={action.onClick} disabled={action.disabled}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
