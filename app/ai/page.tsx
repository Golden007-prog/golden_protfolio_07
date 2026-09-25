import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Footer } from '@/components/layout/Footer';
import { SubpageHeader } from '@/components/layout/SubpageHeader';
import { ArchitectureDiagram } from '@/components/ai/lab/ArchitectureDiagram';
import { EmbeddingMap } from '@/components/ai/lab/EmbeddingMap';
import { EvalReport, parseEvalReport } from '@/components/ai/lab/EvalReport';
import { ModelCards } from '@/components/ai/lab/ModelCards';
import { RedTeamResults, parseAttacks } from '@/components/ai/lab/RedTeamResults';
import { StructuredDemo, labDemos } from '@/components/ai/lab/StructuredDemo';
import evalReport from '@/data/ai-eval-report.json';
import labStore from '@/data/ai-generated/lab.json';
import { MODEL_CARDS } from '@/data/ai-model-cards';
import { SHOW_UNREVIEWED } from '@/lib/ai/config';
import { AI_MODELS, aiTier, modelOrder } from '@/lib/ai/config.server';

// Built once as a static page. Model ids and the tier come from the server
// configuration at build time; Vercel applies env changes only on a redeploy, so
// they match what /api/ai/health reports for the same deployment.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'How the AI works',
  description:
    "How the AI on Oikantik Basu's portfolio answers from the site's own content: the pipeline, its defences and limits, model cards, privacy, evals and red-team results.",
  alternates: { canonical: '/ai' },
};

const TERMS_URL = 'https://ai.google.dev/gemini-api/terms';
const PAPER_URL = 'https://arxiv.org/abs/2307.03172';

/*
 * Repo files read at build time; a missing one reads as empty. Each path is spelled
 * out in literal segments: a computed path makes Turbopack trace (and deploy) the
 * whole project into the server output.
 */
const REPO_FILES = {
  golden: () => readFileSync(path.join(process.cwd(), 'evals', 'golden.jsonl'), 'utf8'),
  injection: () => readFileSync(path.join(process.cwd(), 'evals', 'injection.jsonl'), 'utf8'),
  vectors: () => readFileSync(path.join(process.cwd(), 'src', 'data', 'ai-vectors.json'), 'utf8'),
};

function readRepoFile(name: keyof typeof REPO_FILES): string {
  try {
    return REPO_FILES[name]();
  } catch {
    return '';
  }
}

function countSets() {
  const golden = readRepoFile('golden')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return (JSON.parse(l) as { set?: string }).set;
      } catch {
        return null;
      }
    });
  return { golden: golden.filter((s) => s === 'golden').length, bait: golden.filter((s) => s === 'bait').length };
}

function embeddingModel(): string | null {
  try {
    const v = JSON.parse(readRepoFile('vectors')) as { model?: unknown; entries?: Record<string, unknown> };
    return typeof v.model === 'string' && v.entries && Object.keys(v.entries).length ? v.model : null;
  } catch {
    return null;
  }
}

const NEW_TAB = <span className="sr-only"> (opens in new tab)</span>;

const TOC: { id: string; label: string }[] = [
  { id: 'how', label: 'How it works' },
  { id: 'defences', label: 'Defences' },
  { id: 'limitations', label: 'Limitations' },
  { id: 'cards', label: 'Model cards' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'evals', label: 'Evals' },
  { id: 'red-team', label: 'Red team' },
  { id: 'demo', label: 'Structured output' },
  { id: 'explorer', label: 'Embedding map' },
];

const DEFENCES: { title: string; text: string }[] = [
  {
    title: 'Rules before models',
    text: 'Questions with a known answer (his CV, links, a named project, education, a listed skill) are answered by rules from the site’s data and never reach a model.',
  },
  {
    title: 'A cheap-first guard',
    text: 'Every AI request must be a same-origin JSON POST under a size cap that passes its schema, the kill switches, Vercel BotID and a per-IP token bucket (IPv6 by /64) whose cost grows with input size. A refusal never touches the key.',
  },
  {
    title: 'A relevance gate',
    text: 'Without a strong match on his own work, the assistant says the site doesn’t cover the question and offers the contact form, without calling the model.',
  },
  {
    title: 'Visitor text is data, never instructions',
    text: 'The question, earlier questions and any web or live data are wrapped in delimited untrusted blocks with look-alike delimiters removed. Visitor text never enters the system instructions, and earlier AI answers are never sent back, so a client can’t forge a model turn.',
  },
  {
    title: 'Honesty rules',
    text: 'The model is told never to total his years of experience, state salary, visa, age or health, call him certified, turn a project or evaluation job into employment at Google DeepMind, OpenAI or Anthropic, or describe his in-progress Master’s as held. Reference chunks are never evidence that he used something.',
  },
  {
    title: 'A sentence filter',
    text: 'Each sentence is released only after it passes: links, emails and phone numbers not on the site are scrubbed, a canary leak ends the answer, citations must come from the context, and numbers and employers must appear in the cited chunks. A claim about him with no surviving citation is dropped.',
  },
  {
    title: 'Verbatim quotes on structured answers',
    text: 'The job fit check and role briefs return claims with quotes, and each quote must match its source chunk word for word, or the claim is removed.',
  },
  {
    title: 'Safety settings',
    text: 'Every call blocks harassment, hate speech, sexually explicit and dangerous content at medium and above, because the Gemini 3 default is off.',
  },
  {
    title: 'Cost limits',
    text: 'Output-token caps per feature, one 25-second deadline per request, the fallback model only on a 429 or 503 with 8 seconds left, no retry after a timeout, and the upstream call is cancelled when the visitor stops or leaves.',
  },
  {
    title: 'Owner review for precomputed claims',
    text: 'Content generated ahead of time that makes claims about him stays hidden in production until Oikantik approves it.',
  },
  {
    title: 'Graceful fallback',
    text: 'Every failure answers HTTP 200 with a reason, and the rule-based answer or keyword search takes over. After two quota or service failures in a row, the browser stops asking for ten minutes, or for the rest of the session when AI is switched off.',
  },
  {
    title: 'No key in the browser',
    text: 'The Gemini key lives only on the server, and every build is scanned to make sure it never reaches client code.',
  },
];

const LIMITATIONS: string[] = [
  'It can be wrong. The checks catch invented numbers, employers and links, but not every misreading: a sentence can cite the right chunk and still paraphrase it badly.',
  'It knows only this site. Salary, notice period, references and anything else not written here get “not on this site”, by design.',
  'The checks can over-remove. A true sentence whose wording differs from its source can be dropped, so some answers come out shorter than they should.',
  'Retrieval can miss. A question worded very differently from the site can get “not on this site” even when the answer is here, and keyword search alone, when embeddings are off, misses more.',
  'Answers in non-Latin scripts are shown only when their numbers and names survive the check; otherwise the English answer is shown.',
  'Precomputed content lags the site until the generators run again.',
  'The free tier’s quota is small. On a busy day the AI rests and the rule-based answers take over.',
  'The evals below are small and written by the site’s owner, so they are a smoke test, not a benchmark.',
];

function Section({ id, title, kicker, children }: { id: string; title: string; kicker: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-hairline py-12 sm:py-16">
      <p className="font-mono text-xs text-text-muted">{kicker}</p>
      <h2 id={`${id}-title`} className="mt-2 font-display text-h3 font-semibold text-text-primary">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <div className="flex max-w-[68ch] flex-col gap-4 text-base leading-relaxed text-text-secondary">{children}</div>;
}

export default function AiPage() {
  const primary = AI_MODELS.primary;
  const fallbackModel = AI_MODELS.fallback;
  const tier = aiTier();
  const report = parseEvalReport(evalReport);
  const sizes = countSets();
  const attacks = parseAttacks(readRepoFile('injection'));
  const demos = labDemos(labStore, SHOW_UNREVIEWED);
  const embed = embeddingModel();

  return (
    <>
      <SubpageHeader />
      <main id="main" tabIndex={-1} className="min-h-screen bg-bg-base text-text-primary">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-8 sm:pt-12">
          <header className="pb-10">
            <p className="font-mono text-xs text-text-muted">Transparency</p>
            <h1 className="mt-2 font-display text-h2 font-semibold text-text-primary">How this site’s AI works</h1>
            <div className="mt-6">
              <Prose>
                <p className="text-lg text-text-secondary">
                  The AI on this site answers questions about Oikantik’s work using only the site’s own content. It cites what it uses, says
                  so when the site doesn’t cover something, and falls back to plain rule-based answers when anything goes wrong.
                </p>
                <p>
                  This page shows how: the pipeline, the defences and their limits, a card for every AI feature, what happens to what you type,
                  and the evals that check it.
                </p>
              </Prose>
            </div>
            <nav aria-labelledby="ai-toc-title" className="mt-8">
              <h2 id="ai-toc-title" className="font-mono text-xs font-normal text-text-muted">
                On this page
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {TOC.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      className="tap-safe ring-focus rounded-full border border-glass-border px-4 text-sm text-text-secondary transition-colors hover:border-glass-border-strong hover:text-text-primary"
                    >
                      {t.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </header>

          <Section id="how" kicker="01 · Pipeline" title="How an answer is made">
            <Prose>
              <p>
                When you ask the assistant something, the question passes through the steps below. Four of them can end the request early,
                and every early exit is cheaper and safer than calling the model.
              </p>
            </Prose>
            <div className="mt-8">
              <ArchitectureDiagram models={{ primary, fallback: fallbackModel }} />
            </div>

            <div id="context-order" className="mt-12 scroll-mt-24 rounded-2xl border border-hairline bg-surface-tint p-5 sm:p-6">
              <h3 className="font-display text-xl font-semibold text-text-primary">Why the strongest chunks go first and last</h3>
              <div className="mt-3">
                <Prose>
                  <p>
                    Language models use information at the start and end of a long context better than information in the middle, as{' '}
                    <a href={PAPER_URL} target="_blank" rel="noopener noreferrer" className="ai-link ring-focus rounded-md">
                      Lost in the Middle (Liu et al., 2023)
                      {NEW_TAB}
                    </a>{' '}
                    showed. So the context packer doesn’t list retrieved chunks in rank order. It alternates them, so ranks 1, 2, 3, 4, 5 are
                    placed as 1, 3, 5, 4, 2: the two strongest sit at the edges and the weakest in the middle.
                  </p>
                  <p>It also keeps the context to about 3,000 tokens, since a shorter, better-ordered context beats a longer one.</p>
                </Prose>
              </div>
            </div>
          </Section>

          <Section id="defences" kicker="02 · Defences" title="What stops it from making things up">
            <ul data-ai-defences="" className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {DEFENCES.map((d) => (
                <li key={d.title} className="rounded-2xl border border-hairline bg-surface-tint p-5">
                  <h3 className="font-semibold text-text-primary">{d.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">{d.text}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="limitations" kicker="03 · Limitations" title="What it still gets wrong">
            <ul data-ai-limitations="" className="flex max-w-[68ch] list-disc flex-col gap-3 pl-5 text-base leading-relaxed text-text-secondary marker:text-text-dim">
              {LIMITATIONS.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Section>

          <Section id="cards" kicker="04 · Model cards" title="Every AI feature, one card each">
            <Prose>
              <p>
                The chat tier tries <code className="font-mono text-sm text-text-primary">{primary}</code> first, the cheap tier tries{' '}
                <code className="font-mono text-sm text-text-primary">{fallbackModel}</code> first, and each falls back to the other only on a
                429 or 503. These ids are read from the server configuration when the site is built.
              </p>
            </Prose>
            <div className="mt-8">
              <ModelCards cards={MODEL_CARDS} models={{ chat: modelOrder('chat'), cheap: modelOrder('cheap'), embedding: embed }} />
            </div>
          </Section>

          <Section id="privacy" kicker="05 · Privacy" title="What happens to what you type">
            <div data-privacy-tier={tier} className="flex flex-col gap-8">
              <div>
                <h3 className="font-display text-xl font-semibold text-text-primary">What goes to Google</h3>
                <ul className="mt-3 flex max-w-[68ch] list-disc flex-col gap-2 pl-5 text-base leading-relaxed text-text-secondary marker:text-text-dim">
                  <li>
                    What you type into an AI feature: a question, a job description, a message draft, or a phrase to search by meaning. In the
                    Ask panel, up to six of your earlier questions in the same chat go with it, so follow-ups make sense. Earlier AI answers
                    don’t.
                  </li>
                  <li>Excerpts of this site’s own content that the answer draws on, and the site’s instructions to the model.</li>
                  <li>
                    Before a pasted job description or contact note is sent, email addresses, phone numbers and links carrying credentials are
                    removed. That is best effort, so please don’t paste confidential text.
                  </li>
                  <li>
                    Not your IP address, cookies or any identifier: requests reach Google from this site’s server, not from your browser.
                  </li>
                </ul>
              </div>

              <div data-privacy-terms="" className="max-w-[68ch] rounded-2xl border border-hairline bg-surface-tint p-5 sm:p-6">
                <h3 className="font-display text-xl font-semibold text-text-primary">
                  {tier === 'paid' ? 'Paid tier: what Google does with it' : 'Free tier: what Google may do with it'}
                </h3>
                {tier === 'paid' ? (
                  <p data-privacy-copy="paid" className="mt-3 text-base leading-relaxed text-text-secondary">
                    This site uses the paid tier of the Gemini API. Under Google’s terms for paid services, Google doesn’t use prompts or
                    responses to improve its products. It logs them for a limited period, only to detect violations of its Prohibited Use
                    Policy and for required legal or regulatory disclosures.
                  </p>
                ) : (
                  <p data-privacy-copy="free" className="mt-3 text-base leading-relaxed text-text-secondary">
                    {tier === 'unknown'
                      ? 'The site’s Gemini API tier isn’t declared, so this page assumes the free tier, whose terms are stricter for you. '
                      : 'This site uses the free tier of the Gemini API. '}
                    Under Google’s terms for unpaid services, Google uses what is sent and the responses to provide, improve and develop its
                    products and machine-learning technologies, and human reviewers may read and annotate them, after they are disconnected
                    from this site’s account and key. Don’t type anything confidential or personal.
                  </p>
                )}
                <p className="mt-3 text-sm text-text-muted">
                  Checked against the{' '}
                  <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="ai-link ring-focus rounded-md">
                    Gemini API terms
                    {NEW_TAB}
                  </a>{' '}
                  (last updated 28 April 2026).
                </p>
              </div>

              <div>
                <h3 className="font-display text-xl font-semibold text-text-primary">What this site keeps</h3>
                <ul className="mt-3 flex max-w-[68ch] list-disc flex-col gap-2 pl-5 text-base leading-relaxed text-text-secondary marker:text-text-dim">
                  <li>
                    No question text. Nothing you type is written to a database or to the site’s logs, which record only the feature, model,
                    timings, token counts and the reason for any fallback.
                  </li>
                  <li>
                    So that a repeated standalone question costs nothing, one server may hold it and its answer in memory for up to ten
                    minutes. A restart clears it.
                  </li>
                  <li>Rate limiting keeps a short-lived counter per IP address (per /64 block for IPv6) in server memory, never on disk.</li>
                  <li>Your chat stays in this browser tab’s session storage until you close the tab or start a new chat.</li>
                  <li>Anonymous analytics count AI events, such as which feature ran and whether it fell back, never what you typed.</li>
                  <li>Vercel hosts the site under its own privacy policy and runs BotID, a bot check, on AI requests.</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section id="evals" kicker="06 · Evals" title="How well it does, measured">
            <EvalReport report={report} current={{ primary, fallback: fallbackModel }} sets={{ ...sizes, injection: attacks.length }} />
          </Section>

          <Section id="red-team" kicker="07 · Red team" title="Attacks it was tested against">
            <RedTeamResults attacks={attacks} results={report.run ? report.run.injection : null} date={report.run?.date} />
          </Section>

          <Section id="demo" kicker="08 · Structured output" title="Structured extraction, recorded once">
            <Prose>
              <p>
                Some features ask the model for JSON rather than prose. The request carries a JSON Schema, and the reply must then pass a zod
                check, which verifies things a schema can’t express, such as a phrase appearing word for word in the input, and catches a reply that ignores the schema.
              </p>
              <p>
                These three runs were recorded once from the site’s own data and are replayed here, so this section makes no request. A live
                extraction box would have been a general-purpose endpoint on the owner’s key.
              </p>
            </Prose>
            <div className="mt-8">
              <StructuredDemo demos={demos} />
            </div>
          </Section>

          <Section id="explorer" kicker="09 · Embeddings" title="The site, mapped by meaning">
            <Prose>
              <p>
                Each chunk of the site has an embedding: a list of 768 numbers that places similar text close together. This map squeezes
                them into two dimensions. Plot a question to see which chunks search by meaning would hand the assistant.
              </p>
            </Prose>
            <div className="mt-8">
              <EmbeddingMap />
            </div>
          </Section>
        </div>
      </main>
      {/* The footer's oversized wordmark bleeds past narrow viewports; clip it like the home page does. */}
      <div className="overflow-x-clip">
        <Footer />
      </div>
    </>
  );
}
