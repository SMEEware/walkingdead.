import type { Severity } from "./types";

export const APP_NAME = "Walking Dead";
export const APP_DESCRIPTION =
  "Walking Dead – a zombie-themed honeypot control center.";

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
