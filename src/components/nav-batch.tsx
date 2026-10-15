"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  EraserIcon,
  HourglassIcon,
  LoaderCircleIcon,
  SendIcon,
  SquareIcon,
  XIcon,
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
  cancelBatchJobs,
  resetFailedGenerations,
  sendAllOpenGenerations,
  stopWaitingGenerations,
  useGenerations,
} from "@/hooks/use-generations";
import { formatNumber } from "@/lib/etsy/format";
import {
  resetOf,
  type GenerationSet,
  type PaintJob,
} from "@/lib/generation/types";
import { cn } from "@/lib/utils";

// What's being generated at a glance, above the API quota: images back of
// those asked for (painted online or in batch jobs) and how long it's been.
// Shown while anything is at work, and after, until it's been looked at (the
// Generation page opened, or its list opened and closed once all is back) or
// Reset fails puts the finished jobs away; the next generation then starts a
// fresh clock. Clicking it lists every batch job and how many sets are still
// waiting, which can be stopped there: each job once, however many sets it
// paints for, with its size, model and how far Google has got.

// What an image costs at 2K, in US dollars (docs/generation-pipeline.md):
// Nano Banana 2.1, and Nano Banana 2 (the fallback, `model` on the output),
// online or in a batch job (half price). An estimate, for a feel of the run.
const PRICE = {
  usual: { online: 0.05, batch: 0.025 },
  fallback: { online: 0.1, batch: 0.05 },
};

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

// Routes with dynamic params (e.g. /generation/[id]) only know the pathname at
// request time, so the widget streams in; it shows nothing until then anyway.
export function NavBatch(
  props: React.ComponentPropsWithoutRef<typeof SidebarGroup>,
) {
  return (
    <React.Suspense fallback={null}>
      <BatchWidget {...props} />
    </React.Suspense>
  );
}

function BatchWidget(
  props: React.ComponentPropsWithoutRef<typeof SidebarGroup>,
) {
  const sets = useGenerations();
  const pathname = usePathname();
  const [seen, markSeen] = useSeen();
  const onGeneration = pathname.startsWith("/generation");

  // Jobs still going, and those back since the Generation page was last open
  // (unless Reset fails has put them away).
  const jobs = React.useMemo(
    () =>
      (sets ?? []).flatMap((set) =>
        (set.jobs ?? [])
          .filter(
            (j) =>
              j.status === "running" ||
              (!j.cleared && seen !== null && (j.finishedAt ?? "") > seen),
          )
          .map((job) => ({ set, job })),
      ),
    [sets, seen],
  );
  const run = React.useMemo(() => tally(sets ?? [], seen), [sets, seen]);
  const running = run.busy > 0 || jobs.some(({ job }) => job.status === "running");
  const waiting = React.useMemo(() => (sets ?? []).filter(isWaiting), [sets]);
  // What Reset fails would clear, in every set (not only those listed).
  const fails = React.useMemo(() => {
    const plans = (sets ?? []).map(resetOf);
    return {
      images: plans.reduce((n, p) => n + p.images, 0),
      sets: plans.filter((p) => p.drop).length,
    };
  }, [sets]);

  // Looking at Generation counts as having seen what's back.
  React.useEffect(() => {
    if (onGeneration && !running) markSeen();
  }, [onGeneration, running, jobs.length, markSeen]);

  const now = useNow(running);
  if (seen === null || (run.total === 0 && jobs.length === 0 && waiting.length === 0)) return null;

  const { total, back, failed } = run;
  let start = run.start;
  let end = run.end;
  for (const { job } of jobs) {
    start = Math.min(start, Date.parse(job.submittedAt));
    end = Math.max(end, job.finishedAt ? Date.parse(job.finishedAt) : 0);
  }
  // Nothing was at work when it was last seen, so the run began after that
  // (retried images keep the day they were first asked for).
  if (seen) start = Math.max(start, Date.parse(seen));
  const done = !running && waiting.length === 0;
  const elapsed = Number.isFinite(start) ? (running ? now : end || now) - start : 0;
  const share = total ? back / total : 0;
  const painted = paintedAtVertex(jobs);
  // Each job once, however many sets it paints for: "2 jobs · 183 + 25".
  const runningSizes = byJob(jobs)
    .filter((g) => g.running)
    .map((g) => g.size);
  const runningJobs = runningSizes.length;
  // At the pace of the run so far: a rough guess, and none until a few are back.
  const left =
    running && back >= 3 && elapsed > 60_000 && total > back + failed
      ? ((total - back - failed) * elapsed) / back
      : null;

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <Popover
              // All back: once its list has been looked at, it goes until the
              // next generation.
              onOpenChangeComplete={(open) => {
                if (!open && done) markSeen();
              }}
            >
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
                      ? "Generating"
                      : waiting.length
                        ? "Waiting"
                        : "Generated"}
                  </span>
                  <span
                    className="ml-auto flex items-center gap-1 text-xs text-muted-foreground tabular-nums [&_svg]:size-3"
                    title={left !== null ? `About ${duration(left)} to go at the pace so far` : undefined}
                  >
                    <ClockIcon />
                    {duration(elapsed)}
                    {left !== null && <span className="text-muted-foreground/70">· ~{duration(left)} left</span>}
                  </span>
                </div>

                <div
                  role="progressbar"
                  aria-label="Images back"
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
                  {run.cost > 0 && (
                    <span title="What the images back so far cost, estimated at Google's 2K prices">
                      · ≈ ${run.cost.toFixed(2)}
                    </span>
                  )}
                  {failed > 0 && (
                    <span className="ml-auto text-destructive">
                      {failed} failed
                    </span>
                  )}
                  {failed === 0 && (
                    <span className="ml-auto truncate">
                      {running
                        ? [
                            run.online > 0 && `${formatNumber(run.online)} online`,
                            runningJobs > 0 &&
                              `${runningJobs} ${runningJobs === 1 ? "job" : "jobs"} · ${
                                runningJobs <= 3
                                  ? runningSizes.join(" + ")
                                  : formatNumber(runningSizes.reduce((n, size) => n + size, 0))
                              }`,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Starting"
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
                className="w-96 gap-0 p-0"
              >
                <BatchList
                  jobs={jobs}
                  online={run.online}
                  waiting={waiting}
                  fails={fails}
                  now={now}
                />
              </PopoverContent>
            </Popover>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The images of the run: those asked for since the Generation page was last
 * looked at, and any still being made. Painting online they're running with
 * no job; bound for a batch job they wait as `sending`, then name it.
 */
function tally(sets: GenerationSet[], seen: string | null) {
  const run = { total: 0, back: 0, failed: 0, online: 0, busy: 0, start: Infinity, end: 0, cost: 0 };
  for (const set of sets) {
    // Painted in a batch job: the job lists it.
    const batched = new Set((set.jobs ?? []).flatMap((j) => j.outputs));
    for (const o of set.outputs) {
      const busy = o.status === "pending" || o.status === "running";
      if (!busy && !(seen !== null && o.createdAt > seen)) continue;
      run.total++;
      run.start = Math.min(run.start, Date.parse(o.createdAt));
      if (o.status === "done") {
        run.back++;
        run.cost += PRICE[o.model ? "fallback" : "usual"][batched.has(o.id) ? "batch" : "online"];
      }
      else if (o.status === "error") run.failed++;
      if (busy) run.busy++;
      if (o.status === "running" && !o.job) run.online++;
    }
    if (set.outputs.some((o) => !(o.status === "pending" || o.status === "running") && seen !== null && o.createdAt > seen)) {
      run.end = Math.max(run.end, Date.parse(set.updatedAt));
    }
  }
  return run;
}

/** Images running jobs have painted but Vertex still holds; one job can paint for several sets. */
function paintedAtVertex(jobs: { job: PaintJob }[]) {
  const ready = new Map<string, number>();
  for (const { job } of jobs) {
    if (job.status === "running" && job.ready) ready.set(job.name, job.ready);
  }
  return [...ready.values()].reduce((sum, n) => sum + n, 0);
}

/** A batch job and the sets it paints for: one job at Vertex, however many sets share it. */
type JobGroup = {
  name: string;
  running: boolean;
  /** Requests in the whole job. */
  size: number;
  /** Painted at Vertex so far (it hands them over when the job ends). */
  ready: number;
  /** Back in their sets, and failed. */
  back: number;
  failed: number;
  /** Of the job's images, those still listed under it (a rest sent on to another job isn't). */
  listed: number;
  model?: string;
  harvest: boolean;
  cancelled: boolean;
  error: boolean;
  submittedAt: string;
  finishedAt?: string;
  shares: { set: GenerationSet; images: number; back: number }[];
};

function byJob(jobs: { set: GenerationSet; job: PaintJob }[]): JobGroup[] {
  const groups = new Map<string, JobGroup>();
  for (const { set, job } of jobs) {
    const ids = new Set(job.outputs);
    const outs = set.outputs.filter((o) => ids.has(o.id));
    const back = outs.filter((o) => o.status === "done").length;
    const failed = outs.filter((o) => o.status === "error").length;
    const group = groups.get(job.name) ?? {
      name: job.name,
      running: false,
      size: 0,
      ready: 0,
      back: 0,
      failed: 0,
      listed: 0,
      harvest: false,
      cancelled: false,
      error: false,
      submittedAt: job.submittedAt,
      shares: [],
    };
    group.running ||= job.status === "running";
    group.size = Math.max(group.size, job.size ?? 0);
    group.ready = Math.max(group.ready, job.ready ?? 0);
    group.back += back;
    group.failed += failed;
    group.listed += job.outputs.length;
    group.model ??= job.model;
    group.harvest ||= !!job.harvest;
    group.cancelled ||= !!job.cancelled;
    group.error ||= job.status === "error";
    if (job.submittedAt < group.submittedAt) group.submittedAt = job.submittedAt;
    if (job.finishedAt && (!group.finishedAt || job.finishedAt > group.finishedAt)) group.finishedAt = job.finishedAt;
    group.shares.push({ set, images: job.outputs.length, back });
    groups.set(job.name, group);
  }
  for (const group of groups.values()) group.size = Math.max(group.size, group.listed);
  // Running first, then the newest.
  return [...groups.values()].sort(
    (a, b) => Number(b.running) - Number(a.running) || b.submittedAt.localeCompare(a.submittedAt),
  );
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
  online,
  waiting,
  fails,
  now,
}: {
  jobs: { set: GenerationSet; job: PaintJob }[];
  /** Images painting online in the lane right now. */
  online: number;
  waiting: GenerationSet[];
  /** Failed images in every set, and the sets with nothing else in them. */
  fails: { images: number; sets: number };
  now: number;
}) {
  const [stopping, setStopping] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  // The job being cancelled, or "all"; cancelling them all asks once more.
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [confirmAll, setConfirmAll] = React.useState(false);
  // Resetting asks once more too: what goes doesn't come back.
  const [resetting, setResetting] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const anyRunning = jobs.some(({ job }) => job.status === "running");
  const groups = byJob(jobs);
  const running = groups.filter((g) => g.running);

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

  React.useEffect(() => {
    if (!confirmAll) return;
    const timer = setTimeout(() => setConfirmAll(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirmAll]);

  React.useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  async function reset() {
    setResetting(true);
    try {
      const { images, sets } = await resetFailedGenerations();
      toast.success(
        `Cleared ${formatNumber(images)} failed ${images === 1 ? "image" : "images"}`,
        {
          description: `${sets ? `${formatNumber(sets)} ${sets === 1 ? "set" : "sets"} with nothing else in ${sets === 1 ? "it" : "them"} went too. ` : ""}New batch jobs show here once they're sent.`,
        },
      );
    } catch (error) {
      toast.error(`Couldn't reset: ${(error as Error).message}`);
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  }

  async function cancel(name?: string) {
    setCancelling(name ?? "all");
    try {
      const ended = await cancelBatchJobs(name ? [name] : undefined);
      toast.success(
        `Cancelled ${formatNumber(ended)} ${ended === 1 ? "job" : "jobs"}`,
        {
          description:
            "What was painted comes in; the rest is marked cancelled. Retry a set to ask for it again.",
        },
      );
    } catch (error) {
      toast.error(`Couldn't cancel: ${(error as Error).message}`);
    } finally {
      setCancelling(null);
      setConfirmAll(false);
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
        <span className="min-w-0 text-sm">
          <span className="font-medium">Batch jobs</span>
          {groups.length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
              {running.length > 0
                ? `${running.length} running · ${formatNumber(running.reduce((n, g) => n + g.size, 0))} images`
                : `${groups.length} · ${formatNumber(groups.reduce((n, g) => n + g.size, 0))} images`}
              {online > 0 && ` · ${formatNumber(online)} online`}
            </span>
          )}
        </span>
        <Link
          href="/generation"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open Generation
        </Link>
      </div>
      {groups.length > 0 && (
        <ul className="max-h-96 overflow-y-auto py-1">
          {groups.map((group) => (
            <JobRow
              key={group.name}
              group={group}
              now={now}
              cancelling={cancelling}
              onCancel={() => void cancel(group.name)}
            />
          ))}
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
      {fails.images > 0 && (
        <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground [&_svg]:size-3.5">
          <span className="flex-1">
            {confirmReset ? (
              <>
                Removes {formatNumber(fails.images)} failed{" "}
                {fails.images === 1 ? "image" : "images"}
                {fails.sets > 0 &&
                  ` and ${formatNumber(fails.sets)} ${fails.sets === 1 ? "set" : "sets"} with nothing else in ${fails.sets === 1 ? "it" : "them"}`}
              </>
            ) : (
              <>
                <span className="font-medium text-destructive tabular-nums">
                  {formatNumber(fails.images)}
                </span>{" "}
                failed {fails.images === 1 ? "image" : "images"}: clear them,
                so nothing tries them again
              </>
            )}
          </span>
          <Button
            variant={confirmReset ? "destructive" : "outline"}
            size="xs"
            onClick={() => (confirmReset ? void reset() : setConfirmReset(true))}
            disabled={resetting}
          >
            {resetting ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <EraserIcon />
            )}
            {confirmReset ? "Sure?" : "Reset fails"}
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
      {anyRunning && (
        <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground [&_svg]:size-3.5">
          <span className="flex-1">
            End every job: what&apos;s painted comes in, the rest can be
            retried
          </span>
          <Button
            variant={confirmAll ? "destructive" : "outline"}
            size="xs"
            onClick={() => (confirmAll ? void cancel() : setConfirmAll(true))}
            disabled={cancelling !== null}
          >
            {cancelling === "all" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <XIcon />
            )}
            {confirmAll ? "Sure?" : "Cancel all"}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * One batch job: how big, which model, how far Google has got and how long
 * it's taken; opened, the sets it paints for.
 */
function JobRow({
  group,
  now,
  cancelling,
  onCancel,
}: {
  group: JobGroup;
  now: number;
  cancelling: string | null;
  onCancel: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const end = group.finishedAt ? Date.parse(group.finishedAt) : now;
  const took = duration(end - Date.parse(group.submittedAt));
  const sets = group.shares.length;
  const moved = group.size - group.listed;
  const status = group.running
    ? group.harvest
      ? `Ending early: ${formatNumber(group.ready)} painted coming in`
      : group.ready > 0
        ? `${formatNumber(group.ready)} of ${formatNumber(group.size)} painted at Google`
        : "Waiting at Google to start"
    : [
        group.cancelled ? "Cancelled" : group.error ? "Failed" : `${formatNumber(group.back)} back`,
        moved > 0 && `${formatNumber(moved)} went on as a rest`,
        group.failed > 0 && `${formatNumber(group.failed)} failed`,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <li className="border-b border-border/50 last:border-b-0">
      <div className="flex items-center hover:bg-muted">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 py-1.5 pl-3 text-left text-xs outline-none focus-visible:bg-muted"
        >
          <span className="flex items-center gap-2 [&_svg]:size-3.5 [&_svg]:shrink-0">
            {group.running ? (
              <LoaderCircleIcon className="animate-spin text-emerald-500" />
            ) : (
              <CheckIcon className={group.error || group.cancelled ? "text-destructive" : "text-emerald-500"} />
            )}
            <span className="font-medium tabular-nums">
              {formatNumber(group.size)} {group.size === 1 ? "image" : "images"}
            </span>
            <span
              className={cn(
                "rounded px-1 py-px text-[10px] font-medium",
                group.model ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground",
              )}
              title={group.model ?? "The usual model"}
            >
              {group.model ? "NB 2" : "2.1"}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {sets === 1 ? group.shares[0].set.source.title : `${sets} sets`}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{took}</span>
            <ChevronRightIcon
              className={cn("text-muted-foreground transition-transform duration-150", open && "rotate-90")}
            />
          </span>
          {group.running && group.size > 0 && (
            <span className="ml-5.5 h-1 overflow-hidden rounded-full bg-emerald-500/15">
              <span
                className="block h-full rounded-full bg-emerald-500 transition-[width] duration-700"
                style={{ width: `${Math.min(100, (group.ready / group.size) * 100)}%` }}
              />
            </span>
          )}
          <span className="ml-5.5 truncate text-[11px] text-muted-foreground tabular-nums">{status}</span>
        </button>
        {group.running ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="mx-1 text-muted-foreground hover:text-destructive"
            onClick={onCancel}
            disabled={cancelling !== null}
            aria-label={`Cancel the batch job of ${formatNumber(group.size)} images`}
            title="Cancel this job: what's painted comes in, the rest can be retried"
          >
            {cancelling === group.name ? <LoaderCircleIcon className="animate-spin" /> : <XIcon />}
          </Button>
        ) : (
          <span className="w-3" />
        )}
      </div>
      {open && (
        <ul className="pb-1">
          {group.shares.map(({ set, images, back }) => (
            <li key={set.id}>
              <Link
                href={`/generation/${set.id}`}
                className="flex items-center gap-2 py-1 pr-3 pl-8.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <span className="min-w-0 flex-1 truncate">{set.source.title}</span>
                <span className="shrink-0 tabular-nums">
                  {group.running ? formatNumber(images) : `${formatNumber(back)}/${formatNumber(images)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
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
