import type { LogEvent, Severity } from "../types";
import type { DayKey } from "./day";

export interface DayStat {
  day: DayKey;
  total: number;
  bySeverity: Record<Severity, number>;
}

export interface DaySummary {
  day: DayKey;
  source: "ai" | "local";
  text: string;
  logCount: number;
  createdAt: number;
  provider?: "deepseek";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type NotificationKind = "alert" | "system" | "ai";

export interface AppNotification {
  id: string;
  ts: number;
  kind: NotificationKind;
  severity: Severity;
  title: string;
  body: string;
  read: boolean;
  count?: number;
  group?: string;
  ref?: { type: "log"; id: string } | { type: "day"; day: DayKey };
}

export interface DataStats {
  logs: number;
  days: number;
  summaries: number;
  notifications: number;
}

export interface DataSource {
  readonly kind: "http";
  getRecentLogs(limit: number): Promise<LogEvent[]>;
  getDayLogs(day: DayKey): Promise<LogEvent[]>;
  listDays(): Promise<DayStat[]>;
  clearLogs(): Promise<void>;
  listSummaries(): Promise<DaySummary[]>;
  saveSummary(summary: DaySummary): Promise<void>;
  deleteSummary(day: DayKey): Promise<void>;
  listNotifications(limit?: number): Promise<AppNotification[]>;
  saveNotifications(items: AppNotification[]): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  clearNotifications(): Promise<void>;
  stats(): Promise<DataStats>;
  exportAll(): Promise<unknown>;
  clearAll(): Promise<void>;
}
