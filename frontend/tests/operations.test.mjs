import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Use the project's compiler so the tests also run on Node versions without native TS loading.
const source = await readFile(new URL("../lib/operations.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { getSentinelStatus, activityBuckets } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const now = 200_000;
const event = (patch = {}) => ({ id: "evt-1", ts: now - 1000, service: "ssh", type: "exploit", severity: "critical", srcIp: "192.0.2.1", country: "DE", message: "Exploit detected", ...patch });
const status = (patch = {}) => getSentinelStatus({ running: true, ready: true, enabledServices: 4, latestEvent: event(), now, ...patch });

test("shutdown takes precedence over a queued critical event", () => {
  assert.equal(status({ running: false }).phase, "offline");
});
test("startup and zero-listener states never report active observation", () => {
  assert.equal(status({ ready: false }).phase, "initializing");
  assert.equal(status({ enabledServices: 0 }).phase, "standby");
});
test("fresh threats react, expired or future threats do not", () => {
  assert.equal(status().phase, "responding");
  assert.equal(status({ latestEvent: event({ ts: now - 7000 }) }).phase, "observing");
  assert.equal(status({ latestEvent: event({ ts: now + 1 }) }).phase, "observing");
});
test("scans and confirmed blocks get distinct operational descriptions", () => {
  assert.equal(status({ latestEvent: event({ type: "scan", severity: "low" }) }).label, "Inspecting connection");
  assert.equal(status({ latestEvent: event({ type: "blocked", severity: "medium" }) }).label, "Source isolated");
});
test("signal buckets enforce time boundaries and count severity separately", () => {
  const buckets = activityBuckets([
    event({ ts: now }), event({ ts: now - 4999, severity: "low" }),
    event({ ts: now - 5000 }), event({ ts: now - 119999 }),
    event({ ts: now - 120000 }), event({ ts: now + 1 }),
  ], now);
  assert.equal(buckets[23].total, 2);
  assert.equal(buckets[23].critical, 1);
  assert.equal(buckets[22].total, 1);
  assert.equal(buckets[0].total, 1);
  assert.equal(buckets.reduce((sum, b) => sum + b.total, 0), 4);
});
test("invalid or empty signal windows remain safe", () => {
  assert.deepEqual(activityBuckets([], now, 0), []);
  assert.deepEqual(activityBuckets([], now, 24, 0), []);
  assert.equal(activityBuckets([], now).every((b) => b.total === 0), true);
});
