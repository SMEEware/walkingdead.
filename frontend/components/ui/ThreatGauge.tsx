"use client";

import { threatLabel } from "../../lib/stats";

const R = 80;
const CX = 100;
const CY = 100;

function tick(i: number, total: number) {
  const a = Math.PI + (i / total) * Math.PI;
  const long = i % 5 === 0;
  const r1 = R + 10;
  const r2 = R + (long ? 20 : 15);
  const r = (n: number) => Number(n.toFixed(2));
  return {
    x1: r(CX + Math.cos(a) * r1),
    y1: r(CY + Math.sin(a) * r1),
    x2: r(CX + Math.cos(a) * r2),
    y2: r(CY + Math.sin(a) * r2),
    long,
  };
}

export function ThreatGauge({ score }: { score: number }) {
  return (
    <div className="relative mx-auto w-full max-w-60">
      <svg
        viewBox="0 0 200 118"
        className="w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <linearGradient id="gauge" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" style={{ stopColor: "var(--accent)" }} />
            <stop offset="1" style={{ stopColor: "var(--alert)" }} />
          </linearGradient>
        </defs>
        {Array.from({ length: 21 }, (_, i) => {
          const t = tick(i, 20);
          return (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="white"
              strokeOpacity={t.long ? 0.35 : 0.14}
              strokeWidth={t.long ? 1.4 : 1}
            />
          );
        })}
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke="white"
          strokeOpacity="0.07"
          strokeWidth="9"
          strokeLinecap="round"
          pathLength={100}
        />
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke="url(#gauge)"
          strokeWidth="9"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${Math.max(score, 0.01)} 100`}
          style={{
            transition: "stroke-dasharray 1.4s cubic-bezier(0.16, 1, 0.3, 1)",
            filter: "drop-shadow(0 0 7px var(--accent))",
          }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="font-display text-5xl leading-none tabular-nums text-white text-glow">
          {score}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.32em] text-accent">
          {threatLabel(score)}
        </div>
      </div>
    </div>
  );
}
