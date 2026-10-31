import type { LogEvent } from "./types";

export type SentinelPhase = "initializing" | "offline" | "standby" | "observing" | "investigating" | "responding";
export type SignalTone = "neutral" | "mint" | "amber" | "red";

export interface SentinelStatus {
  phase: SentinelPhase;
  label: string;
  description: string;
  tone: SignalTone;
}

/** Operational state stays independent of the model's animation names. */
export function getSentinelStatus({ running, ready, enabledServices, latestEvent, now }: {
  running: boolean;
  ready: boolean;
  enabledServices: number;
  latestEvent?: LogEvent;
  now: number;
}): SentinelStatus {
  if (!running) return { phase: "offline", label: "System offline", description: "Listeners stopped. Your collected intelligence is preserved.", tone: "neutral" };
  if (!ready) return { phase: "initializing", label: "Establishing observation", description: "Connecting the event store and preparing listeners.", tone: "neutral" };
  if (enabledServices === 0) return { phase: "standby", label: "Waiting for listeners", description: "Enable a service to begin observing connections.", tone: "neutral" };
  const age = latestEvent ? now - latestEvent.ts : Infinity;
  if (latestEvent && age >= 0 && age < 7_000) {
    if (latestEvent.severity === "critical" || latestEvent.severity === "high") return { phase: "responding", label: "Threat activity detected", description: `${latestEvent.service.toUpperCase()} · ${latestEvent.message}`, tone: "red" };
    if (latestEvent.type === "scan" || latestEvent.type === "blocked") return { phase: "investigating", label: latestEvent.type === "blocked" ? "Source isolated" : "Inspecting connection", description: `${latestEvent.service.toUpperCase()} · ${latestEvent.message}`, tone: "amber" };
  }
  return { phase: "observing", label: "Observing your perimeter", description: `${enabledServices} services listening. Every interaction becomes intelligence.`, tone: "mint" };
}

export interface ActivityBucket { total: number; critical: number }

/** Fixed-duration buckets, including the current window but never future events. */
export function activityBuckets(logs: readonly LogEvent[], now: number, count = 24, windowMs = 120_000): ActivityBucket[] {
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(windowMs) || windowMs <= 0) return [];
  const buckets = Array.from({ length: count }, () => ({ total: 0, critical: 0 }));
  const bucketMs = windowMs / count;
  for (const log of logs) {
    const age = now - log.ts;
    if (age < 0 || age >= windowMs) continue;
    const index = count - 1 - Math.floor(age / bucketMs);
    buckets[index].total++;
    if (log.severity === "critical" || log.severity === "high") buckets[index].critical++;
  }
  return buckets;
}
