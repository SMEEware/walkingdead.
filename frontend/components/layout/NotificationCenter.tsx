"use client";

import {
  Bell,
  BellRing,
  CheckCheck,
  Inbox,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";

import { dayKey, formatDayLong, timeAgo } from "../../lib/data/day";
import type { AppNotification, NotificationKind } from "../../lib/data/types";
import { clearSelection, peekSelection } from "../../lib/selection";
import { SEVERITY_STYLE } from "../../lib/ui";
import { useNow } from "../../lib/useNow";
import { useNotifications } from "../../providers/NotificationProvider";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Sheet } from "../ui/Sheet";

type FilterId = "all" | "unread" | NotificationKind;

const FILTERS: { value: FilterId; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "alert", label: "Alerts" },
  { value: "ai", label: "AI" },
  { value: "system", label: "System" },
];

const KIND_ICON: Record<
  NotificationKind,
  ComponentType<{ className?: string }>
> = {
  alert: Bell,
  ai: Sparkles,
  system: Bell,
};

export function NotificationBell() {
  const { items, unread, markAllRead, clear } = useNotifications();
  const [open, setOpen] = useState(
    () => peekSelection().open === "notifications",
  );
  const [filter, setFilter] = useState<FilterId>("all");
  const now = useNow(20_000);

  useEffect(() => clearSelection, []);

  const counts = useMemo(() => {
    const base: Record<FilterId, number> = {
      all: items.length,
      unread,
      alert: 0,
      ai: 0,
      system: 0,
    };
    for (const n of items) base[n.kind]++;
    return base;
  }, [items, unread]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((n) => !n.read);
    return items.filter((n) => n.kind === filter);
  }, [items, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, AppNotification[]>();
    for (const n of filtered) {
      const key = dayKey(n.ts);
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return [...map.entries()];
  }, [filtered]);

  const unreadItems = useMemo(() => items.filter((n) => !n.read), [items]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className={`relative grid size-9 cursor-pointer place-items-center rounded-lg ring-1 ring-inset transition-colors duration-300 ${
          unread
            ? "bg-accent/12 text-accent ring-accent/30"
            : "bg-white/4 text-zinc-300 ring-white/8 hover:text-accent"
        }`}
      >
        {unread ? <BellRing className="size-4" /> : <Bell className="size-4" />}
        {unread > 0 && (
          <>
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 size-2 animate-ping-soft rounded-full bg-accent"
            />
            <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[9px] font-bold text-black ring-2 ring-black">
              {unread > 9 ? "9+" : unread}
            </span>
          </>
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        description={`${items.length} stored · ${unread} unread`}
        icon={<Bell className="size-4" />}
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Showing {filtered.length} of {items.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                icon={<CheckCheck className="size-3.5" />}
                onClick={markAllRead}
                disabled={!unread}
              >
                Read all
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-3.5" />}
                onClick={clear}
                disabled={!items.length}
              >
                Clear
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <section className="relative overflow-hidden rounded-xl bg-white/3 p-3.5 ring-1 ring-inset ring-white/8">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-accent/15 blur-3xl"
            />
            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-accent" />
                  <span className="text-sm font-medium text-zinc-100">
                    AI catch-up
                  </span>
                  {unreadItems.length > 0 && (
                    <span className="rounded bg-accent/15 px-1.5 font-mono text-[10px] text-accent">
                      {unreadItems.length} unread
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-snug text-zinc-500">
                  AI analysis is available for captured events and daily briefings. Notification summaries are not supported yet.
                </p>
              </div>
              <Button variant="soft" size="sm" disabled title="Use event analysis or a daily briefing" icon={<Wand2 className="size-3.5" />}>Summarize</Button>
            </div>

          </section>

          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {FILTERS.map((f) => {
              const active = filter === f.value;
              const count = counts[f.value];
              return (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.value)}
                  className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium ring-1 ring-inset transition-colors duration-300 ${
                    active
                      ? "bg-accent/15 text-accent ring-accent/40"
                      : "bg-white/4 text-zinc-400 ring-white/8 hover:text-zinc-100"
                  }`}
                >
                  {f.label}
                  <span
                    className={`font-mono text-[10px] ${active ? "text-accent/70" : "text-zinc-600"}`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {groups.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-5" />}
              title={
                filter === "unread"
                  ? "You are all caught up"
                  : "Nothing here yet"
              }
              hint="Important events land here as they happen. Adjust the threshold in Settings → Alerts."
            />
          ) : (
            <div className="space-y-5">
              {groups.map(([day, list]) => (
                <section key={day} className="space-y-2">
                  <h3 className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-black/60 px-1 py-1 backdrop-blur">
                    <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                      {formatDayLong(day)}
                    </span>
                    <span className="h-px flex-1 bg-white/8" />
                    <span className="font-mono text-[10px] text-zinc-600">
                      {list.length}
                    </span>
                  </h3>
                  <ul className="space-y-1.5">
                    {list.map((n) => (
                      <Row key={n.id} n={n} ago={timeAgo(n.ts, now)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}

function Row({ n, ago }: { n: AppNotification; ago: string }) {
  const sev = SEVERITY_STYLE[n.severity];
  const Icon = KIND_ICON[n.kind];
  return (
    <li
      className={`group relative overflow-hidden rounded-lg bg-white/3 p-3 pr-4 ring-1 ring-inset transition-colors duration-300 hover:bg-white/6 ${
        n.read ? "ring-white/6" : "ring-accent/25"
      }`}
    >
      {!n.read && (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent"
        />
      )}
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md ring-1 ring-inset ${sev.chip}`}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-sm ${n.read ? "text-zinc-300" : "font-medium text-zinc-50"}`}
            >
              {n.title}
            </span>
            {n.count && n.count > 1 && (
              <span className="rounded bg-white/8 px-1.5 font-mono text-[10px] text-zinc-300">
                ×{n.count}
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500">
              {ago}
            </span>
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-zinc-400">
            {n.body}
          </p>
        </div>
      </div>
    </li>
  );
}
