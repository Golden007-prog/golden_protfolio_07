#!/usr/bin/env node
// Records the structured-output demo on /ai (#demo) into
// src/data/ai-generated/lab.json. Three fixed inputs taken from the site's own
// data, none of them a claim about Oikantik (a citation, a glossary definition
// and a reading-list note), go through Gemini structured extraction once. For
// each, the store keeps the JSON Schema sent, the raw reply and the zod
// safeParse result, so the page renders all three panes with no request.
//
// This replaces a live extraction playground, which would have been an
// ungrounded general-purpose endpoint on the owner's key.
//
// Entries are hash-gated (input + schema + prompt), so an unchanged demo is not
// re-run; --force re-runs all three. No key, or a 429: prints a notice, exits 0.
//
//   node --env-file-if-exists=.env scripts/ai/gen-lab.mjs [--force]
//   (npm run ai:generate runs it with every other generator)

import path from 'node:path';
import { z } from 'zod';
import { hashText } from '../../src/lib/ai/corpus.ts';
import { quoteOk } from '../../src/lib/ai/verify.ts';
import { apiKey, callGemini, DATA_DIR, exitSoft, loadStore, newEntry, readJson, saveStore, stale } from './lib.mjs';

const STORE = 'lab';
const force = process.argv.includes('--force');
// Prints each prompt and JSON Schema, calls nothing and writes nothing.
const dryRun = process.argv.includes('--dry-run');

if (!dryRun && !apiKey()) exitSoft('skipped: no key (set GOOGLE_AI_API_KEY to record the /ai structured-output demo)');

const reading = readJson(path.join(DATA_DIR, 'reading.json'));
const skills = readJson(path.join(DATA_DIR, 'skills-index.json'));

const paperIndex = reading.findIndex((r) => r.title.startsWith('Lost in the Middle'));
const paper = reading[paperIndex];
const rag = skills.find((s) => s.name === 'RAG');
if (!paper || !rag) {
  console.error('✖ gen-lab: the demo inputs moved (reading.json "Lost in the Middle" or skills-index.json "RAG").');
  process.exit(1);
}
const TAGS = [...new Set(reading.map((r) => r.tag))];

/** zod checks the JSON Schema cannot express: a string must appear in the input verbatim. */
const verbatim = (input, what) => z.string().min(1).refine((s) => quoteOk(s, input), { message: `${what} is not in the input verbatim` });

function demos() {
  const citation = `${paper.authors} (${paper.year}). ${paper.title}. ${paper.url}`;
  const definition = `${rag.term ?? rag.name}${rag.def}`.trim();
  const note = paper.note;
  return [
    {
      key: 'citation',
      title: 'A citation, as fields',
      source: `reading:${paperIndex}`,
      task: 'Extract the bibliographic fields from this citation. Use null for an arXiv id the text does not contain.',
      input: citation,
      zodChecks: ['The title must appear in the citation word for word, which JSON Schema can’t express.', 'The year must be a whole number from 1900 to 2100.'],
      schema: z.strictObject({
        title: verbatim(citation, 'title').describe('The work’s title, exactly as written'),
        authors: z.string().min(1).describe('The authors, exactly as written'),
        year: z.number().int().min(1900).max(2100),
        arxivId: z
          .string()
          .regex(/^\d{4}\.\d{4,5}$/)
          .nullable()
          .describe('The arXiv identifier, such as 1706.03762, or null'),
        kind: z.enum(['paper', 'book']),
      }),
    },
    {
      key: 'glossary',
      title: 'A definition, as a glossary card',
      source: `ref:${rag.name.toLowerCase()}`,
      task: 'Turn this definition into a glossary card. Key phrases must be copied from the text exactly.',
      input: definition,
      zodChecks: [
        'The term and every key phrase must appear in the definition word for word, which JSON Schema can’t express.',
        'The summary must be at most 90 characters. The schema says so too, but the model isn’t bound by it, so zod enforces it.',
      ],
      schema: z.strictObject({
        term: verbatim(definition, 'term'),
        kind: z.enum(['framework', 'technique', 'library', 'model', 'service', 'concept']),
        summary: z.string().min(1).max(90).describe('One plain sentence, at most 90 characters'),
        keyPhrases: z.array(verbatim(definition, 'key phrase')).min(1).max(4),
      }),
    },
    {
      key: 'note-tag',
      title: 'A reading note, tagged',
      source: `reading:${paperIndex}`,
      task: `Tag this reading-list note with one topic from the allowed list and pick the concepts it names. Concepts must be copied from the note exactly.`,
      input: note,
      zodChecks: ['The topic must be one of the reading list’s own tags.', 'Every concept must appear in the note word for word, which JSON Schema can’t express.'],
      schema: z.strictObject({
        topic: z.enum(TAGS),
        concepts: z.array(verbatim(note, 'concept')).min(1).max(3),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
    },
  ];
}

const SYSTEM =
  'You extract structured data from a short text. Use only what the text says, copy phrases exactly when asked to, and return JSON that matches the schema.';

// The same conversion the app's routes use (gemini.server.ts toResponseSchema).
const toJsonSchema = (schema) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

const { entries } = loadStore(STORE);
let ran = 0;
let skipped = 0;

for (const d of demos()) {
  const jsonSchema = toJsonSchema(d.schema);
  const prompt = `${d.task}\n\nTEXT:\n${d.input}`;
  const hash = hashText(JSON.stringify({ system: SYSTEM, prompt, jsonSchema, zodChecks: d.zodChecks }));
  if (dryRun) {
    console.log(`\n▶ ${d.key} (${stale(entries[d.key], hash) ? 'would run' : 'unchanged'})\n${prompt}\n${JSON.stringify(jsonSchema, null, 2)}`);
    continue;
  }
  if (!force && !stale(entries[d.key], hash)) {
    skipped += 1;
    console.log(`  ${d.key}: unchanged`);
    continue;
  }

  // A plain JSON Schema object: callGemini sends it as responseJsonSchema and only
  // JSON-parses the reply, so the raw text survives for the page. zod runs here.
  const res = await callGemini({ system: SYSTEM, prompt, schema: jsonSchema, maxOutputTokens: 1024 });
  if (!res.ok && res.reason === 'quota') {
    if (ran) saveStore(STORE, entries);
    exitSoft(`skipped: quota (429) after ${ran} demo(s); lab.json keeps the rest`);
  }
  if (!res.ok && res.reason !== 'unverified') {
    console.error(`✖ ${d.key}: ${res.reason}${res.status ? ` (HTTP ${res.status})` : ''}; lab.json unchanged for it`);
    continue;
  }

  let parse;
  if (!res.ok) {
    parse = { success: false, issues: [{ path: '', message: 'The reply was not valid JSON' }] };
  } else {
    const parsed = d.schema.safeParse(res.data);
    parse = parsed.success
      ? { success: true, data: parsed.data }
      : { success: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }

  entries[d.key] = newEntry({
    hash,
    model: res.ok ? res.model : 'unknown',
    claimBearing: false,
    value: {
      title: d.title,
      source: d.source,
      task: d.task,
      input: d.input,
      schema: jsonSchema,
      zodChecks: d.zodChecks,
      raw: res.ok ? res.text : null,
      parse,
      ...(res.ok && res.usage ? { usage: res.usage } : {}),
    },
  });
  ran += 1;
  console.log(`  ${d.key}: ${res.ok ? res.model : 'no model reply'} → safeParse ${parse.success ? 'passed' : `failed (${parse.issues.length} issue${parse.issues.length === 1 ? '' : 's'})`}`);
}

if (ran) saveStore(STORE, entries);
console.log(`lab: ${ran} recorded, ${skipped} unchanged.`);
