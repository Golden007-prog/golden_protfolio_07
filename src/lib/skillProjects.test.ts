import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { projectCounts, projectSlug, projectsForSkill } from './skillProjects.ts';

type Project = { name: string; slug?: string; techStack: string[] };

const projects = JSON.parse(readFileSync(new URL('../data/projects.json', import.meta.url), 'utf8')) as Project[];
const profile = JSON.parse(readFileSync(new URL('../data/profile.json', import.meta.url), 'utf8')) as {
  skills: Record<string, string[]>;
};
const allSkills = Object.values(profile.skills).flat();

test('Gemini is used in 8 projects, across every Gemini version', () => {
  const matches = projectsForSkill(projects, 'Gemini');
  assert.equal(matches.length, 8);
  assert.ok(matches.every((p) => p.techStack.some((t) => /Gemini/.test(t))));
});

test('ReAct (the agent pattern) matches no React projects', () => {
  assert.equal(projectsForSkill(projects, 'ReAct').length, 0);
  assert.ok(projectsForSkill(projects, 'React').length > 0, 'the React projects exist, so the zero above is meaningful');
});

test('stack entries match on families and whole words only', () => {
  assert.deepEqual(
    projectsForSkill(projects, 'AWS Bedrock').map((p) => p.name),
    projects.filter((p) => p.techStack.includes('Bedrock')).map((p) => p.name),
  );
  assert.ok(projectsForSkill(projects, 'TensorFlow').some((p) => p.techStack.includes('Keras/TensorFlow')));
  // PostgreSQL is not SQL, and 'GitHub Gist API' is not Git.
  assert.equal(projectsForSkill(projects, 'SQL').length, 0);
  assert.equal(projectsForSkill(projects, 'Git').length, 0);
});

test('projectCounts covers the profile skills and omits zeros', () => {
  const counts = projectCounts(projects, allSkills);
  assert.equal(counts.Gemini, 8);
  assert.equal(counts.ReAct, undefined);
  for (const [skill, n] of Object.entries(counts)) {
    assert.ok(allSkills.includes(skill));
    assert.equal(n, projectsForSkill(projects, skill).length);
  }
});

test('projectSlug prefers the data field and falls back to slugify(name)', () => {
  assert.equal(projectSlug({ name: 'Bruhworking — NexusFlow' }), 'bruhworking-nexusflow');
  assert.equal(projectSlug({ name: 'Anything', slug: 'kept-as-is' }), 'kept-as-is');
});
