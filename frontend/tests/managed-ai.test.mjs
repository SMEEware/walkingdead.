import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const uri = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const api = uri(compile(await readFile(new URL("../lib/api.ts", import.meta.url), "utf8")));
const clientSource = compile(await readFile(new URL("../lib/ai/client.ts", import.meta.url), "utf8")).replace(/from ["']\.\.\/api["']/, `from ${JSON.stringify(api)}`);
const { aiReference, runManagedAi, updateManagedAi } = await import(uri(clientSource));

test("managed AI sends only canonical references, with cookies and caller cancellation", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/v1/ai");
    assert.equal(init.credentials, "include");
    assert.equal(init.signal, controller.signal);
    assert.deepEqual(JSON.parse(init.body), { task: "explain", eventId: "event-1" });
    return Response.json({ text: "Grounded explanation", totalEvents: 1 });
  });
  const result = await runManagedAi("explain", { eventId: "event-1", prompt: "private prompt", providerKey: "synthetic-secret", model: "arbitrary" }, controller.signal);
  assert.equal(result.totalEvents, 1);
  assert.deepEqual(aiReference("digest", { day: "2026-10-18", system: "ignored" }), { task: "digest", day: "2026-10-18" });
});

test("managed AI configuration cannot forward browser secrets or arbitrary destinations", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/v1/ai/settings");
    assert.deepEqual(JSON.parse(init.body), { enabled: true, model: "deepseek-flash", redactIps: true });
    return Response.json({ configured: true });
  });
  await updateManagedAi({ enabled: true, model: "deepseek-flash", redactIps: true, providerKey: "synthetic-secret", baseUrl: "https://invalid.example" }, new AbortController().signal);
});

test("unsupported AI tasks and missing references fail before a provider request", (t) => {
  t.mock.method(globalThis, "fetch", () => { assert.fail("unexpected request"); });
  for (const task of ["catchup", "triage", "explain", "digest"]) assert.throws(() => aiReference(task, {}));
});
