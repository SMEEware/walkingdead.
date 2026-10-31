import type { LogEvent } from "./types";

export const eventsCsv = (rows: LogEvent[]) => {
  const esc = (v: string | undefined) => {
    const value = v ?? "";
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const head =
    "event_id,session_id,sensor_id,timestamp,service,type,severity,src_ip,country,user,password,command,user_agent,tags,tactics,iocs,message,payload,method,path";
  return [
    head,
    ...rows.map((r) =>
      [
        r.id,
        r.sessionId,
        r.sensorId,
        new Date(r.ts).toISOString(),
        r.service,
        r.type,
        r.severity,
        r.srcIp,
        r.country,
        r.user,
        r.password,
        r.command,
        r.userAgent,
        r.tags?.join(" "),
        r.tactics?.join(" "),
        r.iocs?.join(" "),
        r.message,
        r.payload,
        r.method,
        r.path,
      ]
        .map((v) => esc(typeof v === "string" ? v : undefined))
        .join(","),
    ),
  ].join("\n");
};
