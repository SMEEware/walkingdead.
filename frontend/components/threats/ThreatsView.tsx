"use client";

import {
  Ban,
  Check,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  Fingerprint,
  KeyRound,
  ListX,
  Radar,
  ShieldAlert,
  Skull,
  TerminalSquare,
  Users,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import { timeAgo } from "../../lib/data/day";
import {
  downloadBlocklist,
  tagLabel,
  threatsApi,
  useThreatData,
  type Attacker,
  type BlocklistFormat,
  type Counted,
} from "../../lib/threats";
import { formatDateTime, formatTime } from "../../lib/ui";
import { useNow } from "../../lib/useNow";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Panel } from "../ui/Panel";
import { Segmented } from "../ui/Segmented";
import { ServiceIcon } from "../ui/ServiceIcon";
import { SeverityBadge } from "../ui/SeverityBadge";
import { Sheet } from "../ui/Sheet";

type Tab = "attackers" | "credentials" | "tactics" | "blocklist";

const TABS = [
  { value: "attackers" as const, label: "Attackers", icon: <Users className="size-3.5" /> },
  { value: "credentials" as const, label: "Credentials", icon: <KeyRound className="size-3.5" /> },
  { value: "tactics" as const, label: "Tactics & IOCs", icon: <Crosshair className="size-3.5" /> },
  { value: "blocklist" as const, label: "Blocklist", icon: <ListX className="size-3.5" /> },
];

export function ThreatsView() {
  const { version } = useHoneypot();
  const [tab, setTab] = useState<Tab>("attackers");
  const intel = useThreatData(threatsApi.intel, version);
  const i = intel.data;
  const credentialCount = i?.usernames.reduce((sum, u) => sum + u.count, 0) ?? 0;

  return (
    <div className="secondary-workspace threats-workspace pointer-events-auto flex min-h-0 grow flex-col gap-4 overflow-y-auto p-3 pb-[6.5rem] sm:p-4 xl:pb-6">
      <header className="threats-heading">
        <div>
          <p className="eyebrow">Threat intelligence</p>
          <h1 className="font-display">Who is knocking<span className="text-accent">.</span></h1>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-zinc-500">
          Every source is profiled from its decoy activity, scored, classified against MITRE ATT&CK and ready to block.
        </p>
      </header>

      <div className="kpi-row">
        <Kpi icon={<Users className="size-4" />} label="Attackers" value={i?.attackers} />
        <Kpi icon={<Skull className="size-4" />} label="Shell sessions" value={i?.compromised} tone="alert" />
        <Kpi icon={<KeyRound className="size-4" />} label="Credentials tried" value={credentialCount} />
        <Kpi icon={<Crosshair className="size-4" />} label="Techniques" value={i?.tactics.length} />
        <Kpi icon={<Ban className="size-4" />} label="Blocked" value={i?.blocked} />
      </div>

      <Segmented options={TABS} value={tab} onChange={setTab} compact className="glass p-1.5" />
      {intel.error && <p role="alert" className="text-xs text-blood">{intel.error}</p>}

      <div className="min-h-0">
        {tab === "attackers" && <AttackersTab version={version} />}
        {tab === "credentials" && i && <CredentialsTab intel={i} />}
        {tab === "tactics" && i && <TacticsTab intel={i} />}
        {tab === "blocklist" && <BlocklistTab version={version} />}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: ReactNode; label: string; value?: number; tone?: "alert" }) {
  return (
    <div className={`kpi-card ${tone === "alert" && value ? "is-alert" : ""}`}>
      <span className="kpi-icon">{icon}</span>
      <span className="kpi-value tabular-nums">{value ?? "–"}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const tone = score >= 70 ? "bg-blood" : score >= 40 ? "bg-orange-400" : score >= 15 ? "bg-ember" : "bg-zinc-500";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1 w-16 overflow-hidden rounded-full bg-white/6">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
      <span className="w-6 text-right font-mono text-[11px] tabular-nums text-zinc-300">{score}</span>
    </span>
  );
}

function AttackersTab({ version }: { version: number }) {
  const { data, error } = useThreatData(threatsApi.attackers, version);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow();
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((a) => !q || `${a.ip} ${a.services.join(" ")} ${a.tags.join(" ")}`.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <Panel
      title="Attacker profiles"
      subtitle="Ranked by threat score: severity, breadth across services and attack techniques"
      icon={<Radar className="size-3.5" />}
      action={<input className="field-input w-48" placeholder="Filter IP, service, tag…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter attackers" />}
      bodyClassName="p-2"
    >
      {error && <p className="px-3 text-xs text-blood">{error}</p>}
      {!rows.length ? (
        <EmptyState icon={<Radar className="size-5" />} title={data ? "No attackers yet" : "Loading profiles…"} hint="Start the decoys and expose them to the internet. Every source that touches a decoy gets a profile here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Source</th><th>Score</th><th className="col-sm">Severity</th><th className="col-lg">Services</th><th className="col-lg">Techniques</th><th className="col-sm text-right">Events</th><th className="text-right">Last seen</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.ip} onClick={() => setSelected(a.ip)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(a.ip)}>
                  <td>
                    <span className="flex items-center gap-2 font-mono text-[12px] text-zinc-100">
                      {a.ip}
                      {a.compromised && <span className="pill pill-alert col-sm-inline" title="Entered an emulated shell">shell</span>}
                      {a.blocked && <span className="pill col-sm-inline">blocked</span>}
                    </span>
                  </td>
                  <td><ScoreBar score={a.score} /></td>
                  <td className="col-sm"><SeverityBadge severity={a.severity} /></td>
                  <td className="col-lg"><span className="flex gap-1.5 text-zinc-400">{a.services.map((s) => <span key={s} title={s.toUpperCase()}><ServiceIcon id={s} className="size-3.5" /></span>)}</span></td>
                  <td className="col-lg"><span className="flex max-w-xs flex-wrap gap-1">{a.tags.filter((t) => t !== "no-user-agent").slice(0, 3).map((t) => <span key={t} className="tag-chip">{tagLabel(t)}</span>)}{a.tags.length > 3 && <span className="tag-chip">+{a.tags.length - 3}</span>}</span></td>
                  <td className="col-sm text-right font-mono text-[11px] tabular-nums text-zinc-300">{a.events}</td>
                  <td className="text-right font-mono text-[11px] text-zinc-500">{now ? timeAgo(a.lastSeen, now) : formatTime(a.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <AttackerSheet ip={selected} version={version} onClose={() => setSelected(null)} />}
    </Panel>
  );
}

function AttackerSheet({ ip, version, onClose }: { ip: string; version: number; onClose: () => void }) {
  const { data } = useThreatData(() => threatsApi.attacker(ip), version, [ip]);
  const { bumpVersion } = useHoneypot();
  const [busy, setBusy] = useState(false);
  const a = data?.attacker;
  const events = useMemo(() => [...(data?.events ?? [])].reverse(), [data]);
  const commands = events.filter((e) => e.command);
  const creds = events.filter((e) => e.type === "auth_fail" || (e.service === "http" && e.password));
  const toggleBlock = async (attacker: Attacker) => {
    setBusy(true);
    try {
      if (attacker.blocked) await threatsApi.unblock(attacker.ip);
      else await threatsApi.block(attacker.ip, `Manual: score ${attacker.score}, ${attacker.tags.slice(0, 3).join(", ") || attacker.severity}`);
      bumpVersion();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={ip}
      description={a ? `First seen ${formatDateTime(a.firstSeen)} · last seen ${formatDateTime(a.lastSeen)}` : "Loading profile…"}
      icon={<Fingerprint className="size-4" />}
      size="xl"
      footer={a && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={a.blocked ? "soft" : "danger"} disabled={busy} icon={<Ban className="size-3.5" />} onClick={() => void toggleBlock(a)}>
            {a.blocked ? "Remove from blocklist" : "Add to blocklist"}
          </Button>
          <a className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/4 px-2.5 text-[11px] font-medium text-zinc-300 ring-1 ring-inset ring-white/8 hover:bg-white/8" href={`https://www.abuseipdb.com/check/${encodeURIComponent(ip)}`} target="_blank" rel="noreferrer noopener">
            AbuseIPDB <ExternalLink className="size-3" />
          </a>
          <a className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/4 px-2.5 text-[11px] font-medium text-zinc-300 ring-1 ring-inset ring-white/8 hover:bg-white/8" href={`https://www.shodan.io/host/${encodeURIComponent(ip)}`} target="_blank" rel="noreferrer noopener">
            Shodan <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    >
      {!a ? <p className="text-xs text-zinc-500">Loading…</p> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Threat score" value={`${a.score}/100`} />
            <Stat label="Events" value={a.events} />
            <Stat label="Sessions" value={a.sessions} />
            <Stat label="Credentials" value={a.credentials} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={a.severity} />
            {a.compromised && <span className="pill pill-alert">entered emulated shell</span>}
            {a.tags.map((t) => <span key={t} className="tag-chip">{tagLabel(t)}</span>)}
            {a.tactics.map((t) => <a key={t} className="tag-chip tag-mitre" href={mitreUrl(t)} target="_blank" rel="noreferrer noopener">{t}</a>)}
          </div>

          {!!commands.length && (
            <section>
              <SectionLabel icon={<TerminalSquare className="size-3.5" />}>Session replay</SectionLabel>
              <pre className="terminal-block max-h-72 overflow-y-auto">
                {commands.map((e) => `[${formatTime(e.ts)}] ${e.service}:${e.user || "?"}$ ${e.command}`).join("\n")}
              </pre>
            </section>
          )}

          {!!creds.length && (
            <section>
              <SectionLabel icon={<KeyRound className="size-3.5" />}>Credentials tried</SectionLabel>
              <ul className="grid gap-1 sm:grid-cols-2">
                {creds.slice(-40).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 rounded-md bg-white/3 px-2.5 py-1.5 font-mono text-[11px]">
                    <span className="truncate text-zinc-200">{e.user || "∅"} <span className="text-zinc-600">/</span> <span className="text-ember">{e.password || "∅"}</span></span>
                    <span className="shrink-0 text-[10px] uppercase text-zinc-500">{e.service}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <SectionLabel icon={<ShieldAlert className="size-3.5" />}>Timeline</SectionLabel>
            <ol className="timeline">
              {[...events].reverse().slice(0, 120).map((e) => (
                <li key={e.id} className={`timeline-item sev-${e.severity}`}>
                  <span className="font-mono text-[10px] text-zinc-500">{formatTime(e.ts)}</span>
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase text-zinc-400"><ServiceIcon id={e.service} className="size-3" />{e.service}</span>
                  <span className="min-w-0 truncate text-[12px] text-zinc-200">{e.message}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-white/3 px-3 py-2.5 ring-1 ring-inset ring-white/6">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-base text-zinc-100">{value}</div>
    </div>
  );
}

function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">{icon}{children}</div>;
}

const mitreUrl = (id: string) => `https://attack.mitre.org/techniques/${id.replace(".", "/")}/`;

function BarList({ items, empty, mono = true, accent = "bg-accent/60" }: { items: Counted[]; empty: string; mono?: boolean; accent?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.length) return <p className="px-2 py-6 text-center text-xs text-zinc-500">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.value} className="bar-row">
          <span className="bar-fill" style={{ width: `${(i.count / max) * 100}%` }}><span className={`block h-full ${accent}`} /></span>
          <span className={`relative min-w-0 flex-1 truncate ${mono ? "font-mono" : ""} text-[11px] text-zinc-200`} title={i.value}>{i.value === "" ? "∅ (empty)" : i.value}</span>
          <span className="relative font-mono text-[11px] tabular-nums text-zinc-400">{i.count}</span>
        </li>
      ))}
    </ul>
  );
}

function CredentialsTab({ intel }: { intel: NonNullable<ReturnType<typeof useThreatData<import("../../lib/threats").Intel>>["data"]> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Top usernames" icon={<Users className="size-3.5" />} bodyClassName="p-3"><BarList items={intel.usernames} empty="No usernames captured yet." /></Panel>
      <Panel title="Top passwords" icon={<KeyRound className="size-3.5" />} bodyClassName="p-3"><BarList items={intel.passwords} empty="No passwords captured yet." accent="bg-ember/60" /></Panel>
      <Panel title="Top combinations" icon={<Fingerprint className="size-3.5" />} bodyClassName="p-3">
        <BarList items={intel.pairs.map((p) => ({ value: `${p.user || "∅"} : ${p.password || "∅"}`, count: p.count }))} empty="No credential pairs captured yet." accent="bg-blood/50" />
      </Panel>
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div>
      <div className="heatmap">
        {grid.map((row, d) => (
          <div key={d} className="heatmap-row">
            <span className="heatmap-day">{DAYS[d]}</span>
            {row.map((v, h) => (
              <span key={h} className="heatmap-cell" title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 UTC · ${v} events`} style={{ opacity: v ? 0.18 + 0.82 * (v / max) : 0.06 }} />
            ))}
          </div>
        ))}
        <div className="heatmap-row heatmap-hours"><span className="heatmap-day" />{Array.from({ length: 24 }, (_, h) => <span key={h} className="heatmap-hour">{h % 6 === 0 ? h : ""}</span>)}</div>
      </div>
    </div>
  );
}

function TacticsTab({ intel }: { intel: Parameters<typeof CredentialsTab>[0]["intel"] }) {
  const [copied, setCopied] = useState(false);
  const iocText = intel.iocs.map((i) => i.value).join("\n");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="MITRE ATT&CK techniques" icon={<Crosshair className="size-3.5" />} bodyClassName="p-3">
        {!intel.tactics.length ? <p className="py-6 text-center text-xs text-zinc-500">No techniques observed yet.</p> : (
          <ul className="space-y-1">
            {intel.tactics.map((t) => (
              <li key={t.id}>
                <a href={mitreUrl(t.id)} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/4">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-accent">{t.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{t.name || "Unmapped"}</span>
                  <span className="font-mono text-[11px] tabular-nums text-zinc-400">{t.count}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Attack classes" icon={<ShieldAlert className="size-3.5" />} bodyClassName="p-3">
        <BarList items={intel.tags.map((t) => ({ value: tagLabel(t.value), count: t.count }))} empty="No classified activity yet." mono={false} accent="bg-orange-400/50" />
      </Panel>
      <Panel
        title="Indicators of compromise"
        subtitle="Payload URLs and hosts referenced by attackers"
        icon={<Skull className="size-3.5" />}
        bodyClassName="p-3"
        action={!!intel.iocs.length && (
          <Button size="xs" icon={copied ? <Check className="size-3 text-accent" /> : <Copy className="size-3" />} onClick={async () => { await navigator.clipboard.writeText(iocText); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            Copy all
          </Button>
        )}
      >
        <BarList items={intel.iocs} empty="No indicators extracted yet." accent="bg-blood/45" />
      </Panel>
      <Panel title="Activity heatmap" subtitle="Events by weekday and hour (UTC)" icon={<Radar className="size-3.5" />} bodyClassName="p-3">
        <Heatmap grid={intel.heatmap} />
      </Panel>
      <Panel title="Top shell commands" icon={<TerminalSquare className="size-3.5" />} bodyClassName="p-3">
        <BarList items={intel.commands} empty="No shell commands captured yet." />
      </Panel>
      <Panel title="Top HTTP paths" icon={<Radar className="size-3.5" />} bodyClassName="p-3">
        <BarList items={intel.paths} empty="No HTTP requests captured yet." />
      </Panel>
    </div>
  );
}

const FORMATS: { id: BlocklistFormat; label: string }[] = [
  { id: "txt", label: "Plain list" },
  { id: "iptables", label: "iptables" },
  { id: "nftables", label: "nftables" },
  { id: "pf", label: "pf" },
  { id: "csv", label: "CSV" },
];

function BlocklistTab({ version }: { version: number }) {
  const { data, error } = useThreatData(threatsApi.blocklist, version);
  const { bumpVersion } = useHoneypot();
  const [ip, setIp] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const now = useNow();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    try {
      await threatsApi.block(ip.trim(), "Manual");
      setIp("");
      bumpVersion();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not add the address.");
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Blocked sources" subtitle="Sources added manually or by auto-block" icon={<Ban className="size-3.5" />} bodyClassName="p-2">
        {error && <p className="px-3 text-xs text-blood">{error}</p>}
        {!data?.length ? (
          <EmptyState icon={<Ban className="size-5" />} title="The blocklist is empty" hint="Block attackers from their profile, add an address manually, or enable auto-block on the overview." />
        ) : (
          <table className="data-table">
            <thead><tr><th>Address</th><th className="col-sm">Source</th><th className="col-lg">Reason</th><th className="col-sm text-right">Added</th><th /></tr></thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.ip}>
                  <td className="font-mono text-[12px] text-zinc-100">{b.ip}</td>
                  <td className="col-sm"><span className={`pill ${b.source === "auto" ? "pill-alert" : ""}`}>{b.source}</span></td>
                  <td className="col-lg max-w-sm truncate text-[11px] text-zinc-400" title={b.reason}>{b.reason}</td>
                  <td className="col-sm text-right font-mono text-[11px] text-zinc-500">{now ? timeAgo(b.createdAt, now) : ""}</td>
                  <td className="text-right"><Button size="xs" variant="ghost" onClick={async () => { await threatsApi.unblock(b.ip); bumpVersion(); }}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel title="Add address" icon={<Ban className="size-3.5" />} bodyClassName="p-4">
          <form onSubmit={submit} className="flex gap-2">
            <input className="field-input flex-1" placeholder="203.0.113.7" value={ip} onChange={(e) => setIp(e.target.value)} aria-label="IP address" />
            <Button size="md" variant="primary" type="submit" disabled={!ip.trim()}>Block</Button>
          </form>
          {message && <p className="mt-2 text-xs text-blood">{message}</p>}
        </Panel>
        <Panel title="Export to firewall" subtitle="Ready-to-apply rule sets" icon={<Download className="size-3.5" />} bodyClassName="grid grid-cols-2 gap-2 p-4">
          {FORMATS.map((f) => (
            <Button key={f.id} size="sm" icon={<Download className="size-3" />} onClick={() => void downloadBlocklist(f.id).catch((e) => setMessage(e.message))}>{f.label}</Button>
          ))}
        </Panel>
      </div>
    </div>
  );
}
