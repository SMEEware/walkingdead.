"use client";

import { ArrowRight, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { setSelection } from "../../lib/selection";
import { SEVERITY_STYLE } from "../../lib/ui";
import { useNotifications } from "../../providers/NotificationProvider";

export function Toaster() {
  const { toasts, dismissToast, markAllRead } = useNotifications();
  const router = useRouter();

  if (!toasts.length) return null;

  const inspect = (
    id: string,
    ref?: { type: "log"; id: string } | { type: "day"; day: string },
  ) => {
    dismissToast(id);
    markAllRead();
    if (ref?.type === "log") {
      setSelection({ focusId: ref.id });
      router.push("/logs");
      return;
    }
    if (ref?.type === "day") setSelection({ day: ref.day });
    setSelection({ open: "notifications" });
    router.push("/briefing");
  };

  return (
    <div
      aria-live="polite"
      className="notification-stack pointer-events-none fixed inset-x-3 z-60 flex flex-col items-center gap-2 [bottom:calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end"
    >
      {toasts.map(({ id, notification: n }) => {
        const sev = SEVERITY_STYLE[n.severity];
        return (
          <div
            key={id}
            role="status"
            style={{
              animation: "toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
            }}
            className="notification-toast glass-strong pointer-events-auto w-full max-w-sm overflow-hidden rounded-xl"
          >
            <div className="flex items-start gap-3 p-3">
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${sev.dot}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.2em] ${sev.text}`}
                  >
                    {sev.label}
                  </span>
                  {n.count && n.count > 1 && (
                    <span className="font-mono text-[10px] text-zinc-500">
                      ×{n.count}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-sm font-medium text-zinc-100">
                  {n.title}
                </div>
                <div className="toast-description mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-zinc-500">
                  {n.body}
                </div>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismissToast(id)}
                className="shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/6 hover:text-zinc-200"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => inspect(id, n.ref as { type: "log"; id: string })}
              className="toast-inspect flex w-full cursor-pointer items-center justify-between border-t border-white/6 px-3 py-1.5 text-[10px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-accent"
            >
              Inspect
              <ArrowRight className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
