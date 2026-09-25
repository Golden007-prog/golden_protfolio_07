import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { slugify } from '../slug.ts';
import { stepLabel, toolAction, toolDataFrom, toolDeclarations, validateToolCall, wantsNavigation } from './tools.ts';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../data/${file}`, import.meta.url), 'utf8'));
const profile = read('profile.json');
const projects = (
  read('projects.json') as {
    name: string;
    category: string;
    techStack: string[];
  }[]
).map((p) => ({ ...p, slug: slugify(p.name) }));
const SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'skills', label: 'Skills' },
  { id: 'projects', label: 'Projects' },
  { id: 'experience', label: 'Experience' },
  { id: 'philosophy', label: 'Principles' },
  { id: 'contact', label: 'Contact' },
] as const;
const data = toolDataFrom({
  sections: SECTIONS,
  projects,
  skills: profile.skills,
});

test('six declarations, every argument an enum from the data or a capped string', () => {
  const decls = toolDeclarations(data);
  assert.deepEqual(
    decls.map((d) => d.name),
    ['scrollToSection', 'openProject', 'openSkill', 'setProjectFilters', 'openCv', 'prefillContact'],
  );
  const props = (name: string) =>
    (decls.find((d) => d.name === name)?.parametersJsonSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  assert.deepEqual(
    props('scrollToSection').section.enum,
    SECTIONS.map((s) => s.id),
  );
  assert.ok((props('openProject').slug.enum as string[]).includes('omni-lab'));
  assert.ok((props('openSkill').name.enum as string[]).includes('ReAct'));
  assert.equal(props('setProjectFilters').q.maxLength, 60);
  assert.equal(props('prefillContact').message.maxLength, 500);
});

test('arguments outside the enums are rejected', () => {
  assert.equal(validateToolCall({ name: 'openProject', args: { slug: 'not-a-project' } }, data), null);
  assert.equal(validateToolCall({ name: 'openProject', args: { slug: 'Omni-Lab' } }, data), null);
  assert.equal(validateToolCall({ name: 'scrollToSection', args: { section: 'admin' } }, data), null);
  assert.equal(validateToolCall({ name: 'openSkill', args: { name: 'Kubernetes' } }, data), null);
  assert.equal(validateToolCall({ name: 'setProjectFilters', args: { tech: 'COBOL' } }, data), null);
  assert.equal(validateToolCall({ name: 'setProjectFilters', args: { cat: 'Secret' } }, data), null);
  assert.equal(validateToolCall({ name: 'setProjectFilters', args: { live: 'yes' } }, data), null);
  assert.equal(validateToolCall({ name: 'setProjectFilters', args: { q: 'x'.repeat(61) } }, data), null);
  assert.equal(validateToolCall({ name: 'prefillContact', args: { message: 'x'.repeat(501) } }, data), null);
  assert.equal(validateToolCall({ name: 'openCv', args: { url: 'https://evil.example' } }, data), null);
  assert.equal(validateToolCall({ name: 'openProject', args: { slug: 'omni-lab', extra: 1 } }, data), null);
  assert.equal(validateToolCall({ name: 'deleteEverything', args: {} }, data), null);
  assert.equal(validateToolCall(null, data), null);
  assert.equal(validateToolCall({ name: 'openProject', args: [] }, data), null);
});

test('valid calls come back rebuilt and map to runner actions', () => {
  const open = validateToolCall({ name: 'openProject', args: { slug: 'omni-lab' } }, data);
  assert.deepEqual(open, { name: 'openProject', args: { slug: 'omni-lab' } });
  assert.deepEqual(toolAction(open!), { kind: 'project', slug: 'omni-lab' });
  assert.equal(stepLabel(open!, data), `Opening ${projects.find((p) => p.slug === 'omni-lab')!.name}…`);

  const scroll = validateToolCall({ name: 'scrollToSection', args: { section: 'experience' } }, data);
  assert.deepEqual(toolAction(scroll!), { kind: 'section', id: 'experience' });
  assert.equal(stepLabel(scroll!, data), 'Moving to Experience…');

  const tech = data.tech.find((t) => t === 'Python') ?? data.tech[0];
  const filter = validateToolCall({ name: 'setProjectFilters', args: { tech, live: true, q: '  agents  ' } }, data);
  assert.deepEqual(filter, {
    name: 'setProjectFilters',
    args: { tech, live: true, q: 'agents' },
  });
  assert.deepEqual(toolAction(filter!), {
    kind: 'filter',
    tech,
    live: true,
    q: 'agents',
  });

  assert.deepEqual(toolAction(validateToolCall({ name: 'openCv' }, data)!), {
    kind: 'cv',
  });
});

test('a drafted message keeps no foreign URL or email', () => {
  const call = validateToolCall(
    {
      name: 'prefillContact',
      args: {
        message: 'Hi, reach me at bad@evil.example or https://evil.example/x please.',
      },
    },
    data,
  );
  assert.ok(call);
  assert.doesNotMatch(String(call.args.message), /evil\.example/);
  assert.equal(validateToolCall({ name: 'prefillContact', args: { message: 'https://evil.example' } }, data), null);
});

test('declarations are sent only for navigation requests', () => {
  for (const q of [
    'Open the UrbanCare project',
    'Take me to his experience',
    'Filter the projects to Python',
    'Download his CV',
    'Draft a message to him about a role',
  ]) {
    assert.equal(wantsNavigation(q), true, q);
  }
  for (const q of [
    'Which projects use Gemini?',
    'Show me your best projects',
    'Is he open to relocation?',
    'Does he contribute to open-source?',
    'What is OpenAI?',
    'How do I hire you?',
  ]) {
    assert.equal(wantsNavigation(q), false, q);
  }
});
