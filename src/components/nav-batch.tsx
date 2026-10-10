"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  CheckIcon,
  ClockIcon,
  HourglassIcon,
  LoaderCircleIcon,
  SendIcon,
  SquareIcon,
} from "lucide-react";
import { toast } from "sonner";

import { duration } from "@/components/generation/parts";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  sendAllOpenGenerations,
  stopWaitingGenerations,
  useGenerations,
} from "@/hooks/use-generations";
import { formatNumber } from "@/lib/etsy/format";
import type { GenerationSet, PaintJob } from "@/lib/generation/types";
import { cn } from "@/lib/utils";

// Batch jobs at a glance, above the API quota: images back of those sent and
// how long it's been. Shown while any job runs or sets wait their turn, and
// after, until the Generation page is opened again. Clicking it lists every
// job and how many sets are still waiting, which can be stopped there.

const SEEN_KEY = "nav-batch:seen";
const seenListeners = new Set<() => void>();

function useSeen() {
  const seen = React.useSyncExternalStore(
    (notify) => {
      seenListeners.add(notify);
      return () => {
        seenListeners.delete(notify);
      };
    },
    () => localStorage.getItem(SEEN_KEY) ?? "",
    () => null,
  );
  const markSeen = React.useCallback(() => {
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
    seenListeners.forEach((notify) => notify());
  }, []);
  return [seen, markSeen] as const;
}

export function NavBatch(
  props: React.ComponentPropsWithoutRef<typeof SidebarGroup>,
) {
  const sets = useGenerations();
  const pathname = usePathname();
  const [seen, markSeen] = useSeen();
  const onGeneration = pathname.startsWith("/generation");

  // Jobs still going, and those back since the Generation page was last open.
  const jobs = React.useMemo(
    () =>
      (sets ?? []).flatMap((set) =>
        (set.jobs ?? [])
          .filter(
            (j) =>
              j.status === "running" ||
              (seen !== null && (j.finishedAt ?? "") > seen),
          )
          .map((job) => ({ set, job })),
      ),
    [sets, seen],
  );
  const running = jobs.some(({ job }) => job.status === "running");
  const waiting = React.useMemo(() => (sets ?? []).filter(isWaiting), [sets]);

  // Looking at Generation counts as having seen what's back.
  React.useEffect(() => {
    if (onGeneration && !running) markSeen();
  }, [onGeneration, running, jobs.length, markSeen]);

  const now = useNow(running);
  if (seen === null || (jobs.length === 0 && waiting.length === 0)) return null;

  let total = 0;
  let back = 0;
  let failed = 0;
  let start = Infinity;
  let end = 0;
  for (const { set, job } of jobs) {
    const ids = new Set(job.outputs);
    total += ids.size;
    for (const o of set.outputs) {
      if (!ids.has(o.id)) continue;
      if (o.status === "done") back++;
      else if (o.status === "error") failed++;
    }
    start = Math.min(start, Date.parse(job.submittedAt));
    end = Math.max(end, job.finishedAt ? Date.parse(job.finishedAt) : now);
  }
  const elapsed = jobs.length ? (running ? now : end) - start : 0;
  const share = total ? back / total : 0;
  const painted = paintedAtVertex(jobs);

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <Popover>
              <PopoverTrigger
                className={cn(
                  "relative flex w-full cursor-pointer flex-col text-left gap-2 overflow-hidden rounded-lg border p-2.5 text-sm shadow-xs outline-none transition-colors duration-200 focus-visible:ring-3 focus-visible:ring-ring/50",
                  "border-emerald-500/25 bg-emerald-500/[0.06] hover:bg-emerald-500/10",
                )}
              >
                {running && (
                  // A soft glow drifting across while Vertex paints.
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-emerald-400/10 to-transparent motion-reduce:hidden"
                  />
                )}
                <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
                  <span className="relative grid size-4 place-items-center">
                    {running ? (
                      <>
                        <span className="absolute size-2 animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" />
                        <span className="size-2 rounded-full bg-emerald-500" />
                      </>
                    ) : (
                      <CheckIcon className="text-emerald-600 dark:text-emerald-400" />
                    )}
                  </span>
                  <span className="truncate">
                    {running
                      ? "Batch running"
                      : waiting.length
                        ? "Batch waiting"
                        : "Batch done"}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground tabular-nums [&_svg]:size-3">
                    <ClockIcon />
                    {duration(elapsed)}
                  </span>
                </div>

                <div
                  role="progressbar"
                  aria-label="Batch images back"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={back}
                  className="h-1.5 overflow-hidden rounded-full bg-emerald-500/15"
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 ease-out-strong motion-reduce:transition-none"
                    style={{
                      width: `${Math.max(share * 100, back > 0 ? 4 : 0)}%`,
                    }}
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      {formatNumber(back)}
                    </span>{" "}
                    of {formatNumber(total)} images
                    {painted > 0 && (
                      <span title="Painted at Vertex, which hands them over when the job ends. Jobs are ended every 10 minutes or so to collect them.">
                        {" "}
                        · {formatNumber(painted)} painted
                      </span>
                    )}
                  </span>
                  {failed > 0 && (
                    <span className="ml-auto text-destructive">
                      {failed} failed
                    </span>
                  )}
                  {failed === 0 && (
                    <span className="ml-auto">
                      {running
                        ? `${jobs.filter(({ job }) => job.status === "running").length} jobs`
                        : "View"}
                      {waiting.length > 0 &&
                        ` · ${formatNumber(waiting.length)} waiting`}
                    </span>
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="end"
                className="w-80 gap-0 p-0"
              >
                <BatchList jobs={jobs} waiting={waiting} now={now} />
              </PopoverContent>
            </Popover>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Images running jobs have painted but Vertex still holds; one job can paint for several sets. */
function paintedAtVertex(jobs: { job: PaintJob }[]) {
  const ready = new Map<string, number>();
  for (const { job } of jobs) {
    if (job.status === "running" && job.ready) ready.set(job.name, job.ready);
  }
  return [...ready.values()].reduce((sum, n) => sum + n, 0);
}

/** Not yet sent off: waiting its turn, or still reading posters and writing briefs. */
function isWaiting(set: GenerationSet) {
  if (set.status !== "queued" && set.status !== "running") return false;
  if (set.stopping) return false;
  return (
    set.batches.some((b) => !b.expanded) ||
    set.outputs.some((o) => o.status === "pending" && !o.job)
  );
}

function BatchList({
  jobs,
  waiting,
  now,
}: {
  jobs: { set: GenerationSet; job: PaintJob }[];
  waiting: GenerationSet[];
  now: number;
}) {
  const [stopping, setStopping] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const sorted = [...jobs].sort(
    (a, b) =>
      Number(b.job.status === "running") - Number(a.job.status === "running") ||
      b.job.submittedAt.localeCompare(a.job.submittedAt),
  );

  async function stop() {
    setStopping(true);
    try {
      const stopped = await stopWaitingGenerations();
      toast.success(
        `Stopped ${formatNumber(stopped)} ${stopped === 1 ? "set" : "sets"}`,
        {
          description:
            "Batch jobs already sent keep painting. Retry a set to run it again.",
        },
      );
    } catch (error) {
      toast.error(`Couldn't stop: ${(error as Error).message}`);
    } finally {
      setStopping(false);
    }
  }

  async function sendAll() {
    setSending(true);
    try {
      const { jobs, retried } = await sendAllOpenGenerations();
      toast.success("Sending everything open in one batch job", {
        description: `${formatNumber(jobs)} running ${jobs === 1 ? "job" : "jobs"} ended early — what they painted comes in now — and ${formatNumber(retried)} failed ${retried === 1 ? "image" : "images"} retried.`,
      });
    } catch (error) {
      toast.error(`Couldn't send: ${(error as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">Batch jobs</span>
        <Link
          href="/generation"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open Generation
        </Link>
      </div>
      {sorted.length > 0 && (
        <ul className="max-h-72 overflow-y-auto py-1">
          {sorted.map(({ set, job }) => {
            const ids = new Set(job.outputs);
            const outs = set.outputs.filter((o) => ids.has(o.id));
            const back = outs.filter((o) => o.status === "done").length;
            const failed = outs.filter((o) => o.status === "error").length;
            const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
            return (
              <li key={job.name}>
                <Link
                  href={`/generation/${set.id}`}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted [&_svg]:size-3.5 [&_svg]:shrink-0"
                >
                  {job.status === "running" ? (
                    <LoaderCircleIcon className="animate-spin text-emerald-500" />
                  ) : (
                    <CheckIcon
                      className={
                        job.status === "error"
                          ? "text-destructive"
                          : "text-emerald-500"
                      }
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {set.source.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {failed > 0 && (
                      <span className="text-destructive">
                        {failed} failed ·{" "}
                      </span>
                    )}
                    {back}/{job.outputs.length} ·{" "}
                    {duration(end - Date.parse(job.submittedAt))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {waiting.length > 0 && (
        <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground [&_svg]:size-3.5">
          <HourglassIcon />
          <span className="flex-1">
            <span className="font-medium text-foreground tabular-nums">
              {formatNumber(waiting.length)}
            </span>{" "}
            {waiting.length === 1 ? "set" : "sets"} not sent yet
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={stop}
            disabled={stopping}
          >
            {stopping ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SquareIcon className="fill-current" />
            )}
            Stop
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground [&_svg]:size-3.5">
        <span className="flex-1">
          Collect what&apos;s painted, send the rest and every failed image
          in one job
        </span>
        <Button variant="outline" size="xs" onClick={sendAll} disabled={sending}>
          {sending ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
          Send all
        </Button>
      </div>
    </>
  );
}

// The time is only read once mounted: prerendering mustn't (Next.js errors on
// it), and the widget shows nothing until it's in the browser anyway.
let clock = 0;

function subscribeClock(notify: () => void) {
  const tick = () => {
    clock = Date.now();
    notify();
  };
  tick();
  const timer = setInterval(tick, 5_000);
  return () => clearInterval(timer);
}

const noSubscribe = () => () => {};

/** The time, ticking every few seconds while `on`. */
function useNow(on: boolean) {
  return React.useSyncExternalStore(
    on ? subscribeClock : noSubscribe,
    () => clock,
    () => 0,
  );
}
