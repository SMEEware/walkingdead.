"use client";

import {
  Crosshair,
  LayoutDashboard,
  Power,
  ScrollText,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useHoneypot } from "../../providers/HoneypotProvider";

const TABS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/threats", label: "Threats", icon: Crosshair },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function MobileNav() {
  const pathname = usePathname();
  const { running, toggleRunning } = useHoneypot();
  const [left, right] = [TABS.slice(0, 2), TABS.slice(2)];

  const tab = ({ href, label, icon: Icon }: (typeof TABS)[number]) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-2 transition-colors duration-300 ${
          active ? "text-accent" : "text-zinc-500 active:text-zinc-300"
        }`}
      >
        {active && (
          <span
            aria-hidden
            className="absolute inset-x-3 -top-1.5 h-0.5 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]"
          />
        )}
        <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em]">
          {label}
        </span>
      </Link>
    );
  };

  return (
    <nav aria-label="Mobile navigation" className="mobile-dock glass-strong pointer-events-auto fixed inset-x-3 z-40 flex items-center gap-1 rounded-2xl px-2 py-1.5 transition-opacity duration-300 md:hidden [bottom:max(0.75rem,env(safe-area-inset-bottom))]">
      {left.map(tab)}
      <button
        type="button"
        onClick={toggleRunning}
        aria-pressed={running}
        aria-label={running ? "Shut down system" : "Start system"}
        className={`mobile-power-button ${running ? "is-shutdown" : "is-startup"}`}
      >
        <Power className="size-5" aria-hidden="true" strokeWidth={1.8} />
      </button>
      {right.map(tab)}
    </nav>
  );
}
