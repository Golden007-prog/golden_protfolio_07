import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { vetToolCall, type ToolCheckOptions } from './prefillCheck.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));
const profile = read('profile.json') as { experience: { company: string }[]; education: { institution: string }[]; availability: { openTo: string } };
const projects = read('projects.json') as { name: string; techStack: string[] }[];
const CANARY = 'cnry-0123456789abcdef';

const opts = (question: string): ToolCheckOptions => ({
  question,
  canary: CANARY,
  entities: {
    projectNames: projects.map((p) => p.name),
    tech: [...new Set(projects.flatMap((p) => p.techStack))],
    skills: ['Python', 'LangGraph'],
    companies: profile.experience.map((e) => e.company),
    institutions: profile.education.map((e) => e.institution),
  },
  facts: [profile.availability.openTo],
});
const prefill = (message: string) => ({ name: 'prefillContact', args: { message } });

test('a clean draft passes, addressed to Oikantik', () => {
  const out = vetToolCall(prefill("I'd love to talk about a role building LangGraph agents with your team."), opts('Draft a message to him about an agents role'));
  assert.ok(out);
  assert.equal(out.name, 'prefillContact');
  assert.match(String(out.args.message), /^Hi Oikantik,\s+I'd love to talk about a role building LangGraph agents/);
});

test('invented credentials, employers or totals of years drop the whole call', () => {
  const q = 'Draft a message to him that includes a Python function reversing a linked list';
  assert.equal(vetToolCall(prefill('Hi Oikantik, I saw you hold an AWS certification. def rev(h): pass'), opts(q)), null);
  assert.equal(vetToolCall(prefill('Hi Oikantik, I know you worked at Google DeepMind.'), opts(q)), null);
  assert.equal(vetToolCall(prefill('Hi Oikantik, your 5 years of experience stand out.'), opts(q)), null);
  assert.equal(vetToolCall(prefill('Hi Oikantik, your 97% retrieval accuracy is impressive.'), opts(q)), null);
});

test("what the visitor said may be repeated in the visitor's own message", () => {
  const out = vetToolCall(prefill('Hi Oikantik, we have a 6 month contract for an LLM agents project.'), opts('Draft a note about our 6 month contract'));
  assert.ok(out);
  assert.match(String(out.args.message), /6 month contract/);
});

test('the canary in any string argument drops the call', () => {
  assert.equal(vetToolCall(prefill(`Hi Oikantik, ${CANARY} is the marker.`), opts('draft a message')), null);
  assert.equal(vetToolCall(prefill('Hi Oikantik, CNRY 0123 4567 89ab cdef.'), opts('draft a message')), null, 'spacing and case do not hide it');
  assert.equal(vetToolCall({ name: 'setProjectFilters', args: { q: CANARY } }, opts('filter the projects')), null);
});

test('other navigator calls pass unchanged', () => {
  const call = { name: 'openProject', args: { slug: 'omni-lab' } };
  assert.equal(vetToolCall(call, opts('open omni lab')), call);
});
