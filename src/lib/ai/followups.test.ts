import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createFollowupSplitter,
  keepFollowups,
  parseFollowups,
  startersFor,
  type FollowupNames,
  type StarterEntries,
} from './followups.ts';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../data/${file}`, import.meta.url), 'utf8'));
const profile = read('profile.json');
const projects = read('projects.json') as { name: string }[];
const known: FollowupNames = {
  projects: projects.map((p) => p.name),
  skills: Object.values(profile.skills as Record<string, string[]>).flat(),
  companies: (profile.experience as { company: string }[]).map((e) => e.company),
  sections: ['About', 'Skills', 'Projects', 'Experience', 'Principles', 'Contact'],
};

/** Feeds `pieces` through a splitter and returns what reached the filter plus the raw tail. */
function split(pieces: string[]) {
  const s = createFollowupSplitter();
  let text = '';
  for (const p of pieces) text += s.push(p);
  const end = s.end();
  return { text: text + end.text, raw: end.raw };
}

test('the FOLLOWUPS line is cut off before the filter, even split across deltas', () => {
  const answer = 'He built UrbanCare AI [c:project:urbancare-ai#summary].';
  const tail = 'FOLLOWUPS: What stack does UrbanCare AI use? | Which projects use LangGraph?';
  const whole = `${answer}\n${tail}`;
  for (const size of [1, 3, 7, 11, 40, whole.length]) {
    const pieces: string[] = [];
    for (let i = 0; i < whole.length; i += size) pieces.push(whole.slice(i, i + size));
    const r = split(pieces);
    assert.equal(r.text.trimEnd(), answer, `chunk size ${size}`);
    assert.deepEqual(parseFollowups(r.raw), ['What stack does UrbanCare AI use?', 'Which projects use LangGraph?'], `chunk size ${size}`);
  }
});

test('Markdown-decorated markers are recognised; a mid-line "follow-up:" is not', () => {
  assert.equal(split(['Answer [c:profile:about].\n**Follow-ups:** What is Omni-Lab?']).text, 'Answer [c:profile:about].');
  const mid = 'His follow-up: work continued [c:profile:about].';
  assert.equal(split([mid]).text, mid);
  assert.equal(split(['No markers here.']).raw, '');
  assert.equal(split(['FOLLOWUPS: What is RAG?']).text, '');
});

test('keepFollowups drops "Kubernetes cluster at Meta" and anything ungrounded', () => {
  const kept = keepFollowups(
    [
      'What did he build with a Kubernetes cluster at Meta?',
      'Did he work at Google DeepMind?',
      'What does UrbanCare AI do?',
      'Which projects use LangGraph?',
      'What is his favourite colour?',
      'See https://evil.example for UrbanCare AI?',
      'What did he do at Mindrift?',
      'Tell me about Omni-Lab',
      'What does the Experience section list?',
    ],
    known,
  );
  assert.deepEqual(kept, ['What does UrbanCare AI do?', 'Which projects use LangGraph?', 'What did he do at Mindrift?']);
});

test('keepFollowups keeps at most three, once each, and project names with an org inside count as known', () => {
  const kept = keepFollowups(
    [
      'What did IBM HR Attrition Prediction find?',
      'what did ibm hr attrition prediction find?',
      'What is in the Principles section?',
      'Is ReAct listed?',
      'Which projects use Python?',
    ],
    known,
  );
  assert.deepEqual(kept, ['What did IBM HR Attrition Prediction find?', 'What is in the Principles section?', 'Is ReAct listed?']);
  assert.deepEqual(keepFollowups(['Does he know react hooks?'], known), []);
});

const STARTERS = ['What do you work on?', 'Show me your best projects', 'What tech do you use?', 'How do I hire you?'];
const entry = (questions: string[], extra: Partial<{ reviewed: boolean; claimBearing: boolean }> = {}) => ({
  hash: 'h',
  model: 'gemini-test',
  generatedAt: '2026-09-25T00:00:00Z',
  reviewed: false,
  claimBearing: false,
  ...extra,
  value: { questions },
});

test('an empty store shows the four static starters unchanged', () => {
  assert.deepEqual(
    startersFor({
      entries: {},
      showUnreviewed: false,
      section: 'skills',
      project: null,
      fallback: STARTERS,
    }),
    STARTERS,
  );
  assert.deepEqual(startersFor({ entries: null, showUnreviewed: false, fallback: STARTERS }), STARTERS);
});

test('a fixture entry for "skills" shows its starters in the Skills section only', () => {
  const entries: StarterEntries = {
    'section:skills': entry(['Which projects use RAG?', 'Where is LangGraph used?']),
  };
  assert.deepEqual(
    startersFor({
      entries,
      showUnreviewed: false,
      section: 'skills',
      fallback: STARTERS,
    }),
    ['Which projects use RAG?', 'Where is LangGraph used?'],
  );
  assert.deepEqual(
    startersFor({
      entries,
      showUnreviewed: false,
      section: 'about',
      fallback: STARTERS,
    }),
    STARTERS,
  );
});

test('an open project wins over the section; hidden entries fall through', () => {
  const entries: StarterEntries = {
    'section:projects': entry(['Which project is featured?']),
    'project:omni-lab': entry(['What stack does Omni-Lab use?']),
    'project:urbancare-ai': entry(['What does UrbanCare AI do?'], {
      claimBearing: true,
    }),
  };
  assert.deepEqual(
    startersFor({
      entries,
      showUnreviewed: false,
      section: 'projects',
      project: 'omni-lab',
      fallback: STARTERS,
    }),
    ['What stack does Omni-Lab use?'],
  );
  assert.deepEqual(
    startersFor({
      entries,
      showUnreviewed: false,
      section: 'projects',
      project: 'urbancare-ai',
      fallback: STARTERS,
    }),
    ['Which project is featured?'],
  );
  assert.deepEqual(
    startersFor({
      entries,
      showUnreviewed: true,
      section: 'projects',
      project: 'urbancare-ai',
      fallback: STARTERS,
    }),
    ['What does UrbanCare AI do?'],
  );
});
