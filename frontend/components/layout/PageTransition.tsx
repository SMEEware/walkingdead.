"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <main key={pathname} className="workspace-content flex min-h-0 grow animate-page-in flex-col">
      {children}
    </main>
  );
}
