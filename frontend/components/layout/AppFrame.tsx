"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AiProvider } from "../../providers/AiProvider";
import { AuthProvider } from "../../providers/AuthProvider";
import { HoneypotProvider } from "../../providers/HoneypotProvider";
import { NotificationProvider } from "../../providers/NotificationProvider";
import { SettingsProvider } from "../../providers/SettingsProvider";
import { ZombieStage } from "../stage/ZombieStage";
import { CommandPalette } from "./CommandPalette";
import { Header } from "./Header";
import { MobileNav } from "./MobileNav";
import { PageTransition } from "./PageTransition";
import { Ticker } from "./Ticker";
import { Toaster } from "./Toaster";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/docs")) return <>{children}</>;
  return (
    <SettingsProvider>
      <AuthProvider>
        <NotificationProvider>
          <AiProvider>
            <HoneypotProvider>
              <ZombieStage />
              <div aria-hidden className="ambient-atmosphere pointer-events-none fixed inset-0 z-1" />
              <div className="app-shell pointer-events-none relative z-10 flex min-h-dvh flex-col">
                <Header />
                <PageTransition>{children}</PageTransition>
                <Ticker />
              </div>
              <MobileNav />
              <Toaster />
              <CommandPalette />
            </HoneypotProvider>
          </AiProvider>
        </NotificationProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
