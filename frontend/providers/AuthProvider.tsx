"use client";

import { LockKeyhole, ShieldCheck, ArrowRight, LoaderCircle, LogIn } from "lucide-react";
import Image from "next/image";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, apiRequest, SESSION_EXPIRED_EVENT } from "../lib/api";

type AuthStatus = "loading" | "setup" | "anonymous" | "authenticated" | "unavailable";
interface AuthContextValue {
  username: string;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);

  const check = useCallback(async () => {
    const current = ++generation.current;
    try {
      const bootstrap = await apiRequest<{ initialized: boolean }>("/bootstrap");
      if (current !== generation.current) return;
      if (!bootstrap.initialized) { setStatus("setup"); return; }
      const session = await apiRequest<{ username: string }>("/auth/session");
      if (current !== generation.current) return;
      setUsername(session.username);
      setStatus("authenticated");
    } catch (cause) {
      if (current !== generation.current) return;
      setUsername("");
      if (cause instanceof ApiError && cause.status === 401) setStatus("anonymous");
      else {
        setStatus("unavailable");
        setError(cause instanceof Error ? cause.message : "The management API is unavailable.");
      }
    }
  }, []);

  useEffect(() => {
    try {
      for (const storage of [localStorage, sessionStorage]) {
        for (const key of ["wd-ai-keys", "wd-ai-keys-session"]) storage.removeItem(key);
      }
    } catch { /* Storage may be unavailable. */ }
    const expired = () => {
      invalidate();
      setUsername("");
      setStatus("anonymous");
      setError(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    const timer = window.setTimeout(() => void check(), 0);
    return () => {
      window.clearTimeout(timer);
      invalidate();
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    };
  }, [check, invalidate]);

  const retry = () => { setStatus("loading"); setError(null); void check(); };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const passwordInput = event.currentTarget.elements.namedItem("password") as HTMLInputElement;
    const credentials = { username: String(data.get("username") ?? ""), password: String(data.get("password") ?? "") };
    setBusy(true);
    setError(null);
    try {
      const session = await apiRequest<{ username: string }>("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
      setUsername(session.username);
      setStatus("authenticated");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed.");
    } finally {
      credentials.password = "";
      passwordInput.value = "";
      setBusy(false);
    }
  };

  const logout = useCallback(async () => {
    await apiRequest<void>("/auth/logout", { method: "POST" });
    generation.current++;
    setUsername("");
    setStatus("anonymous");
  }, []);

  if (status === "authenticated") {
    return <AuthContext.Provider value={{ username, logout }}>{children}</AuthContext.Provider>;
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#050606] p-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(185,246,208,0.07),transparent_60%)]" />
      <section className="glass-strong relative w-full max-w-md rounded-3xl p-7 shadow-2xl sm:p-10">
        <Image src="/assets/img/wd.svg" alt="Walking Dead" width={58} height={58} unoptimized priority />
        <div className="mb-8 mt-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500"><ShieldCheck size={13} /> Private management console</div>
        <h1 className="text-3xl font-semibold tracking-[-0.05em]">{status === "setup" ? "Initialize your sentinel." : status === "unavailable" ? "Connection interrupted." : "Welcome back."}</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-500">{status === "setup" ? "Create the owner account on the machine running Walking Dead before signing in." : status === "unavailable" ? "Start the Walking Dead backend and check the management API address." : "Sign in to operate your honeypot and inspect captured telemetry."}</p>
        {status === "loading" && <div role="status" className="mt-8 flex items-center gap-3 text-sm text-zinc-400"><LoaderCircle className="animate-spin" size={16} /> Connecting securely…</div>}
        {status === "setup" && <div className="mt-8 space-y-4"><code className="block rounded-xl border border-white/8 bg-black/40 p-4 text-sm text-accent">wdd init --username owner</code><button className="text-sm text-accent" onClick={retry}>Check initialization <ArrowRight className="ml-1 inline" size={14} /></button></div>}
        {status === "anonymous" && <form onSubmit={login} className="mt-8 space-y-4">
          <label className="block text-xs text-zinc-400">Username<input name="username" autoComplete="username" required disabled={busy} className="mt-2 w-full rounded-xl border border-white/10 bg-white/3 px-4 py-3 text-sm text-white outline-none focus:border-accent/50" /></label>
          <label className="block text-xs text-zinc-400">Password<input name="password" type="password" autoComplete="current-password" required disabled={busy} className="mt-2 w-full rounded-xl border border-white/10 bg-white/3 px-4 py-3 text-sm text-white outline-none focus:border-accent/50" /></label>
          <button type="submit" disabled={busy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-50">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <LogIn size={15} />}{busy ? "Signing in…" : "Sign in"}</button>
        </form>}
        {error && <p role="alert" className="mt-5 text-xs leading-relaxed text-red-300">{error}</p>}
        {status === "unavailable" && <div className="mt-6 space-y-4"><p className="text-xs leading-relaxed text-zinc-500">First run? Initialize the owner account with <code className="text-zinc-300">wdd init --username owner</code>, then start the backend.</p><button onClick={retry} className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-zinc-300">Retry connection</button></div>}
        <div className="mt-8 flex items-center gap-2 border-t border-white/6 pt-5 text-[10px] text-zinc-600"><LockKeyhole size={12} /> Owner access · Cookie session · Credentials stay private</div>
      </section>
    </main>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
