#!/usr/bin/env node
/**
 * Writes src/data/github-facts.json, { [slug]: { stars, forks, pushedAt, license } },
 * from the GitHub REST API so the project modal and case-study pages show real
 * repository facts without a request from the browser. Run before `next build`.
 *
 * GITHUB_TOKEN (optional) lifts the anonymous rate limit. If any repository cannot
 * be read (offline, rate-limited, renamed), the committed file is left as it is,
 * so a build never ships half-updated facts.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS_JSON = join(ROOT, 'src/data/projects.json');
const FACTS_JSON = join(ROOT, 'src/data/github-facts.json');
const TIMEOUT_MS = 10_000;

function repoPath(githubUrl) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(githubUrl);
  if (!m) throw new Error(`not a GitHub repository URL: ${githubUrl}`);
  return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
}

/** An SPDX id when GitHub recognised the licence; NOASSERTION means it could not. */
function licenseOf(repo) {
  const id = repo.license?.spdx_id;
  return id && id !== 'NOASSERTION' ? id : null;
}

async function fetchRepo(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'basuoikantik.in-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const projects = JSON.parse(await readFile(PROJECTS_JSON, 'utf8'));
  const facts = {};
  try {
    const repos = await Promise.all(projects.map((p) => fetchRepo(repoPath(p.githubUrl))));
    projects.forEach((p, i) => {
      const repo = repos[i];
      facts[p.slug] = {
        stars: repo.stargazers_count ?? 0,
        forks: repo.forks_count ?? 0,
        pushedAt: repo.pushed_at ?? null,
        license: licenseOf(repo),
      };
    });
  } catch (err) {
    console.warn(`github-facts: kept the committed file (${err instanceof Error ? err.message : err})`);
    return;
  }

  const next = `${JSON.stringify(facts, null, 2)}\n`;
  const prev = await readFile(FACTS_JSON, 'utf8').catch(() => '');
  if (next === prev) {
    console.log('github-facts: unchanged');
    return;
  }
  await writeFile(FACTS_JSON, next);
  console.log(`github-facts: wrote ${Object.keys(facts).length} repositories`);
}

main().catch((err) => {
  // Never fail the build over optional facts.
  console.warn(`github-facts: ${err instanceof Error ? err.message : err}`);
});
