import type { Severity } from "./types";

export const SEVERITY_STYLE: Record<
  Severity,
  { label: string; text: string; chip: string; dot: string }
> = {
  info: {
    label: "INFO",
    text: "text-zinc-400",
    chip: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
    dot: "bg-zinc-400",
  },
  low: {
    label: "LOW",
    text: "text-ice",
    chip: "bg-ice/10 text-ice ring-ice/30",
    dot: "bg-ice",
  },
  medium: {
    label: "MED",
    text: "text-ember",
    chip: "bg-ember/10 text-ember ring-ember/30",
    dot: "bg-ember",
  },
  high: {
    label: "HIGH",
    text: "text-orange-400",
    chip: "bg-orange-500/10 text-orange-400 ring-orange-500/30",
    dot: "bg-orange-400",
  },
  critical: {
    label: "CRIT",
    text: "text-blood",
    chip: "bg-blood/10 text-blood ring-blood/40",
    dot: "bg-blood",
  },
};

export const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export const formatDateTime = (ts: number) =>
  new Date(ts).toLocaleString("en-GB", {
    timeZone: "UTC",
    timeZoneName: "short",
    hourCycle: "h23",
    year: "numeric",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
