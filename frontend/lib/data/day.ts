export type DayKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

// UTC day boundaries match the backend's persisted event partitions.
export const dayKey = (ts: number): DayKey => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const dayDate = (day: DayKey) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const dayStartMs = (day: DayKey) => dayDate(day).getTime();

export const shiftDay = (day: DayKey, delta: number): DayKey => {
  const d = dayDate(day);
  d.setUTCDate(d.getUTCDate() + delta);
  return dayKey(d.getTime());
};

export const formatDayLong = (day: DayKey) =>
  dayDate(day).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export const formatDayShort = (day: DayKey) =>
  dayDate(day).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });

export const formatWeekday = (day: DayKey) =>
  dayDate(day).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export function timeAgo(ts: number, now: number) {
  if (!now) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}
