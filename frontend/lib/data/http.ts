import type { LogEvent } from "../types";
import { apiRequest } from "../api";
import type { DayKey } from "./day";
import type {
  AppNotification,
  DataSource,
  DataStats,
  DayStat,
  DaySummary,
} from "./types";

export class HttpDataSource implements DataSource {
  readonly kind = "http" as const;

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    return apiRequest<T>(path, init);
  }

  private async list<T>(path: string): Promise<T[]> {
    return await this.req<T[] | null>(path) ?? [];
  }

  getRecentLogs = (limit: number) =>
    this.list<LogEvent>(`/logs/recent?limit=${limit}`);
  getDayLogs = (day: DayKey) => this.list<LogEvent>(`/days/${day}/logs`);
  listDays = () => this.list<DayStat>("/days");
  clearLogs = () => this.req<void>("/logs", { method: "DELETE" });
  listSummaries = () => this.list<DaySummary>("/summaries");
  saveSummary = (s: DaySummary) =>
    this.req<void>(`/days/${s.day}/summary`, {
      method: "PUT",
      body: JSON.stringify(s),
    });
  deleteSummary = (day: DayKey) =>
    this.req<void>(`/days/${day}/summary`, { method: "DELETE" });
  listNotifications = (limit = 100) =>
    this.list<AppNotification>(`/notifications?limit=${limit}`);
  saveNotifications = (items: AppNotification[]) =>
    this.req<void>("/notifications", {
      method: "PUT",
      body: JSON.stringify(items),
    });
  markAllNotificationsRead = () =>
    this.req<void>("/notifications/read-all", { method: "POST" });
  clearNotifications = () =>
    this.req<void>("/notifications", { method: "DELETE" });
  stats = () => this.req<DataStats>("/stats");
  exportAll = () => this.req<unknown>("/export");
  clearAll = () => this.req<void>("/all", { method: "DELETE" });
}
