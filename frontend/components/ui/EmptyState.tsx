import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 px-6 py-12 text-center ${className}`}
    >
      {icon && (
        <span className="grid size-12 place-items-center rounded-2xl bg-white/4 text-accent ring-1 ring-inset ring-white/8">
          {icon}
        </span>
      )}
      <div>
        <p className="text-sm font-medium text-zinc-300">{title}</p>
        {hint && (
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
            {hint}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
