export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-white/12 bg-white/6 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-400">
      {children}
    </kbd>
  );
}

export function Stat({
  label,
  value,
  tone = "text-white",
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-2xl leading-none tabular-nums ${tone}`}
      >
        {value}
      </div>
    </div>
  );
}
