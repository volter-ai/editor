#!/usr/bin/env node
/**
 * Generate the GDScript completion denominator from an exact Godot source checkout.
 *
 * Usage:
 *   node scripts/extract-frontend-surface.mjs <3|4> <godot-source-root> <output.json>
 *
 * This intentionally extracts only public language obligations: tokenizer kinds, parser AST
 * kinds, match-pattern kinds, operations, and the parser/analyzer/compiler rule functions that
 * adjudicate them. Fixtures never participate.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const AUTHORITIES = {
  3: {
    version: '3.6.2-stable',
    revision: '3cd3caab6779a7f3ec3bbeb9f200db50c735cfc8',
    files: {
      'modules/gdscript/gdscript_tokenizer.h':
        '9f03abd8905d2f8030208328162d190bbc21246877e47487daa9b6201d5c2c1d',
      'modules/gdscript/gdscript_parser.h':
        '8fd3ad67b117b172afc0486c46a9478db56265f1d3d1f5e674d515646dfa6ff8',
      'modules/gdscript/gdscript_compiler.h':
        '9d5b243642f5c60a4df40af777a33fb68124ac342a7dbf7ad9d142fb8a985862',
    },
  },
  4: {
    version: '4.7-stable',
    revision: '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88',
    files: {
      'modules/gdscript/gdscript_tokenizer.h':
        '9f0800f722f4b33f68bab3bbfa9debcd1d01bb99c9ae27552a9e21e2bdc478e2',
      'modules/gdscript/gdscript_parser.h':
        'a655ec740f570a43b4314b6f97f7f5ee9da5a7bb6517b3845193830e92795914',
      'modules/gdscript/gdscript_analyzer.h':
        '109bbe5038557ea0d11ed99869ec5acec16dbead9a26d8982de87f5138edbed1',
      'modules/gdscript/gdscript_compiler.h':
        '8c81156a95e9c337983b977d94ef26561d542067733dc1ecf2a73ca358e1505a',
    },
  },
};

function fail(message) {
  throw new Error(`extract-frontend-surface: ${message}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function balancedBlock(text, from, open = '{', close = '}') {
  const start = text.indexOf(open, from);
  if (start === -1) fail(`no ${open} after byte ${from}`);
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close) depth -= 1;
    if (depth === 0) return { start, end: index + 1, text: text.slice(start + 1, index) };
  }
  fail(`unterminated ${open}${close} block after byte ${from}`);
}

function enumRows(text, file, family, anchor, enumName) {
  const anchorAt = text.indexOf(anchor);
  if (anchorAt === -1) fail(`${file} has no anchor ${JSON.stringify(anchor)}`);
  const enumAt = text.indexOf(`enum ${enumName}`, anchorAt);
  if (enumAt === -1) fail(`${file} has no enum ${enumName} after ${JSON.stringify(anchor)}`);
  const block = balancedBlock(text, enumAt);
  const prefixLines = text.slice(0, block.start).split('\n').length;
  return block.text.split('\n').flatMap((raw, offset) => {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const match = /^([A-Z][A-Z0-9_]*)\b/.exec(line);
    if (match === null || match[1]?.endsWith('_MAX')) return [];
    return [
      {
        id: `${family}:${match[1]}`,
        family,
        name: match[1],
        source: `${file}:${prefixLines + offset + 1}`,
      },
    ];
  });
}

function ruleRows(text, file) {
  const rows = new Map();
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\/\/.*$/, '');
    const matches = line.matchAll(
      /\b(_?(?:parse|resolve|reduce|check|validate|compile)[A-Za-z0-9_]*)\s*\(/g,
    );
    for (const match of matches) {
      const name = match[1];
      if (name === undefined) continue;
      const id = `official-rule:${path.basename(file)}:${name}`;
      if (!rows.has(id)) {
        rows.set(id, {
          id,
          family: 'official-rule',
          name,
          source: `${file}:${index + 1}`,
        });
      }
    }
  }
  return [...rows.values()];
}

const [majorText, sourceRoot, output] = process.argv.slice(2);
if ((majorText !== '3' && majorText !== '4') || sourceRoot === undefined || output === undefined) {
  fail('usage: <3|4> <godot-source-root> <output.json>');
}
const major = Number(majorText);
const authority = AUTHORITIES[major];
const sources = new Map();
for (const [file, expectedSha256] of Object.entries(authority.files)) {
  const text = readFileSync(path.join(sourceRoot, file), 'utf8');
  const actual = sha256(text);
  if (actual !== expectedSha256) fail(`${file} sha256 ${actual} != ${expectedSha256}`);
  sources.set(file, text);
}
const tokenizerFile = 'modules/gdscript/gdscript_tokenizer.h';
const parserFile = 'modules/gdscript/gdscript_parser.h';
const tokenizer = sources.get(tokenizerFile);
const parser = sources.get(parserFile);
const rows =
  major === 3
    ? [
        ...enumRows(tokenizer, tokenizerFile, 'token', 'class GDScriptTokenizer', 'Token'),
        ...enumRows(parser, parserFile, 'ast', 'struct Node', 'Type'),
        ...enumRows(parser, parserFile, 'operator', 'struct OperatorNode', 'Operator'),
        ...enumRows(parser, parserFile, 'pattern', 'struct PatternNode :', 'PatternType'),
      ]
    : [
        ...enumRows(tokenizer, tokenizerFile, 'token', 'struct Token', 'Type'),
        ...enumRows(parser, parserFile, 'ast', 'struct Node', 'Type'),
        ...enumRows(parser, parserFile, 'operator', 'struct AssignmentNode :', 'Operation'),
        ...enumRows(parser, parserFile, 'operator', 'struct BinaryOpNode :', 'OpType'),
        ...enumRows(parser, parserFile, 'pattern', 'struct PatternNode :', 'Type'),
      ];
for (const [file, text] of sources) rows.push(...ruleRows(text, file));
const unique = new Map(rows.map((row) => [row.id, row]));
const manifest = {
  protocol: 'vgai.godot-frontend-surface',
  protocolVersion: 1,
  engineMajor: major,
  engineVersion: authority.version,
  sourceRevision: authority.revision,
  sources: [...Object.entries(authority.files)].map(([file, digest]) => ({ file, sha256: digest })),
  rows: [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)),
};
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
