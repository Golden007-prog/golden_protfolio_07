import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { countByTech, matchesTech, techFamily } from './tech.ts';

const projects = JSON.parse(readFileSync(new URL('../data/projects.json', import.meta.url), 'utf8')) as {
  name: string;
  techStack: string[];
}[];

test('techFamily folds versions and vendor prefixes into one family', () => {
  assert.equal(techFamily('Gemini 2.0 Flash'), 'Gemini');
  assert.equal(techFamily('Gemini 2.5 Flash/Pro'), 'Gemini');
  assert.equal(techFamily('Google Gemini API'), 'Gemini');
  assert.equal(techFamily('Gemini'), 'Gemini');
  assert.equal(techFamily('MedGemma'), 'Gemma');
  assert.equal(techFamily('Bedrock'), 'AWS Bedrock');
  assert.equal(techFamily('AWS Bedrock'), 'AWS Bedrock');
  assert.equal(techFamily('GPT API'), 'GPT');
  assert.equal(techFamily('Claude API'), 'Claude');
  assert.equal(techFamily('React 19'), 'React');
  assert.equal(techFamily('Next.js 14'), 'Next.js');
  assert.equal(techFamily('Veo 3.1'), 'Veo');
  assert.equal(techFamily('Scikit-learn'), 'Scikit-learn');
});

test('ReAct stays ReAct and never matches React', () => {
  assert.equal(techFamily('ReAct'), 'ReAct');
  assert.equal(matchesTech(['React 19'], 'ReAct'), false);
  assert.equal(matchesTech(['ReAct'], 'React'), false);
  assert.equal(countByTech(projects, 'ReAct'), 0);
  assert.ok(countByTech(projects, 'React') > 0, 'the React projects exist, so the zero above is meaningful');
});

test('Gemini counts every project on any Gemini version', () => {
  assert.equal(countByTech(projects, 'Gemini'), 6);
  const verbatim = projects.filter((p) => p.techStack.includes('Gemini')).length;
  assert.equal(verbatim, 1);
});

test('whole-word matching inside compound entries', () => {
  assert.equal(matchesTech(['Keras/TensorFlow'], 'TensorFlow'), true);
  assert.equal(matchesTech(['PostgreSQL'], 'SQL'), false);
  assert.equal(matchesTech(['GitHub Gist API'], 'Git'), false);
  assert.equal(matchesTech(['Bedrock'], 'AWS Bedrock'), true);
  assert.equal(matchesTech(['CI/CD'], 'CI/CD'), true);
});
