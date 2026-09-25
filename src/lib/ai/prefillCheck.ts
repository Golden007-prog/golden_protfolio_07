/*
 * The server's last check on a navigator call before it is framed. validateToolCall
 * (tools.ts) rebuilds arguments from the site's enums, but prefillContact's message
 * is free model text, so it also goes through the pipeline /api/ai/draft runs on a
 * streamed draft (createDraftFilter): no number, total of years, 'certified', held
 * Master's or employer that neither the visitor nor the site gives, unknown project
 * names turned into '[project name]', no off-site contacts, and a greeting that
 * addresses Oikantik. The visitor's question plays the draft route's notes: what the
 * visitor said may be repeated in their own message.
 *
 * Any dropped sentence, or the canary in any string argument, drops the whole call.
 * The answer text still shows, and the visitor can write the message themselves.
 *
 * Pure: relative .ts imports only.
 */
import { createDraftFilter } from './draft.ts';
import type { AiToolCall } from './protocol.ts';

export type ToolCheckOptions = {
  /** The visitor's own question. */
  question: string;
  canary: string;
  entities: {
    projectNames: readonly string[];
    tech: readonly string[];
    skills: readonly string[];
    companies: readonly string[];
    institutions: readonly string[];
  };
  /** Site text whose numbers a draft may repeat, as /api/ai/draft passes it. */
  facts?: readonly string[];
};

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function leaksCanary(args: Record<string, unknown>, canary: string): boolean {
  const k = key(canary);
  return k !== '' && Object.values(args).some((v) => typeof v === 'string' && key(v).includes(k));
}

/**
 * The validated call as it may be sent, or null. Every call is refused when a
 * string argument carries the canary; prefillContact's message is replaced by the
 * draft filter's output and refused when any sentence of it fails a check.
 */
export function vetToolCall(call: AiToolCall, opts: ToolCheckOptions): AiToolCall | null {
  if (leaksCanary(call.args, opts.canary)) return null;
  if (call.name !== 'prefillContact') return call;
  const message = typeof call.args.message === 'string' ? call.args.message : '';
  if (!message.trim()) return null;

  const { entities } = opts;
  const filter = createDraftFilter({
    length: 'note',
    notes: typeof opts.question === 'string' ? opts.question : '',
    projectNames: entities.projectNames,
    knownNames: [...entities.tech, ...entities.skills, ...entities.companies, ...entities.institutions],
    companies: entities.companies,
    facts: opts.facts ?? [],
    canary: opts.canary,
  });
  const pushed = filter.push(message);
  if (pushed.blocked) return null;
  const end = filter.end();
  if (end.dropped > 0 || end.kept === 0) return null;
  const text = [...pushed.emit, ...end.emit].join('').trim();
  return text ? { name: 'prefillContact', args: { message: text } } : null;
}
