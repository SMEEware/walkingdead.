export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type ServiceId = "http" | "ssh" | "telnet" | "ftp" | "redis" | "mysql";

export const SERVICE_IDS: ServiceId[] = ["http", "ssh", "telnet", "ftp", "redis", "mysql"];

export type EventType =
  | "connection"
  | "scan"
  | "auth_fail"
  | "auth_success"
  | "command"
  | "exploit"
  | "tunnel"
  | "blocked";

export type HoneypotMode = "passive" | "interactive" | "tarpit";

export interface HoneypotService {
  id: ServiceId;
  name: string;
  port: number;
  address: string;
  enabled: boolean;
  active: boolean;
  hits: number;
  error?: string;
}

export interface WebhookConfig {
  enabled: boolean;
  url?: string;
  format: "generic" | "slack" | "discord";
  minSeverity: Exclude<Severity, "info">;
}

export interface LogEvent {
  id: string;
  ts: number;
  service: ServiceId;
  type: EventType;
  severity: Severity;
  srcIp: string;
  country: string;
  message: string;
  user?: string;
  payload?: string;
  sessionId?: string;
  sensorId?: string;
  method?: string;
  path?: string;
  password?: string;
  command?: string;
  userAgent?: string;
  tags?: string[];
  tactics?: string[];
  iocs?: string[];
}

export interface ZombieCue {
  id: number;
  clip: ZombieClip;
  priority: number;
  severity: Severity;
  reason: string;
}

export const ZOMBIE_CLIPS = [
  "Idle",
  "Walk",
  "Walk_Grab",
  "Run",
  "Idle_Attack",
  "Roar",
  "HitReact",
  "Death",
] as const;

export type ZombieClip = (typeof ZOMBIE_CLIPS)[number];
