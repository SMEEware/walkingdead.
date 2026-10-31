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

import { getDataSource } from "../lib/data";
import type { AppNotification } from "../lib/data/types";
import { eventToNotification } from "../lib/notify";
import type { LogEvent } from "../lib/types";
import { useSettings } from "./SettingsProvider";

const LOAD_LIMIT = 60;
const MAX_TOASTS = 4;
const GROUP_WINDOW_MS = 45_000;

interface Toast {
  id: string;
  notification: AppNotification;
}

interface NotificationContextValue {
  items: AppNotification[];
  unread: number;
  toasts: Toast[];
  pushEvents: (events: LogEvent[]) => void;
  push: (
    n: Pick<AppNotification, "kind" | "severity" | "title" | "body"> &
      Partial<Pick<AppNotification, "ref" | "group">>,
  ) => void;
  markAllRead: () => void;
  clear: () => void;
  dismissToast: (id: string) => void;
  version: number;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

const mergeable = (a: AppNotification, b: AppNotification) =>
  !!a.group && a.group === b.group && b.ts - a.ts < GROUP_WINDOW_MS;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState(0);
  const settingsRef = useRef(settings);
  const itemsRef = useRef(items);
  const toastTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = toastTimers.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    itemsRef.current = items;
  }, [settings, items]);

  useEffect(() => {
    let alive = true;
    getDataSource()
      .listNotifications(LOAD_LIMIT)
      .then((list) => alive && setItems(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const dismissToast = useCallback(
    (id: string) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );

  const showToast = useCallback((n: AppNotification) => {
    const toast = { id: `${n.id}:${Date.now().toString(36)}`, notification: n };
    setToasts((t) => [...t.slice(-(MAX_TOASTS - 1)), toast]);
    const timer = setTimeout(() => {
      toastTimers.current.delete(timer);
      setToasts((t) => t.filter((x) => x.id !== toast.id));
    }, 7000);
    toastTimers.current.add(timer);
  }, []);

  const add = useCallback(
    (drafts: AppNotification[]) => {
      if (!drafts.length) return;
      const next = [...itemsRef.current];
      const toStore: AppNotification[] = [];
      for (const draft of drafts) {
        const idx = next.findIndex((n) => mergeable(n, draft));
        if (idx >= 0) {
          const merged = {
            ...next[idx],
            ts: draft.ts,
            count: (next[idx].count ?? 1) + 1,
            body: draft.body,
            read: false,
          };
          next[idx] = merged;
          toStore.push(merged);
        } else {
          next.unshift(draft);
          toStore.push(draft);
          if (settingsRef.current.toasts) showToast(draft);
        }
      }
      next.sort((a, b) => b.ts - a.ts);
      setItems(next.slice(0, LOAD_LIMIT));
      setVersion((v) => v + 1);
      void getDataSource().saveNotifications(toStore).catch(() => undefined);
    },
    [showToast],
  );

  const push = useCallback<NotificationContextValue["push"]>(
    (partial) => {
      add([
        {
          id: `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          read: false,
          ...partial,
        },
      ]);
    },
    [add],
  );

  const pushEvents = useCallback(
    (events: LogEvent[]) => {
      const drafts = events
        .map((e) =>
          eventToNotification(e, settingsRef.current.notifyMinSeverity),
        )
        .filter((d): d is NonNullable<typeof d> => !!d)
        .map((d) => ({
          id: `ntf_${d.group.replace(/[^\w]+/g, "_")}_${Date.now().toString(36)}`,
          ts: Date.now(),
          read: false,
          kind: d.kind,
          severity: d.severity,
          title: d.title,
          body: d.body,
          ref: d.ref,
          group: d.group,
        }));
      add(drafts);
    },
    [add],
  );

  const markAllRead = useCallback(() => {
    setItems((list) => list.map((n) => (n.read ? n : { ...n, read: true })));
    void getDataSource().markAllNotificationsRead().catch(() => undefined);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setToasts([]);
    void getDataSource().clearNotifications().catch(() => undefined);
    setVersion((v) => v + 1);
  }, []);

  const value = useMemo<NotificationContextValue>(
    () => ({
      items,
      unread: items.filter((n) => !n.read).length,
      toasts,
      pushEvents,
      push,
      markAllRead,
      clear,
      dismissToast,
      version,
    }),
    [
      items,
      toasts,
      pushEvents,
      push,
      markAllRead,
      clear,
      dismissToast,
      version,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx)
    throw new Error(
      "useNotifications must be used inside <NotificationProvider>",
    );
  return ctx;
}
