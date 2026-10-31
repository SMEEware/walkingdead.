"use client";

import { Activity } from "lucide-react";
import { useMemo } from "react";

import { computeStats, computeThreat, threatLabel } from "../../lib/stats";
import { useCountUp } from "../../lib/useCountUp";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { Panel } from "../ui/Panel";
import { Sparkline } from "../ui/Sparkline";

function Kpi({
  label,
  value,
  suffix,
  tone = "text-zinc-100",
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: string;
}) {
  const shown = useCountUp(value, 1100);
  return (
    <div className="rounded-xl border border-white/5 bg-white/2 px-3 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`mt-1 text-[27px] font-medium leading-none tracking-[-0.05em] tabular-nums ${tone}`}>
        {shown}
        {suffix && <span className="ml-1 text-sm tracking-normal text-zinc-600">{suffix}</span>}
      </div>
    </div>
  );
}

export function StatsPanel() {
  const { logs, services } = useHoneypot();
  const stats = useMemo(() => computeStats(logs), [logs]);
  const threat = useMemo(() => computeThreat(logs), [logs]);
  const online = services.filter((s) => s.enabled).length;
  const threatColor = threat >= 70 ? "#ff6175" : threat >= 45 ? "#e9ad6e" : "#b9f6d0";

  return (
    <Panel
      title="Network pulse"
      icon={<Activity className="size-3.5" />}
      bodyClassName="p-3.5"
      action={<span className="text-[10px] text-zinc-600">Live overview</span>}
    >
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Recent events" value={stats.total} />
        <Kpi label="Critical events" value={stats.critical} tone="text-[#ff6175]" />
        <Kpi label="Unique sources" value={stats.uniqueIps} />
        <Kpi label="Services enabled" value={online} suffix={`/ ${services.length}`} />
      </div>

      <div className="mt-3.5">
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="text-zinc-500">Threat level</span>
          <span style={{ color: threatColor }}>
            {threatLabel(threat)} <span className="ml-1.5 tabular-nums opacity-65">{threat}/100</span>
          </span>
        </div>
        <div
          role="meter"
          aria-label="Threat level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={threat}
          aria-valuetext={`${threatLabel(threat)}, ${threat} out of 100`}
          className="mt-2 flex h-1.5 gap-1"
        >
          {Array.from({ length: 24 }, (_, i) => (
            <span
              key={i}
              className="h-full flex-1 rounded-xs transition-colors duration-700"
              style={{ backgroundColor: i < Math.ceil(threat * 0.24) ? threatColor : "rgb(255 255 255 / 0.06)" }}
            />
          ))}
        </div>
      </div>

      <div className="mt-3 border-t border-white/6 pt-2">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>Connection activity</span>
          <span className="text-zinc-600">Last 15 min</span>
        </div>
        <Sparkline values={stats.series} className="mt-2 h-7 w-full opacity-65" />
      </div>
    </Panel>
  );
}
