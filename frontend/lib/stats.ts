import { SEVERITY_RANK } from "./constants";
import type { LogEvent } from "./types";

const BUCKETS = 30;
const BUCKET_MS = 30_000;
const SEVERITY_WEIGHT = [0, 0.15, 0.4, 0.75, 1];

export function computeStats(logs: LogEvent[]) {
  const ips = new Set<string>();
  let critical = 0;
  for (const l of logs) {
    ips.add(l.srcIp);
    if (l.severity === "critical") critical++;
  }

  // Reference the newest event so the chart never depends on the render-time clock.
  const end = logs[0]?.ts ?? 0;
  const series = new Array<number>(BUCKETS).fill(0);
  for (const l of logs) {
    const idx = BUCKETS - 1 - Math.floor((end - l.ts) / BUCKET_MS);
    // A clamp keeps an out-of-range index from turning the array into NaN.
    if (idx >= 0 && idx < BUCKETS) series[idx]++;
  }

  return { total: logs.length, critical, uniqueIps: ips.size, series };
}

// Recency-weighted average severity of the newest events, scaled to 0-100.
export function computeThreat(logs: LogEvent[]) {
  let sum = 0;
  let weights = 0;
  logs.slice(0, 30).forEach((l, i) => {
    const w = Math.pow(0.92, i);
    sum += w * SEVERITY_WEIGHT[SEVERITY_RANK[l.severity]];
    weights += w;
  });
  return weights ? Math.min(100, Math.round((sum / weights) * 190)) : 0;
}

export function threatLabel(score: number) {
  if (score < 20) return "Calm";
  if (score < 45) return "Elevated";
  if (score < 70) return "High";
  return "Critical";
}
