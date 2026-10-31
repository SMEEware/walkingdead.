import { useEffect, useState } from "react";

import { API_BASE, ApiError, apiRequest } from "./api";
import type { LogEvent, ServiceId, Severity } from "./types";

export interface Attacker {
  ip: string;
  firstSeen: number;
  lastSeen: number;
  events: number;
  sessions: number;
  services: ServiceId[];
  severity: Severity;
  score: number;
  tags: string[];
  tactics: string[];
  credentials: number;
  commands: number;
  compromised: boolean;
  blocked: boolean;
  bySeverity: Partial<Record<Severity, number>>;
}

export interface Counted {
  value: string;
  count: number;
}

export interface Intel {
  events: number;
  attackers: number;
  compromised: number;
  blocked: number;
  services: Counted[];
  usernames: Counted[];
  passwords: Counted[];
  pairs: { user: string; password: string; count: number }[];
  tags: Counted[];
  tactics: { id: string; name: string; count: number }[];
  paths: Counted[];
  commands: Counted[];
  userAgents: Counted[];
  iocs: Counted[];
  heatmap: number[][];
}

export interface BlockEntry {
  ip: string;
  reason: string;
  source: "manual" | "auto";
  createdAt: number;
}

export type BlocklistFormat = "txt" | "iptables" | "nftables" | "pf" | "csv";

export const threatsApi = {
  attackers: () => apiRequest<Attacker[]>("/attackers?limit=1000"),
  attacker: (ip: string) => apiRequest<{ attacker: Attacker; events: LogEvent[] }>(`/attackers/${encodeURIComponent(ip)}`),
  intel: () => apiRequest<Intel>("/intel"),
  blocklist: () => apiRequest<BlockEntry[]>("/blocklist"),
  block: (ip: string, reason?: string) => apiRequest<void>("/blocklist", { method: "POST", body: JSON.stringify({ ip, reason }) }),
  unblock: (ip: string) => apiRequest<void>(`/blocklist/${encodeURIComponent(ip)}`, { method: "DELETE" }),
  testWebhook: () => apiRequest<void>("/webhook/test", { method: "POST" }),
};

export async function downloadBlocklist(format: BlocklistFormat) {
  const response = await fetch(`${API_BASE}/blocklist/export?format=${format}`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new ApiError(`Export failed (${response.status}).`, response.status);
  const blob = await response.blob();
  const name = /filename=([^;]+)/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `blocklist.${format}`;
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useThreatData<T>(load: () => Promise<T>, version: number, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    load()
      .then((data) => alive && setState({ data, error: null }))
      .catch((cause) => alive && setState((s) => ({ data: s.data, error: cause instanceof Error ? cause.message : "Request failed." })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}

export const TAG_LABEL: Record<string, string> = {
  "sql-injection": "SQL injection",
  "command-injection": "Command injection",
  "path-traversal": "Path traversal",
  "log4shell": "Log4Shell",
  "shellshock": "Shellshock",
  "exploit-probe": "Exploit probe",
  "secret-harvesting": "Secret harvesting",
  "cms-probe": "CMS probe",
  "admin-panel-probe": "Admin panel probe",
  "credential-attempt": "Credential attempt",
  "default-credentials": "Default credentials",
  "malware-download": "Malware download",
  "cryptominer": "Cryptominer",
  "defense-evasion": "Defense evasion",
  "persistence": "Persistence",
  "execution": "Execution",
  "botnet": "Botnet",
  "discovery": "Discovery",
  "redis-exploit": "Redis exploit",
  "redis-recon": "Redis recon",
  "proxy-abuse": "Proxy abuse",
  "scanner": "Scanner",
  "automated-client": "Automated client",
  "no-user-agent": "No user agent",
  "unusual-method": "Unusual method",
  "xss": "XSS",
};

export const tagLabel = (tag: string) => TAG_LABEL[tag] ?? tag;
