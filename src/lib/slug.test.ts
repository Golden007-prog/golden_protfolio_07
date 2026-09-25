import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { slugify } from './slug.ts';

test('slugify makes lower-kebab ASCII', () => {
  assert.equal(slugify('Bruhworking — NexusFlow'), 'bruhworking-nexusflow');
  assert.equal(slugify('UrbanCare AI'), 'urbancare-ai');
  assert.equal(slugify('CI/CD'), 'ci-cd');
  assert.equal(slugify('JAX/Tunix'), 'jax-tunix');
  assert.equal(slugify('  Café Déjà Vu  '), 'cafe-deja-vu');
  assert.equal(slugify('---'), '');
});

test('slugify reproduces the existing /public/skills image names', () => {
  const skills = JSON.parse(readFileSync(new URL('../data/skills-detailed.json', import.meta.url), 'utf8')) as {
    name: string;
    heroImage?: string;
  }[];
  for (const { name, heroImage } of skills) {
    if (!heroImage?.startsWith('/skills/')) continue;
    assert.equal(`/skills/${slugify(name)}.webp`, heroImage, name);
  }
});

test('project slugs are unique', () => {
  const projects = JSON.parse(readFileSync(new URL('../data/projects.json', import.meta.url), 'utf8')) as {
    name: string;
  }[];
  const slugs = projects.map((p) => slugify(p.name));
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(slugs.every((s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)));
});
