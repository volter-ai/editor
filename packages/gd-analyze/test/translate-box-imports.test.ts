/**
 * test/translate-box-imports.test.ts — the `code/` / `data/` / `emit/` boxes are import-graph
 * facts, not a directory convention.
 *
 * The ruled lane shape (`docs/ARCHITECTURE-CORE.md` §Foreign games) defines the three
 * directories. This guard makes crossing them fail here instead of somewhere later.
 * It cannot pass by scanning nothing: each box is asserted to contain files, and the
 * parsed-import set is asserted non-empty, before any edge is checked.
 *
 * Rules (the ruling's own):
 *  - `code/**` imports `../surface` and the language/AST modules only — nothing from `data/` or
 *    `emit/` except the shrinking allowlist of imports that already existed when those files
 *    moved (later slices empty it; this test forbids NEW entries).
 *  - `emit/**` imports no module under `read/` except type-only imports. Current value imports
 *    from `read/` are the other shrinking allowlist. No new specifier may appear.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TRANSLATE_DIR = path.resolve(fileURLToPath(new URL('../src/translate', import.meta.url)));

/** `code/` reaches dialect/model/target through `surface.ts`. Empty: no direct data/emit imports. */
const CODE_DATA_EMIT_ALLOWLIST: readonly string[] = [];

/**
 * `emit/` reaches Godot documents through `data/` specs/plans. Type-only `read/` imports remain
 * allowed. Empty: no value import from `read/`.
 */
const EMIT_READ_VALUE_ALLOWLIST: readonly string[] = [];

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/** End offset of the leading import/export-from region (comments and blank lines allowed). */
function leadingImportRegionEnd(text: string): number {
  let i = 0;
  const n = text.length;
  const skipWsAndComments = (): void => {
    while (i < n) {
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (text[i] === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      if (/\s/.test(text[i] ?? '')) {
        i++;
        continue;
      }
      break;
    }
  };
  skipWsAndComments();
  while (i < n) {
    skipWsAndComments();
    const rest = text.slice(i);
    if (
      !/^(import\b|export\s+\*\s+from\b|export\s+type\s+\*\s+from\b|export\s+(?:type\s+)?\{)/.test(
        rest,
      )
    ) {
      break;
    }
    let j = i;
    let quote: string | null = null;
    let found = false;
    while (j < n) {
      const c = text[j] ?? '';
      if (quote) {
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      } else if (c === ';') {
        j++;
        i = j;
        found = true;
        break;
      }
      j++;
    }
    if (!found) {
      i = n;
      break;
    }
  }
  return i;
}

interface ParsedImport {
  statement: string;
  specifier: string;
  typeOnly: boolean;
}

function parseImports(region: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  const re = /(?:^|\n)((?:import|export)\s[\s\S]*?\sfrom\s+['"]([^'"]+)['"]\s*;)/g;
  for (let match = re.exec(region); match !== null; match = re.exec(region)) {
    const statement = (match[1] ?? '').trim();
    const specifier = match[2] ?? '';
    out.push({ statement, specifier, typeOnly: isTypeOnly(statement) });
  }
  return out;
}

function isTypeOnly(statement: string): boolean {
  if (/^(?:import|export)\s+type\b/.test(statement)) return true;
  const brace = /\{([^}]*)\}/.exec(statement);
  if (!brace) return false;
  const parts = (brace[1] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 && parts.every((part) => /^type\s+/.test(part));
}

function boxFiles(box: 'code' | 'data' | 'emit'): { rel: string; abs: string }[] {
  const dir = path.join(TRANSLATE_DIR, box);
  expect(statSync(dir).isDirectory(), `${box}/ must exist`).toBe(true);
  return listTsFiles(dir).map((abs) => ({
    abs,
    rel: path.relative(TRANSLATE_DIR, abs).split(path.sep).join('/'),
  }));
}

function importsOf(file: { rel: string; abs: string }): ParsedImport[] {
  const text = readFileSync(file.abs, 'utf8');
  return parseImports(text.slice(0, leadingImportRegionEnd(text)));
}

describe('translate box import graph', () => {
  const code = boxFiles('code');
  const data = boxFiles('data');
  const emit = boxFiles('emit');

  it('scans a real, non-empty set of files in each box (cannot pass by scanning nothing)', () => {
    expect(code.length, 'code/ is empty').toBeGreaterThan(0);
    expect(data.length, 'data/ is empty').toBeGreaterThan(0);
    expect(emit.length, 'emit/ is empty').toBeGreaterThan(0);
    const parsed = [...code, ...data, ...emit].reduce(
      (sum, file) => sum + importsOf(file).length,
      0,
    );
    expect(parsed, 'parsed no import specifiers').toBeGreaterThan(0);
  });

  it('code/** imports nothing from data/ or emit/ except the shrinking allowlist', () => {
    const observed: string[] = [];
    for (const file of code) {
      for (const imp of importsOf(file)) {
        if (imp.specifier.includes('/data/') || imp.specifier.includes('/emit/')) {
          observed.push(`${file.rel} -> ${imp.specifier}`);
        }
      }
    }
    const extra = observed.filter((row) => !CODE_DATA_EMIT_ALLOWLIST.includes(row));
    const missing = CODE_DATA_EMIT_ALLOWLIST.filter((row) => !observed.includes(row));
    expect(
      extra,
      `new code/ → data|emit import(s) (add only by shrinking the other way): ${extra.join(', ')}`,
    ).toEqual([]);
    expect(
      missing,
      `allowlist entry no longer observed — remove it, do not leave a vacant row: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('emit/** value-imports nothing from read/ except the shrinking allowlist', () => {
    const observed: string[] = [];
    for (const file of emit) {
      for (const imp of importsOf(file)) {
        if (!/(?:^|\/)read(?:\/|$)/.test(imp.specifier) && !imp.specifier.includes('/read/')) {
          continue;
        }
        if (imp.typeOnly) continue;
        observed.push(`${file.rel} -> ${imp.specifier}`);
      }
    }
    const extra = observed.filter((row) => !EMIT_READ_VALUE_ALLOWLIST.includes(row));
    const missing = EMIT_READ_VALUE_ALLOWLIST.filter((row) => !observed.includes(row));
    expect(extra, `new emit/ → read/ value import(s): ${extra.join(', ')}`).toEqual([]);
    expect(
      missing,
      `allowlist entry no longer observed — remove it, do not leave a vacant row: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
