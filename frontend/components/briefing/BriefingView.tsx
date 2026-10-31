"use client";

import {
  Brain,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { analyzeDay, sortedEntries } from "../../lib/analytics";
import { localDigest } from "../../lib/ai/local";
import { formatDayLong, type DayKey } from "../../lib/data/day";
import { useDayLogs, useDays, useSummaries } from "../../lib/data/hooks";
import type { DaySummary } from "../../lib/data/types";
import { getDataSource } from "../../lib/data";
import { clearSelection, peekSelection } from "../../lib/selection";
import { useAi } from "../../providers/AiProvider";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { useNotifications } from "../../providers/NotificationProvider";
import { Button, IconButton } from "../ui/Button";
import { Markdown } from "../ui/Markdown";
import { Panel } from "../ui/Panel";
import { ServiceIcon } from "../ui/ServiceIcon";
import { SeverityBadge } from "../ui/SeverityBadge";
import { DayRail } from "./DayRail";

function Hourly({
  hourly,
  critical,
}: {
  hourly: number[];
  critical: number[];
}) {
  const max = Math.max(1, ...hourly);
  return (
    <div className="flex h-20 items-end gap-0.5" aria-hidden>
      {hourly.map((v, h) => (
        <div
          key={h}
          className="group/bar relative flex h-full flex-1 items-end"
          title={`${h}:00 UTC — ${v} events`}
        >
          <div
            className="w-full rounded-sm bg-linear-to-t from-accent/25 to-accent/70 transition-all duration-700"
            style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
          />
          {critical[h] > 0 && (
            <div
              className="absolute bottom-0 w-full rounded-sm bg-blood"
              style={{ height: `${Math.max(2, (critical[h] / max) * 100)}%` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl bg-white/3 px-3 py-2.5 ring-1 ring-inset ring-white/8 transition-colors duration-300 hover:bg-white/6">
      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-display text-2xl leading-none tabular-nums text-white">
        {value}
      </div>
    </div>
  );
}

export function BriefingView() {
  const { version, bumpVersion, logs: recent } = useHoneypot();
  const { items: notifications, push } = useNotifications();
  const { settings: ai, available, run, busy, cancel } = useAi();
  const { days } = useDays(version);
  const summaries = useSummaries(version);

  const [requested] = useState<DayKey | null>(
    () => peekSelection().day ?? null,
  );
  const [picked, setPicked] = useState<DayKey | null>(null);
  const [draft, setDraft] = useState<{
    day: DayKey;
    summary: DaySummary | null;
    base: Map<DayKey, DaySummary>;
  } | null>(null);
  const [pending, setPending] = useState<"saving" | "deleting" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => clearSelection, []);

  // The requested day (from a notification) wins while it exists, otherwise the newest day.
  const day =
    picked ??
    (requested && days.some((d) => d.day === requested)
      ? requested
      : (days[0]?.day ?? null));
  const setDay = setPicked;

  const { logs, loading } = useDayLogs(day, version);
  const analysis = useMemo(
    () => (logs.length ? analyzeDay(logs) : null),
    [logs],
  );
  // A confirmed local change bridges the server refetch without leaking across days.
  const summary = draft?.day === day && draft.base === summaries
    ? draft.summary
    : day ? summaries.get(day) : undefined;
  const dayIndex = days.findIndex((d) => d.day === day);
  const prev =
    dayIndex >= 0 && dayIndex < days.length - 1 ? days[dayIndex + 1].day : null;
  const next = dayIndex > 0 ? days[dayIndex - 1].day : null;

  const generate = async () => {
    if (!day || !analysis || pending) return;
    setError(null);
    setPending("saving");
    try {
      const out = await run("digest", { day });
      const stored: DaySummary = {
        day,
        source: "ai",
        text: out.text,
        logCount: out.totalEvents,
        createdAt: Date.now(),
        provider: out.provider,
        model: out.model,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
      };
      await getDataSource().saveSummary(stored);
      push({
        kind: "ai",
        severity: "info",
        title: `Briefing ready — ${formatDayLong(day)}`,
        body: out.text.replace(/[#*`-]/g, "").slice(0, 180),
        ref: { type: "day", day },
      });
      setDraft({ day, summary: stored, base: summaries });
      bumpVersion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
    } finally {
      setPending(null);
    }
  };

  const buildLocal = async () => {
    if (!day || !analysis || pending) return;
    setError(null);
    setPending("saving");
    try {
      const stored: DaySummary = {
        day,
        source: "local",
        text: localDigest(day, analysis, ai.language),
        logCount: analysis.total,
        createdAt: Date.now(),
      };
      await getDataSource().saveSummary(stored);
      setDraft({ day, summary: stored, base: summaries });
      bumpVersion();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local briefing could not be saved.");
    } finally { setPending(null); }
  };

  const removeSummary = async () => {
    if (!day || pending) return;
    setError(null);
    setPending("deleting");
    try {
      await getDataSource().deleteSummary(day);
      setDraft({ day, summary: null, base: summaries });
      bumpVersion();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The briefing could not be deleted.");
    } finally { setPending(null); }
  };

  const text = summary?.text ?? null;
  const source = summary?.source ?? null;
  const isAiText = source === "ai";

  return (
    <div className="secondary-workspace briefing-workspace pointer-events-none flex min-h-0 grow flex-col gap-3 overflow-y-auto p-3 pb-[6.5rem] max-md:pointer-events-auto sm:p-4 xl:grid xl:grid-cols-[220px_1fr] xl:overflow-hidden xl:pb-4">
      <div className="order-1 flex flex-col gap-3 xl:min-h-0 xl:overflow-y-auto">
        <Panel
          title="Days · UTC"
          icon={<Clock className="size-3.5" />}
          bodyClassName="p-2"
        >
          <DayRail days={days} value={day} onChange={(d) => setDay(d)} />
        </Panel>
        <div className="glass pointer-events-auto hidden rounded-lg p-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 xl:block">
          {days.length} days stored
        </div>
      </div>

      <div className="order-2 flex min-h-0 flex-col gap-3 xl:overflow-y-auto xl:pr-1">
        <Panel className="animate-rise" bodyClassName="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
                Daily briefing · UTC
              </div>
              <h1 className="mt-1 text-balance font-display text-2xl leading-tight tracking-[0.06em] text-white sm:text-3xl">
                {day ? formatDayLong(day) : "—"}
              </h1>
            </div>
            <div className="flex items-center gap-1.5">
              <IconButton
                label="Previous day"
                disabled={!prev}
                onClick={() => prev && setDay(prev)}
                icon={<ChevronLeft className="size-4" />}
              />
              <IconButton
                label="Next day"
                disabled={!next}
                onClick={() => next && setDay(next)}
                icon={<ChevronRight className="size-4" />}
              />
            </div>
          </div>

          {analysis && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi
                icon={<ShieldAlert className="size-3" />}
                label="Events"
                value={analysis.total}
              />
              <Kpi
                icon={<Brain className="size-3" />}
                label="Critical"
                value={analysis.bySeverity.critical}
              />
              <Kpi
                icon={<Globe2 className="size-3" />}
                label="Sources"
                value={analysis.uniqueIps}
              />
              <Kpi
                icon={<Clock className="size-3" />}
                label="Peak · UTC"
                value={`${String(analysis.peakHour).padStart(2, "0")}:00`}
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!analysis || !available || busy !== null || pending !== null}
              onClick={generate}
              title={available ? undefined : "Configure and enable DeepSeek in Settings"}
              icon={
                <Sparkles
                  className={`size-3.5 ${busy === "digest" ? "animate-pulse" : ""}`}
                />
              }
            >
              {busy === "digest"
                ? "Summarizing…"
                : summary
                  ? "Regenerate with AI"
                  : "Summarize with AI"}
            </Button>
            <Button
              disabled={!analysis || pending !== null || busy === "digest"}
              aria-busy={pending === "saving"}
              onClick={buildLocal}
              icon={<RefreshCw className="size-3.5" />}
            >
              {pending === "saving" ? "Saving briefing…" : "Local digest"}
            </Button>
            {busy === "digest" && <Button onClick={cancel}>Cancel analysis</Button>}
            {summary && (
              <IconButton
                variant="danger"
                label={pending === "deleting" ? "Deleting briefing…" : "Delete stored briefing"}
                disabled={pending !== null || busy === "digest"}
                icon={<Trash2 className="size-3.5" />}
                onClick={removeSummary}
              />
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-500">
            <span>{available ? `DeepSeek · ${ai.model} · evidence-linked analysis` : "DeepSeek is off or unconfigured. Local statistical digests remain available."}</span>
            {summary && (
              <span>
                stored{" "}
                {summary.source === "ai"
                  ? ai.enabled ? `via ${summary.provider}/${summary.model}` : "as a previous AI briefing"
                  : "from local statistics"}
              </span>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-blood">{error}</p>}

          <div className="mt-4 border-t border-white/8 pt-4">
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-3 animate-pulse rounded bg-white/6"
                    style={{ width: `${90 - i * 15}%` }}
                  />
                ))}
              </div>
            ) : text ? (
              <>
                <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  {isAiText ? (
                    <Sparkles className="size-3 text-accent" />
                  ) : (
                    <Brain className="size-3 text-accent" />
                  )}
                  {isAiText ? "AI briefing" : "Local briefing"}
                </div>
                <Markdown text={text} />
              </>
            ) : (
              <p className="text-xs text-zinc-500">
                No briefing for this day yet. Create a local digest from captured
                events, or enable DeepSeek for an evidence-linked AI briefing.
              </p>
            )}
          </div>
        </Panel>

        {analysis && (
          <div className="grid gap-3 xl:grid-cols-2">
            <Panel
              title="Hourly activity · UTC"
              icon={<Clock className="size-3.5" />}
              bodyClassName="p-4"
            >
              <Hourly
                hourly={analysis.hourly}
                critical={analysis.hourlyCritical}
              />
              <div className="mt-1 flex justify-between font-mono text-[9px] text-zinc-600">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
              <div className="mt-4 space-y-1.5">
                {sortedEntries(analysis.byService).map(([svc, n]) => (
                  <div key={svc} className="flex items-center gap-2 text-xs">
                    <ServiceIcon
                      id={svc as never}
                      className="size-3.5 text-zinc-500"
                    />
                    <span className="w-16 text-zinc-300">
                      {svc.toUpperCase()}
                    </span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/6">
                      <span
                        className="block h-full rounded-full bg-accent/70"
                        style={{
                          width: `${(n / Math.max(...Object.values(analysis.byService))) * 100}%`,
                        }}
                      />
                    </span>
                    <span className="w-10 text-right font-mono text-[10px] tabular-nums text-zinc-500">
                      {n}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel
              title="Top sources"
              icon={<Globe2 className="size-3.5" />}
              bodyClassName="p-4"
            >
              <ul className="space-y-2">
                {analysis.topSources.slice(0, 8).map((s) => (
                  <li key={s.ip} className="flex items-center gap-3">
                    <SeverityBadge severity={s.maxSeverity} />
                    <span className="font-mono text-xs text-zinc-200">
                      {s.ip}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {s.country}
                    </span>
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-zinc-400">
                      {s.count}
                    </span>
                  </li>
                ))}
                {!analysis.topSources.length && (
                  <li className="text-xs text-zinc-600">No sources.</li>
                )}
              </ul>
              {analysis.topUsers.length > 0 && (
                <div className="mt-4 border-t border-white/8 pt-3">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                    <Users className="size-3" /> Usernames tried
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {analysis.topUsers.map(([user, n]) => (
                      <span
                        key={user}
                        className="rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-zinc-300"
                      >
                        {user} <span className="text-zinc-500">×{n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            <Panel
              title="Notable events"
              icon={<ShieldAlert className="size-3.5" />}
              className="xl:col-span-2"
              bodyClassName="divide-y divide-white/5"
            >
              {analysis.notable.slice(0, 12).map((n, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                  <SeverityBadge severity={n.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs">
                      <ServiceIcon
                        id={n.service as never}
                        className="size-3.5 text-zinc-500"
                      />
                      <span className="text-zinc-300">
                        {n.service.toUpperCase()}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {n.type}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-zinc-500">
                        ×{n.count}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-zinc-200">
                      {n.payload ?? n.message}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                      {n.sources.join(", ")}
                    </p>
                  </div>
                </div>
              ))}
              {!analysis.notable.length && (
                <p className="px-4 py-6 text-center text-xs text-zinc-600">
                  Nothing high-severity on this day.
                </p>
              )}
            </Panel>
          </div>
        )}

        <div className="glass pointer-events-auto rounded-lg p-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 xl:hidden">
          {days.length} days stored · {notifications.length} notifications ·{" "}
          {recent.length} events in memory
        </div>
      </div>
    </div>
  );
}
