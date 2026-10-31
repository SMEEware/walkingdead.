"use client";

import {
  Check,
  Copy,
  Database,
  Download,
  Filter,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { eventsCsv } from "../../lib/evidence-export";
import {
  dayKey,
  formatDayLong,
  timeAgo,
  type DayKey,
} from "../../lib/data/day";
import { useDayLogs, useDays } from "../../lib/data/hooks";
import { clearSelection, peekSelection } from "../../lib/selection";
import { formatTime } from "../../lib/ui";
import { useNow } from "../../lib/useNow";
import { SERVICE_IDS, type EventType, type LogEvent, type ServiceId, type Severity } from "../../lib/types";
import { useAi } from "../../providers/AiProvider";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { Button, IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Markdown } from "../ui/Markdown";
import { Panel } from "../ui/Panel";
import { ServiceIcon } from "../ui/ServiceIcon";
import { SeverityBadge } from "../ui/SeverityBadge";
import { Sheet } from "../ui/Sheet";
import { DayRail } from "../briefing/DayRail";
import { Segmented } from "../ui/Segmented";
import { SessionExplorer } from "./SessionExplorer";

const PAGE = 60;
const SEVERITIES: Severity[] = ["info", "low", "medium", "high", "critical"];
const TYPES: EventType[] = [
  "connection",
  "scan",
  "auth_fail",
  "auth_success",
  "command",
  "exploit",
  "tunnel",
];

const selectClass =
  "cursor-pointer rounded-lg border border-white/8 bg-white/4 px-2.5 py-1.5 text-xs text-zinc-300 outline-none transition-colors hover:border-white/15 focus-visible:border-accent/50";

export function LogsExplorer() {
  const { version, clearLogs, blocked } = useHoneypot();
  const { days } = useDays(version);
  const { settings: ai, available, run, busy, cancel } = useAi();

  const [requestedDay] = useState<DayKey | null>(
    () => peekSelection().day ?? null,
  );
  const [requestedFocus] = useState<string | null>(
    () => peekSelection().focusId ?? null,
  );
  const [picked, setPicked] = useState<DayKey | null>(null);
  const [view, setView] = useState<"events" | "sessions">("events");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [service, setService] = useState<ServiceId | "all">("all");
  const [type, setType] = useState<EventType | "all">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pickedFocus, setPickedFocus] = useState<string | null>(null);
  const focusRef = useRef<HTMLLIElement>(null);
  const now = useNow(30_000);

  useEffect(() => clearSelection, []);

  const today = dayKey(now);
  const day =
    picked ??
    (requestedDay && days.some((d) => d.day === requestedDay)
      ? requestedDay
      : (days[0]?.day ?? today));
  const setDay = setPicked;
  // "" means the user closed the sheet, so the deep-linked event does not reopen.
  const focusId = pickedFocus === null ? requestedFocus : pickedFocus || null;

  const { logs, loading } = useDayLogs(day, version);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter(
      (l) =>
        (severity === "all" || l.severity === severity) &&
        (service === "all" || l.service === service) &&
        (type === "all" || l.type === type) &&
        (!q ||
          `${l.srcIp} ${l.message} ${l.user ?? ""} ${l.payload ?? ""} ${l.country} ${l.sessionId ?? ""} ${l.method ?? ""} ${l.path ?? ""} ${l.command ?? ""} ${l.userAgent ?? ""} ${(l.tags ?? []).join(" ")} ${(l.iocs ?? []).join(" ")}`
            .toLowerCase()
            .includes(q)),
    );
  }, [logs, query, severity, service, type]);

  const rows = filtered.slice(0, limit);
  const selected = focusId
    ? (logs.find((l) => l.id === focusId) ?? null)
    : null;
  const activeFilters =
    [severity, service, type].filter((v) => v !== "all").length +
    (query ? 1 : 0);

  useEffect(() => {
    if (focusId && focusRef.current)
      focusRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId, rows.length]);

  const reset = () => {
    setSeverity("all");
    setService("all");
    setType("all");
    setQuery("");
    setLimit(PAGE);
  };

  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([eventsCsv(filtered)], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `walking-dead-${day ?? "logs"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filterControls = (
    <>
      <label className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Search IP, user, payload…"
          aria-label="Search log events"
          className="w-full rounded-lg border border-white/8 bg-white/4 py-1.5 pl-8 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus-visible:border-accent/50"
        />
      </label>
      <select
        aria-label="Severity"
        value={severity}
        onChange={(e) => setSeverity(e.target.value as Severity | "all")}
        className={selectClass}
      >
        <option value="all">All severities</option>
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        aria-label="Service"
        value={service}
        onChange={(e) => setService(e.target.value as ServiceId | "all")}
        className={selectClass}
      >
        <option value="all">All services</option>
        {(
          SERVICE_IDS
        ).map((s) => (
          <option key={s} value={s}>
            {s.toUpperCase()}
          </option>
        ))}
      </select>
      <select
        aria-label="Event type"
        value={type}
        onChange={(e) => setType(e.target.value as EventType | "all")}
        className={selectClass}
      >
        <option value="all">All types</option>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {activeFilters > 0 && (
        <button
          type="button"
          onClick={reset}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/4 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-300 ring-1 ring-white/8 transition-colors hover:text-accent"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}
    </>
  );

  return (
    <div className="secondary-workspace pointer-events-none flex min-h-0 grow flex-col gap-3 overflow-y-auto p-3 pb-[6.5rem] max-md:pointer-events-auto sm:p-4 xl:grid xl:grid-cols-[220px_1fr] xl:overflow-hidden xl:pb-4">
      <div className="order-1 flex flex-col gap-3 xl:min-h-0 xl:overflow-y-auto">
        <Segmented value={view} onChange={setView} options={[{ value: "events", label: "Events" }, { value: "sessions", label: "Sessions" }]} />
        <Panel
          title="Days · UTC"
          icon={<Database className="size-3.5" />}
          bodyClassName="p-2"
        >
          <DayRail
            days={days}
            value={day}
            onChange={(d) => {
              setDay(d);
              setLimit(PAGE);
              setPickedFocus("");
            }}
          />
        </Panel>
      </div>

      <div className="order-2 flex min-h-0 flex-col gap-3 xl:overflow-hidden">
        {view === "sessions" ? <SessionExplorer day={day} version={version} selected={sessionId} onSelect={setSessionId} /> :
        <Panel
          className="min-h-[70vh] animate-rise xl:min-h-0"
          bodyClassName="flex min-h-0 flex-col"
          title={day ? `${formatDayLong(day)} · UTC` : "Logs · UTC"}
          icon={<Database className="size-3.5" />}
          action={
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="md:hidden"
                aria-label="Filters"
                icon={<Filter className="size-3.5" />}
                onClick={() => setFiltersOpen(true)}
              >
                {activeFilters > 0 && (
                  <span className="text-accent">{activeFilters}</span>
                )}
              </Button>
              <Button
                size="sm"
                disabled={!filtered.length}
                aria-label="Export events as CSV"
                icon={<Download className="size-3.5" />}
                onClick={exportCsv}
              >
                <span className="hidden sm:inline">CSV</span>
              </Button>
              <IconButton
                size="sm"
                variant="danger"
                label="Delete all stored events"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => {
                  if (window.confirm("Delete all stored log events?"))
                    clearLogs();
                }}
              />
            </div>
          }
        >
          <div className="hidden flex-wrap items-center gap-2 border-b border-white/8 px-4 py-3 md:flex">
            {filterControls}
          </div>

          <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
            {rows.map((l) => (
              <li
                key={l.id}
                ref={l.id === focusId ? focusRef : undefined}
                className={`transition-colors duration-500 ${l.id === focusId ? "bg-accent/10" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setPickedFocus(l.id)}
                  className="flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left transition-colors duration-200 hover:bg-white/5"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                      {formatTime(l.ts)}
                    </span>
                    <SeverityBadge severity={l.severity} />
                    <span className="flex items-center gap-1 font-mono text-[10px] uppercase text-zinc-400">
                      <ServiceIcon id={l.service} className="size-3" />
                      {l.service}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {l.type}
                    </span>
                    {blocked.has(l.id) && (
                      <span className="rounded bg-blood/15 px-1.5 font-mono text-[9px] uppercase text-blood">
                        blocked
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[13px] text-zinc-200">
                    {l.message}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
                    <span>{l.srcIp}</span>
                    <span>·</span>
                    <span>{l.country}</span>
                    {l.user && (
                      <>
                        <span>·</span>
                        <span>{l.user}</span>
                      </>
                    )}
                    {l.command && (
                      <span className="truncate text-accent/80">$ {l.command}</span>
                    )}
                    {!l.command && l.payload && (
                      <span className="truncate">· {l.payload}</span>
                    )}
                  </span>
                  {!!l.tags?.length && (
                    <span className="flex flex-wrap gap-1">
                      {l.tags.slice(0, 4).map((t) => <span key={t} className="tag-chip">{t}</span>)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {!rows.length && (
            <EmptyState
              className="flex-1"
              icon={
                loading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Filter className="size-5" />
                )
              }
              title={loading ? "Loading events…" : "No events match"}
              hint={
                loading
                  ? undefined
                  : "Relax the filters above or pick another day."
              }
            />
          )}

          <div className="flex items-center justify-between gap-3 border-t border-white/8 px-4 py-2.5 font-mono text-[11px] text-zinc-500">
            <span>
              {rows.length} of {filtered.length} · {logs.length} stored
            </span>
            {rows.length < filtered.length && (
              <Button size="xs" onClick={() => setLimit((l) => l + PAGE)}>
                Load more
              </Button>
            )}
          </div>
        </Panel>}
      </div>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        icon={<Filter className="size-3.5" />}
      >
        <div className="flex flex-col gap-2">{filterControls}</div>
      </Sheet>

      <EventSheet
        key={focusId ?? "none"}
        event={selected}
        onInvestigate={(id) => { setPickedFocus(""); setView("sessions"); setSessionId(id); }}
        onClose={() => { if (busy === "explain") cancel(); setPickedFocus(""); }}
        now={now}
        aiEnabled={available}
        model={ai.model}
        cancelAi={cancel}
        runAi={async (event) => {
          const out = await run("explain", { eventId: event.id });
          return out.text;
        }}
        busy={busy === "explain"}
      />
    </div>
  );
}

function EventSheet({
  event,
  onInvestigate,
  onClose,
  model,
  cancelAi,
  runAi,
  aiEnabled,
  busy,
  now,
}: {
  event: LogEvent | null;
  onInvestigate: (id: string) => void;
  onClose: () => void;
  model: string;
  cancelAi: () => void;
  runAi: (event: LogEvent) => Promise<string>;
  aiEnabled: boolean;
  busy: boolean;
  now: number;
}) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const active = useRef(true);
  const requesting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; if (requesting.current) cancelAi(); };
  }, [cancelAi]);

  if (!event) return null;

  const fields: [string, string | undefined][] = [
    ["ID", event.id],
    ["Timestamp", new Date(event.ts).toISOString()],
    ["Service", event.service.toUpperCase()],
    ["Type", event.type],
    ["Source", `${event.srcIp} · ${event.country}`],
    ["User", event.user],
    ["Password", event.password],
    ["User agent", event.userAgent],
    ["MITRE ATT&CK", event.tactics?.join(", ")],
    ["Session", event.sessionId],
    ["Sensor", event.sensorId],
    ["Method", event.method],
    ["Path", event.path],
    ["Age", now ? timeAgo(event.ts, now) : undefined],
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      title="Event detail"
      size="lg"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {event.sessionId && <Button size="sm" onClick={() => onInvestigate(event.sessionId!)}>Inspect session</Button>}
          <Button
            size="sm"
            aria-label="Copy event as JSON"
            onClick={async () => {
              await navigator.clipboard.writeText(
                JSON.stringify(event, null, 2),
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            icon={
              copied ? (
                <Check className="size-3.5 text-accent" />
              ) : (
                <Copy className="size-3.5" />
              )
            }
          >
            JSON
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={event.severity} />
          <span className="text-sm font-medium text-zinc-100">
            {event.message}
          </span>
        </div>

        <dl className="space-y-1.5 font-mono text-[11px]">
          {fields
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between gap-4 border-b border-white/5 pb-1.5"
              >
                <dt className="text-zinc-500">{k}</dt>
                <dd className="truncate text-zinc-200">{v}</dd>
              </div>
            ))}
        </dl>

        {!!event.tags?.length && (
          <div className="flex flex-wrap gap-1.5">
            {event.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
          </div>
        )}

        {event.command && (
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Command
            </div>
            <pre className="terminal-block">$ {event.command}</pre>
          </div>
        )}

        {!!event.iocs?.length && (
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Indicators of compromise
            </div>
            <ul className="space-y-1 font-mono text-[11px] text-orange-300">
              {event.iocs.map((i) => <li key={i} className="break-all">{i}</li>)}
            </ul>
          </div>
        )}

        {event.payload && (
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Payload
            </div>
            <pre className="overflow-x-auto rounded-lg border border-white/8 bg-black/50 p-3 font-mono text-[11px] text-accent/90">
              {event.payload}
            </pre>
          </div>
        )}

        <div className="relative overflow-hidden rounded-xl bg-white/3 p-3.5 ring-1 ring-inset ring-white/8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <Sparkles className="size-3.5 text-accent" />
              <span className="font-medium">AI explanation</span>
              {aiEnabled && <span className="font-mono text-[10px] text-zinc-500">
                {model}
              </span>}
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={!aiEnabled || busy}
              title={aiEnabled ? undefined : "Configure and enable DeepSeek in Settings"}
              onClick={async () => {
                setError(null);
                requesting.current = true;
                try {
                  const text = await runAi(event);
                  if (active.current) setExplanation(text);
                } catch (e) {
                  if (active.current) setError(e instanceof Error ? e.message : "The request failed.");
                } finally { requesting.current = false; }
              }}
            >
              {busy ? "Thinking…" : "Explain"}
            </Button>
          </div>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">
            {aiEnabled ? "Read-only interpretation linked to captured event IDs. Model judgments are not verified facts." : "DeepSeek is off or unconfigured. Enable it in Settings after server setup."}
          </p>
          {busy && <Button size="xs" onClick={cancelAi}>Cancel analysis</Button>}
          {error && <p className="mt-2 text-xs text-blood">{error}</p>}
          {explanation && (
            <div className="mt-3 border-t border-white/8 pt-3">
              <Markdown text={explanation} />
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
