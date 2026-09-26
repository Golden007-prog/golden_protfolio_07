import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  achievementsByKind,
  achievementsForProject,
  allAchievements,
  parseAchievements,
  unknownProjects,
} from './achievements.ts';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const data = parseAchievements(read('achievements.json'));
const projects = read('projects.json') as { slug: string; githubUrl: string }[];

// Private on GitHub; never linked from the site.
const PRIVATE_REPOS = ['GOLDEN_karaoke', 'DMAT_Core_Module_with_Free_Gemini_key', 'Bruhdeutschland', 'pingpen', 'test-chal', 'Cast-Screen', 'test1', 'desktop-tutorial'];

test('the data file parses, ids are unique and dates are YYYY-MM', () => {
  assert.equal(data.items.length, 6);
  const ids = data.items.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of data.items) assert.match(a.date, /^\d{4}-(0[1-9]|1[0-2])$/, a.id);
});

test('every project reference is a project on the site', () => {
  assert.deepEqual(
    unknownProjects(
      data,
      projects.map((p) => p.slug),
    ),
    [],
  );
  assert.deepEqual(
    achievementsForProject(data, 'vyapar-gyan').map((a) => a.id),
    ['ai-for-bharat-finalist'],
  );
});

test('every link is https and none points at a private repository', () => {
  for (const a of data.items) {
    for (const l of a.links) {
      const u = new URL(l.url);
      assert.equal(u.protocol, 'https:', l.url);
      if (u.hostname === 'github.com') {
        const repo = u.pathname.split('/')[2] ?? '';
        assert.ok(!PRIVATE_REPOS.some((r) => r.toLowerCase() === repo.toLowerCase()), `${a.id} links private ${repo}`);
      }
    }
  }
});

test('the Coreforge entry links only to the live site', () => {
  const coreforge = data.items.find((a) => a.id === 'coreforge-launch');
  assert.deepEqual(
    coreforge?.links.map((l) => l.url),
    ['https://goldensdmat.in'],
  );
});

test('no percentages, no teammate names: team entries say only how many', () => {
  for (const a of data.items) {
    assert.ok(!/%/.test(`${a.title} ${a.summary}`), `${a.id} states a percentage`);
    if (a.team !== undefined) assert.match(a.team, /^team of \w+$/);
  }
  assert.equal(data.items.filter((a) => a.team).length, 1);
});

test('newest first, same-month entries in file order', () => {
  assert.deepEqual(
    allAchievements(data).map((a) => a.id),
    ['coreforge-launch', 'promptwars-sankalp', 'ai-for-bharat-finalist', 'gitlab-hackathon-shieldflow', 'promptwars-pulse', 'kaggle-hai-def'],
  );
  assert.deepEqual(
    achievementsByKind(data, 'finalist').map((a) => a.id),
    ['ai-for-bharat-finalist'],
  );
});

test('parseAchievements refuses a broken file', () => {
  const good = { id: 'a', title: 'A', date: '2026-04', kind: 'build', summary: 'S.', links: [{ label: 'GitHub', url: 'https://github.com/x/y' }] };
  const wrap = (items: unknown[]) => ({ items });
  assert.doesNotThrow(() => parseAchievements(wrap([good])));
  assert.throws(() => parseAchievements(wrap([good, good])), /not unique/);
  assert.throws(() => parseAchievements(wrap([{ ...good, date: '2026-4' }])), /YYYY-MM/);
  assert.throws(() => parseAchievements(wrap([{ ...good, kind: 'winner' }])), /unknown/);
  assert.throws(() => parseAchievements(wrap([{ ...good, team: 'with Jane Doe' }])), /never name anyone/);
  assert.throws(() => parseAchievements(wrap([{ ...good, links: [{ label: 'Site', url: 'http://x.example' }] }])), /https/);
  assert.throws(() => parseAchievements(wrap([{ ...good, links: [] }])), /at least one link/);
  assert.throws(() => parseAchievements(wrap([{ ...good, summary: 'Cut waits by 47%.' }])), /scripted simulation/);
  assert.doesNotThrow(() => parseAchievements(wrap([{ ...good, summary: 'In a scripted simulation, waits fell 47%.' }])));
});
