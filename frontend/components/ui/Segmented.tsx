"use client";

import type { CSSProperties, ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className = "",
  compact = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  compact?: boolean;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      role="tablist"
      className={`pointer-events-auto relative flex min-w-0 gap-0.5 overflow-x-auto rounded-xl bg-black/25 p-1 ring-1 ring-inset ring-white/8 ${compact ? "max-sm:grid max-sm:grid-cols-[repeat(var(--segment-columns),minmax(0,1fr))] max-sm:gap-1 max-sm:overflow-visible" : ""} ${className}`}
      style={compact ? ({ "--segment-columns": Math.min(options.length, options.length > 5 ? 4 : 5) } as CSSProperties) : undefined}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-white/8 ring-1 ring-inset ring-white/12 transition-transform duration-300 ease-out-expo ${compact ? "max-sm:hidden" : ""}`}
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            title={o.hint ?? (compact ? o.label : undefined)}
            aria-label={compact ? o.label : undefined}
            className={`relative z-10 flex flex-1 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg font-sans font-medium normal-case tracking-tight transition-colors duration-200 ${
              size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
            } ${active ? "text-white" : "text-zinc-500 hover:text-zinc-200"} ${compact ? `max-sm:flex-col max-sm:gap-1 max-sm:px-1 max-sm:py-2 max-sm:text-[10px] ${active ? "max-sm:bg-white/8 max-sm:ring-1 max-sm:ring-inset max-sm:ring-white/12" : ""}` : ""}`}
          >
            {o.icon}
            <span className="max-w-full truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
