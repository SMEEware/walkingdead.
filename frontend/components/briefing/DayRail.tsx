"use client";

import { AlertTriangle } from "lucide-react";

import { formatDayShort, formatWeekday } from "../../lib/data/day";
import type { DayStat } from "../../lib/data/types";

export function DayRail({
  days,
  value,
  onChange,
  className = "",
}: {
  days: DayStat[];
  value: string | null;
  onChange: (day: string) => void;
  className?: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.total));

  return (
    <div
      className={`flex min-w-0 max-w-full gap-1.5 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible xl:pb-0 ${className}`}
      role="tablist"
      aria-label="Days"
    >
      {days.map((d) => {
        const active = d.day === value;
        return (
          <button
            key={d.day}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(d.day)}
            className={`group relative flex w-28 shrink-0 cursor-pointer flex-col gap-1.5 rounded-xl px-3 py-3 text-left ring-1 ring-inset transition-colors duration-200 xl:w-auto ${
              active
                ? "bg-accent/8 ring-accent/25"
                : "bg-white/2 ring-white/6 hover:bg-white/5"
            }`}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={`text-[11px] font-medium ${
                  active ? "text-accent" : "text-zinc-500"
                }`}
              >
                {formatWeekday(d.day)}
              </span>
              {d.bySeverity.critical > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-medium tabular-nums text-blood">
                  <AlertTriangle className="size-3" />
                  {d.bySeverity.critical}
                </span>
              )}
            </span>
            <span
              className={`text-xs font-medium ${active ? "text-white" : "text-zinc-300"}`}
            >
              {formatDayShort(d.day)}
            </span>
            <span className="h-1 overflow-hidden rounded-full bg-white/8">
              <span
                className={`block h-full rounded-full transition-all duration-700 ${active ? "bg-accent" : "bg-zinc-600"}`}
                style={{ width: `${(d.total / max) * 100}%` }}
              />
            </span>
            <span className="text-[10px] tabular-nums text-zinc-500">
              {d.total} events
            </span>
          </button>
        );
      })}
      {!days.length && (
        <p className="p-3 text-xs text-zinc-600">No days stored yet.</p>
      )}
    </div>
  );
}
