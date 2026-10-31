"use client";

import { Globe2, LockKeyhole, Radio } from "lucide-react";
import { useHoneypot } from "../../providers/HoneypotProvider";

export function Ticker() {
  const { running, services, ready } = useHoneypot();
  const online = running ? services.filter((s) => s.active).length : 0;
  return (
    <footer className="system-footer pointer-events-auto">
      <div><Radio size={12} /><span>Managed runtime</span><span className="footer-separator" /><span>{ready ? "Data store connected" : "Connecting data store"}</span><span className="footer-separator" /><span>UTC</span></div>
      <span className="footer-statement">Curiosity is their weakness.</span>
      <div><Globe2 size={12} /><span>{online} decoys online</span><span className="footer-separator" /><LockKeyhole size={11} /><span>Owner session</span><span className="footer-version">v0.1.0</span></div>
    </footer>
  );
}
