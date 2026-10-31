"use client";

import {
  ChevronRight,
  Power,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Snail,
  Terminal,
} from "lucide-react";
import type { ComponentType } from "react";

import type { HoneypotMode } from "../../lib/types";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { Panel } from "../ui/Panel";
import { Switch } from "../ui/Switch";

const MODES: {
  id: HoneypotMode;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "passive", label: "Passive", hint: "Capture credentials and probes; never grant access", icon: Shield },
  {
    id: "interactive",
    label: "Interactive",
    hint: "Let attackers into an emulated shell and record every command",
    icon: Terminal,
  },
  { id: "tarpit", label: "Tarpit", hint: "Slow attackers down with throttled responses", icon: Snail },
];

export function ControlPanel() {
  const { running, toggleRunning, mode, setMode, pending, ready, error, services, autoBlock, setAutoBlock } =
    useHoneypot();
  const active = services.filter((s) => s.active).length;
  const enabled = services.filter((s) => s.enabled).length;

  return (
    <Panel
      title="System control"
      icon={<SlidersHorizontal className="size-3.5" />}
      className={`system-control-panel ${running ? "is-running" : "is-offline"}`}
      bodyClassName="space-y-3 p-4 pt-2"
    >
      <div className="flex items-center gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl border transition-colors duration-300 ${
            running
              ? "border-[#b9f6d0]/15 bg-[#b9f6d0]/7 text-[#b9f6d0]"
              : "border-white/8 bg-white/3 text-zinc-500"
          }`}
        >
          <ShieldCheck className="size-4.5" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
            {!ready ? "Checking system state" : running ? "Honeypot is online" : "System is offline"}
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${
                running ? "animate-pulse bg-[#b9f6d0]" : "bg-zinc-600"
              }`}
            />
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {!ready ? "Waiting for the management API" : running ? `${active} of ${enabled} decoys listening` : `${enabled} decoys armed and ready`}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void toggleRunning()}
        disabled={pending || !ready}
        aria-busy={pending}
        aria-pressed={running}
        aria-label={running ? "Shut down system" : "Start system"}
        className={`system-power-button ${running ? "is-shutdown" : "is-startup"}`}
      >
        <span className="power-button-disc" aria-hidden="true">
          <Power size={19} strokeWidth={1.8} />
        </span>
        <span className="power-button-copy">
          <span className="power-button-label">
            {pending ? "Applying system change…" : running ? "Shut down system" : "Start system"}
          </span>
          <span className="power-button-hint">
            {running ? "Stop all active listeners" : "Bring your perimeter online"}
          </span>
        </span>
        <ChevronRight className="power-button-arrow" size={15} aria-hidden="true" />
      </button>

      <div role="group" aria-label="Interaction mode" className="grid grid-cols-3 gap-1 rounded-xl border border-white/6 bg-black/25 p-1">
        {MODES.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            disabled={pending || !ready}
            title={hint}
            onClick={() => void setMode(id)}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg px-1 py-2 text-[10px] font-medium transition-colors duration-200 ${
              mode === id
                ? "bg-white/8 text-zinc-100 shadow-[0_1px_4px_rgb(0_0_0/0.18)] ring-1 ring-inset ring-white/10"
                : "text-zinc-500 hover:bg-white/3 hover:text-zinc-300"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/6 pt-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-zinc-200">Auto-block</div>
          <p className="text-[10px] leading-snug text-zinc-500">Add sources of high and critical activity to the blocklist</p>
        </div>
        <Switch size="sm" checked={autoBlock} onChange={() => void setAutoBlock(!autoBlock)} disabled={pending || !ready} label="Toggle auto-block" />
      </div>
      {error && <p role="alert" className="text-xs leading-relaxed text-red-300">{error}</p>}
    </Panel>
  );
}
