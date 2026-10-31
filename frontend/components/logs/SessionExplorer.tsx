"use client";

import { Download, Loader2, Network, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { eventsCsv } from "../../lib/evidence-export";
import type { LogEvent, Severity } from "../../lib/types";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Panel } from "../ui/Panel";
import { SeverityBadge } from "../ui/SeverityBadge";
import { Sheet } from "../ui/Sheet";

interface Session {
  id: string; srcIp: string; service: string; sensorId: string;
  startedAt: number; lastSeenAt: number; eventCount: number; severity: Severity;
}
interface Detail { session: Session; events: LogEvent[]; retainedOnly: boolean }
const timestamp = (value: number) => new Date(value).toISOString().replace("T", " ").replace("Z", " UTC");

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SessionExplorer({ day, version, selected, onSelect }: {
  day: string; version: number; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "day">("all");
  const [limit, setLimit] = useState(60);
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
  if (scope === "day") params.set("day", day);
  const key = params.toString();
  const [state, setState] = useState<{ key: string; items: Session[]; error?: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiRequest<Session[]>(`/sessions?${key}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
        .then((items) => { if (!controller.signal.aborted) setState({ key, items }); })
        .catch((cause) => { if (!controller.signal.aborted) setState({ key, items: [], error: cause instanceof Error ? cause.message : "Sessions could not be loaded." }); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, version]);

  const ready = state?.key === key;
  const items = ready ? state.items : [];
  return <>
    <Panel title="Session investigation" icon={<Network className="size-3.5" />} className="min-h-0" bodyClassName="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/8 p-4">
        <label className="relative min-w-40 flex-1">
          <Search className="absolute left-3 top-2.5 size-3.5 text-zinc-500" />
          <input aria-label="Search sessions" placeholder="Source IP, session, path or method…" maxLength={256} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(60); }} className="w-full rounded-lg border border-white/8 bg-white/4 py-2 pl-9 pr-3 text-xs outline-none focus-visible:border-accent/50" />
        </label>
        <select aria-label="Session time range" value={scope} onChange={(event) => { setScope(event.target.value as "all" | "day"); setLimit(60); }} className="rounded-lg border border-white/8 bg-black px-3 py-2 text-xs text-zinc-300">
          <option value="all">All retained days</option><option value="day">{day} · UTC</option>
        </select>
      </div>
      <p className="border-b border-white/8 px-4 py-3 text-xs leading-relaxed text-zinc-500">Each session represents one captured connection. Times and counts cover retained evidence; they do not indicate whether a connection is still open.</p>
      {ready && state.error ? <p role="alert" className="p-4 text-sm text-blood">{state.error}</p> : !items.length ? <EmptyState icon={ready ? <Network className="size-5" /> : <Loader2 className="size-5 animate-spin" />} title={ready ? "No matching sessions" : "Loading sessions…"} hint={ready ? "Start the decoys and send traffic, or adjust your search." : undefined} /> : <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
        {items.map((session) => <li key={session.id}><button type="button" aria-label={`Inspect session ${session.id}`} onClick={() => onSelect(session.id)} className="group flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none">
          <span className="min-w-0"><span className="flex items-center gap-2"><SeverityBadge severity={session.severity} /><span className="text-sm text-zinc-200">{session.srcIp}</span><span className="font-mono text-[10px] uppercase text-zinc-500">{session.service}</span></span><span className="mt-2 block truncate font-mono text-[10px] text-zinc-600">{session.id}</span></span>
          <span className="text-right"><span className="block text-sm tabular-nums text-zinc-200">{session.eventCount} events</span><span className="mt-1 block font-mono text-[10px] text-zinc-500">Last seen {timestamp(session.lastSeenAt)}</span></span>
        </button></li>)}
      </ul>}
      {items.length > 0 && <div className="flex items-center justify-between border-t border-white/8 px-4 py-3 text-xs text-zinc-500"><span>{items.length} sessions shown</span>{items.length === limit && limit < 10000 && <Button size="xs" onClick={() => setLimit((value) => Math.min(value + 60, 10000))}>Load more</Button>}</div>}
    </Panel>
    {selected && <SessionTimeline key={selected} id={selected} version={version} onClose={() => onSelect(null)} />}
  </>;
}

function SessionTimeline({ id, version, onClose }: { id: string; version: number; onClose: () => void }) {
  const [state, setState] = useState<{ detail?: Detail; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Detail>(`/sessions/${encodeURIComponent(id)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then((detail) => { if (!controller.signal.aborted) setState({ detail }); })
      .catch((cause) => { if (!controller.signal.aborted) setState({ error: cause instanceof Error ? cause.message : "Session could not be loaded." }); });
    return () => controller.abort();
  }, [id, version]);
  const detail = state.detail;
  return <Sheet open onClose={onClose} title="Session timeline" description={id} size="lg" icon={<Network className="size-4" />} footer={detail && <div className="flex gap-2"><Button size="sm" icon={<Download className="size-3.5" />} onClick={() => download(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...detail }, null, 2), `walkingdead-session-${id}.json`, "application/json")}>Evidence JSON</Button><Button size="sm" onClick={() => download(eventsCsv(detail.events), `walkingdead-session-${id}.csv`, "text/csv")}>CSV</Button></div>}>
    {state.error ? <p role="alert" className="text-sm text-blood">{state.error}</p> : !detail ? <p role="status" className="text-sm text-zinc-500">Loading retained evidence…</p> : <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/8 bg-white/3 p-4 text-xs"><div><p className="text-zinc-500">Source</p><p className="mt-1 break-all text-zinc-200">{detail.session.srcIp}</p></div><div><p className="text-zinc-500">Sensor / service</p><p className="mt-1 text-zinc-200">{detail.session.sensorId} / {detail.session.service.toUpperCase()}</p></div><div><p className="text-zinc-500">First observed</p><p className="mt-1 text-zinc-200">{timestamp(detail.session.startedAt)}</p></div><div><p className="text-zinc-500">Last observed</p><p className="mt-1 text-zinc-200">{timestamp(detail.session.lastSeenAt)}</p></div></div>
      <p className="text-xs leading-relaxed text-zinc-500">{detail.events.length} retained events, oldest first. Retention may have removed earlier observations. Captured paths and payloads are untrusted input.</p>
      <ol className="space-y-3">{detail.events.map((event, index) => <li key={event.id} className="rounded-xl border border-white/8 bg-black/30 p-4"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-zinc-600">{String(index + 1).padStart(2, "0")}</span><SeverityBadge severity={event.severity} /><time className="font-mono text-[10px] text-zinc-500">{timestamp(event.ts)}</time></div><p className="mt-2 break-words text-sm text-zinc-200">{event.method} {event.path || event.message}</p><p className="mt-2 break-all font-mono text-[10px] text-zinc-600">{event.type} · {event.id}</p>{event.payload && <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/3 p-3 font-mono text-[11px] text-zinc-400">{event.payload}</pre>}</li>)}</ol>
    </div>}
  </Sheet>;
}
