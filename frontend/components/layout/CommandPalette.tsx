"use client";

import { CornerDownLeft, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { THEMES } from "../../lib/themes";
import { clearSelection, peekSelection } from "../../lib/selection";
import { useIsClient } from "../../lib/useIsClient";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { useSettings } from "../../providers/SettingsProvider";
import { Kbd } from "../ui/Kbd";

interface Action {
  id: string;
  group: string;
  label: string;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

export function CommandPalette() {
  const isClient = useIsClient();
  const router = useRouter();
  const { running, toggleRunning, clearLogs, setMode } =
    useHoneypot();
  const { update, settings: appSettings } = useSettings();
  const [open, setOpen] = useState(() => peekSelection().open === "palette");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  useEffect(() => clearSelection, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onRequest = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wd:palette", onRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wd:palette", onRequest);
    };
  }, []);

  const actions = useMemo<Action[]>(() => {
    const go = (href: string, label: string): Action => ({
      id: `go-${href}`,
      group: "Navigate",
      label,
      run: () => router.push(href),
    });
    return [
      go("/", "Deception operations"),
      go("/threats", "Threat intelligence"),
      go("/briefing", "Daily briefing"),
      go("/logs", "Logs database"),
      go("/settings", "Settings"),
      go("/docs", "API documentation"),
      {
        id: "arm",
        group: "Honeypot",
        label: running ? "Shut down system" : "Start system",
        run: toggleRunning,
      },
      {
        id: "mode-passive",
        group: "Honeypot",
        label: "Mode: passive",
        run: () => setMode("passive"),
      },
      {
        id: "mode-interactive",
        group: "Honeypot",
        label: "Mode: interactive",
        run: () => setMode("interactive"),
      },
      {
        id: "mode-tarpit",
        group: "Honeypot",
        label: "Mode: tarpit",
        run: () => setMode("tarpit"),
      },
      {
        id: "clear",
        group: "Honeypot",
        label: "Clear stored logs",
        hint: "deletes every event",
        danger: true,
        run: clearLogs,
      },
      ...THEMES.map((t) => ({
        id: `theme-${t.id}`,
        group: "Appearance",
        label: `Theme: ${t.name}`,
        hint: appSettings.theme === t.id ? "active" : undefined,
        run: () => update({ theme: t.id }),
      })),
      {
        id: "theme-auto-rotate",
        group: "Appearance",
        label: `Auto-rotate: ${appSettings.autoRotate ? "off" : "on"}`,
        run: () => update({ autoRotate: !appSettings.autoRotate }),
      },

    ];
  }, [
    router,
    running,
    toggleRunning,
    setMode,
    clearLogs,
    update,
    appSettings.autoRotate,
    appSettings.theme,
  ]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? actions.filter((a) =>
          `${a.group} ${a.label} ${a.hint ?? ""}`.toLowerCase().includes(q),
        )
      : actions;
    return list.slice(0, 40);
  }, [actions, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { action: Action; index: number }[]>();
    results.forEach((action, index) => {
      map.set(action.group, [
        ...(map.get(action.group) ?? []),
        { action, index },
      ]);
    });
    return [...map.entries()];
  }, [results]);

  const run = (action: Action) => {
    close();
    action.run();
  };

  if (!isClient || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-90 flex items-start justify-center p-3 pt-[8vh] sm:p-6 sm:pt-[14vh]">
      <div
        aria-hidden
        onClick={close}
        className="absolute inset-0 animate-fade-in cursor-default bg-black/75 backdrop-blur-[3px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="glass-strong relative flex max-h-[76dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl"
        style={{ animation: "pop 0.26s cubic-bezier(0.16, 1, 0.3, 1) both" }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-12 top-0 h-px bg-linear-to-r from-transparent via-accent to-transparent opacity-70"
        />
        <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3.5">
          <Search className="size-4 shrink-0 text-zinc-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && results[cursor]) {
                run(results[cursor]);
              } else if (e.key === "Escape") {
                close();
              }
            }}
            placeholder="Search actions and pages…"
            aria-label="Search actions"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Sparkles className="size-5 text-zinc-600" />
              <p className="text-xs text-zinc-500">No matching action.</p>
            </div>
          )}
          {groups.map(([group, entries]) => (
            <section key={group}>
              <h3 className="sticky top-0 z-10 bg-black/70 px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-500 backdrop-blur">
                {group}
              </h3>
              <ul>
                {entries.map(({ action, index }) => (
                  <li key={action.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => run(action)}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150 ${
                        index === cursor
                          ? "bg-accent/12 text-accent"
                          : "text-zinc-300 hover:bg-white/5"
                      } ${action.danger && index !== cursor ? "text-zinc-400 hover:text-blood" : ""}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {action.label}
                      </span>
                      {action.hint && (
                        <span className="truncate font-mono text-[10px] text-zinc-600">
                          {action.hint}
                        </span>
                      )}
                      {index === cursor && (
                        <CornerDownLeft className="size-3.5 shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/8 bg-black/30 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <Kbd>⌘K</Kbd> toggle
          </span>
          <span className="flex items-center gap-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <Kbd>↵</Kbd>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
