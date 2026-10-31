import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../components/ui/Markdown.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/from "(react(?:\/jsx-runtime)?)"/g, (_, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
const { Markdown } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("provider escapes render as literal text without creating formatting or links", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { text: "### Admin\\-path\n\nsource\\_01 \\(metadata\\) \\*\\*literal\\*\\* \\[link\\]\\(https://example.com\\)" }));
  assert.match(html, /Admin-path/);
  assert.match(html, /source_01 \(metadata\) \*\*literal\*\* \[link\]\(https:\/\/example.com\)/);
  assert.doesNotMatch(html, /\\|<a\b|<strong\b/);
});

test("trusted digest formatting and escaped HTML remain safe", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { text: "### Overview\n\n**Observed** `<script>`\n- Evidence" }));
  assert.match(html, /<strong[^>]*>Observed<\/strong>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<li>Evidence<\/li>/);
  assert.doesNotMatch(html, /<script\b/);
});
