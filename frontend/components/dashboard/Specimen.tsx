"use client";

import { ArrowUpRight, Database, Fingerprint, Network, Radio, ScanLine, Shield, ShieldAlert, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { dayKey } from "../../lib/data/day";
import { activityBuckets, getSentinelStatus } from "../../lib/operations";
import { setSelection } from "../../lib/selection";
import { formatTime, SEVERITY_STYLE } from "../../lib/ui";
import { useNow } from "../../lib/useNow";
import { useHoneypot } from "../../providers/HoneypotProvider";

export function Specimen() {
  const { running, ready, logs, services, mode } = useHoneypot();
  const now = useNow(2000);
  const online = services.filter((s) => s.enabled).length;
  const event = logs[0];
  const status = getSentinelStatus({ running, ready, enabledServices: online, latestEvent: event, now });
  const buckets = useMemo(() => activityBuckets(logs, now), [logs, now]);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const StatusIcon = status.phase === "responding" ? ShieldAlert : !running ? Shield : ScanLine;
  const severity = event ? SEVERITY_STYLE[event.severity] : null;

  return (
    <section className="specimen-panel sentinel-panel" data-phase={status.phase} data-tone={status.tone} aria-label="Autonomous honeypot sentinel">
      <div className="specimen-topline">
        <div className="specimen-id"><Fingerprint size={16} /><span>Sentinel <strong>WD–001</strong></span></div>
        <span className="model-badge"><span className={running ? "status-dot is-mint" : "status-dot"} />{running ? "Autonomous" : "Offline"}</span>
      </div>
      <div className="specimen-wordmark" aria-hidden><span>ALWAYS</span><span>WATCHING</span></div>
      <div className="sentinel-orbit" aria-hidden><svg viewBox="0 0 500 500"><circle cx="250" cy="250" r="220" /><circle className="orbit-segment" cx="250" cy="250" r="220" /><circle cx="250" cy="250" r="242" /></svg></div>
      <div className="sentinel-frame-metadata" aria-hidden><span>Deception engine</span><span>WD / 001</span></div>
      <div className="sentinel-observer-label"><span className="observer-marker" /><span>{running ? "Environment aware" : "Listeners disconnected"}<strong>{running ? "Reactive by design" : "Evidence retained"}</strong></span></div>
      <div className="sentinel-caption"><Radio size={12} /><span>{running ? "Every interaction leaves a trace." : "Observation suspended. Data preserved."}</span><span className="sentinel-mode">{mode === "interactive" ? "Interactive engagement" : mode === "tarpit" ? "Tarpit engagement" : "Passive observation"}</span></div>
      <div className="sentinel-console pointer-events-auto">
        <div className="sentinel-console-status">
          <span className="sentinel-status-icon"><StatusIcon size={18} strokeWidth={1.6} /></span>
          <div className="sentinel-status-copy"><span key={status.label} className="state-copy">{status.label}</span><p>{status.description}</p></div>
          <div className="signal-buckets" aria-label="Event activity over the last two minutes" role="img">{buckets.map((bucket, i) => <span key={i} className={bucket.critical ? "is-critical" : ""} style={{ transform: `scaleY(${running ? .08 + (bucket.total / max) * .92 : .05})` }} />)}</div>
        </div>
        <div className="observation-pipeline" aria-label="Observation pipeline">
          <span data-active={running && online > 0}><Network size={12} /><span>Attract</span><i /></span><span className="pipeline-connector" aria-hidden />
          <span data-active={running && online > 0}><ScanLine size={12} /><span>Observe</span><i /></span><span className="pipeline-connector" aria-hidden />
          <span data-active={ready && running}><Database size={12} /><span>{running ? "Record" : "Retained"}</span><i /></span>
        </div>
        {event ? <Link href="/logs" className="sentinel-last-event" onClick={() => setSelection({ focusId: event.id, day: dayKey(event.ts) })}><Zap size={12} /><span className="last-event-label">Latest signal</span><span key={event.id} className="last-event-message">{event.message}</span><span className={`last-event-severity ${severity?.text}`}>{event.service.toUpperCase()}</span><time>{formatTime(event.ts)}</time><ArrowUpRight size={12} /></Link> : <div className="sentinel-last-event"><Zap size={12} /><span>Awaiting the first captured connection.</span></div>}
      </div>
    </section>
  );
}
