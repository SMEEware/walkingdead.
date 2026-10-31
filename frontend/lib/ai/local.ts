import type { DayAnalysis } from "../analytics";
import { sortedEntries } from "../analytics";
import { formatDayLong, type DayKey } from "../data/day";
import type { AiLanguage } from "./types";

const T = {
  en: {
    overview: "Overview",
    notable: "Notable activity",
    behavior: "Attacker behavior",
    recs: "Recommendations",
    summary: (
      n: number,
      ips: number,
      day: string,
      c: number,
      h: number,
      peak: string,
      pc: number,
    ) =>
      `${n} events from ${ips} unique sources on ${day}. ${c} critical and ${h} high-severity events. Peak activity at ${peak} (${pc} events).`,
    none: "No high-severity activity recorded.",
    times: "×",
    service: (s: string, n: number) =>
      `Most targeted service: **${s}** (${n} events)`,
    source: (ip: string, cc: string, n: number, sev: string) =>
      `Top source: \`${ip}\` (${cc}) with ${n} events, max severity ${sev}`,
    users: (u: string) => `Most tried usernames: ${u}`,
    recCrit: (n: number) =>
      `Review the ${n} critical events against the original evidence before choosing a response.`,
    recHigh: "Review high-severity events and correlate their session timelines before choosing a response.",
    recTrap:
      "Review authentication and command observations in their session timeline; decoy activity does not establish a real-host compromise.",
    recQuiet: "No high-severity observations recorded. Check collection coverage and retention before drawing conclusions.",
  },
  de: {
    overview: "Überblick",
    notable: "Auffällige Aktivität",
    behavior: "Angreiferverhalten",
    recs: "Empfehlungen",
    summary: (
      n: number,
      ips: number,
      day: string,
      c: number,
      h: number,
      peak: string,
      pc: number,
    ) =>
      `${n} Ereignisse von ${ips} verschiedenen Quellen am ${day}. ${c} kritische und ${h} hochgradige Ereignisse. Spitzenaktivität um ${peak} (${pc} Ereignisse).`,
    none: "Keine Aktivität mit hohem Schweregrad.",
    times: "×",
    service: (s: string, n: number) =>
      `Am häufigsten angegriffener Dienst: **${s}** (${n} Ereignisse)`,
    source: (ip: string, cc: string, n: number, sev: string) =>
      `Top-Quelle: \`${ip}\` (${cc}) mit ${n} Ereignissen, max. Schweregrad ${sev}`,
    users: (u: string) => `Meistgenutzte Benutzernamen: ${u}`,
    recCrit: (n: number) =>
      `Die ${n} kritischen Ereignisse anhand der Originaldaten prüfen, bevor eine Reaktion gewählt wird.`,
    recHigh: "Die hochgradigen Ereignisse und ihre Sitzungsverläufe vor einer Reaktion gemeinsam prüfen.",
    recTrap:
      "Authentifizierungs- und Befehlsereignisse im Sitzungsverlauf prüfen; Köderaktivität belegt keine Kompromittierung eines echten Hosts.",
    recQuiet: "Keine Ereignisse mit hohem Schweregrad aufgezeichnet. Erfassungsabdeckung und Aufbewahrung vor Schlussfolgerungen prüfen.",
  },
} as const;

/** Deterministic briefing used when AI is off or unavailable. */
export function localDigest(
  day: DayKey,
  a: DayAnalysis,
  language: AiLanguage,
): string {
  const t = T[language];
  const peak = `${String(a.peakHour).padStart(2, "0")}:00 UTC`;
  const topService = sortedEntries(a.byService)[0];
  const topSource = a.topSources[0];
  const lines: string[] = [
    `## ${t.overview}`,
    t.summary(
      a.total,
      a.uniqueIps,
      formatDayLong(day),
      a.bySeverity.critical,
      a.bySeverity.high,
      peak,
      a.hourly[a.peakHour] ?? 0,
    ),
    "",
    `## ${t.notable}`,
  ];

  if (a.notable.length) {
    for (const n of a.notable.slice(0, 5)) {
      lines.push(
        `- **${n.service.toUpperCase()}** ${n.type} (${n.severity}) — ${n.payload ?? n.message} ${t.times}${n.count}`,
      );
    }
  } else lines.push(`- ${t.none}`);

  lines.push("", `## ${t.behavior}`);
  if (topService)
    lines.push(`- ${t.service(topService[0].toUpperCase(), topService[1])}`);
  if (topSource)
    lines.push(
      `- ${t.source(topSource.ip, topSource.country, topSource.count, topSource.maxSeverity)}`,
    );
  if (a.topUsers.length)
    lines.push(
      `- ${t.users(
        a.topUsers
          .slice(0, 4)
          .map(([u]) => `\`${u}\``)
          .join(", "),
      )}`,
    );

  lines.push("", `## ${t.recs}`);
  if (a.bySeverity.critical)
    lines.push(`- ${t.recCrit(a.bySeverity.critical)}`);
  else if (a.bySeverity.high) lines.push(`- ${t.recHigh}`);
  if (a.byType.auth_success || a.byType.command) lines.push(`- ${t.recTrap}`);
  if (!a.bySeverity.critical && !a.bySeverity.high && !a.byType.auth_success && !a.byType.command)
    lines.push(`- ${t.recQuiet}`);

  return lines.join("\n");
}
