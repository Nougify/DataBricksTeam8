"use client";

// Where the top-bar controls go when they don't fit (spec §5.2, §5.3):
// - tablet: an overflow menu (⋯) with presets, the date picker, auto-pause, theme, About and Reset demo;
// - phone: a menu button opening a sheet with every control except Play/Pause, at 44 px touch size.
// Both carry the dev-only "Drop connection" item in mock mode.
import { useState } from "react";
import { CalendarDays, Ellipsis, Info, Menu, RotateCcw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMeta } from "@/lib/api/hooks";
import { useSim } from "@/lib/live/store";
import { cn } from "@/lib/utils";
import { canDropConnection, dropConnection, usePresetJump, useResetDemo } from "./actions";
import {
  AUTO_PAUSE_LABEL,
  AutoPauseSwitch,
  DatePicker,
  DatePickerDialog,
  PresetItems,
  PresetsMenu,
  ResetDemoButton,
  useAutoPause,
} from "./ScenarioControls";
import { ConnectionStatus, MockBadge, ThemeSegmented, useThemeChoice } from "./StatusControls";
import { SpeedControl } from "./Transport";

/** Tablet (768–1279 px) overflow menu. */
export function OverflowMenu({ className }: { className?: string }) {
  const meta = useMeta();
  const hasClock = useSim((s) => s.clock !== null);
  const setAboutOpen = useSim((s) => s.setAboutOpen);
  const { jumpToPreset, isPending: jumping } = usePresetJump();
  const autoPause = useAutoPause();
  const resetDemo = useResetDemo();
  const [theme, setTheme] = useThemeChoice();
  const [dateOpen, setDateOpen] = useState(false);

  return (
    <>
      {/* Non-modal, so the dialogs opened from it take focus cleanly. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("size-9", className)} aria-label="More controls">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5 shadow-float">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!meta.data || jumping} className="px-2 py-1.5">
              Presets
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-80 max-w-[calc(100vw-2rem)] rounded-xl p-1.5 shadow-float">
              {meta.data && <PresetItems presets={meta.data.presets} onSelect={jumpToPreset} />}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={!hasClock} onSelect={() => setDateOpen(true)} className="px-2 py-1.5">
            <CalendarDays aria-hidden />
            Go to date
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            checked={autoPause.checked}
            disabled={autoPause.disabled}
            onCheckedChange={autoPause.setChecked}
            onSelect={(e) => e.preventDefault()}
            className="py-1.5 pl-2"
          >
            {AUTO_PAUSE_LABEL}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="px-2 py-1.5">Theme</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36 rounded-xl shadow-float">
              <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => setAboutOpen(true)} className="px-2 py-1.5">
            <Info aria-hidden />
            About
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={resetDemo.disabled} onSelect={resetDemo.reset} className="px-2 py-1.5">
            <RotateCcw aria-hidden />
            {resetDemo.pending ? "Resetting…" : "Reset demo"}
          </DropdownMenuItem>
          {canDropConnection && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={dropConnection} className="px-2 py-1.5">
                <Unplug aria-hidden />
                Drop connection
                <span className="ml-auto text-xs text-muted-foreground">Dev</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DatePickerDialog open={dateOpen} onOpenChange={setDateOpen} />
    </>
  );
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Phone (< 768 px) menu: a sheet holding every control except Play/Pause. */
export function PhoneMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const setAboutOpen = useSim((s) => s.setAboutOpen);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("size-11", className)} aria-label="Menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="gap-0 overflow-y-auto shadow-float">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-lg font-semibold">Simulation controls</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ConnectionStatus size="xs" />
            <MockBadge size="xs" />
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          <MenuSection title="Speed">
            <SpeedControl size="lg" />
          </MenuSection>
          <MenuSection title="Jump to">
            <PresetsMenu fullWidth />
            <DatePicker fullWidth />
          </MenuSection>
          <AutoPauseSwitch className="min-h-11" />
          <MenuSection title="Theme">
            <ThemeSegmented />
          </MenuSection>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="lg"
              className="h-11 w-full"
              onClick={() => {
                setOpen(false);
                setAboutOpen(true);
              }}
            >
              <Info aria-hidden />
              About
            </Button>
            <ResetDemoButton fullWidth />
            {canDropConnection && (
              <Button variant="ghost" size="lg" className="h-11 w-full" onClick={dropConnection}>
                <Unplug aria-hidden />
                Drop connection (dev)
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
