import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELLS,
  CELL_LABELS,
  CELL_POS,
  FRAME_COUNT,
  RULES,
  cellAt,
  consistentAnswers,
  consistentRules,
  dayKey,
  describeRule,
  drawPuzzle,
  generatePuzzle,
  hashSeed,
  isCorrect,
  isGoodSequence,
  moveCount,
  mulberry32,
  optionLetter,
  puzzleSeed,
  ruleComplexity,
  runRule,
  type Cell,
  type Puzzle,
} from './puzzle.ts';

/** Every seed the component can ask for over two years: each day plus five "try another" draws. */
function seedsForTwoYears(): string[] {
  const seeds: string[] = [];
  const d = new Date(2026, 0, 1);
  for (let i = 0; i < 731; i++) {
    const day = dayKey(d);
    for (let v = 0; v <= 5; v++) seeds.push(puzzleSeed(day, v));
    d.setDate(d.getDate() + 1);
  }
  return seeds;
}

const SEEDS = seedsForTwoYears();
const PUZZLES: Puzzle[] = SEEDS.map((s) => generatePuzzle(s));

function assertExactlyOneCorrect(p: Puzzle) {
  // The four options are the four cells, each once.
  assert.equal(p.options.length, 4);
  assert.deepEqual([...p.options].sort(), [0, 1, 2, 3]);
  const correct = p.options.filter((c) => isCorrect(p, c));
  assert.equal(correct.length, 1, `${p.seed}: expected exactly one correct option`);
  assert.equal(correct[0], p.answer);

  // Inferability: every catalogued rule that reproduces the four frames, from any
  // start, predicts this same answer, so no other option can be defended.
  const answers = consistentAnswers(p.frames);
  assert.deepEqual([...answers], [p.answer], `${p.seed}: frames ${p.frames.join(',')} admit ${[...answers]}`);
}

test('every generated puzzle over two years has exactly one correct answer', () => {
  assert.equal(PUZZLES.length, 731 * 6);
  for (const p of PUZZLES) assertExactlyOneCorrect(p);
});

test('the answer is what the drawn rule produces, and the frames are what it shows', () => {
  for (const p of PUZZLES) {
    const run = runRule(p.rule, p.frames[0], FRAME_COUNT + 1);
    assert.deepEqual(run.slice(0, FRAME_COUNT), [...p.frames]);
    assert.equal(run[FRAME_COUNT], p.answer);
  }
});

test('every puzzle is worth solving: at least two real moves', () => {
  for (const p of PUZZLES) assert.ok(moveCount(p.frames) >= 2, `${p.seed}: ${p.frames.join(',')}`);
});

test('the explained rule fits the frames, is no more complex than the drawn one, and predicts the answer', () => {
  for (const p of PUZZLES) {
    const fits = consistentRules(p.frames);
    assert.ok(fits.includes(p.shownRule), `${p.seed}: shown rule does not fit`);
    assert.ok(ruleComplexity(p.shownRule) <= ruleComplexity(p.rule));
    assert.equal(runRule(p.shownRule, p.frames[0], FRAME_COUNT + 1)[FRAME_COUNT], p.answer);
    assert.ok(p.explanation.includes(CELL_LABELS[p.answer].toLowerCase()), `${p.seed}: explanation misses the answer`);
  }
});

test('the generator never needs its fallback over the tested range', () => {
  for (const s of SEEDS) assert.notEqual(drawPuzzle(s), null, `${s}: every seeded draw failed`);
  const rand = mulberry32(hashSeed('2026-09-26'));
  for (let i = 0; i < 1000; i++) {
    const x = rand();
    assert.ok(x >= 0 && x < 1);
  }
});

test('exhaustively, no catalogued rule from any start shows an ambiguous four-frame sequence', () => {
  for (const rule of RULES) {
    for (const start of CELLS) {
      const frames = runRule(rule, start, FRAME_COUNT);
      assert.equal(consistentAnswers(frames).size, 1, `${JSON.stringify(rule)} from ${start}`);
    }
  }
});

test('the checker does catch ambiguity when the evidence is too short', () => {
  // Two frames 0 -> 1 fit "one clockwise every frame" (next 2) and "clockwise,
  // then stay" (next 1). This is why the puzzle shows four frames.
  const answers = consistentAnswers([0, 1]);
  assert.ok(answers.size > 1);
  assert.ok(answers.has(2) && answers.has(1));
  assert.equal(isGoodSequence([0, 1]), false);
});

test('static or barely moving sequences are rejected', () => {
  assert.equal(isGoodSequence([2, 2, 2, 2]), false);
  assert.equal(isGoodSequence([0, 0, 1, 1]), false);
  assert.equal(isGoodSequence([0, 1, 2, 3]), true);
});

test('the same seed always gives the same puzzle, and days differ', () => {
  assert.deepEqual(generatePuzzle('2026-09-26'), generatePuzzle('2026-09-26'));
  const distinct = new Set(PUZZLES.filter((_, i) => i % 6 === 0).map((p) => `${p.frames.join('')}${p.answer}`));
  assert.ok(distinct.size > 40, `only ${distinct.size} distinct daily puzzles`);
});

test('rule families are drawn with some balance', () => {
  const counts = new Map<string, number>();
  for (const p of PUZZLES) counts.set(p.rule.kind, (counts.get(p.rule.kind) ?? 0) + 1);
  assert.equal(counts.size, 5);
  for (const [kind, n] of counts) assert.ok(n > PUZZLES.length * 0.1, `${kind} drawn only ${n} times`);
});

test('dayKey uses the local calendar date; puzzleSeed keeps variant 0 equal to the day', () => {
  assert.equal(dayKey(new Date(2026, 8, 6, 23, 59)), '2026-09-06');
  assert.equal(puzzleSeed('2026-09-06'), '2026-09-06');
  assert.equal(puzzleSeed('2026-09-06', 2), '2026-09-06#2');
});

test('cell geometry round-trips and labels are distinct', () => {
  for (const c of CELLS) {
    const { row, col } = CELL_POS[c];
    assert.equal(cellAt(row, col), c);
  }
  assert.equal(new Set(Object.values(CELL_LABELS)).size, 4);
  assert.deepEqual([0, 1, 2, 3].map(optionLetter), ['A', 'B', 'C', 'D']);
});

test('every rule has a plain-language description', () => {
  for (const r of RULES) {
    const d = describeRule(r);
    assert.ok(d.startsWith('The marker') || d.startsWith('Each move'), d);
    assert.ok(d.endsWith('.'));
  }
});

test('hashSeed is stable', () => {
  assert.equal(hashSeed(''), 0x811c9dc5);
  assert.equal(hashSeed('a'), hashSeed('a'));
  assert.notEqual(hashSeed('2026-09-26'), hashSeed('2026-09-27'));
  const c: Cell = 3;
  assert.equal(CELL_LABELS[c], 'Bottom left');
});
