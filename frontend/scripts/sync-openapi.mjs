import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../../backend/api/openapi.json", import.meta.url);
for (const target of ["../lib/docs/openapi.json", "../public/openapi.json"]) {
  const url = new URL(target, import.meta.url);
  await mkdir(new URL(".", url), { recursive: true });
  await copyFile(source, url);
}
