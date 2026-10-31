"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_THEME,
  SETTINGS_KEY,
  THEMES,
  getTheme,
  type Theme,
  type ThemeId,
} from "../lib/themes";
import type { Severity } from "../lib/types";

export interface Settings {
  theme: ThemeId;
  autoRotate: boolean;
  particles: boolean;
  bloom: boolean;
  toasts: boolean;
  notifySystem: boolean;
  notifyMinSeverity: Severity;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
  autoRotate: true,
  particles: true,
  bloom: true,
  toasts: true,
  notifySystem: true,
  notifyMinSeverity: "high",
};

interface SettingsContextValue {
  settings: Settings;
  theme: Theme;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyTheme(id: ThemeId) {
  const t = getTheme(id);
  const root = document.documentElement;
  root.style.setProperty("--accent", t.accent);
  root.style.setProperty("--alert", t.alert);
  root.dataset.theme = t.id;
}

function persist(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); the setting still applies for this session.
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const ref = useRef(settings);

  // Read after mount so server and client render the same defaults.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const stored = JSON.parse(
          localStorage.getItem(SETTINGS_KEY) ?? "{}",
        ) as Partial<Settings>;
        const next: Settings = {
          ...DEFAULT_SETTINGS,
          ...stored,
          theme: THEMES.some((x) => x.id === stored.theme)
            ? (stored.theme as ThemeId)
            : DEFAULT_THEME,
        };
        ref.current = next;
        setSettings(next);
        applyTheme(next.theme);
      } catch {
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setSettings(next);
    persist(next);
    applyTheme(next.theme);
  }, []);

  const reset = useCallback(
    () =>
      update({
        theme: DEFAULT_SETTINGS.theme,
        autoRotate: DEFAULT_SETTINGS.autoRotate,
        particles: DEFAULT_SETTINGS.particles,
        bloom: DEFAULT_SETTINGS.bloom,
      }),
    [update],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, theme: getTheme(settings.theme), update, reset }),
    [settings, update, reset],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx)
    throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
