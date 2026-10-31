"use client";

import { KeyRound, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api";
import { formatDateTime } from "../../lib/ui";
import { useAuth } from "../../providers/AuthProvider";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";

const SCOPES = ["system:read", "system:write", "events:read", "keys:read", "keys:write", "data:write", "ai:run"] as const;
interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  revokedAt?: number;
}
const fieldClass = "w-full rounded-lg border border-white/10 bg-white/3 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-accent/50";
const date = (value?: number) => value ? formatDateTime(value) : "Never";

export function AccountTab() {
  const { username, logout } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>(["system:read", "events:read"]);
  const load = useCallback(async () => {
    const list = await apiRequest<ApiKeyRecord[]>("/keys");
    setKeys(list ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => {
    let alive = true;
    apiRequest<ApiKeyRecord[]>("/keys").then((list) => {
      if (alive) { setKeys(list ?? []); setLoaded(true); }
    }).catch((cause) => {
      if (alive) { setError(cause instanceof Error ? cause.message : "Keys could not be loaded."); setLoaded(true); }
    });
    return () => { alive = false; };
  }, []);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const result = await apiRequest<ApiKeyRecord & { key: string }>("/keys", { method: "POST", body: JSON.stringify({ name: String(data.get("name") ?? "").trim(), scopes, expiresInDays: Number(data.get("expiresInDays")) }) });
      setSecret(result.key);
      form.reset();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The key could not be created."); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest<void>(`/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The key could not be revoked."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3">
    <Panel title="Owner session" icon={<ShieldCheck className="size-3.5" />} bodyClassName="flex flex-wrap items-center justify-between gap-4 p-5">
      <div><div className="text-sm font-medium text-zinc-100">{username}</div><p className="mt-1 text-xs text-zinc-500">Authenticated with a private, HttpOnly cookie session.</p></div>
      <Button icon={<LogOut size={14} />} disabled={busy} onClick={async () => {
        setBusy(true);
        try { await logout(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign out failed."); setBusy(false); }
      }}>Sign out</Button>
    </Panel>
    <Panel title="API access keys" icon={<KeyRound className="size-3.5" />} bodyClassName="space-y-5 p-5">
      <p className="text-xs leading-relaxed text-zinc-500">Create scoped credentials for integrations. Only the owner session can create or revoke keys. The secret is shown once and never stored by this UI.</p>
      {secret && <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
        <p className="text-xs font-medium text-accent">Copy this key now. It cannot be retrieved again.</p>
        <code className="mt-3 block select-all break-all rounded-lg bg-black/30 p-3 text-xs text-zinc-200">{secret}</code>
        <Button size="xs" className="mt-3" onClick={() => setSecret(null)}>I saved it · Dismiss</Button>
      </div>}
      <form onSubmit={create} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="text-xs text-zinc-400">Key name<input name="name" required maxLength={80} placeholder="Monitoring integration" className={`mt-2 ${fieldClass}`} disabled={busy} /></label>
          <label className="text-xs text-zinc-400">Expires in days<input name="expiresInDays" type="number" min={1} max={365} defaultValue={30} required className={`mt-2 ${fieldClass}`} disabled={busy} /></label>
        </div>
        <fieldset disabled={busy}><legend className="mb-2 text-xs text-zinc-400">Permissions</legend><div className="flex flex-wrap gap-2">{SCOPES.map((scope) => <label key={scope} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[10px] ${scopes.includes(scope) ? "border-accent/25 bg-accent/5 text-accent" : "border-white/8 text-zinc-500"}`}><input className="accent-(--accent)" type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((previous) => event.target.checked ? [...previous, scope] : previous.filter((value) => value !== scope))} />{scope}</label>)}</div></fieldset>
        <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={busy || !scopes.length}>{busy ? "Working…" : "Create key"}</Button>
      </form>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <div className="space-y-2 border-t border-white/6 pt-4">
        {!loaded && <p className="text-xs text-zinc-500">Loading keys…</p>}
        {loaded && !keys.length && <p className="text-xs text-zinc-500">No API keys yet.</p>}
        {keys.map((key) => <div key={key.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/6 p-3">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm text-zinc-200">{key.name}<code className="text-[10px] text-zinc-600">{key.prefix}…</code>{!!key.revokedAt && <span className="text-[10px] text-red-300">Revoked</span>}</div><p className="mt-1 break-words font-mono text-[10px] text-zinc-500">{key.scopes.join(" · ")}</p><p className="mt-2 text-[10px] leading-relaxed text-zinc-600">Created {date(key.createdAt)} · Expires {date(key.expiresAt)} · Last used {date(key.lastUsedAt)}</p></div>
          <Button size="xs" variant="danger" icon={<Trash2 size={12} />} disabled={busy || !!key.revokedAt} onClick={() => void revoke(key.id)}>Revoke</Button>
        </div>)}
      </div>
    </Panel>
  </div>;
}
