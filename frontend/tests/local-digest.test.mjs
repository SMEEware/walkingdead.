import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const uri = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const constants = uri(await compile("../lib/constants.ts"));
const day = uri(await compile("../lib/data/day.ts"));
const analytics = uri((await compile("../lib/analytics.ts")).replace('from "./constants"', `from ${JSON.stringify(constants)}`));
const local = uri((await compile("../lib/ai/local.ts")).replace('from "../analytics"', `from ${JSON.stringify(analytics)}`).replace('from "../data/day"', `from ${JSON.stringify(day)}`));
const { localDigest } = await import(local);
const { analyzeDay } = await import(analytics);

test("local advice never assumes automatic blocking or a successful real-host compromise", () => {
 const analysis=analyzeDay([{id:"event",ts:Date.parse("2026-10-18T00:00:00Z"),service:"http",type:"command",severity:"critical",srcIp:"192.0.2.1",country:"Unknown",message:"Observed decoy input"}]);
 for(const language of ["en","de"]){
  const text=localDigest("2026-10-18",analysis,language);
  assert.doesNotMatch(text,/auto-block|Block-Liste|trap sessions|Trap-Sitzungen/);
  assert.match(text,/evidence|Ereignisse/);
 }
});

test("a high-severity observation never produces a quiet-day recommendation", () => {
  const analysis = analyzeDay([{ id: "high-event", ts: Date.parse("2026-10-18T00:00:00Z"), service: "http", type: "scan", severity: "high", srcIp: "192.0.2.1", country: "Unknown", message: "Observed sensitive path" }]);
  for (const language of ["en", "de"]) {
    const text = localDigest("2026-10-18", analysis, language);
    assert.doesNotMatch(text, /No high-severity observations|Keine Ereignisse mit hohem/);
    assert.match(text, /high-severity events|hochgradigen Ereignisse/);
  }
});
