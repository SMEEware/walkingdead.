"use client";

import { ArrowUpRight, Radio, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { SEVERITY_STYLE, formatTime } from "../../lib/ui";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { EmptyState } from "../ui/EmptyState";
import { Panel } from "../ui/Panel";
import { setSelection } from "../../lib/selection";
import { dayKey } from "../../lib/data/day";

export function LiveFeed() {
  const { logs, running } = useHoneypot();
  const recent = logs.slice(0, 20);
  return (
    <Panel title="Live activity" icon={<Radio className="size-3.5" />} className="live-activity-panel flex-1" bodyClassName="live-activity-body" action={<Link href="/logs" className="text-zinc-500 hover:text-white" aria-label="View all event logs"><ArrowUpRight size={15} /></Link>}>
      <div className="feed-status"><span className={`status-dot ${running ? "is-mint" : ""}`} /><span>{running ? "Monitoring connection activity" : "Event collection stopped"}</span></div>
      {recent.length === 0 ? (
        <EmptyState icon={<ShieldAlert className="size-5" />} title={running ? "No connections recorded" : "System offline"} hint={running ? "New connections will appear here." : "Start the system to collect events."} />
      ) : (
        <ul className="activity-list">{recent.map((e) => { const sev = SEVERITY_STYLE[e.severity]; return (
          <li key={e.id}>
            <Link href="/logs" onClick={() => setSelection({ focusId: e.id, day: dayKey(e.ts) })} className="activity-event">
              <span className={`activity-dot ${sev.dot}`} />
              <div className="activity-event-content"><div className="activity-event-title"><span>{e.message}</span><time>{formatTime(e.ts).slice(0, 5)}</time></div><div className="activity-event-meta"><span>{e.srcIp}</span><span className="activity-service">{e.service.toUpperCase()}</span><span className={`activity-severity ${sev.text}`}>{sev.label}</span></div></div>
            </Link>
          </li>
        ); })}</ul>
      )}
      <Link href="/logs" className="activity-view-all">Explore all events<ArrowUpRight size={13} /></Link>
    </Panel>
  );
}
