import type { AiRun } from "../../lib/ai/types";
import { Markdown } from "./Markdown";

export function AiAnalysis({ result }: { result: AiRun }) {
  return (
    <section className="space-y-3" aria-label="AI interpretation">
      <div className="text-[10px] font-medium uppercase tracking-widest text-accent">AI interpretation · Verify against captured evidence</div>
      <p className="text-[10px] leading-relaxed text-zinc-500">DeepSeek · {result.model} · {result.sampledEvents} of {result.totalEvents} events selected · {result.inputTokens} input / {result.outputTokens} output tokens</p>
      <Markdown text={result.text} />
      {!!result.findings?.length && <details className="rounded-lg border border-white/8 bg-black/20 p-3">
        <summary className="cursor-pointer text-xs text-zinc-400">Findings and evidence references</summary>
        <div className="mt-3 space-y-4">{result.findings.map((finding, index) => <article key={index} className="space-y-1">
          <h4 className="text-xs font-medium text-zinc-200">{finding.title} <span className="ml-2 text-[10px] font-normal text-zinc-500">{finding.confidence} confidence</span></h4>
          <p className="text-xs leading-relaxed text-zinc-400">{finding.assessment}</p>
          <div className="flex flex-wrap gap-1.5" aria-label="Supporting event IDs">{finding.evidenceIds.map((id) => <code key={id} className="break-all rounded bg-white/5 px-1.5 py-1 font-mono text-[9px] text-accent/80">{id}</code>)}</div>
        </article>)}</div>
      </details>}
      {!!result.limitations?.length && <div className="rounded-lg border border-amber-300/10 bg-amber-300/3 p-3"><div className="text-[10px] uppercase tracking-widest text-amber-200/70">Limitations</div><ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-relaxed text-zinc-400">{result.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
    </section>
  );
}
