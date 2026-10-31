"use client";

import { Network, Send, Webhook } from "lucide-react";
import { useState } from "react";

import { threatsApi } from "../../lib/threats";
import type { HoneypotService, WebhookConfig } from "../../lib/types";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";
import { Segmented } from "../ui/Segmented";
import { ServiceIcon } from "../ui/ServiceIcon";
import { Switch } from "../ui/Switch";

const DESCRIPTIONS: Record<string, string> = {
  http: "Web server with admin login bait. Classifies SQLi, RCE, Log4Shell, traversal and scanners.",
  ssh: "OpenSSH 8.9 lookalike. Records credentials and keys; interactive mode opens an emulated root shell.",
  telnet: "IoT-style login prompt favoured by Mirai-family botnets, with the same emulated shell.",
  ftp: "vsFTPd banner that captures USER/PASS pairs and pre-auth commands.",
  redis: "Unauthenticated-looking Redis 6.2 that records CONFIG SET, SLAVEOF and module-loading attacks.",
  mysql: "MySQL 5.7 handshake that captures usernames from database brute-force tools.",
};

function DecoyRow({ service }: { service: HoneypotService }) {
  const { toggleService, setServiceAddress, pending, ready } = useHoneypot();
  const [address, setAddress] = useState(service.address);
  const dirty = address !== service.address;
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl border ${service.active ? "border-[#b9f6d0]/20 bg-[#b9f6d0]/8 text-[#b9f6d0]" : "border-white/8 bg-white/3 text-zinc-500"}`}>
        <ServiceIcon id={service.id} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          {service.name}
          {service.active && <span className="pill" style={{ color: "#b9f6d0" }}>listening</span>}
          {service.error && <span className="pill pill-alert" title={service.error}>bind failed</span>}
        </div>
        <p className="mt-0.5 text-xs leading-snug text-zinc-500">{DESCRIPTIONS[service.id]}</p>
        {service.error && <p className="mt-1 text-[11px] text-blood">{service.error}</p>}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void setServiceAddress(service.id, address.trim());
        }}
      >
        <input className="field-input w-40 font-mono" value={address} onChange={(e) => setAddress(e.target.value)} aria-label={`${service.name} listen address`} />
        {dirty && <Button size="sm" variant="primary" type="submit" disabled={pending}>Save</Button>}
        <Switch checked={service.enabled} onChange={() => void toggleService(service.id)} disabled={pending || !ready} label={`Enable ${service.name}`} />
      </form>
    </li>
  );
}

export function DecoysTab() {
  const { services, error } = useHoneypot();
  return (
    <Panel
      title="Decoy services"
      subtitle="Enabled decoys start together with the system. Use 0.0.0.0 to expose a decoy on every interface."
      icon={<Network className="size-3.5" />}
      className="animate-rise"
    >
      <ul className="divide-y divide-white/5">
        {services.map((s) => <DecoyRow key={s.id} service={s} />)}
      </ul>
      {error && <p className="px-5 pb-4 text-xs text-blood">{error}</p>}
    </Panel>
  );
}

const FORMATS = [
  { value: "generic" as const, label: "JSON" },
  { value: "slack" as const, label: "Slack" },
  { value: "discord" as const, label: "Discord" },
];
const LEVELS = [
  { value: "low" as const, label: "Low+" },
  { value: "medium" as const, label: "Medium+" },
  { value: "high" as const, label: "High+" },
  { value: "critical" as const, label: "Critical" },
];

export function WebhookTab() {
  const { webhook, updateSystem, pending } = useHoneypot();
  const [draft, setDraft] = useState<WebhookConfig>(webhook);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (next: WebhookConfig) => {
    setDraft(next);
    setStatus(null);
    await updateSystem({ webhook: next });
  };
  return (
    <Panel title="Real-time alerts" subtitle="Push attacks to Slack, Discord or any JSON endpoint as they happen (max. 20 per minute)" icon={<Webhook className="size-3.5" />} className="animate-rise" bodyClassName="space-y-4 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-zinc-100">Send alerts</div>
          <p className="text-xs text-zinc-500">Delivered from the honeypot service, even when no browser is open.</p>
        </div>
        <Switch checked={webhook.enabled} disabled={pending || !draft.url} onChange={() => void save({ ...draft, enabled: !webhook.enabled })} label="Enable webhook alerts" />
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[11px] text-zinc-400">Webhook URL</span>
        <input className="field-input w-full font-mono" placeholder="https://hooks.slack.com/services/…" value={draft.url ?? ""} onChange={(e) => setDraft({ ...draft, url: e.target.value })} onBlur={() => draft.url !== webhook.url && void save({ ...draft, enabled: draft.url ? draft.enabled : false })} />
      </label>
      <div className="flex flex-wrap gap-4">
        <div>
          <span className="mb-1.5 block text-[11px] text-zinc-400">Format</span>
          <Segmented size="sm" options={FORMATS} value={draft.format} onChange={(format) => void save({ ...draft, format })} />
        </div>
        <div>
          <span className="mb-1.5 block text-[11px] text-zinc-400">Minimum severity</span>
          <Segmented size="sm" options={LEVELS} value={draft.minSeverity} onChange={(minSeverity) => void save({ ...draft, minSeverity })} />
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-white/6 pt-4">
        <Button
          size="sm"
          icon={<Send className="size-3.5" />}
          disabled={!webhook.url}
          onClick={async () => {
            try {
              await threatsApi.testWebhook();
              setStatus({ ok: true, text: "Test alert delivered." });
            } catch (e) {
              setStatus({ ok: false, text: e instanceof Error ? e.message : "Delivery failed." });
            }
          }}
        >
          Send test alert
        </Button>
        {status && <span className={`text-xs ${status.ok ? "text-[#b9f6d0]" : "text-blood"}`}>{status.text}</span>}
      </div>
    </Panel>
  );
}
