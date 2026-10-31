"use client";

import { useId } from "react";

export function Sparkline({
  values,
  className = "",
}: {
  values: number[];
  className?: string;
}) {
  const fillId = `spark-fill-${useId().replace(/:/g, "")}`;
  const w = 200;
  const h = 48;
  const safe = values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const max = Math.max(1, ...safe);
  // Keep matching path commands as data changes so the browser can morph the line.
  const pointCount = 32;
  const pts = Array.from({ length: pointCount }, (_, i) => {
    const position = (i / (pointCount - 1)) * Math.max(0, safe.length - 1);
    const index = Math.floor(position);
    const from = safe[index] ?? 0;
    const to = safe[index + 1] ?? from;
    const value = from + (to - from) * (position - index);
    return [(i / (pointCount - 1)) * w, h - 4 - (value / max) * (h - 10)] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`sparkline ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop
            offset="0"
            style={{ stopColor: "var(--accent)", stopOpacity: 0.4 }}
          />
          <stop
            offset="1"
            style={{ stopColor: "var(--accent)", stopOpacity: 0 }}
          />
        </linearGradient>
      </defs>
      <path className="chart-area" d={area} fill={`url(#${fillId})`} />
      <path
        className="chart-line"
        d={line}
        pathLength={1}
        fill="none"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        style={{
          stroke: "var(--accent)",
          filter: "drop-shadow(0 0 4px var(--accent))",
        }}
      />
      {values.length > 0 && last && (
        <circle
          className="chart-head"
          cx={last[0]}
          cy={last[1]}
          r="2.5"
          style={{ fill: "var(--accent)" }}
        />
      )}
    </svg>
  );
}
