import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/evidence-export.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { eventsCsv } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("CSV neutralizes attacker-controlled formulas while preserving evidence references", () => {
 const csv=eventsCsv([{id:"event-1",sessionId:"session-1",sensorId:"local-http",ts:0,service:"http",type:"scan",severity:"low",srcIp:"192.0.2.1",country:"Unknown",message:'=HYPERLINK("https://invalid.example")',payload:"\t+SUM(1,2)",path:"/admin",method:"GET",user:"@malicious"}]);
 assert.match(csv,/event_id,session_id,sensor_id/);
 assert.match(csv,/"event-1","session-1","local-http"/);
 assert.match(csv,/"'=HYPERLINK\(""https:\/\/invalid.example""\)"/);
 assert.match(csv,/"'\t\+SUM\(1,2\)"/);
 assert.match(csv,/"'@malicious"/);
 assert.match(csv,/"GET","\/admin"/);
});
