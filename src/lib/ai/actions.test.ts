import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  anchorOf,
  announcementFor,
  KNOWN_SECTIONS,
  planAction,
  PROJECT_FILTER_PARAMS,
  RUNNER_PARAMS,
  sectionOf,
  targetHref,
  type AiPlan,
} from './actions.ts';
import type { AiAction, AiTarget } from './protocol.ts';
import type { SectionId } from '../site.ts';

const CASE_STUDIES = ['urbancare-ai', 'vyapar-gyan', 'omni-lab', 'nexusflow', 'hr-analytics'];
const LABELS: Record<SectionId, string> = {
  about: 'About',
  skills: 'Skills',
  projects: 'Projects',
  experience: 'Experience',
  philosophy: 'Principles',
  contact: 'Contact',
};
const label = (id: SectionId) => LABELS[id];

test('KNOWN_SECTIONS matches the section ids in site.ts', () => {
  const source = readFileSync(new URL('../site.ts', import.meta.url), 'utf8');
  const ids = [...source.matchAll(/\{ id: '([a-z]+)', label: '[^']+', index: '\d\d' \}/g)].map((m) => m[1]);
  assert.deepEqual([...KNOWN_SECTIONS], ids);
});

test('targetHref: case studies get their page, other projects their dialog', () => {
  assert.equal(targetHref({ kind: 'project', slug: 'urbancare-ai' }, CASE_STUDIES), '/projects/urbancare-ai');
  assert.equal(targetHref({ kind: 'project', slug: 'tcs-stock-forecasting' }, CASE_STUDIES), '/?project=tcs-stock-forecasting');
  assert.equal(targetHref({ kind: 'project', slug: 'urbancare-ai' }, new Set(CASE_STUDIES)), '/projects/urbancare-ai');
  // A hostile slug can't escape the query value.
  assert.equal(targetHref({ kind: 'project', slug: 'x&skill=y#z' }, CASE_STUDIES), '/?project=x-skill-y-z');
});

test('targetHref for every other kind', () => {
  const cases: [AiTarget, string][] = [
    [{ kind: 'skill', name: 'RAG' }, '/?skill=rag'],
    [{ kind: 'skill', name: 'JAX/Tunix' }, '/?skill=jax-tunix'],
    [{ kind: 'section', id: 'philosophy' }, '/#philosophy'],
    [{ kind: 'experience', index: 2 }, '/#experience'],
    [{ kind: 'education', index: 0 }, '/#experience'],
    [{ kind: 'reading', index: 1 }, '/#experience'],
    [{ kind: 'tenet', index: 3 }, '/#philosophy'],
    [{ kind: 'cv' }, '/cv'],
    [{ kind: 'contact' }, '/#contact'],
  ];
  for (const [t, href] of cases) assert.equal(targetHref(t, CASE_STUDIES), href, t.kind);
});

test('sectionOf and anchorOf', () => {
  assert.equal(sectionOf({ kind: 'reading', index: 0 }), 'experience');
  assert.equal(sectionOf({ kind: 'section', id: 'nope' as SectionId }), null);
  assert.deepEqual(anchorOf({ kind: 'experience', index: 1 }), { attr: 'data-exp-index', value: '1' });
  assert.deepEqual(anchorOf({ kind: 'education', index: 0 }), { attr: 'data-edu-index', value: '0' });
  assert.deepEqual(anchorOf({ kind: 'reading', index: 4 }), { attr: 'data-reading-index', value: '4' });
  assert.deepEqual(anchorOf({ kind: 'tenet', index: 2 }), { attr: 'data-tenet-index', value: '2' });
  assert.equal(anchorOf({ kind: 'experience', index: -1 }), null);
  assert.equal(anchorOf({ kind: 'experience', index: 1.5 }), null);
  assert.equal(anchorOf({ kind: 'project', slug: 'x' }), null);
});

test('planAction covers every target kind', () => {
  const cases: [AiTarget, AiPlan][] = [
    [{ kind: 'project', slug: 'urbancare-ai' }, { do: 'project', slug: 'urbancare-ai' }],
    [{ kind: 'skill', name: 'Gemini' }, { do: 'skill', slug: 'gemini', name: 'Gemini' }],
    [{ kind: 'section', id: 'skills' }, { do: 'scroll', section: 'skills', anchor: null }],
    [{ kind: 'experience', index: 0 }, { do: 'scroll', section: 'experience', anchor: { attr: 'data-exp-index', value: '0' } }],
    [{ kind: 'education', index: 1 }, { do: 'scroll', section: 'experience', anchor: { attr: 'data-edu-index', value: '1' } }],
    [{ kind: 'reading', index: 2 }, { do: 'scroll', section: 'experience', anchor: { attr: 'data-reading-index', value: '2' } }],
    [{ kind: 'tenet', index: 3 }, { do: 'scroll', section: 'philosophy', anchor: { attr: 'data-tenet-index', value: '3' } }],
    [{ kind: 'cv' }, { do: 'cv' }],
    [{ kind: 'contact' }, { do: 'scroll', section: 'contact', anchor: null }],
  ];
  for (const [t, plan] of cases) {
    assert.deepEqual(planAction(t), plan, t.kind);
    // An open action is the same as its target.
    assert.deepEqual(planAction({ kind: 'open', target: t }), plan, `open ${t.kind}`);
  }
});

test('planAction covers every action kind', () => {
  const cases: [AiAction, AiPlan][] = [
    [
      { kind: 'filter', tech: 'Python', live: true },
      { do: 'filter', patch: { q: null, cat: null, tech: 'Python', live: '1' } },
    ],
    [
      { kind: 'filter', q: '  agent   frameworks ', cat: 'AI / ML', live: false },
      { do: 'filter', patch: { q: 'agent frameworks', cat: 'AI / ML', tech: null, live: null } },
    ],
    [
      { kind: 'prefill', subject: ' Hiring ', message: ' Hi Oikantik ' },
      { do: 'prefill', detail: { subject: 'Hiring', message: 'Hi Oikantik' } },
    ],
    [{ kind: 'prefill', message: 'Just a note' }, { do: 'prefill', detail: { message: 'Just a note' } }],
    [{ kind: 'cv' }, { do: 'cv' }],
    [{ kind: 'vcard' }, { do: 'vcard' }],
    [{ kind: 'copyEmail' }, { do: 'copyEmail' }],
  ];
  for (const [a, plan] of cases) assert.deepEqual(planAction(a), plan, a.kind);
});

test('malformed input plans nothing', () => {
  const bad = [
    { kind: 'prefill', message: '   ' },
    { kind: 'project', slug: '' },
    { kind: 'skill', name: '***' },
    { kind: 'experience', index: -2 },
    { kind: 'tenet', index: 'one' },
    { kind: 'section', id: 'admin' },
    { kind: 'open', target: { kind: 'open', target: { kind: 'cv' } } },
    { kind: 'open' },
    { kind: 'navigate', url: 'https://evil.example' },
    null,
    {},
  ];
  for (const x of bad) assert.deepEqual(planAction(x as unknown as AiAction), { do: 'none' }, JSON.stringify(x));
});

test('no plan writes a URL key outside the runner namespaces', () => {
  const allowed = new Set(['project', 'q', 'cat', 'tech', 'live', 'skill', 'lens']);
  assert.ok(RUNNER_PARAMS.every((k) => allowed.has(k)));
  const plan = planAction({ kind: 'filter', cat: 'x', tech: 'y', q: 'z', live: true, lens: 'hack', skill: 'rag' } as AiAction);
  assert.equal(plan.do, 'filter');
  if (plan.do === 'filter') assert.deepEqual(Object.keys(plan.patch).sort(), [...PROJECT_FILTER_PARAMS].sort());
  // Filter phrases are capped.
  const long = planAction({ kind: 'filter', q: 'a'.repeat(500) });
  assert.equal(long.do === 'filter' && long.patch.q?.length, 160);
});

test('announcements', () => {
  assert.equal(announcementFor(planAction({ kind: 'experience', index: 0 }), label), 'Moved to Experience');
  assert.equal(announcementFor(planAction({ kind: 'tenet', index: 0 }), label), 'Moved to Principles');
  assert.equal(announcementFor(planAction({ kind: 'filter', tech: 'Python', live: true }), label), 'Projects filtered by Python, live demos');
  assert.equal(announcementFor(planAction({ kind: 'filter' }), label), 'Project filters cleared');
  assert.match(announcementFor(planAction({ kind: 'prefill', message: 'Hi' }), label), /Nothing has been sent/);
  // Dialogs announce themselves and copying raises a toast.
  assert.equal(announcementFor(planAction({ kind: 'project', slug: 'omni-lab' }), label), '');
  assert.equal(announcementFor(planAction({ kind: 'skill', name: 'RAG' }), label), '');
  assert.equal(announcementFor(planAction({ kind: 'copyEmail' }), label), '');
});
