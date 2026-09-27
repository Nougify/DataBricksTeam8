"use client";

import { useSyncExternalStore } from "react";
import { FlaskConical, Monitor, Moon, Sun, WifiOff, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ENV } from "@/config/env";
import { useSim, type ConnectionState } from "@/lib/live/store";
import { cn } from "@/lib/utils";

// ---------- connection ----------

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

/** Shape, not colour, carries the state: filled dot = live, hollow dot = (re)connecting, crossed wifi = offline. */
function ConnectionGlyph({ state }: { state: ConnectionState }) {
  if (state === "offline") return <WifiOff aria-hidden className="size-3.5 shrink-0 text-destructive" />;
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full border-[1.5px] border-foreground",
        state === "live" && "bg-foreground",
      )}
    />
  );
}

/** "Live", "Reconnecting…", "Offline" (spec §6), from the live store. A polite status region. */
export function ConnectionStatus({ size = "sm", className }: { size?: "xs" | "sm"; className?: string }) {
  const state = useSim((s) => s.connection);
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        size === "xs" ? "text-xs text-muted-foreground" : "text-sm",
        className,
      )}
    >
      <ConnectionGlyph state={state} />
      <span className="sr-only">Connection: </span>
      {CONNECTION_LABEL[state]}
    </span>
  );
}

/** Always visible in mock mode (spec §12.1): outline badge with a flask in the bar, plain text in the subline. */
export function MockBadge({ size = "sm", className }: { size?: "xs" | "sm"; className?: string }) {
  if (!ENV.useMocks) return null;
  if (size === "xs") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground", className)}>
        <FlaskConical aria-hidden className="size-3" />
        Mock data
      </span>
    );
  }
  return (
    <Badge variant="outline" className={cn("h-6 gap-1 px-2 text-xs", className)}>
      <FlaskConical aria-hidden />
      Mock data
    </Badge>
  );
}

// ---------- theme ----------

type ThemeChoice = "light" | "dark" | "system";
const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const noopSubscribe = () => () => {};

/** The stored theme choice; "system" during SSR and hydration so the markup matches. */
export function useThemeChoice(): [ThemeChoice, (value: string) => void] {
  const { theme, setTheme } = useTheme();
  // next-themes reads localStorage on the client's first render, so gate on hydration.
  // The third argument (server snapshot) is what the old version was missing.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const choice: ThemeChoice = hydrated && (theme === "light" || theme === "dark") ? theme : "system";
  return [choice, setTheme];
}

/** Icon button with a Light / Dark / System menu (top bar). */
export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setTheme] = useThemeChoice();
  const current = THEMES.find((t) => t.value === choice) ?? THEMES[2];
  const Icon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className} aria-label={`Theme: ${current.label}`}>
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 rounded-xl shadow-float">
        <DropdownMenuRadioGroup value={choice} onValueChange={setTheme}>
          {THEMES.map(({ value, label, icon: ItemIcon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <ItemIcon aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same choice as a full-width segmented control (phone menu). */
export function ThemeSegmented({ className }: { className?: string }) {
  const [choice, setTheme] = useThemeChoice();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      value={choice}
      onValueChange={(v) => v && setTheme(v)}
      aria-label="Theme"
      className={cn("w-full", className)}
    >
      {THEMES.map(({ value, label, icon: ItemIcon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          className="h-11 flex-1 gap-1.5 aria-checked:bg-primary aria-checked:text-primary-foreground hover:aria-checked:bg-primary/90"
        >
          <ItemIcon aria-hidden />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ---------- about ----------

export function AboutButton({ className }: { className?: string }) {
  const setAboutOpen = useSim((s) => s.setAboutOpen);
  return (
    <Button variant="ghost" size="sm" className={className} onClick={() => setAboutOpen(true)}>
      About
    </Button>
  );
}
