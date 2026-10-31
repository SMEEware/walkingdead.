"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "../lib/api";
import { AiError, runManagedAi, updateManagedAi } from "../lib/ai/client";
import type { AiLanguage, AiReference, AiRun, AiTask, ManagedAiPatch, ManagedAiSettings } from "../lib/ai/types";

const LANGUAGE_KEY = "wd-ai-language";
const DEFAULT_SETTINGS: ManagedAiSettings = { provider: "deepseek", enabled: false, configured: false, model: "deepseek-flash", redactIps: true, includePayloads: false, maxEvents: 80, maxOutputTokens: 1200 };
interface AiContextValue {
  settings: ManagedAiSettings & { language: AiLanguage };
  ready: boolean;
  available: boolean;
  updating: boolean;
  refresh: () => Promise<void>;
  update: (patch: ManagedAiPatch & { language?: AiLanguage }) => Promise<void>;
  busy: AiTask | null;
  error: string | null;
  clearError: () => void;
  cancel: () => void;
  run: (task: AiTask, built: AiReference) => Promise<AiRun>;
  usage: { calls: number; inputTokens: number; outputTokens: number };
}
const AiContext = createContext<AiContextValue | null>(null);

export function AiProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState(DEFAULT_SETTINGS);
  const [language, setLanguage] = useState<AiLanguage>("en");
  const [ready, setReady] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [busy, setBusy] = useState<AiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState({ calls: 0, inputTokens: 0, outputTokens: 0 });
  const mounted = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const running = useRef<AbortController | null>(null);
  const changing = useRef(false);

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const actual = await apiRequest<ManagedAiSettings>("/ai/settings", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      if (mounted.current && !controller.signal.aborted) { setServer(actual); setReady(true); setError(null); }
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) { setReady(false); setError(cause instanceof Error ? cause.message : "AI settings are unavailable."); }
    } finally { controllers.current.delete(controller); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const active = controllers.current;
    const timer = setTimeout(() => {
      try {
        for (const storage of [localStorage, sessionStorage]) {
          storage.removeItem("wd-ai-keys");
          storage.removeItem("wd-ai-keys-session");
        }
        const saved = localStorage.getItem(LANGUAGE_KEY);
        if (saved === "en" || saved === "de") setLanguage(saved);
      } catch { /* Local language preferences are optional. */ }
      void refresh();
    }, 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      active.forEach((controller) => controller.abort());
      active.clear();
    };
  }, [refresh]);

  const update = useCallback(async (patch: ManagedAiPatch & { language?: AiLanguage }) => {
    if (patch.language) {
      setLanguage(patch.language);
      try { localStorage.setItem(LANGUAGE_KEY, patch.language); } catch { /* The current page still uses the selection. */ }
    }
    const serverPatch = { enabled: patch.enabled, model: patch.model, redactIps: patch.redactIps, includePayloads: patch.includePayloads };
    if (!Object.values(serverPatch).some((value) => value !== undefined) || changing.current) return;
    changing.current = true;
    setUpdating(true);
    setError(null);
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const actual = await updateManagedAi(serverPatch, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (mounted.current && !controller.signal.aborted) { setServer(actual); setReady(true); }
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "AI settings could not be updated.");
    } finally {
      controllers.current.delete(controller);
      changing.current = false;
      if (mounted.current) setUpdating(false);
    }
  }, []);

  const cancel = useCallback(() => {
    running.current?.abort();
  }, []);

  const run = useCallback(async (task: AiTask, built: AiReference): Promise<AiRun> => {
    if (!ready || !server.enabled || !server.configured) throw new AiError("Configure DeepSeek on the server and enable AI in Settings first.");
    if (running.current) throw new AiError("Another AI request is already running.");
    const controller = new AbortController();
    running.current = controller;
    controllers.current.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    setBusy(task);
    setError(null);
    try {
      const result = await runManagedAi(task, built, controller.signal);
      if (!mounted.current || controller.signal.aborted) throw new AiError("AI request cancelled.");
      setUsage((previous) => ({ calls: previous.calls + 1, inputTokens: previous.inputTokens + result.inputTokens, outputTokens: previous.outputTokens + result.outputTokens }));
      return result;
    } catch (cause) {
      const failure = controller.signal.aborted ? new AiError(timedOut ? "AI request timed out." : "AI request cancelled.") : cause;
      if (mounted.current) setError(failure instanceof Error ? failure.message : "AI analysis failed.");
      throw failure;
    } finally {
      clearTimeout(timer);
      controllers.current.delete(controller);
      if (running.current === controller) {
        running.current = null;
        if (mounted.current) setBusy(null);
      }
    }
  }, [ready, server.enabled, server.configured]);

  const value = useMemo<AiContextValue>(() => ({
    settings: { ...server, language }, ready,
    available: ready && server.enabled && server.configured, updating, refresh, update,
    busy, error, clearError: () => setError(null), cancel, run, usage,
  }), [server, language, ready, updating, refresh, update, busy, error, cancel, run, usage]);
  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

export function useAi() {
  const value = useContext(AiContext);
  if (!value) throw new Error("useAi must be used inside <AiProvider>");
  return value;
}
