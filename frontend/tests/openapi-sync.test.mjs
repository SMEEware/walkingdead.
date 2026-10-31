import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the docs bundle the current backend API contract", async () => {
  const source = await readFile(new URL("../../backend/api/openapi.json", import.meta.url), "utf8");
  for (const copy of ["../lib/docs/openapi.json", "../public/openapi.json"]) {
    assert.equal(await readFile(new URL(copy, import.meta.url), "utf8"), source, `${copy} is stale; run node scripts/sync-openapi.mjs`);
  }
});
