"use client";

import { ArrowUpRight, ChevronDown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useHoneypot } from "../../providers/HoneypotProvider";

export function HeroTitle() {
  const { running, services } = useHoneypot();
  const count = services.filter((s) => s.active).length;
  return (
    <div className="overview-heading pointer-events-auto">
      <div>
        <div className="workspace-breadcrumb"><span>Security operations</span><span className="text-zinc-700">/</span><span>Deception network</span><ChevronDown size={11} /></div>
        <h1>Deception operations<span className="heading-period">.</span></h1>
        <p>Observe connections. Understand intent. Collect intelligence.</p>
      </div>
      <div className="overview-heading-actions">
        <span className={`perimeter-badge ${running && count > 0 ? "is-online" : ""}`}><ShieldCheck size={14} />{running ? `${count} ${count === 1 ? "decoy" : "decoys"} listening` : "System offline"}</span>
        <Link href="/threats" className="briefing-link">Threat intelligence<ArrowUpRight size={14} /></Link>
      </div>
    </div>
  );
}
