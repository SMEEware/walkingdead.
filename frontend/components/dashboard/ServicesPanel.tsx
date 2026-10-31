"use client";

import { Network } from "lucide-react";

import { useCountUp } from "../../lib/useCountUp";
import { useHoneypot } from "../../providers/HoneypotProvider";
import type { HoneypotService } from "../../lib/types";
import { Panel } from "../ui/Panel";
import { ServiceIcon } from "../ui/ServiceIcon";
import { Switch } from "../ui/Switch";

function Hits({ value }: { value: number }) {
  const shown = useCountUp(value, 900);
  return <>{shown}</>;
}

function Row({ s, max }: { s: HoneypotService; max: number }) {
  const live = s.active;
  const { toggleService, pending, ready } = useHoneypot();
  return (
    <li className="group flex items-center gap-2.5 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-white/3">
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-lg border transition-colors duration-300 ${
          live
            ? "border-white/6 bg-white/4 text-zinc-300"
            : "border-white/4 bg-white/2 text-zinc-600"
        }`}
      >
        <ServiceIcon id={s.id} className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-xs font-medium ${live ? "text-zinc-200" : "text-zinc-500"}`}>
            {s.name}
          </span>
          <span className="font-mono text-[10px] text-zinc-600">:{s.port}</span>
          {s.error && <span className="font-mono text-[9px] uppercase text-blood" title={s.error}>bind failed</span>}
        </div>
        <div className="mt-1.5 h-0.5 w-full max-w-22 overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-out-expo ${
              live ? "bg-[#b9f6d0]/55" : "bg-zinc-700"
            }`}
            style={{ width: `${(s.hits / max) * 100}%` }}
          />
        </div>
      </div>

      <span
        className="mr-1 min-w-7 text-right text-[11px] tabular-nums text-zinc-500"
        title={`${s.hits} captured events`}
        aria-label={`${s.hits} captured events`}
      >
        <Hits value={s.hits} />
      </span>
      <Switch
        size="sm"
        checked={s.enabled}
        onChange={() => void toggleService(s.id)}
        disabled={pending || !ready}
        label={`Toggle ${s.name}`}
      />
    </li>
  );
}

export function ServicesPanel() {
  const { services, running } = useHoneypot();
  const max = Math.max(1, ...services.map((s) => s.hits));
  const online = running ? services.filter((s) => s.active).length : 0;

  return (
    <Panel
      title="Exposed services"
      icon={<Network className="size-3.5" />}
      className="min-h-64 flex-1 xl:min-h-0"
      bodyClassName="overflow-y-auto p-2"
      action={
        <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span aria-hidden className={`size-1 rounded-full ${online ? "bg-[#b9f6d0]" : "bg-zinc-600"}`} />
          {online} online
        </span>
      }
    >
      <ul>
        {!services.length && <li className="px-3 py-5 text-xs text-zinc-500">Loading decoy configuration…</li>}
        {services.map((s) => (
          <Row key={s.id} s={s} max={max} />
        ))}
      </ul>
    </Panel>
  );
}
