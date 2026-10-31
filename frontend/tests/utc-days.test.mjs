import test from "node:test";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";

const run = promisify(execFile);
const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const dayUrl = moduleUrl(await compile("../lib/data/day.ts"));
const uiUrl = moduleUrl(await compile("../lib/ui.ts"));
const constantsUrl = moduleUrl(await compile("../lib/constants.ts"));
const analyticsUrl = moduleUrl((await compile("../lib/analytics.ts")).replace('from "./constants"', `from ${JSON.stringify(constantsUrl)}`));

for (const timezone of ["Europe/Berlin", "America/Los_Angeles"]) {
  test(`UTC partitions, shifts, labels and hour bins stay stable in ${timezone}`, async () => {
    const script = `
      import assert from "node:assert/strict";
      const { dayKey, dayDate, dayStartMs, shiftDay, formatDayLong, formatDayShort, formatWeekday } = await import(${JSON.stringify(dayUrl)});
      const { formatTime, formatDateTime } = await import(${JSON.stringify(uiUrl)});
      const { analyzeDay } = await import(${JSON.stringify(analyticsUrl)});
      const evening = Date.parse("2026-10-17T22:15:00Z");
      const midnight = Date.parse("2026-10-18T00:15:00Z");
      assert.equal(dayKey(evening), "2026-10-17");
      assert.equal(dayKey(midnight), "2026-10-18");
      assert.equal(dayDate("2026-10-17").toISOString(), "2026-10-17T00:00:00.000Z");
      assert.equal(dayStartMs("2026-10-17"), Date.UTC(2026, 9, 17));
      assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
      assert.equal(shiftDay("2024-02-28", 1), "2024-02-29");
      for (const day of ["2026-03-08", "2026-03-29", "2026-10-25", "2026-11-01"]) {
        const next = shiftDay(day, 1);
        assert.equal(dayStartMs(next) - dayStartMs(day), 86_400_000);
        assert.equal(shiftDay(next, -1), day);
      }
      assert.equal(formatDayLong("2026-10-17"), "Saturday, 17 October 2026");
      assert.equal(formatDayShort("2026-10-17"), "17 Oct");
      assert.equal(formatWeekday("2026-10-17"), "Sat");
      assert.equal(formatTime(evening), "22:15:00");
      assert.equal(formatTime(midnight), "00:15:00");
      assert.equal(formatDateTime(evening), "17 Oct 2026, 22:15:00 UTC");
      const event = (ts, severity = "info") => ({ id: String(ts), ts, service: "http", type: "connection", severity, srcIp: "192.0.2.1", country: "", message: "HTTP request" });
      const analysis = analyzeDay([event(evening, "critical"), event(evening + 30 * 60_000), event(Date.parse("2026-10-17T23:59:59Z"))]);
      assert.equal(analysis.hourly[22], 2);
      assert.equal(analysis.hourly[23], 1);
      assert.equal(analysis.hourlyCritical[22], 1);
      assert.equal(analysis.peakHour, 22);
      const repeatedLocalHour = analyzeDay([event(Date.parse("2026-10-25T00:30:00Z")), event(Date.parse("2026-10-25T01:30:00Z"))]);
      assert.equal(repeatedLocalHour.hourly[0], 1);
      assert.equal(repeatedLocalHour.hourly[1], 1);
    `;
    await run(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: timezone } });
  });
}
