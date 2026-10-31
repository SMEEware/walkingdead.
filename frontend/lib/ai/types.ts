import type { DayKey } from "../data/day";

export type AiTask = "explain" | "digest";
export type AiLanguage = "en" | "de";
export interface AiReference { eventId?: string; day?: DayKey }

export interface AiRun {
  text: string;
  provider: "deepseek";
  model: ManagedAiModel;
  inputTokens: number;
  outputTokens: number;
  findings: AiFinding[];
  limitations: string[];
  sampledEvents: number;
  totalEvents: number;
}

export type ManagedAiModel = "deepseek-flash" | "deepseek-v4-pro";

export interface ManagedAiSettings {
  provider: "deepseek";
  enabled: boolean;
  configured: boolean;
  model: ManagedAiModel;
  redactIps: boolean;
  includePayloads: boolean;
  maxEvents: number;
  maxOutputTokens: number;
}

export type ManagedAiPatch = Partial<Pick<ManagedAiSettings, "enabled" | "model" | "redactIps" | "includePayloads">>;

export interface AiFinding {
  title: string;
  assessment: string;
  evidenceIds: string[];
  confidence: string;
}
