import { Fragment, type ReactNode } from "react";

/** Renders the small Markdown subset that the AI digests use. Input is never inserted as HTML. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\\[\\`*_{}\[\]()#+!|\-]|\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("\\")) {
      nodes.push(token.slice(1));
      last = match.index + token.length;
      continue;
    }
    nodes.push(
      token.startsWith("**") ? (
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      ) : (
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.9em] text-accent"
        >
          {token.slice(1, -1)}
        </code>
      ),
    );
    last = match.index + token.length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (!bullets.length) return;
    blocks.push(
      <ul
        key={key}
        className="ml-4 list-disc space-y-1.5 text-sm text-zinc-300 marker:text-accent"
      >
        {bullets.map((b, i) => (
          <li key={i}>{inline(b, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("- ") || line.startsWith("* ")) {
      bullets.push(line.slice(2));
      return;
    }
    flush(`ul-${i}`);
    if (!line) return;
    if (line.startsWith("### ")) {
      blocks.push(
        <h4
          key={i}
          className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-400"
        >
          {inline(line.slice(4), `h4-${i}`)}
        </h4>,
      );
      return;
    }
    if (line.startsWith("## ") || line.startsWith("# ")) {
      blocks.push(
        <h3
          key={i}
          className="mt-5 flex items-center gap-2 font-display text-lg tracking-[0.08em] text-white first:mt-0"
        >
          <span aria-hidden className="h-3 w-0.5 bg-accent" />
          {inline(line.replace(/^#{1,2} /, ""), `h3-${i}`)}
        </h3>,
      );
      return;
    }
    blocks.push(
      <p key={i} className="mt-2 text-sm leading-relaxed text-zinc-300">
        {inline(line, `p-${i}`)}
      </p>,
    );
  });
  flush("ul-end");

  return (
    <div className="space-y-1">
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
