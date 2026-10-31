"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ZombieScene } from "../../lib/zombie-scene";
import { useHoneypot } from "../../providers/HoneypotProvider";
import { useSettings } from "../../providers/SettingsProvider";

const MODEL_URL = "/assets/objects/feral-walker-web.glb";

export function ZombieStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ZombieScene | null>(null);
  const [scene, setScene] = useState<ZombieScene | null>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const { running, cue } = useHoneypot();
  const { settings, theme } = useSettings();
  const pathname = usePathname();
  const command = pathname === "/";
  const consumedCue = useRef(cue?.id ?? 0);

  useEffect(() => {
    if (!command || sceneRef.current) return;
    let cancelled = false;

    // Three and its postprocessing modules are fetched only when this view is needed.
    void import("../../lib/zombie-scene").then(({ ZombieScene }) => {
      if (cancelled || !containerRef.current) return;
      try {
        const next = new ZombieScene(containerRef.current, {
          onProgress: setProgress,
          onReady: () => setReady(true),
          onError: () => setFailed(true),
        });
        sceneRef.current = next;
        setScene(next);
        next.load(MODEL_URL);
      } catch {
        setFailed(true);
      }
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [command]);

  useEffect(() => () => {
    sceneRef.current?.dispose();
    sceneRef.current = null;
  }, []);

  useEffect(() => {
    scene?.setActive(command);
  }, [command, scene]);

  useEffect(() => {
    scene?.setPowered(running);
  }, [running, scene]);

  useEffect(() => {
    scene?.setTheme(theme.accent, theme.alert);
  }, [theme.accent, theme.alert, scene]);

  const { autoRotate, particles, bloom } = settings;
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => scene?.setOptions({ autoRotate, particles, bloom, reducedMotion: preference.matches });
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [autoRotate, particles, bloom, scene]);

  useEffect(() => {
    if (!cue || cue.id <= consumedCue.current) return;
    consumedCue.current = cue.id;
    // Cues observed while loading, dormant or on another route are deliberately not replayed.
    if (!running || !command || !ready) return;
    scene?.play(cue.clip, cue.priority);
    scene?.pulse(cue.severity);
  }, [cue, running, command, ready, scene]);

  return (
    <div
      className={`zombie-stage ${command ? "stage-command" : "stage-background"} transition-opacity duration-700 ease-out-expo`}
      style={{ opacity: command ? 1 : 0, pointerEvents: command ? undefined : "none" }}
      aria-hidden={!command}
      data-system-state={running ? "online" : "offline"}
      data-render-state={!command ? "paused" : failed ? "unavailable" : ready ? "ready" : "loading"}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        role="img"
        aria-label={running ? "Autonomous sentinel monitoring honeypot activity" : "Dormant sentinel. Honeypot listeners are stopped"}
      />

      <div
        aria-hidden={ready && !failed}
        className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black transition-opacity duration-700 ease-out-expo ${
          ready && !failed ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="text-xl font-semibold tracking-[-0.04em] text-white">
          {failed ? "Sentinel visualization unavailable" : "Initializing sentinel"}
          {!failed && <span className="text-zinc-500">.</span>}
        </div>
        {!failed && <div className="h-px w-48 overflow-hidden bg-white/10">
          <div
            className="h-full bg-accent transition-[width] duration-500 ease-out-expo"
            style={{ width: progress ? `${Math.round(progress * 100)}%` : "8%" }}
          />
        </div>}
        <div className="max-w-64 text-center text-xs leading-relaxed text-zinc-500">
          {failed ? "System controls and telemetry remain available." : `Preparing the secure observation environment${progress ? ` · ${Math.round(progress * 100)}%` : ""}`}
        </div>
      </div>
    </div>
  );
}
