"use client";

import {
  Bell,
  Brain,
  Check,
  Database,
  Download,
  Network,
  Webhook,
  Palette,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { API_BASE } from "../../lib/api";
import { AccountTab } from "./AccountTab";
import { DecoysTab, WebhookTab } from "./DecoysTab";

import type { AiLanguage, ManagedAiModel } from "../../lib/ai/types";
import { getDataSource } from "../../lib/data";
import type { DataStats } from "../../lib/data/types";
import { THEMES } from "../../lib/themes";
import type { Severity } from "../../lib/types";
import { useAi } from "../../providers/AiProvider";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { useNotifications } from "../../providers/NotificationProvider";
import { useSettings } from "../../providers/SettingsProvider";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";
import { Segmented } from "../ui/Segmented";
import { Switch } from "../ui/Switch";

type Tab = "decoys" | "webhook" | "account" | "appearance" | "stage" | "ai" | "notifications" | "data";

const TABS: { value: Tab; label: string; icon: ReactNode }[] = [
  { value: "decoys", label: "Decoys", icon: <Network className="size-3.5" /> },
  { value: "webhook", label: "Webhooks", icon: <Webhook className="size-3.5" /> },
  { value: "account", label: "Access", icon: <ShieldCheck className="size-3.5" /> },
  {
    value: "appearance",
    label: "Look",
    icon: <Palette className="size-3.5" />,
  },
  { value: "stage", label: "Stage", icon: <Sparkles className="size-3.5" /> },
  { value: "ai", label: "AI", icon: <Brain className="size-3.5" /> },
  {
    value: "notifications",
    label: "Alerts",
    icon: <Bell className="size-3.5" />,
  },
  { value: "data", label: "Data", icon: <Database className="size-3.5" /> },
];

function Row({
  title,
  hint,
  children,
  stacked,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={`flex gap-4 px-4 py-3.5 sm:px-5 ${stacked ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between"}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-zinc-100">{title}</div>
        {hint && (
          <p className="mt-0.5 text-xs leading-snug text-zinc-500">{hint}</p>
        )}
      </div>
      <div className={stacked ? "" : "shrink-0"}>{children}</div>
    </div>
  );
}

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("decoys");

  return (
    <div className="secondary-workspace pointer-events-none flex min-h-0 grow flex-col gap-3 overflow-y-auto p-3 pb-[6.5rem] max-md:pointer-events-auto sm:p-4 xl:pb-4 lg:overflow-hidden">
      <div className="order-1 shrink-0">
        <Segmented
          options={TABS}
          value={tab}
          onChange={setTab}
          compact
          className="glass p-1.5"
        />
      </div>
      <div className="order-2 min-h-0 lg:overflow-y-auto lg:pr-1">
        {tab === "decoys" && <DecoysTab />}
        {tab === "webhook" && <WebhookTab />}
        {tab === "account" && <AccountTab />}
        {tab === "appearance" && <AppearanceTab />}
        {tab === "stage" && <StageTab />}
        {tab === "ai" && <AiTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "data" && <DataTab />}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { settings, update } = useSettings();
  return (
    <Panel
      title="Color scheme"
      icon={<Palette className="size-3.5" />}
      className="animate-rise"
      bodyClassName="p-4 sm:p-5"
      action={
        <span className="font-mono text-[10px] text-zinc-500">
          applies to UI and stage
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {THEMES.map((t, i) => {
          const active = settings.theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => update({ theme: t.id })}
              style={
                {
                  "--c": t.accent,
                  animationDelay: `${i * 45}ms`,
                } as CSSProperties
              }
              className={`group/card relative animate-rise cursor-pointer overflow-hidden rounded-lg p-3 text-left ring-1 ring-inset transition-all duration-500 ease-out-expo hover:-translate-y-0.5 ${
                active
                  ? "bg-white/6 ring-(--c)"
                  : "bg-white/3 ring-white/8 hover:ring-white/20"
              }`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full opacity-30 blur-2xl transition-opacity duration-500 group-hover/card:opacity-60"
                style={{ background: "var(--c)" }}
              />
              <span
                className="relative block h-10 rounded-md"
                style={{
                  background: `linear-gradient(135deg, ${t.accent}, ${t.alert})`,
                  boxShadow: active ? `0 0 26px -6px ${t.accent}` : undefined,
                }}
              >
                <span
                  className={`absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-black/70 text-white transition-all duration-500 ease-out-expo ${
                    active ? "scale-100 opacity-100" : "scale-50 opacity-0"
                  }`}
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </span>
              <span className="relative mt-2.5 block font-display text-lg leading-none tracking-[0.1em]">
                {t.name.toUpperCase()}
              </span>
              <span className="relative mt-0.5 block text-[11px] text-zinc-500">
                {t.tagline}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function StageTab() {
  const { settings, update } = useSettings();
  const options = [
    {
      key: "autoRotate",
      label: "Auto-rotate",
      hint: "Slow turntable spin of the specimen",
    },
    {
      key: "particles",
      label: "Ambient particles",
      hint: "Drifting spores around the stage",
    },
    {
      key: "bloom",
      label: "Bloom glow",
      hint: "Cinematic light bleed on bright edges",
    },
  ] as const;

  return (
    <Panel
      title="Stage"
      icon={<Sparkles className="size-3.5" />}
      className="animate-rise"
      bodyClassName="divide-y divide-white/5"
    >
      {options.map(({ key, label, hint }) => (
        <Row key={key} title={label} hint={hint}>
          <Switch
            checked={settings[key]}
            onChange={() => update({ [key]: !settings[key] })}
            label={label}
          />
        </Row>
      ))}
    </Panel>
  );
}

function AiTab() {
  const { settings, update, ready, updating, refresh, error, usage, busy } = useAi();
  const locked = !ready || updating || busy !== null;
  return (
    <Panel title="DeepSeek intelligence" icon={<Brain className="size-3.5" />} bodyClassName="divide-y divide-white/5" action={<Button size="xs" disabled={updating || busy !== null} onClick={() => void refresh()}>Refresh status</Button>}>
      <div className="px-5 py-5 text-sm leading-relaxed text-zinc-400">
        <span className="mb-2 block text-[10px] uppercase tracking-widest text-accent">{!ready ? "Connecting to AI settings" : settings.configured ? "Provider key configured on server" : "Server configuration required"}</span>
        Event analysis and daily briefings use captured evidence selected by your backend. Provider credentials stay in the encrypted server vault and never enter this browser.
        {!settings.configured && <div className="mt-4"><p className="text-xs text-zinc-500">Import the provider key through the CLI:</p><code className="mt-2 block break-all rounded-lg bg-black/40 p-3 text-xs text-zinc-300">wd --username OWNER ai configure --provider-key-file PATH</code></div>}
      </div>
      <Row title="Enable DeepSeek analysis" hint="Opt in to sending selected evidence to DeepSeek. Local statistical briefings remain available when AI is off.">
        <Switch checked={settings.enabled} disabled={locked || (!settings.configured && !settings.enabled)} onChange={() => void update({ enabled: !settings.enabled })} label="Enable DeepSeek analysis" />
      </Row>
      <Row title="Model" hint="The backend uses this model for supported AI tasks." stacked>
        <select value={settings.model} disabled={locked} onChange={(event) => void update({ model: event.target.value as ManagedAiModel })} className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm disabled:opacity-40">
          <option value="deepseek-flash">DeepSeek Flash · deepseek-flash</option>
          <option value="deepseek-v4-pro">DeepSeek V4 Pro · deepseek-v4-pro</option>
        </select>
      </Row>
      <Row title="Redact source IP addresses" hint="Enabled by default. The backend replaces source IP addresses before preparing provider input."><Switch checked={settings.redactIps} disabled={locked} onChange={() => void update({ redactIps: !settings.redactIps })} label="Redact source IP addresses" /></Row>
      <Row title="Include captured payloads" hint="Off by default. Payloads may contain sensitive or attacker-controlled text."><Switch checked={settings.includePayloads} disabled={locked} onChange={() => void update({ includePayloads: !settings.includePayloads })} label="Include captured payloads" /></Row>
      <Row title="Request limits" hint={`Daily analysis selects at most ${settings.maxEvents} events; responses are limited to ${settings.maxOutputTokens} output tokens.`}><span className="text-xs text-zinc-500">Server enforced</span></Row>
      <Row title="Local digest language" hint="Applies to statistical briefings generated without AI."><Segmented size="sm" options={[{ value: "en" as AiLanguage, label: "English" }, { value: "de" as AiLanguage, label: "Deutsch" }]} value={settings.language} onChange={(language) => void update({ language })} /></Row>
      <Row title="This session" hint="Provider-reported token usage. Pricing is not estimated here."><span className="text-xs tabular-nums text-zinc-400">{usage.calls ? `${usage.calls} calls · ${usage.inputTokens} input / ${usage.outputTokens} output tokens` : "No AI requests yet"}</span></Row>
      {updating && <p role="status" className="px-5 py-3 text-xs text-zinc-500">Saving server settings…</p>}
      {error && <p role="alert" className="px-5 py-4 text-xs text-red-300">{error}</p>}
    </Panel>
  );
}

const SEVERITY_OPTIONS = ["info", "low", "medium", "high", "critical"] as const;

function NotificationsTab() {
  const { settings, update } = useSettings();
  const { items, unread, markAllRead, clear, push } = useNotifications();

  return (
    <Panel
      title="Notifications"
      icon={<Bell className="size-3.5" />}
      className="animate-rise"
      bodyClassName="divide-y divide-white/5"
    >
      <Row
        title="On-screen toasts"
        hint="Show a toast for every new important event while you watch the dashboard."
      >
        <Switch
          checked={settings.toasts}
          onChange={() => update({ toasts: !settings.toasts })}
          label="Toasts"
        />
      </Row>

      <Row
        title="Minimum severity"
        hint="Events below this level stay in the log but never raise a notification."
        stacked
      >
        <Segmented
          options={SEVERITY_OPTIONS.map((s) => ({ value: s, label: s }))}
          value={settings.notifyMinSeverity}
          onChange={(v) => update({ notifyMinSeverity: v as Severity })}
          compact
        />
      </Row>

      <Row
        title="System messages"
        hint="Arming, blocked sources, AI results and welcome notes."
      >
        <Switch
          checked={settings.notifySystem}
          onChange={() => update({ notifySystem: !settings.notifySystem })}
          label="System messages"
        />
      </Row>

      <Row title="Inbox" hint={`${items.length} stored · ${unread} unread`}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() =>
              push({
                kind: "system",
                severity: "medium",
                title: "Test notification",
                body: "If you can read this, notifications work.",
              })
            }
          >
            Send test
          </Button>
          <Button onClick={markAllRead}>Read all</Button>
          <Button
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={clear}
          >
            Clear
          </Button>
        </div>
      </Row>
    </Panel>
  );
}

function DataTab() {
  const { version, bumpVersion, clearLogs, error: systemError } = useHoneypot();
  const { clear: clearNotifications } = useNotifications();
  const [stats, setStats] = useState<DataStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getDataSource()
      .stats()
      .then((value) => { setStats(value); setError(null); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Storage statistics are unavailable."));
  }, []);

  useEffect(refresh, [refresh, version]);

  const source = getDataSource().kind;
  const backend = API_BASE;

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
    const data = await getDataSource().exportAll();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `walking-dead-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export failed.");
    } finally { setBusy(false); }
  };

  return (
    <Panel
      title="Storage"
      icon={<Database className="size-3.5" />}
      className="animate-rise"
      bodyClassName="divide-y divide-white/5"
    >
      <Row
        title="Where events live"
        hint="Captured events, briefings and notifications are stored by your management server."
      >
        <span className="rounded-lg bg-white/4 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-accent ring-1 ring-inset ring-white/8">
          {source}
          {backend ? ` · ${backend}` : ""}
        </span>
      </Row>

      <Row title="Stored now" stacked>
        <div className="flex flex-wrap gap-2 font-mono text-[11px] text-zinc-300">
          {[
            ["events", stats?.logs],
            ["days", stats?.days],
            ["briefings", stats?.summaries],
            ["notifications", stats?.notifications],
          ].map(([label, value]) => (
            <span
              key={String(label)}
              className="rounded bg-white/5 px-2.5 py-1"
            >
              {value ?? "—"} {label}
            </span>
          ))}
          <Button size="xs" variant="ghost" onClick={refresh}>
            refresh
          </Button>
        </div>
      </Row>

      <Row
        title="Export"
        hint="Everything the UI can read: events, days, briefings and notifications."
      >
        <Button icon={<Download className="size-3.5" />} onClick={download} disabled={busy}>
          Download JSON
        </Button>
      </Row>

      <Row
        title="Delete events"
        hint="Removes stored events and day counters. Briefings stay until deleted."
      >
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm("Delete all stored log events?")) clearLogs();
          }}
        >
          Clear logs
        </Button>
      </Row>

      <Row
        title="Reset everything"
        hint="Deletes captured events, briefings and notifications from the backend. Account and API keys remain."
      >
        <Button
          variant="danger"
          disabled={busy}
          icon={<RotateCcw className="size-3.5" />}
          onClick={async () => {
            if (
              !window.confirm(
                "Delete all captured events, briefings and notifications from the backend?",
              )
            )
              return;
            setBusy(true);
            setError(null);
            try {
            await getDataSource().clearAll();
            await clearLogs();
            clearNotifications();
            bumpVersion();
            refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "The data reset failed.");
            } finally { setBusy(false); }
          }}
        >
          {busy ? "Resetting…" : "Wipe captured data"}
        </Button>
      </Row>
      {(error || systemError) && <p role="alert" className="px-5 py-4 text-xs text-red-300">{error || systemError}</p>}
    </Panel>
  );
}
