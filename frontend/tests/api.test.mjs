import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { API_BASE, apiRequest, ApiError, SESSION_EXPIRED_EVENT } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("management requests include cookies, bypass caches and preserve caller cancellation", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, `${API_BASE}/system`);
    assert.equal(init.credentials, "include");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.has("Content-Type"), false);
    assert.equal(init.signal, controller.signal);
    return Response.json({ running: false });
  });
  assert.deepEqual(await apiRequest("/system", { credentials: "omit", signal: controller.signal }), { running: false });
});

test("an expired cookie resets the authentication gate and preserves the API error", async (t) => {
  const previousWindow = globalThis.window;
  const events = new EventTarget();
  let expired = 0;
  events.addEventListener(SESSION_EXPIRED_EVENT, () => expired++);
  globalThis.window = events;
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Session expired" }, { status: 401 }));
  try {
    await assert.rejects(apiRequest("/logs/recent"), (error) => error instanceof ApiError && error.status === 401 && error.message === "Session expired");
    assert.equal(expired, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("successful empty responses do not require JSON and mutations use JSON headers", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.headers.get("Content-Type"), "application/json");
    assert.equal(init.method, "POST");
    return new Response(null, { status: 204 });
  });
  assert.equal(await apiRequest("/auth/logout", { method: "POST", body: "{}" }), undefined);
});

test("bodyless unsafe requests include the JSON content type required by the owner API", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.headers.get("Content-Type"), "application/json");
    assert.equal(init.body, undefined);
    return new Response(null, { status: 204 });
  });
  for (const [path, method] of [
    ["/auth/logout", "POST"],
    ["/notifications/read-all", "POST"],
    ["/keys/key-1", "DELETE"],
    ["/all", "DELETE"],
  ]) {
    assert.equal(await apiRequest(path, { method }), undefined);
  }
});
