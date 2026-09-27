"use client";

// Banners under the top bar, one per line, pushing the content down (never covering the map):
// - dev only: "Contract mismatch: {endpoint}" (dismissible);
// - /meta failed to load (presets, speeds and Reset demo need it), with Retry;
// - a live-connection configuration error (e.g. ws:// on an https page);
// - a shared link's time: "This link points to Sat Dec 6 13:00. Jump there?" with Jump and dismiss.
import type { ReactNode } from "react";
import { CircleAlert, Link2, TriangleAlert, WifiOff, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ENV } from "@/config/env";
import { useContractIssues } from "@/lib/api/contractIssues";
import { useMeta } from "@/lib/api/hooks";
import { fmtDateShort, fmtTime } from "@/lib/format";
import { useSim } from "@/lib/live/store";
import { vancouverParts } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useJumpTo } from "@/features/topbar";

function Banner({
  icon: Icon,
  iconClassName,
  children,
  actions,
  role = "status",
}: {
  icon: LucideIcon;
  iconClassName?: string;
  children: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div role={role} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-card px-3 py-2 text-sm md:px-4">
      <Icon aria-hidden className={cn("size-4 shrink-0", iconClassName ?? "text-muted-foreground")} />
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

function DismissButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
      <X />
    </Button>
  );
}

function ContractBanner() {
  const endpoints = useContractIssues((s) => s.endpoints);
  const clear = useContractIssues((s) => s.clear);
  if (!ENV.isDev || endpoints.length === 0) return null;
  const [first, ...rest] = endpoints;
  return (
    <Banner
      icon={TriangleAlert}
      iconClassName="text-surge-high"
      actions={<DismissButton label="Dismiss contract warning" onClick={clear} />}
    >
      <span title={endpoints.join("\n")}>
        Contract mismatch: <span className="font-mono text-xs">{first}</span>
        {rest.length > 0 && <span className="text-muted-foreground"> and {rest.length} more</span>}
        <span className="text-muted-foreground"> (dev only; details in the console)</span>
      </span>
    </Banner>
  );
}

function SettingsBanner() {
  const meta = useMeta();
  if (!meta.isError || meta.data) return null;
  return (
    <Banner
      icon={CircleAlert}
      iconClassName="text-destructive"
      actions={
        <Button variant="outline" size="sm" onClick={() => void meta.refetch()} disabled={meta.isFetching}>
          {meta.isFetching ? "Retrying…" : "Retry"}
        </Button>
      }
    >
      <span className="font-semibold">Couldn&rsquo;t load the simulation settings.</span>{" "}
      <span className="text-muted-foreground">
        {meta.error?.message} Presets, speeds and Reset demo are unavailable until they load.
      </span>
    </Banner>
  );
}

function ConfigErrorBanner() {
  const configError = useSim((s) => s.configError);
  if (!configError) return null;
  return (
    <Banner icon={WifiOff} iconClassName="text-destructive" role="alert">
      <span className="font-semibold">The live connection is misconfigured.</span>{" "}
      <span className="text-muted-foreground">{configError}</span>
    </Banner>
  );
}

function LinkTimeBanner() {
  const pendingLinkTime = useSim((s) => s.pendingLinkTime);
  const setPendingLinkTime = useSim((s) => s.setPendingLinkTime);
  const hasClock = useSim((s) => s.clock !== null);
  const { jump, isPending } = useJumpTo();
  if (!pendingLinkTime) return null;

  const ms = Date.parse(pendingLinkTime);
  const when = `${fmtDateShort(vancouverParts(ms).local_date)} ${fmtTime(ms)}`;
  const clear = () => setPendingLinkTime(null);

  return (
    <Banner
      icon={Link2}
      actions={
        <>
          <Button
            size="sm"
            disabled={!hasClock || isPending}
            onClick={() => jump(pendingLinkTime, { label: when }, clear)}
          >
            {isPending ? "Jumping…" : "Jump"}
          </Button>
          <DismissButton label="Dismiss link time" onClick={clear} />
        </>
      }
    >
      This link points to {when}. Jump there?
    </Banner>
  );
}

export function GlobalBanners() {
  return (
    <div className="flex flex-col">
      <ContractBanner />
      <ConfigErrorBanner />
      <SettingsBanner />
      <LinkTimeBanner />
    </div>
  );
}
