"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_BASE, apiRequest } from "../lib/api";
import { getDataSource } from "../lib/data";
import type { HoneypotMode, HoneypotService, LogEvent, ServiceId, WebhookConfig, ZombieCue } from "../lib/types";
import { useNotifications } from "./NotificationProvider";
import { useSettings } from "./SettingsProvider";

interface SystemState {
  running: boolean;
  mode: HoneypotMode;
  autoBlock: boolean;
  services: HoneypotService[];
  httpAddress: string;
  webhook: WebhookConfig;
  error?: string;
}
export type SystemPatch = Partial<Pick<SystemState, "running" | "mode" | "autoBlock" | "httpAddress" | "webhook">> & {
  httpEnabled?: boolean;
  decoys?: Partial<Record<ServiceId, { enabled: boolean; address?: string }>>;
};
interface HoneypotContextValue extends Omit<SystemState, "error"> {
  ready: boolean;
  pending: boolean;
  error: string | null;
  logs: LogEvent[];
  cue: ZombieCue | null;
  blocked: Set<string>;
  toggleRunning: () => Promise<void>;
  setMode: (mode: HoneypotMode) => Promise<void>;
  setAutoBlock: (value: boolean) => Promise<void>;
  toggleService: (id: ServiceId) => Promise<void>;
  setServiceAddress: (id: ServiceId, address: string) => Promise<void>;
  updateSystem: (patch: SystemPatch) => Promise<void>;
  clearLogs: () => Promise<void>;
  version: number;
  bumpVersion: () => void;
}
const HoneypotContext = createContext<HoneypotContextValue | null>(null);
const INITIAL_SYSTEM: SystemState = { running: false, mode: "passive", autoBlock: false, services: [], httpAddress: "", webhook: { enabled: false, format: "generic", minSeverity: "high" } };

function eventCue(event: LogEvent): Omit<ZombieCue, "id" | "severity"> | null {
  if (event.type === "auth_success") return { clip: "Idle_Attack", priority: 5, reason: "Attacker entered an emulated shell" };
  if (event.type === "command" && (event.severity === "high" || event.severity === "critical")) return { clip: "Roar", priority: 4, reason: "Hostile command captured" };
  if (event.type === "command") return { clip: "Walk_Grab", priority: 2, reason: "Shell command captured" };
  if (event.type === "exploit") return { clip: "Idle_Attack", priority: 4, reason: "Suspicious request captured" };
  if (event.type === "auth_fail") return { clip: "Roar", priority: 2, reason: "Authentication attempt captured" };
  if (event.type === "scan") return { clip: "Walk_Grab", priority: 1, reason: "Scan observed" };
  return null;
}

export function HoneypotProvider({ children }: { children: ReactNode }) {
  const { pushEvents, push } = useNotifications();
  const { settings } = useSettings();
  const [system, setSystem] = useState<SystemState>(INITIAL_SYSTEM);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [cue, setCue] = useState<ZombieCue | null>(null);
  const [version, setVersion] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const cueId = useRef(0);
  const operating = useRef(false);
  const epoch = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const requestEpoch = epoch.current;
    const [actual, recent] = await Promise.all([
      apiRequest<SystemState>("/system", { signal }),
      getDataSource().getRecentLogs(400),
    ]);
    if (!mounted.current || signal?.aborted) return;
    if (requestEpoch === epoch.current && !operating.current) setSystem(actual);
    const fresh = seen.current ? recent.filter((event) => !seen.current!.has(event.id)) : [];
    seen.current = new Set(recent.map((event) => event.id));
    setLogs(recent);
    setError(actual.error || null);
    setReady(true);
    if (fresh.length) {
      pushEvents(fresh.slice(0, 8));
      const next = fresh.map((event) => ({ event, reaction: eventCue(event) })).filter((item) => item.reaction).sort((a, b) => b.reaction!.priority - a.reaction!.priority)[0];
      if (actual.running && next?.reaction) setCue({ id: ++cueId.current, severity: next.event.severity, ...next.reaction });
    }
    setVersion((value) => value + 1);
  }, [pushEvents]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let refreshing = false;
    let queued = false;
    let streamTimer: ReturnType<typeof setTimeout> | null = null;
    const sync = async () => {
      if (refreshing) { queued = true; return; }
      refreshing = true;
      try { await refresh(controller.signal); }
      catch (cause) {
        if (mounted.current && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "The backend is unreachable.");
          setReady(false);
        }
      } finally {
        refreshing = false;
        if (queued && !controller.signal.aborted) { queued = false; void sync(); }
      }
    };
    void sync();
    const stream = new EventSource(`${API_BASE}/stream`, { withCredentials: true });
    const updated = () => {
      if (streamTimer !== null || document.hidden) return;
      streamTimer = setTimeout(() => { streamTimer = null; void sync(); }, 400);
    };
    stream.addEventListener("event:update", updated);
    stream.addEventListener("system:update", updated);
    stream.addEventListener("update", updated);
    stream.onopen = updated;
    stream.onerror = () => { if (!document.hidden) void sync(); };
    const poll = window.setInterval(() => { if (!document.hidden) void sync(); }, 15_000);
    document.addEventListener("visibilitychange", updated);
    return () => {
      mounted.current = false;
      controller.abort();
      stream.close();
      if (streamTimer !== null) clearTimeout(streamTimer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", updated);
    };
  }, [refresh]);

  const updateSystem = useCallback(async (patch: SystemPatch) => {
    if (operating.current) return;
    operating.current = true;
    epoch.current++;
    setPending(true);
    setError(null);
    try {
      const actual = await apiRequest<SystemState>("/system", { method: "PUT", body: JSON.stringify(patch) });
      if (!mounted.current) return;
      setSystem(actual);
      setError(actual.error || null);
      if (patch.running !== undefined) {
        setCue(null);
        if (settings.notifySystem) push({ kind: "system", severity: actual.running ? "info" : "medium", title: actual.running ? "System online" : "System offline", body: actual.running ? `${actual.services.filter((s) => s.active).map((s) => s.name).join(", ") || "Decoys"} accepting connections.` : "All decoy listeners have stopped." });
      }
      setVersion((value) => value + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The system update failed.";
      try {
        const actual = await apiRequest<SystemState>("/system");
        if (mounted.current) { setSystem(actual); setReady(true); }
      } catch {
        if (mounted.current) setReady(false);
      }
      if (mounted.current) setError(message);
    } finally {
      operating.current = false;
      if (mounted.current) setPending(false);
    }
  }, [push, settings.notifySystem]);

  const clearLogs = useCallback(async () => {
    try {
      await getDataSource().clearLogs();
      if (!mounted.current) return;
      seen.current = new Set();
      setLogs([]);
      setCue(null);
      setVersion((value) => value + 1);
      await refresh();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Events could not be cleared.");
    }
  }, [refresh]);
  const value = useMemo<HoneypotContextValue>(() => ({
    ...system, ready, pending, error, logs, cue, version,
    blocked: new Set(logs.filter((event) => event.type === "blocked").map((event) => event.id)),
    toggleRunning: () => updateSystem({ running: !system.running }),
    setMode: (mode) => updateSystem({ mode }),
    setAutoBlock: (autoBlock) => updateSystem({ autoBlock }),
    toggleService: (id) => {
      const enabled = !system.services.find((service) => service.id === id)?.enabled;
      return id === "http" ? updateSystem({ httpEnabled: enabled }) : updateSystem({ decoys: { [id]: { enabled } } });
    },
    setServiceAddress: (id, address) => {
      const current = system.services.find((service) => service.id === id);
      return id === "http" ? updateSystem({ httpAddress: address }) : updateSystem({ decoys: { [id]: { enabled: !!current?.enabled, address } } });
    },
    updateSystem,
    clearLogs,
    bumpVersion: () => setVersion((current) => current + 1),
  }), [system, ready, pending, error, logs, cue, version, updateSystem, clearLogs]);
  return <HoneypotContext.Provider value={value}>{children}</HoneypotContext.Provider>;
}

export function useHoneypot() {
  const value = useContext(HoneypotContext);
  if (!value) throw new Error("useHoneypot must be used inside <HoneypotProvider>");
  return value;
}
