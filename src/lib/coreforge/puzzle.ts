// "Follow the marker": a small daily puzzle for the portfolio's CoreForge section.
// A marker sits in one cell of a 2x2 frame and moves by a rule across four frames;
// the player picks the cell it lands on in the fifth. Pure, erasable TypeScript with
// no '@/' imports, so node --test can import it directly.
//
// A puzzle only ships when it is inferable: every rule in RULES that reproduces the
// four shown frames (from any start cell) must predict the same fifth frame. That is
// the property the tests prove for every generated puzzle.

/** Cells in clockwise ring order, which makes a clockwise move `+1 mod 4`. */
export type Cell = 0 | 1 | 2 | 3;

export const CELLS: readonly Cell[] = [0, 1, 2, 3];

export const CELL_LABELS: Readonly<Record<Cell, string>> = {
  0: 'Top left',
  1: 'Top right',
  2: 'Bottom right',
  3: 'Bottom left',
};

/** Grid coordinates for rendering: row 0 is the top row. */
export const CELL_POS: Readonly<Record<Cell, { row: 0 | 1; col: 0 | 1 }>> = {
  0: { row: 0, col: 0 },
  1: { row: 0, col: 1 },
  2: { row: 1, col: 1 },
  3: { row: 1, col: 0 },
};

/** The cell at a grid coordinate (inverse of CELL_POS). */
export function cellAt(row: number, col: number): Cell {
  if (row === 0) return col === 0 ? 0 : 1;
  return col === 0 ? 3 : 2;
}

/**
 * H mirrors left-right, V mirrors top-bottom, D mirrors across the top-left to
 * bottom-right diagonal (it fixes those two cells), A across the other diagonal.
 */
export type Axis = 'H' | 'V' | 'D' | 'A';

const MIRROR: Readonly<Record<Axis, readonly [Cell, Cell, Cell, Cell]>> = {
  H: [1, 0, 3, 2],
  V: [3, 2, 1, 0],
  D: [0, 3, 2, 1],
  A: [2, 1, 0, 3],
};

export type Rule =
  /** The same move every frame: 1 clockwise, 2 diagonal jump, 3 anticlockwise. */
  | { readonly kind: 'step'; readonly step: 1 | 2 | 3 }
  /** Two moves in turn (0 means it stays put). */
  | { readonly kind: 'alternate'; readonly steps: readonly [number, number] }
  /** Each move one cell longer than the last, starting at `first` cells. */
  | { readonly kind: 'grow'; readonly dir: 'cw' | 'ccw'; readonly first: 0 | 1 | 2 }
  /** The same mirror flip every frame. */
  | { readonly kind: 'mirror'; readonly axis: 'H' | 'V' }
  /** Two different mirror flips in turn. */
  | { readonly kind: 'mirrorAlternate'; readonly axes: readonly [Axis, Axis] };

export type Frames = readonly [Cell, Cell, Cell, Cell];

export type Puzzle = {
  readonly seed: string;
  readonly frames: Frames;
  readonly answer: Cell;
  /** The four cells in A-D order; exactly one equals `answer`. */
  readonly options: readonly Cell[];
  /** The rule the generator drew. */
  readonly rule: Rule;
  /** The simplest catalogued rule that fits the frames; what the reveal explains. */
  readonly shownRule: Rule;
  readonly explanation: string;
};

export const FRAME_COUNT = 4;

const mod4 = (n: number): Cell => (((n % 4) + 4) % 4) as Cell;

/** Every rule the generator may draw and the checker must rule out. Order is the tie-break. */
export const RULES: readonly Rule[] = buildRules();

function buildRules(): Rule[] {
  const rules: Rule[] = [
    { kind: 'step', step: 1 },
    { kind: 'step', step: 3 },
    { kind: 'step', step: 2 },
    { kind: 'mirror', axis: 'H' },
    { kind: 'mirror', axis: 'V' },
  ];
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      if (a !== b) rules.push({ kind: 'alternate', steps: [a, b] });
    }
  }
  for (const dir of ['cw', 'ccw'] as const) {
    for (const first of [0, 1, 2] as const) rules.push({ kind: 'grow', dir, first });
  }
  const axes: Axis[] = ['H', 'V', 'D', 'A'];
  for (const x of axes) {
    for (const y of axes) {
      if (x !== y) rules.push({ kind: 'mirrorAlternate', axes: [x, y] });
    }
  }
  return rules;
}

/** Lower is simpler. The reveal describes the simplest rule that fits. */
export function ruleComplexity(rule: Rule): number {
  switch (rule.kind) {
    case 'step':
      return 1;
    case 'mirror':
    case 'alternate':
      return 2;
    case 'grow':
    case 'mirrorAlternate':
      return 3;
  }
}

/** The cell after `from` on move number `i` (0-based) of `rule`. */
export function nextCell(rule: Rule, from: Cell, i: number): Cell {
  switch (rule.kind) {
    case 'step':
      return mod4(from + rule.step);
    case 'alternate':
      return mod4(from + rule.steps[i % 2]);
    case 'grow': {
      const len = rule.first + i;
      return mod4(from + (rule.dir === 'cw' ? len : -len));
    }
    case 'mirror':
      return MIRROR[rule.axis][from];
    case 'mirrorAlternate':
      return MIRROR[rule.axes[i % 2]][from];
  }
}

/** `count` cells starting at `start`, following `rule`. */
export function runRule(rule: Rule, start: Cell, count: number): Cell[] {
  const out: Cell[] = [start];
  for (let i = 0; out.length < count; i++) out.push(nextCell(rule, out[out.length - 1], i));
  return out;
}

function sameFrames(a: readonly Cell[], b: readonly Cell[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/** Rules from `rules` that reproduce `frames` exactly (the start is always frames[0]). */
export function consistentRules(frames: readonly Cell[], rules: readonly Rule[] = RULES): Rule[] {
  return rules.filter((r) => sameFrames(runRule(r, frames[0], frames.length), frames));
}

/** Every fifth frame some consistent rule predicts. Inferable means exactly one. */
export function consistentAnswers(frames: readonly Cell[], rules: readonly Rule[] = RULES): Set<Cell> {
  const answers = new Set<Cell>();
  for (const r of consistentRules(frames, rules)) {
    answers.add(runRule(r, frames[0], frames.length + 1)[frames.length]);
  }
  return answers;
}

export function isInferable(frames: readonly Cell[], rules: readonly Rule[] = RULES): boolean {
  return consistentAnswers(frames, rules).size === 1;
}

/** How many of the shown transitions actually move the marker. */
export function moveCount(frames: readonly Cell[]): number {
  let n = 0;
  for (let i = 1; i < frames.length; i++) if (frames[i] !== frames[i - 1]) n++;
  return n;
}

/** A shown sequence worth solving: at least two real moves and a unique answer. */
export function isGoodSequence(frames: readonly Cell[], rules: readonly Rule[] = RULES): boolean {
  return moveCount(frames) >= 2 && isInferable(frames, rules);
}

// ---------- seeded randomness ----------

/** 32-bit FNV-1a. Stable across engines, so a date string gives the same puzzle everywhere. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The viewer's local calendar day as 'YYYY-MM-DD'. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Seed for the day's puzzle; `variant` > 0 is "try another" on the same day. */
export function puzzleSeed(day: string, variant = 0): string {
  return variant > 0 ? `${day}#${variant}` : day;
}

// ---------- descriptions ----------

const MOVE_WORDS = ['stays put', 'moves one cell clockwise', 'jumps to the opposite corner', 'moves one cell anticlockwise'];

const AXIS_WORDS: Readonly<Record<Axis, string>> = {
  H: 'left to right',
  V: 'top to bottom',
  D: 'across the top-left to bottom-right diagonal',
  A: 'across the top-right to bottom-left diagonal',
};

function cellsWord(n: number): string {
  return n === 1 ? '1 cell' : `${n} cells`;
}

/** One sentence naming the rule, e.g. 'The marker moves one cell clockwise every frame.' */
export function describeRule(rule: Rule): string {
  switch (rule.kind) {
    case 'step':
      return `The marker ${MOVE_WORDS[rule.step]} every frame.`;
    case 'alternate':
      return `The marker takes turns: it ${MOVE_WORDS[rule.steps[0]]}, then it ${MOVE_WORDS[rule.steps[1]]}.`;
    case 'grow': {
      const way = rule.dir === 'cw' ? 'clockwise' : 'anticlockwise';
      const [a, b, c] = [rule.first, rule.first + 1, rule.first + 2];
      return `Each move is one cell longer than the last, going ${way}: ${a}, then ${b}, then ${c}.`;
    }
    case 'mirror':
      return `The marker flips ${AXIS_WORDS[rule.axis]} every frame, like a mirror image.`;
    case 'mirrorAlternate':
      return `The marker takes turns between two mirror flips: ${AXIS_WORDS[rule.axes[0]]}, then ${AXIS_WORDS[rule.axes[1]]}.`;
  }
}

/** What the next move is under `rule`, for the second half of the explanation. */
function describeNextMove(rule: Rule, i: number): string {
  switch (rule.kind) {
    case 'step':
    case 'alternate': {
      const step = rule.kind === 'step' ? rule.step : rule.steps[i % 2];
      return `Next it ${MOVE_WORDS[step]}`;
    }
    case 'grow': {
      const len = rule.first + i;
      const lap = len % 4 === 0 && len > 0 ? ', a full lap back to the same cell' : '';
      return `Next it moves ${cellsWord(len)} ${rule.dir === 'cw' ? 'clockwise' : 'anticlockwise'}${lap}`;
    }
    case 'mirror':
      return `Next it flips ${AXIS_WORDS[rule.axis]} again`;
    case 'mirrorAlternate':
      return `Next it flips ${AXIS_WORDS[rule.axes[i % 2]]}`;
  }
}

/** Full reveal text: the rule, then where that sends the marker. */
export function explain(rule: Rule, frames: Frames, answer: Cell): string {
  const last = frames[frames.length - 1];
  return `${describeRule(rule)} ${describeNextMove(rule, frames.length - 1)}, so from ${CELL_LABELS[last].toLowerCase()} it lands ${CELL_LABELS[answer].toLowerCase()}.`;
}

/** The simplest rule in `rules` that reproduces `frames`, catalogue order breaking ties. */
export function simplestRule(frames: readonly Cell[], rules: readonly Rule[] = RULES): Rule | null {
  let best: Rule | null = null;
  for (const r of consistentRules(frames, rules)) {
    if (!best || ruleComplexity(r) < ruleComplexity(best)) best = r;
  }
  return best;
}

// ---------- generation ----------

/** Used only if every seeded draw fails the checks, which the tests show never happens. */
const FALLBACK: { rule: Rule; start: Cell } = { rule: { kind: 'step', step: 1 }, start: 0 };

const MAX_DRAWS = 64;

function build(seed: string, rule: Rule, start: Cell): Puzzle {
  const run = runRule(rule, start, FRAME_COUNT + 1);
  const frames = [run[0], run[1], run[2], run[3]] as const;
  const answer = run[FRAME_COUNT];
  const shownRule = simplestRule(frames) ?? rule;
  return {
    seed,
    frames,
    answer,
    options: CELLS,
    rule,
    shownRule,
    explanation: explain(shownRule, frames, answer),
  };
}

/**
 * The seeded draw for a seed, or null if every draw failed the checks. Rule families
 * are drawn evenly first (so a day is not mostly clockwise steps), then a rule within
 * the family and a start cell; a draw that is not a good sequence is thrown away and
 * the next one tried.
 */
export function drawPuzzle(seed: string, rules: readonly Rule[] = RULES): Puzzle | null {
  const rand = mulberry32(hashSeed(seed));
  const families = [...new Set(rules.map((r) => r.kind))];
  for (let n = 0; n < MAX_DRAWS; n++) {
    const kind = families[Math.floor(rand() * families.length)];
    const pool = rules.filter((r) => r.kind === kind);
    const rule = pool[Math.floor(rand() * pool.length)];
    const start = CELLS[Math.floor(rand() * 4)];
    const frames = runRule(rule, start, FRAME_COUNT);
    if (isGoodSequence(frames, rules)) return build(seed, rule, start);
  }
  return null;
}

/** The puzzle for a seed: the seeded draw, or a fixed clockwise puzzle if that ever failed. */
export function generatePuzzle(seed: string, rules: readonly Rule[] = RULES): Puzzle {
  return drawPuzzle(seed, rules) ?? build(seed, FALLBACK.rule, FALLBACK.start);
}

export function isCorrect(puzzle: Puzzle, cell: Cell): boolean {
  return cell === puzzle.answer;
}

/** Option letter for an index: 0 -> 'A'. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}
