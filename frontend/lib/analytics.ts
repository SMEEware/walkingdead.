import { SEVERITY_RANK } from "./constants";
import type { LogEvent, Severity } from "./types";

export interface SourceSummary {
  ip: string;
  country: string;
  count: number;
  maxSeverity: Severity;
  services: string[];
  types: string[];
  first: number;
  last: number;
}

export interface NotableEvent {
  type: string;
  service: string;
  severity: Severity;
  message: string;
  payload?: string;
  count: number;
  first: number;
  last: number;
  sources: string[];
}

export interface DayAnalysis {
  total: number;
  uniqueIps: number;
  bySeverity: Record<Severity, number>;
  byType: Record<string, number>;
  byService: Record<string, number>;
  hourly: number[];
  hourlyCritical: number[];
  peakHour: number;
  topSources: SourceSummary[];
  topCountries: [string, number][];
  topUsers: [string, number][];
  notable: NotableEvent[];
}

const top = <T>(map: Map<string, T>, score: (v: T) => number, n: number) =>
  [...map.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, n);

export function analyzeDay(logs: LogEvent[]): DayAnalysis {
  const bySeverity: Record<Severity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const byType: Record<string, number> = {};
  const byService: Record<string, number> = {};
  const hourly = new Array<number>(24).fill(0);
  const hourlyCritical = new Array<number>(24).fill(0);
  const sources = new Map<string, SourceSummary>();
  const countries = new Map<string, number>();
  const users = new Map<string, number>();
  const notable = new Map<string, NotableEvent>();

  for (const e of logs) {
    bySeverity[e.severity]++;
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    byService[e.service] = (byService[e.service] ?? 0) + 1;
    const hour = new Date(e.ts).getUTCHours();
    hourly[hour]++;
    if (e.severity === "critical") hourlyCritical[hour]++;
    countries.set(e.country, (countries.get(e.country) ?? 0) + 1);
    if (e.user) users.set(e.user, (users.get(e.user) ?? 0) + 1);

    const src = sources.get(e.srcIp) ?? {
      ip: e.srcIp,
      country: e.country,
      count: 0,
      maxSeverity: "info" as Severity,
      services: [],
      types: [],
      first: e.ts,
      last: e.ts,
    };
    src.count++;
    if (SEVERITY_RANK[e.severity] > SEVERITY_RANK[src.maxSeverity])
      src.maxSeverity = e.severity;
    if (!src.services.includes(e.service)) src.services.push(e.service);
    if (!src.types.includes(e.type)) src.types.push(e.type);
    src.first = Math.min(src.first, e.ts);
    src.last = Math.max(src.last, e.ts);
    sources.set(e.srcIp, src);

    if (
      SEVERITY_RANK[e.severity] >= SEVERITY_RANK.high &&
      e.type !== "blocked"
    ) {
      const key = `${e.type}|${e.service}|${e.payload ?? e.message}`;
      const n = notable.get(key) ?? {
        type: e.type,
        service: e.service,
        severity: e.severity,
        message: e.message,
        payload: e.payload,
        count: 0,
        first: e.ts,
        last: e.ts,
        sources: [],
      };
      n.count++;
      n.first = Math.min(n.first, e.ts);
      n.last = Math.max(n.last, e.ts);
      if (!n.sources.includes(e.srcIp) && n.sources.length < 5)
        n.sources.push(e.srcIp);
      notable.set(key, n);
    }
  }

  const peakHour = hourly.indexOf(Math.max(...hourly));
  const topSources = top(
    sources,
    (s) => s.count * (1 + SEVERITY_RANK[s.maxSeverity]),
    20,
  ).map(([, s]) => s);
  const notableList = [...notable.values()]
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.count - a.count,
    )
    .slice(0, 30);

  return {
    total: logs.length,
    uniqueIps: sources.size,
    bySeverity,
    byType,
    byService,
    hourly,
    hourlyCritical,
    peakHour: Math.max(0, peakHour),
    topSources,
    topCountries: top(countries, (n) => n, 6),
    topUsers: top(users, (n) => n, 8),
    notable: notableList,
  };
}

export const sortedEntries = (rec: Record<string, number>) =>
  Object.entries(rec).sort((a, b) => b[1] - a[1]);
