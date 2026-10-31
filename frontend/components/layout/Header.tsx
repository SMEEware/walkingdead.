"use client";

import { ArrowUpRight, BookOpen, Command, Crosshair, LayoutDashboard, Newspaper, ScrollText, Search, Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { NotificationBell } from "./NotificationCenter";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/threats", label: "Threats", icon: Crosshair },
  { href: "/briefing", label: "Briefing", icon: Newspaper },
  { href: "/logs", label: "Event logs", icon: ScrollText },
  { href: "/docs", label: "API", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Header() {
  const pathname = usePathname();
  const { running, ready } = useHoneypot();
  return (
    <header className="app-header pointer-events-auto">
      <Link href="/" className="brand-lockup" aria-label="Walking Dead home">
        <Image src="/assets/img/wd.svg" alt="" width={44} height={44} unoptimized priority className="brand-mark" />
        <span><span className="brand-name">walking<span className="text-zinc-500">dead</span><span className="brand-period">.</span></span><span className="brand-caption">by SMEEware</span></span>
      </Link>
      <nav className="desktop-navigation" aria-label="Main navigation">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={`navigation-link ${pathname === href ? "is-active" : ""}`}>
            <Icon size={15} strokeWidth={1.6} /><span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="header-utilities">
        <span className={`system-indicator ${running && ready ? "is-online" : ""}`}><span className="status-dot" />{!ready ? "Checking backend" : running ? "System operational" : "System offline"}</span>
        <button type="button" className="command-trigger" onClick={() => window.dispatchEvent(new Event("wd:palette"))} aria-label="Open command palette">
          <Search size={16} /><span>Quick search</span><kbd><Command size={10} />K</kbd>
        </button>
        <div className="notification-button"><NotificationBell /></div>
      </div>
      <Link href="/briefing" className="mobile-intelligence" aria-label="Open intelligence"><ArrowUpRight size={17} /></Link>
    </header>
  );
}
