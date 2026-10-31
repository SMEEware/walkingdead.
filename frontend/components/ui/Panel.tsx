import type { ReactNode } from "react";

export function Panel({ title, subtitle, icon, action, children, className = "", bodyClassName = "" }: {
  title?: string; subtitle?: string; icon?: ReactNode; action?: ReactNode;
  children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={`control-surface pointer-events-auto relative flex min-h-0 flex-col ${className}`}>
      {title && (
        <header className="flex min-h-12 items-center justify-between gap-3 px-5 pt-4 pb-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="shrink-0 text-zinc-500">{icon}</span>}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold tracking-[-0.02em] text-zinc-200">{title}</h2>
              {subtitle && <p className="mt-1 truncate text-[11px] text-zinc-500">{subtitle}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
