"use client";

import { Check, Copy, Download, ExternalLink, KeyRound, Radio, Search, ShieldCheck, Terminal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { info, operations, resolve, tags, typeLabel, type Operation, type Schema } from "../../lib/docs/spec";

const GUIDES = [
  { id: "quickstart", label: "Quickstart" },
  { id: "authentication", label: "Authentication" },
  { id: "monitor", label: "Build a monitor" },
  { id: "live-stream", label: "Live attack stream" },
  { id: "firewall", label: "Firewall automation" },
  { id: "errors", label: "Errors and limits" },
];

const anchor = (op: Operation) => `op-${op.id}`;

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-code">
      <div className="docs-code-head">
        <span>{label ?? "shell"}</span>
        <button type="button" aria-label="Copy code" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="docs-section">
      <h2><a href={`#${id}`}>{title}</a></h2>
      {children}
    </section>
  );
}

function SchemaTree({ schema, depth = 0 }: { schema?: Schema; depth?: number }) {
  const resolved = resolve(schema);
  if (!resolved) return null;
  const target = resolved.type === "array" ? resolve(resolved.items) : resolved;
  if (!target?.properties || depth > 2) return <code className="docs-type">{typeLabel(schema)}</code>;
  return (
    <ul className="docs-schema">
      {Object.entries(target.properties).map(([name, field]) => {
        const nested = resolve(field.type === "array" ? field.items : field);
        return (
          <li key={name}>
            <span className="docs-field">{name}</span>
            {target.required?.includes(name) && <span className="docs-required">required</span>}
            <code className="docs-type">{typeLabel(field)}</code>
            {nested?.properties && depth < 1 && <SchemaTree schema={field} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

function curlFor(op: Operation) {
  const path = op.path.replace("{ip}", "203.0.113.7").replace("{id}", "ID").replace("{day}", "2026-10-31");
  const lines = [`curl${op.method === "GET" ? "" : ` -X ${op.method}`} "$WD_URL${path}${op.id === "exportBlocklist" ? "?format=nftables" : ""}"`, `  -H "Authorization: Bearer $WD_KEY"`];
  if (op.id === "streamEvents" || op.id === "streamInvalidations") lines[0] = lines[0].replace("curl", "curl -N");
  if (op.requestBody) {
    const examples: Record<string, string> = {
      configureSystem: `{"running": true, "mode": "interactive", "decoys": {"ssh": {"enabled": true, "address": "0.0.0.0:2222"}}}`,
      addBlock: `{"ip": "203.0.113.7", "reason": "SSH brute force"}`,
      analyzeEvidence: `{"task": "digest", "day": "2026-10-31"}`,
      createKey: `{"name": "grafana", "scopes": ["events:read"], "expiresInDays": 90}`,
      login: `{"username": "owner", "password": "…"}`,
    };
    lines.push(`  -H "Content-Type: application/json"`, `  -d '${examples[op.id] ?? "{}"}'`);
  }
  return lines.join(" \\\n");
}

function Endpoint({ op }: { op: Operation }) {
  return (
    <article id={anchor(op)} className="docs-endpoint">
      <header>
        <span className={`docs-method m-${op.method.toLowerCase()}`}>{op.method}</span>
        <code className="docs-path">{op.path}</code>
        <a href={`#${anchor(op)}`} className="docs-permalink" aria-label="Link to endpoint">#</a>
      </header>
      <p className="docs-description">{op.description}</p>
      <div className="docs-meta">
        {op.scopes.length ? op.scopes.map((s) => <span key={s} className="docs-scope"><KeyRound size={11} />{s}</span>) : <span className="docs-scope is-public">no scope</span>}
        {op.ownerOnly && <span className="docs-scope is-owner"><ShieldCheck size={11} />owner session</span>}
      </div>
      {!!op.parameters.length && (
        <div className="docs-block">
          <h4>Parameters</h4>
          <table>
            <tbody>
              {op.parameters.map((p) => (
                <tr key={p.name}>
                  <td><span className="docs-field">{p.name}</span>{p.required && <span className="docs-required">required</span>}</td>
                  <td className="text-zinc-500">{p.in}</td>
                  <td><code className="docs-type">{typeLabel(p.schema)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {op.requestBody && (
        <div className="docs-block">
          <h4>Request body <code className="docs-type">{typeLabel(op.requestBody)}</code></h4>
          <SchemaTree schema={op.requestBody} />
        </div>
      )}
      {op.response && (
        <div className="docs-block">
          <h4>Response <code className="docs-type">{op.response.schema ? typeLabel(op.response.schema) : op.response.type}</code>{op.response.schema && <span className="text-zinc-600"> · {op.response.type}</span>}</h4>
          {op.response.schema && op.response.type === "application/json" && <SchemaTree schema={op.response.schema} />}
        </div>
      )}
      <CodeBlock code={curlFor(op)} label="curl" />
    </article>
  );
}

export function ApiDocs() {
  const [query, setQuery] = useState("");
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags
      .map((t) => ({ ...t, ops: operations.filter((op) => op.tag === t.name && (!q || `${op.method} ${op.path} ${op.summary} ${op.description}`.toLowerCase().includes(q))) }))
      .filter((t) => t.ops.length);
  }, [query]);

  return (
    <div className="docs-root">
      <header className="docs-topbar">
        <Link href="/docs" className="flex items-center gap-2.5">
          <Image src="/assets/img/wd.svg" alt="" width={30} height={30} unoptimized />
          <span className="font-semibold tracking-[-0.03em]">walking<span className="text-zinc-500">dead</span><span className="text-[#d7f5e4]">.</span> <span className="ml-1 font-normal text-zinc-500">API</span></span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <a className="docs-top-link" href="/openapi.json" download><Download size={14} />openapi.json</a>
          <a className="docs-top-link" href="https://github.com/SMEEware/walkingdead." target="_blank" rel="noreferrer noopener"><ExternalLink size={14} />GitHub</a>
          <Link className="docs-top-link is-primary" href="/">Open console</Link>
        </div>
      </header>

      <div className="docs-layout">
        <nav className="docs-sidebar" aria-label="Documentation">
          <label className="docs-search">
            <Search size={14} />
            <input placeholder="Filter endpoints…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <p className="docs-nav-title">Guides</p>
          {GUIDES.map((g) => <a key={g.id} href={`#${g.id}`}>{g.label}</a>)}
          {grouped.map((t) => (
            <div key={t.name}>
              <p className="docs-nav-title">{t.name}</p>
              {t.ops.map((op) => (
                <a key={op.id} href={`#${anchor(op)}`} className="docs-nav-op">
                  <span className={`docs-method-dot m-${op.method.toLowerCase()}`}>{op.method}</span>
                  <span className="truncate">{op.path.replace("/api/v1", "")}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>

        <main className="docs-main">
          <div className="docs-hero">
            <p className="eyebrow">Management API · v{info.version}</p>
            <h1>Build your own monitors<span className="text-accent">.</span></h1>
            <p>{info.description}</p>
            <div className="docs-stats">
              <span><Terminal size={14} />{operations.length} endpoints</span>
              <span><Radio size={14} />live SSE stream</span>
              <span><KeyRound size={14} />scoped API keys</span>
            </div>
          </div>

          <Section id="quickstart" title="Quickstart">
            <p>Create a read-only key once with the CLI (or under <em>Settings → Access</em>), then call any endpoint with it. The secret is printed a single time.</p>
            <CodeBlock code={`wd --username owner keys create --name monitor --scopes system:read,events:read --expires 90

export WD_URL=http://127.0.0.1:8080
export WD_KEY=wdk_…   # the "key" value from the output

curl "$WD_URL/api/v1/overview" -H "Authorization: Bearer $WD_KEY"`} />
          </Section>

          <Section id="authentication" title="Authentication">
            <p>Every endpoint except <code>/bootstrap</code> and <code>/auth/login</code> requires either the owner session cookie set by the console or an API key sent as <code>Authorization: Bearer</code>. Keys carry explicit scopes and an expiry; requests outside a key&apos;s scopes return <code>403</code>.</p>
            <table className="docs-table">
              <thead><tr><th>Scope</th><th>Grants</th></tr></thead>
              <tbody>
                <tr><td><code>system:read</code></td><td>System state, health, metrics, audit trail, OpenAPI</td></tr>
                <tr><td><code>system:write</code></td><td>Start and stop decoys, change mode, auto-block and webhooks</td></tr>
                <tr><td><code>events:read</code></td><td>Events, sessions, overview, live stream, attackers, intel, blocklist export</td></tr>
                <tr><td><code>data:write</code></td><td>Blocklist changes, briefings, notifications, deleting evidence</td></tr>
                <tr><td><code>ai:run</code></td><td>DeepSeek analyses and AI settings</td></tr>
                <tr><td><code>keys:read</code> / <code>keys:write</code></td><td>Listing keys; creating and revoking needs an owner session</td></tr>
              </tbody>
            </table>
            <p>Management on anything other than loopback requires TLS. Never expose the management port on a decoy interface.</p>
          </Section>

          <Section id="monitor" title="Build a monitor">
            <p><code>GET /overview</code> returns everything a status board needs in one call: running decoys, a recency-weighted threat level from 0 to 100, counts for the last hour and day, the top attacker and the latest event.</p>
            <CodeBlock label="python" code={`import os, time, requests

URL, KEY = os.environ["WD_URL"], os.environ["WD_KEY"]
headers = {"Authorization": f"Bearer {KEY}"}

while True:
    o = requests.get(f"{URL}/api/v1/overview", headers=headers, timeout=10).json()
    hour = o["lastHour"]
    print(f"threat {o['threatLevel']:3}/100 | {hour['events']} events, "
          f"{hour['bySeverity']['critical']} critical, {o['attackers']} attackers")
    time.sleep(30)`} />
            <p>Combine it with <code>GET /logs/recent?minSeverity=high&amp;since=…</code> to fetch only what is new, or <code>GET /attackers</code> for a ranked leaderboard.</p>
          </Section>

          <Section id="live-stream" title="Live attack stream">
            <p><code>GET /events/stream</code> pushes every captured event as it happens (<code>event: attack</code>), filtered server-side by <code>service</code>, <code>type</code>, <code>ip</code>, <code>tag</code> and <code>minSeverity</code>.</p>
            <CodeBlock code={`curl -N "$WD_URL/api/v1/events/stream?minSeverity=high" \\
  -H "Authorization: Bearer $WD_KEY"`} />
            <CodeBlock label="node" code={`const res = await fetch(\`\${process.env.WD_URL}/api/v1/events/stream?service=ssh\`, {
  headers: { Authorization: \`Bearer \${process.env.WD_KEY}\` },
});
const decoder = new TextDecoder();
for await (const chunk of res.body) {
  for (const block of decoder.decode(chunk, { stream: true }).split("\\n\\n")) {
    const data = block.match(/^data: (.*)$/m)?.[1];
    if (block.startsWith("event: attack") && data) {
      const e = JSON.parse(data);
      console.log(e.severity, e.srcIp, e.command ?? e.path ?? e.message);
    }
  }
}`} />
          </Section>

          <Section id="firewall" title="Firewall automation">
            <p>Enable auto-block (<code>PUT /system</code> with <code>{`{"autoBlock": true}`}</code>) and export the blocklist in the format your edge expects.</p>
            <CodeBlock code={`*/5 * * * * curl -fsS "$WD_URL/api/v1/blocklist/export?format=nftables" \\
  -H "Authorization: Bearer $WD_KEY" -o /etc/nftables.d/walkingdead.nft && nft -f /etc/nftables.d/walkingdead.nft`} />
          </Section>

          <Section id="errors" title="Errors and limits">
            <p>Errors are JSON objects of the form <code>{`{"error": "message"}`}</code> and never contain credentials. Mutations need <code>Content-Type: application/json</code>; browser requests are origin-checked. Retention keeps the newest 10,000 events or 16 MiB. At most 32 concurrent live event streams are accepted; AI calls are rate-limited (5 per minute per actor, 30 per hour).</p>
          </Section>

          {grouped.map((t) => (
            <section key={t.name} className="docs-section" id={`tag-${t.name.toLowerCase().replace(/\W+/g, "-")}`}>
              <h2>{t.name}</h2>
              <p className="text-zinc-500">{t.description}</p>
              <div className="space-y-5">{t.ops.map((op) => <Endpoint key={op.id} op={op} />)}</div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
