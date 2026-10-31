import { apiRequest } from "../api";
import type { AiRun, AiTask, AiReference, ManagedAiPatch, ManagedAiSettings } from "./types";

export class AiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export function aiReference(task: AiTask, reference: AiReference) {
  if (task === "explain" && reference.eventId) return { task, eventId: reference.eventId };
  if (task === "digest" && reference.day) return { task, day: reference.day };
  throw new AiError("Select a captured event or UTC day first.");
}

export function runManagedAi(task: AiTask, reference: AiReference, signal: AbortSignal): Promise<AiRun> {
  return apiRequest("/ai", { method: "POST", body: JSON.stringify(aiReference(task, reference)), signal });
}

export function updateManagedAi(patch: ManagedAiPatch, signal: AbortSignal): Promise<ManagedAiSettings> {
  const { enabled, model, redactIps, includePayloads } = patch;
  return apiRequest("/ai/settings", { method: "PUT", body: JSON.stringify({ enabled, model, redactIps, includePayloads }), signal });
}
