import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  citationProblems,
  formatAuthors,
  isPlaceholderAuthors,
  paperByline,
  paperRef,
  plainText,
  titlesMatch,
  unlistedAuthors,
} from './paperMeta.ts';

test('paperRef reads arXiv, DOI and PMC links and ignores other hosts', () => {
  assert.deepEqual(paperRef('https://arxiv.org/abs/2504.19413'), { kind: 'arxiv', id: '2504.19413' });
  assert.deepEqual(paperRef('https://arxiv.org/pdf/2604.01615'), { kind: 'arxiv', id: '2604.01615' });
  assert.deepEqual(paperRef('https://arxiv.org/pdf/2305.02980v3.pdf'), { kind: 'arxiv', id: '2305.02980' });
  assert.deepEqual(paperRef('https://arxiv.org/abs/cs/0412015v1'), { kind: 'arxiv', id: 'cs/0412015' });
  assert.deepEqual(paperRef('https://doi.org/10.48550/arXiv.2510.04761'), { kind: 'arxiv', id: '2510.04761' });
  assert.deepEqual(paperRef('https://www.pnas.org/doi/10.1073/pnas.1917337117'), { kind: 'doi', id: '10.1073/pnas.1917337117' });
  assert.deepEqual(paperRef('https://doi.org/10.1109/GEC61857.2024.10881712'), { kind: 'doi', id: '10.1109/gec61857.2024.10881712' });
  assert.deepEqual(paperRef('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10788321/'), { kind: 'pmc', id: '10788321' });
  assert.deepEqual(paperRef('https://pmc.ncbi.nlm.nih.gov/articles/PMC12795206/'), { kind: 'pmc', id: '12795206' });
  assert.equal(paperRef('https://ieeexplore.ieee.org/document/10313837'), null);
  assert.equal(paperRef('https://zenodo.org/records/15119179'), null);
});

// What the shipped links opened, per the arXiv / NCBI records, before the rebuild.
const WRONG_PAPERS: [claimed: string, opened: string][] = [
  ['Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory', 'Initiation Route of Coronal Mass Ejections: II. The Role of Filament Mass'],
  ['DPO Meets PPO: Reinforced Token Optimization for RLHF', 'Monotonicity of the cops and robber game for bounded depth treewidth'],
  ['Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context', 'Gemma: Open Models Based on Gemini Research and Technology'],
  ['SQL-CRAFT: Text-to-SQL through Interactive Refinement and Enhanced Reasoning', 'Unleashing Urease Protein Dynamics with Metamaterial Optical Tweezers'],
  ['Developers Are Victims Too : A Comprehensive Analysis of The VS Code Extension Ecosystem', 'Certain Domination Parameters and its Resolving Version of Fractal Cubic Networks'],
  ['Approximating Bayes in the 21st Century', 'Solving Challenging Math Word Problems Using GPT-4 Code Interpreter with Code-based Self-Verification'],
  [
    'Large language model (LLM)-based agentic artificial intelligence tool streamlines research processes in biomarker studies: a proof of concept',
    'Initial damage and failure load of zirconia-ceramic and metal-ceramic posterior cantilever fixed partial dentures.',
  ],
];

test('titlesMatch rejects every wrong paper the review found', () => {
  for (const [claimed, opened] of WRONG_PAPERS) assert.equal(titlesMatch(claimed, opened), false, `${claimed} vs ${opened}`);
});

test('titlesMatch accepts the same paper under a shortened, retyped or reworded title', () => {
  assert.ok(titlesMatch('Automatic Chain of Thought Prompting', 'Automatic Chain of Thought Prompting in Large Language Models'));
  assert.ok(
    titlesMatch('A CPU-Centric Perspective on Agentic AI', 'Towards Understanding, Analyzing, and Optimizing Agentic AI Execution: A CPU-Centric Perspective'),
  );
  assert.ok(
    titlesMatch(
      'Impact of Hyperparameter Optimization on the Accuracy of Lightweight Deep Learning Models for Real-Time Image Classification',
      'Analysis of Hyperparameter Optimization Effects on Lightweight Deep Models for Real-Time Image Classification',
    ),
  );
  assert.ok(titlesMatch('An Empirical Studies on How the Developers Discussed about Pandas Topics', 'An Empirical Study on How the Developers Discussed about Pandas Topics'));
  assert.ok(titlesMatch('Veridical data science', 'Veridical Data Science'));
  // A short title is not "contained" in any longer one that happens to share its words.
  assert.equal(titlesMatch('Vectoring Languages', 'Vectoring Languages for Robotic Unicycles and Other Machines'), false);
  // A paper renamed outright is not matched by its words; the scripts compare the arXiv v1 title for that.
  assert.equal(titlesMatch('Optimizing FaaS Platforms for MCP-enabled Agentic Workflows', 'FAME: QoS-aware Async Service Orchestration for Agentic Workflows'), false);
});

test('isPlaceholderAuthors catches every generator note and made-up list the review found', () => {
  for (const line of [
    "Various (as it's a survey/overview, specific authors not highlighted in snippet, but the paper itself would list them)",
    'Various (specific authors not highlighted in snippet)',
    'Not specified in snippet',
    'Not directly available in snippets, typically found on arXiv page',
    'Not explicitly listed in snippets, but from IEEE Xplore',
    'S. A. M. S. M. S. A. S. A.',
    'A. Asad Khan, S. A. Khan, M. A. Khan, M. A. Khan, M. A. Khan',
    'Ayman Asad Khan, Muhammad Asad Khan, Muhammad Asad Khan, Muhammad Asad Khan, Muhammad Asad Khan',
    'Anonymous',
    'Multiple authors',
    '',
  ]) {
    assert.equal(isPlaceholderAuthors(line), true, line);
  }
  for (const line of ['Hasan M Jamil', 'Bin Yu, Karl Kumbier', 'Gemini Team, Rohan Anil, Sebastian Borgeaud et al.', 'Chen, J.', 'Juliano Genari and Guilherme Tegoni Goedert']) {
    assert.equal(isPlaceholderAuthors(line), false, line);
  }
});

test('unlistedAuthors names the people a record does not list', () => {
  assert.deepEqual(unlistedAuthors('Dany Moshkovich, Shai Zeltyn', ['Dany Moshkovich', 'Sergey Zeltyn']), ['Shai Zeltyn']);
  assert.equal(
    unlistedAuthors('M. T. Ozsu, R. J. Miller, M. J. Carey, D. J. DeWitt, J. M. Hellerstein', ['Hasan M Jamil']).length,
    5,
  );
  assert.deepEqual(unlistedAuthors('Patrick Lewis, Tim Rocktäschel et al.', ['Patrick Lewis', 'Tim Rocktaschel']), []);
  assert.deepEqual(unlistedAuthors('Ye Y, Smith J', ['Ye Y', 'Smith J', 'Doe A']), []);
  assert.deepEqual(unlistedAuthors('Mahak Shah and 4 other authors', ['Mahak Shah', 'Akaash Vishal Hazarika']), []);
  assert.deepEqual(unlistedAuthors('Yue Dong, Huan Zhang et al.', ['Zhuosheng Zhang', 'Aston Zhang', 'Mu Li', 'Alex Smola']), ['Yue Dong', 'Huan Zhang']);
});

test('formatAuthors keeps up to three names, then "et al."', () => {
  assert.equal(formatAuthors(['Hasan M Jamil']), 'Hasan M Jamil');
  assert.equal(formatAuthors(['A One', 'B Two', 'C Three']), 'A One, B Two, C Three');
  assert.equal(formatAuthors(['A One', 'B Two', 'C Three', 'D Four']), 'A One, B Two, C Three et al.');
  assert.equal(formatAuthors([]), '');
});

test('citationProblems fails the shipped Mem0, Veridical, sql and placeholder citations', () => {
  const mem0 = { title: WRONG_PAPERS[0][0], url: 'https://arxiv.org/abs/2504.14876', authors: 'Ankit Kumar et al.' };
  const cme = { id: '2504.14876', title: WRONG_PAPERS[0][1], authors: ['Chen Xing', 'Guillaume Aulanier'] };
  assert.deepEqual(
    citationProblems(mem0, cme).map((p) => p.kind),
    ['title'],
  );

  const veridical = { title: 'Veridical data science', url: 'https://www.pnas.org/doi/10.1073/pnas.1917337117', authors: 'Bin Yu, Karl Kumbier' };
  assert.deepEqual(
    citationProblems(veridical, null).map((p) => p.kind),
    ['missing'],
  );

  const sql = {
    title: 'A Declarative Query Language for Scientific Machine Learning',
    url: 'https://arxiv.org/abs/2405.16159',
    authors: 'M. T. Ozsu, R. J. Miller, M. J. Carey',
  };
  const jamil = { id: '2405.16159', title: sql.title, authors: ['Hasan M Jamil'] };
  assert.deepEqual(
    citationProblems(sql, jamil).map((p) => p.kind),
    ['authors'],
  );

  const ieee = { title: 'Performance Evaluation of a Dynamic RESTful API Using FastAPI, Docker and Nginx', url: 'https://ieeexplore.ieee.org/document/10313837', authors: 'Not explicitly listed in snippets, but from IEEE Xplore' };
  assert.deepEqual(
    citationProblems(ieee, undefined).map((p) => p.kind),
    ['authors'],
  );

  assert.deepEqual(citationProblems({ ...sql, authors: 'Hasan M Jamil' }, jamil), []);
  assert.deepEqual(citationProblems({ ...ieee, authors: undefined }, undefined), []);
});

test('paperByline hides a generator note and keeps names', () => {
  assert.equal(paperByline('Not specified in snippet'), undefined);
  assert.equal(paperByline('Anonymous'), undefined);
  assert.equal(paperByline(undefined), undefined);
  assert.equal(paperByline('Bin Yu, Karl Kumbier'), 'Bin Yu, Karl Kumbier');
});

test('plainText decodes registry markup', () => {
  assert.equal(plainText('Q&amp;A with <i>LLMs</i>\n   at &#x2248; scale'), 'Q&A with LLMs at ≈ scale');
});

type Paper = { title: string; url: string; authors?: string };
const SKILLS_DIR = new URL('../../public/data/skills/', import.meta.url);
const shipped = new Map(
  readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), (JSON.parse(readFileSync(new URL(f, SKILLS_DIR), 'utf8')).researchPapers ?? []) as Paper[]]),
);

// Links the review showed open the wrong paper, with the record each title belongs to.
const CORRECTED: { slug: string; title: RegExp; wrong: string; right: string }[] = [
  { slug: 'performance-tuning', title: /^Mem0:/, wrong: '2504.14876', right: 'https://arxiv.org/abs/2504.19413' },
  { slug: 'gemini', title: /^Gemini 1\.5:/, wrong: '2403.08295', right: 'https://arxiv.org/abs/2403.05530' },
  { slug: 'rlhf', title: /^DPO Meets PPO/, wrong: '2402.09139', right: 'https://arxiv.org/abs/2404.18922' },
  { slug: 'statistics', title: /^Veridical data science$/i, wrong: 'pnas.1917337117', right: 'https://doi.org/10.1073/pnas.1901326117' },
  { slug: 'vs-code', title: /^Developers Are Victims Too/, wrong: '2411.06900', right: 'https://arxiv.org/abs/2411.07479' },
];

test('the shipped write-ups link the corrected records, not the ones the review found', () => {
  for (const { slug, title, wrong, right } of CORRECTED) {
    const papers = shipped.get(slug) ?? [];
    assert.ok(!papers.some((p) => title.test(p.title) && p.url.includes(wrong)), `${slug} still links ${wrong}`);
    assert.equal(papers.find((p) => title.test(p.title))?.url, right, slug);
  }
  assert.ok(!(shipped.get('sql') ?? []).some((p) => p.url.includes('2402.12878')), 'sql still links the urease paper');
  assert.ok(!(shipped.get('vectorization') ?? []).some((p) => p.url.includes('PMC10788321')), 'vectorization still links the dental paper');
});

for (const [slug, papers] of shipped) {
  test(`${slug} ships no placeholder author line`, () => {
    for (const p of papers) {
      if (p.authors !== undefined) assert.equal(isPlaceholderAuthors(p.authors), false, `${p.title}: "${p.authors}"`);
    }
  });
}
