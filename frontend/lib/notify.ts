import { SEVERITY_RANK } from "./constants";
import type { AppNotification } from "./data/types";
import type { LogEvent, Severity } from "./types";

export type DraftNotification = Pick<
  AppNotification,
  "kind" | "severity" | "title" | "body" | "ref"
> & {
  /** Alerts with the same group within a short window are merged into one notification. */
  group: string;
};

const TYPE_LABEL: Record<string, string> = {
  scan: "Scan detected",
  auth_fail: "Failed logins",
  auth_success: "Trap triggered",
  command: "Command executed",
  exploit: "Exploit attempt",
};

export function eventToNotification(
  e: LogEvent,
  min: Severity,
): DraftNotification | null {
  // Blocks are folded into the exploit alert that caused them; plain connections are noise.
  if (e.type === "blocked" || e.type === "connection") return null;
  if (SEVERITY_RANK[e.severity] < SEVERITY_RANK[min]) return null;

  const svc = e.service.toUpperCase();
  const origin = `${e.srcIp} (${e.country})`;
  const detail = e.payload ?? e.message;
  const body =
    e.type === "exploit" || e.type === "command"
      ? `${detail} · ${origin}`
      : `${e.message} · ${origin}`;

  return {
    kind: "alert",
    severity: e.severity,
    title: `${TYPE_LABEL[e.type] ?? e.type} on ${svc}`,
    body,
    ref: { type: "log", id: e.id },
    group: `${e.srcIp}:${e.type}`,
  };
}
