/*
 * The concierge's site navigator: six function declarations whose arguments are
 * enums built from the site's own data, the pure intent check that decides
 * whether they are sent at all (they cost about 500 input tokens), and the one
 * validator both the route and the client run on a proposed call. A call the
 * validator rejects never reaches the action runner.
 *
 * Pure: relative .ts imports only, no JSON. Route and client build ToolData with
 * toolDataFrom() from the same raw data, so their enums always agree.
 */
import type { AiAction, AiTarget, AiToolCall } from './protocol.ts';
import { cleanText, scrubContacts } from './sanitize.ts';
import type { SectionId } from '../site.ts';
import { techFamily } from '../tech.ts';

export const TOOL_NAMES = ['scrollToSection', 'openProject', 'openSkill', 'setProjectFilters', 'openCv', 'prefillContact'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_LIMITS = { q: 60, message: 500 } as const;

export type ToolData = {
  sections: readonly { id: SectionId; label: string }[];
  projects: readonly { slug: string; name: string }[];
  skills: readonly string[];
  categories: readonly string[];
  tech: readonly string[];
};

/** Structurally a @google/genai FunctionDeclaration; kept local so this module stays dependency-free. */
export type ToolDeclaration = {
  name: ToolName;
  description: string;
  parametersJsonSchema?: Record<string, unknown>;
};

const uniq = (xs: Iterable<string>) => [...new Set([...xs].map((x) => x.trim()).filter(Boolean))];

/** Every enum the declarations use, from the site's data. */
export function toolDataFrom(src: {
  sections: readonly { id: SectionId; label: string }[];
  projects: readonly {
    slug: string;
    name: string;
    category: string;
    techStack: readonly string[];
  }[];
  skills: Readonly<Record<string, readonly string[]>>;
}): ToolData {
  return {
    sections: src.sections.map((s) => ({ id: s.id, label: s.label })),
    projects: src.projects.map((p) => ({ slug: p.slug, name: p.name })),
    skills: uniq(Object.values(src.skills).flat()),
    categories: uniq(src.projects.map((p) => p.category)),
    tech: uniq(src.projects.flatMap((p) => p.techStack.map((t) => techFamily(t)))).sort((a, b) => a.localeCompare(b)),
  };
}

export function toolDeclarations(data: ToolData): ToolDeclaration[] {
  const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  });
  return [
    {
      name: 'scrollToSection',
      description: 'Scroll the home page to one of its sections.',
      parametersJsonSchema: obj({ section: { type: 'string', enum: data.sections.map((s) => s.id) } }, ['section']),
    },
    {
      name: 'openProject',
      description: "Open one project's details dialog.",
      parametersJsonSchema: obj({ slug: { type: 'string', enum: data.projects.map((p) => p.slug) } }, ['slug']),
    },
    {
      name: 'openSkill',
      description: "Open one listed skill's details.",
      parametersJsonSchema: obj({ name: { type: 'string', enum: [...data.skills] } }, ['name']),
    },
    {
      name: 'setProjectFilters',
      description: 'Filter the projects grid. Any omitted filter is cleared.',
      parametersJsonSchema: obj({
        cat: { type: 'string', enum: [...data.categories] },
        tech: { type: 'string', enum: [...data.tech] },
        live: {
          type: 'boolean',
          description: 'Only projects with a live demo.',
        },
        q: {
          type: 'string',
          maxLength: TOOL_LIMITS.q,
          description: 'A short search phrase.',
        },
      }),
    },
    { name: 'openCv', description: 'Download his CV (PDF).' },
    {
      name: 'prefillContact',
      description: 'Put a draft message into the contact form for the visitor to review. It is never sent.',
      parametersJsonSchema: obj({ message: { type: 'string', maxLength: TOOL_LIMITS.message } }, ['message']),
    },
  ];
}

/* ---------------------------------------------------------------------------
 * When to send the declarations
 * ------------------------------------------------------------------------- */

const NAVIGATION =
  /\b(?:open\b(?![- ](?:source|to|for|minded)\b)|take me|bring me|go to|goto|navigate|jump to|scroll (?:to|down|up)|head to|filter|narrow (?:down|it)|only show|show only|download|pre-?fill|fill (?:in|out)|draft (?:a |an |me a )?(?:message|email|note)|write (?:a |an |me a )?(?:message|email|note))/i;

/** True when the question asks the site to do something: open, go to, filter, download or draft. */
export function wantsNavigation(question: string): boolean {
  return typeof question === 'string' && NAVIGATION.test(question);
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------- */

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function onlyKeys(args: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(args).every((k) => allowed.includes(k));
}

function oneOf(value: unknown, list: readonly string[]): string | null {
  return typeof value === 'string' && list.includes(value) ? value : null;
}

function phrase(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const v = cleanText(value).replace(/\s+/g, ' ').trim();
  return v && v.length <= max ? v : null;
}

/**
 * The call with its arguments rebuilt from the enums, or null. Unknown names,
 * unknown keys, values outside an enum and over-long text are all rejected; a
 * draft message loses any URL or email address that is not the site's own.
 */
export function validateToolCall(call: unknown, data: ToolData): AiToolCall | null {
  if (!isRecord(call) || typeof call.name !== 'string') return null;
  const args = call.args === undefined || call.args === null ? {} : call.args;
  if (!isRecord(args)) return null;

  switch (call.name as ToolName) {
    case 'scrollToSection': {
      const section = oneOf(
        args.section,
        data.sections.map((s) => s.id),
      );
      return section && onlyKeys(args, ['section']) ? { name: 'scrollToSection', args: { section } } : null;
    }
    case 'openProject': {
      const slug = oneOf(
        args.slug,
        data.projects.map((p) => p.slug),
      );
      return slug && onlyKeys(args, ['slug']) ? { name: 'openProject', args: { slug } } : null;
    }
    case 'openSkill': {
      const name = oneOf(args.name, data.skills);
      return name && onlyKeys(args, ['name']) ? { name: 'openSkill', args: { name } } : null;
    }
    case 'setProjectFilters': {
      if (!onlyKeys(args, ['cat', 'tech', 'live', 'q'])) return null;
      const out: Record<string, unknown> = {};
      if (args.cat !== undefined && args.cat !== null && args.cat !== '') {
        const cat = oneOf(args.cat, data.categories);
        if (!cat) return null;
        out.cat = cat;
      }
      if (args.tech !== undefined && args.tech !== null && args.tech !== '') {
        const tech = oneOf(args.tech, data.tech);
        if (!tech) return null;
        out.tech = tech;
      }
      if (args.live !== undefined && args.live !== null) {
        if (typeof args.live !== 'boolean') return null;
        if (args.live) out.live = true;
      }
      if (args.q !== undefined && args.q !== null && args.q !== '') {
        const q = phrase(args.q, TOOL_LIMITS.q);
        if (!q) return null;
        out.q = q;
      }
      return { name: 'setProjectFilters', args: out };
    }
    case 'openCv':
      return Object.keys(args).length === 0 ? { name: 'openCv', args: {} } : null;
    case 'prefillContact': {
      if (!onlyKeys(args, ['message']) || typeof args.message !== 'string') return null;
      if (args.message.length > TOOL_LIMITS.message) return null;
      const message = scrubContacts(cleanText(args.message), {
        urls: [],
        emails: [],
      }).trim();
      return message ? { name: 'prefillContact', args: { message } } : null;
    }
    default:
      return null;
  }
}

/** What the action runner does for a validated call. */
export function toolAction(call: AiToolCall): AiTarget | AiAction | null {
  const a = call.args;
  switch (call.name as ToolName) {
    case 'scrollToSection':
      return { kind: 'section', id: a.section as SectionId };
    case 'openProject':
      return { kind: 'project', slug: String(a.slug) };
    case 'openSkill':
      return { kind: 'skill', name: String(a.name) };
    case 'setProjectFilters': {
      const f: Extract<AiAction, { kind: 'filter' }> = { kind: 'filter' };
      if (typeof a.cat === 'string') f.cat = a.cat;
      if (typeof a.tech === 'string') f.tech = a.tech;
      if (a.live === true) f.live = true;
      if (typeof a.q === 'string') f.q = a.q;
      return f;
    }
    case 'openCv':
      return { kind: 'cv' };
    case 'prefillContact':
      return typeof a.message === 'string' ? { kind: 'prefill', message: a.message } : null;
    default:
      return null;
  }
}

/** The step chip's text: 'Opening UrbanCare AI…'. */
export function stepLabel(call: AiToolCall, data: ToolData): string {
  const a = call.args;
  switch (call.name as ToolName) {
    case 'scrollToSection':
      return `Moving to ${data.sections.find((s) => s.id === a.section)?.label ?? 'that section'}…`;
    case 'openProject':
      return `Opening ${data.projects.find((p) => p.slug === a.slug)?.name ?? 'the project'}…`;
    case 'openSkill':
      return `Opening ${String(a.name)}…`;
    case 'setProjectFilters': {
      const parts = [a.tech, a.cat, typeof a.q === 'string' ? `“${a.q}”` : null, a.live === true ? 'live demos' : null].filter(
        (x): x is string => typeof x === 'string',
      );
      return parts.length ? `Filtering projects by ${parts.join(', ')}…` : 'Clearing the project filters…';
    }
    case 'openCv':
      return 'Downloading the CV…';
    case 'prefillContact':
      return 'Adding a draft to the contact form…';
    default:
      return 'Working on it…';
  }
}

/** URL keys a tool may change, so Undo can put them back. */
export const UNDO_PARAMS = ['project', 'skill', 'q', 'cat', 'tech', 'live'] as const;
