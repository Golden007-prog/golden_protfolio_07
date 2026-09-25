/*
 * The assistant's pipeline as an inline SVG, with its text equivalent built from
 * the same list, so the two never disagree. Colours come from theme tokens in
 * ai-lab.css, so the diagram follows dark and light. Server component: no JS.
 */

type Kind = 'io' | 'step' | 'check' | 'model';

type Step = {
  title: string;
  /** One short line inside the box (about 40 characters at most). */
  sub: string;
  /** Where a request leaves the pipeline at this step, if it can. */
  exit?: string;
  /** The longer explanation in the text equivalent. */
  detail: string;
  kind: Kind;
  mono?: string[];
};

type Models = { primary: string; fallback: string };

function steps(models: Models): Step[] {
  return [
    {
      title: 'Your question',
      sub: 'Typed or dictated in the Ask panel',
      detail: 'A visitor asks something in the Ask panel, by typing or by voice.',
      kind: 'io',
    },
    {
      title: 'Rule router',
      sub: 'CV, links, projects, education…',
      exit: 'Known intent → rule answer, no AI',
      detail:
        'Known intents (his CV, links, a named project, education, a listed skill) are answered instantly by rules from the site’s data. Only open-ended questions go further.',
      kind: 'check',
    },
    {
      title: 'Guard',
      sub: 'Origin, size, schema, BotID, rate limit',
      exit: 'Refused cheaply, before any model call',
      detail:
        'The server checks, cheapest first: POST only, JSON only, same origin, a capped body, the request schema, the kill switches, Vercel BotID and a per-IP token bucket. A refusal never reaches the model.',
      kind: 'check',
    },
    {
      title: 'Hybrid retrieval',
      sub: 'BM25 + embeddings, fused by RRF',
      detail:
        'The question is matched against the site’s content twice, by keywords (BM25) and by meaning (embeddings), and the two rankings are fused with reciprocal rank fusion. Without embeddings it uses BM25 alone.',
      kind: 'step',
    },
    {
      title: 'Relevance gate',
      sub: 'Needs a strong match on his own work',
      exit: 'Weak match → says “not on this site”',
      detail:
        'Unless a chunk about his own work clears the threshold, the answer is “nothing on this site covers that”, with an offer to write to him, and the model is never called. Reference and live chunks don’t count.',
      kind: 'check',
    },
    {
      title: 'Context packer',
      sub: 'Strongest chunks first and last',
      detail:
        'A fixed core card plus the best hits, within about 3,000 tokens, ordered so the strongest sit at the start and the end. Web and live data are wrapped as untrusted, as is the question itself.',
      kind: 'step',
    },
    {
      title: 'Gemini fallback chain',
      sub: 'Fallback model only on 429 or 503',
      mono: [`primary: ${short(models.primary)}`, `fallback: ${short(models.fallback)}`],
      exit: 'Quota, timeout or error → rule answer',
      detail: `The primary model (${models.primary}) answers under one 25-second deadline. Only a 429 or 503, with at least 8 seconds left, moves to the fallback (${models.fallback}); a timeout is never retried. Any failure falls back to the rule answer.`,
      kind: 'model',
    },
    {
      title: 'Sentence filter',
      sub: 'Scrub, canary, citations, tripwire',
      exit: 'Unverified sentence → dropped',
      detail:
        'Each sentence is held until it passes: foreign links, emails and phone numbers are scrubbed, a canary leak stops the answer, citations must come from the packed context, and every number and employer must appear in the cited chunks.',
      kind: 'check',
    },
    {
      title: 'Stream',
      sub: 'Verified sentences only, as NDJSON',
      detail: 'Only sentences that passed are streamed to the browser, one at a time, so nothing unchecked is ever shown or copied.',
      kind: 'step',
    },
    {
      title: 'Answer with sources',
      sub: 'Numbered chips and an AI disclosure',
      detail: 'Each citation becomes a numbered chip that opens its source on the site, under an “AI-generated · may be wrong” disclosure.',
      kind: 'io',
    },
  ];
}

function short(id: string): string {
  return id.length > 30 ? `${id.slice(0, 29)}…` : id;
}

const W = 300;
const X = 6;
const BOX_W = W - X * 2;
const PAD = 12;
const LINE = 18;
const GAP = 24;

type Line = { y: number; text: string; cls: 'ai-lab-title' | 'ai-lab-sub' | 'ai-lab-mono' | 'ai-lab-exit' };
type Box = { s: Step; top: number; h: number; lines: Line[] };

/** Box positions and text baselines, computed once outside render. */
function layout(list: Step[]): { boxes: Box[]; height: number } {
  const boxes: Box[] = [];
  let top = 4;
  list.forEach((s, i) => {
    const lines: Line[] = [{ y: top + 22, text: `${i + 1}. ${s.title}`, cls: 'ai-lab-title' }];
    let y = top + 22 + LINE;
    lines.push({ y, text: s.sub, cls: 'ai-lab-sub' });
    for (const m of s.mono ?? []) {
      y += 16;
      lines.push({ y, text: m, cls: 'ai-lab-mono' });
    }
    if (s.exit) {
      y += LINE;
      lines.push({ y, text: s.exit, cls: 'ai-lab-exit' });
    }
    const h = y - top + 12;
    boxes.push({ s, top, h, lines });
    top += h + GAP;
  });
  return { boxes, height: top - GAP + 4 };
}

export function ArchitectureDiagram({ models, id = 'ai-arch' }: { models: Models; id?: string }) {
  const list = steps(models);
  const { boxes, height } = layout(list);

  return (
    <figure data-ai-diagram="" className="ai-lab-figure">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        className="ai-lab-diagram"
        preserveAspectRatio="xMidYMin meet"
      >
        <title id={`${id}-title`}>How an answer is made</title>
        <desc id={`${id}-desc`}>
          A vertical pipeline of ten steps, from the visitor’s question through a rule router, a guard, hybrid retrieval, a relevance gate, a
          context packer, the Gemini fallback chain, a sentence filter and a stream, to an answer with sources. Four steps can end the
          request early. The same steps are listed in text below the diagram.
        </desc>
        <defs>
          <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="ai-lab-arrowhead" />
          </marker>
        </defs>
        {boxes.map(({ s, top, h, lines }, i) => {
          const next = boxes[i + 1];
          return (
            <g key={s.title} className="ai-lab-node" data-kind={s.kind}>
              <rect x={X} y={top} width={BOX_W} height={h} rx={12} />
              {lines.map((l) => (
                <text key={l.cls + l.text} x={X + PAD} y={l.y} className={l.cls}>
                  {l.text}
                </text>
              ))}
              {next ? (
                <line
                  x1={W / 2}
                  y1={top + h + 2}
                  x2={W / 2}
                  y2={next.top - 3}
                  className="ai-lab-arrow"
                  markerEnd={`url(#${id}-arrow)`}
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      <figcaption className="max-w-[68ch]">
        <h3 id={`${id}-text`} className="font-display text-lg font-semibold text-text-primary">
          The same pipeline, step by step
        </h3>
        <ol data-ai-diagram-text="" aria-labelledby={`${id}-text`} className="mt-4 flex flex-col gap-4 text-sm leading-relaxed text-text-secondary">
          {list.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-2">
              <span aria-hidden="true" className="font-mono text-xs leading-6 text-text-dim">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>
                <span className="font-semibold text-text-primary">{s.title}.</span> {s.detail}
                {s.exit ? <span className="mt-1 block text-amber-text">Can end here: {s.exit}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
