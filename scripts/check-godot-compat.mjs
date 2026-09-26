#!/usr/bin/env node
// The godot-compat contract (docs/GODOT.md §The compat contract), checked mechanically.
// Dependency-free; runs from the pre-commit hook when capability sources are staged.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'packages/gd-analyze/capabilities/catalog');
const PROJECT_SOURCE = path.join(CATALOG, 'project-source');
const COMPAT = path.join(PROJECT_SOURCE, 'src/lib/godot-compat');
const ENTRY = path.join(CATALOG, 'entries/godot-compat.json');

const FORBIDDEN_NAME = /server|rendering-device|xr|openxr|-extension|object-dispatch|class-db/u;
const FORBIDDEN_TOKEN = /\brequestAnimationFrame\b|\bsetInterval\b|\bsetTimeout\s*\(/gu;
const DELETED_AREA = /(^|\/)(godot-runtime|character|sprite|codecs)(\/|$)/u;
const ALLOWED_VOLTER = /^@volter\/(threejs-runtime|game-runtime)(\/|$)/u;
const CLASS_NAME = /^[A-Z][A-Za-z0-9]+(2D|3D)?$/u;
const SOURCE_FILE = /\.(ts|tsx|js|mjs)$/u;

const problems = [];
const report = (file, line, message) =>
  problems.push(`${path.relative(ROOT, file)}:${line}: ${message}`);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Tokens with line numbers: comments dropped, strings kept with their value.
function tokenize(text) {
  const tokens = [];
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (/\s/u.test(c)) { i += 1; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let k = i; k < stop; k += 1) if (text[k] === '\n') line += 1;
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const start = line;
      let value = '';
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { value += text[i + 1] ?? ''; i += 2; continue; }
        if (text[i] === '\n') line += 1;
        value += text[i];
        i += 1;
      }
      i += 1;
      tokens.push({ kind: 'string', value, line: start, quote: c });
      continue;
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(text.slice(i, i + 200));
    if (word !== null) {
      tokens.push({ kind: 'word', value: word[0], line });
      i += word[0].length;
      continue;
    }
    tokens.push({ kind: 'punct', value: c, line });
    i += 1;
  }
  return tokens;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (m) => m.replace(/[^\n]/gu, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/gu, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function checkHeader(file, text) {
  const header = /^\s*\/\*\*[\s\S]*?\*\//u.exec(text);
  if (header === null) {
    report(file, 1, 'module header (/** … */ before any code) is missing');
    return;
  }
  if (!/@godot-class\s+\S+/u.test(header[0])) report(file, 1, 'module header lacks @godot-class');
  if (!/@role\s+(BINDING|PROTOCOL)\b/u.test(header[0])) {
    report(file, 1, 'module header lacks @role BINDING|PROTOCOL');
  }
}

function docBefore(text, index) {
  const before = text.slice(0, index).trimEnd();
  if (!before.endsWith('*/')) return null;
  const start = before.lastIndexOf('/**');
  return start === -1 ? null : before.slice(start);
}

function checkExports(file, text) {
  const exported = [];
  const declaration =
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?\s*([A-Za-z_$][\w$]*)?|class\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>|<))/gmu;
  for (const match of text.matchAll(declaration)) {
    exported.push({ name: match[1] ?? match[2] ?? match[3] ?? 'default', index: match.index });
  }
  // `export { a, b }` of local functions: check the local declaration's doc.
  for (const match of text.matchAll(/^export\s*\{([^}]*)\}\s*(?!\s*from)(?:;|$)/gmu)) {
    for (const part of match[1].split(',')) {
      const local = part.trim().split(/\s+as\s+/u)[0]?.replace(/^type\s+/u, '');
      if (!local) continue;
      const decl = new RegExp(`^(?:async\\s+)?function\\s+${local}\\b|^const\\s+${local}\\s*=`, 'mu').exec(text);
      if (decl !== null) exported.push({ name: local, index: decl.index });
    }
  }
  for (const { name, index } of exported) {
    const doc = docBefore(text, index);
    const line = lineOf(text, index);
    if (doc === null) {
      report(file, line, `export ${name} has no doc comment with @godot and @source`);
      continue;
    }
    if (!/@godot\s/u.test(doc)) report(file, line, `export ${name}: doc comment lacks @godot`);
    if (!/@source\s/u.test(doc)) report(file, line, `export ${name}: doc comment lacks @source`);
  }
}

function checkImports(file, tokens) {
  for (let t = 0; t < tokens.length; t += 1) {
    const token = tokens[t];
    if (token.kind !== 'string') continue;
    const previous = tokens[t - 1];
    const isSpecifier =
      (previous?.kind === 'word' && (previous.value === 'from' || previous.value === 'import')) ||
      (previous?.value === '(' && tokens[t - 2]?.value === 'import') ||
      (previous?.value === '(' && tokens[t - 2]?.value === 'require');
    if (!isSpecifier) continue;
    const spec = token.value;
    if (spec.startsWith('@volter/') && !ALLOWED_VOLTER.test(spec)) {
      report(file, token.line, `import of ${spec}: compat may import only npm packages and @volter/threejs-runtime or @volter/game-runtime`);
    } else if (spec.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), spec);
      if (resolved !== COMPAT && !resolved.startsWith(COMPAT + path.sep)) {
        report(file, token.line, `import of ${spec} reaches outside godot-compat (a sibling capability)`);
      }
    }
    if (DELETED_AREA.test(spec)) report(file, token.line, `import of ${spec} names a deleted area`);
  }
}

function checkTokens(file, text) {
  const code = stripComments(text);
  for (const match of code.matchAll(FORBIDDEN_TOKEN)) {
    report(file, lineOf(code, match.index), `${match[0].replace(/\s*\($/u, '(')}: compat owns no frame loop, timer or scheduler`);
  }
}

// A table or switch that selects behaviour by Godot class name: 3+ class-name literals as the
// keys of one object literal, the cases of one switch, or the keys of one `new Map([...])`.
function checkClassDispatch(file, tokens) {
  const frames = [];
  const flag = (frame) => {
    if (frame.names.size >= 3) {
      report(file, frame.line, `${frame.kind} keyed by Godot class names (${[...frame.names].slice(0, 4).join(', ')}…) selects behaviour by class`);
    }
  };
  for (let t = 0; t < tokens.length; t += 1) {
    const token = tokens[t];
    const top = frames[frames.length - 1];
    if (token.value === '{' || token.value === '(' || token.value === '[') {
      let kind = 'block';
      if (token.value === '{') {
        // `switch (…) {`
        let k = t - 1;
        if (tokens[k]?.value === ')') {
          let depth = 0;
          for (; k >= 0; k -= 1) {
            if (tokens[k].value === ')') depth += 1;
            else if (tokens[k].value === '(') { depth -= 1; if (depth === 0) break; }
          }
          if (tokens[k - 1]?.value === 'switch') kind = 'switch';
        }
        if (kind === 'block') kind = 'object literal';
      } else if (token.value === '(' && tokens[t - 1]?.value === 'Map' && tokens[t - 2]?.value === 'new') {
        kind = 'Map';
      } else {
        kind = token.value;
      }
      frames.push({ kind, line: token.line, names: new Set(), open: token.value });
      continue;
    }
    if (token.value === '}' || token.value === ')' || token.value === ']') {
      const frame = frames.pop();
      if (frame !== undefined && frame.kind !== '(' && frame.kind !== '[') flag(frame);
      continue;
    }
    if (top === undefined || token.kind === 'punct') continue;
    const previous = tokens[t - 1];
    const next = tokens[t + 1];
    if (top.kind === 'switch' && token.kind === 'string' && previous?.value === 'case' && CLASS_NAME.test(token.value)) {
      top.names.add(token.value);
    } else if (
      top.kind === 'object literal' && next?.value === ':' &&
      (previous?.value === '{' || previous?.value === ',') && CLASS_NAME.test(token.value)
    ) {
      top.names.add(token.value);
    } else if (token.kind === 'string' && previous?.value === '[' && CLASS_NAME.test(token.value)) {
      // `[['Node3D', …], …]` inside `new Map(` — the pair's key sits one frame below the Map.
      const map = frames[frames.length - 3];
      if (frames[frames.length - 1].kind === '[' && frames[frames.length - 2]?.kind === '[' && map?.kind === 'Map') {
        map.names.add(token.value);
      }
    }
  }
}

function checkEntry(files) {
  let entry;
  try {
    entry = JSON.parse(readFileSync(ENTRY, 'utf8'));
  } catch (error) {
    report(ENTRY, 1, `cannot read the godot-compat entry: ${error.message}`);
    return;
  }
  const onDisk = new Set(files.map((file) => path.relative(PROJECT_SOURCE, file).split(path.sep).join('/')));
  const listed = new Set(entry.files ?? []);
  for (const file of onDisk) if (!listed.has(file)) report(ENTRY, 1, `files omits ${file}, which is on disk`);
  for (const file of listed) if (!onDisk.has(file)) report(ENTRY, 1, `files lists ${file}, which is not on disk`);
}

const files = walk(COMPAT);
for (const file of files) {
  const name = path.basename(file);
  const forbidden = FORBIDDEN_NAME.exec(name);
  if (forbidden !== null) report(file, 1, `file name contains "${forbidden[0]}": no server, RenderingDevice, XR, *Extension, dispatch or ClassDB module`);
  if (!SOURCE_FILE.test(name)) continue;
  const text = readFileSync(file, 'utf8');
  const tokens = tokenize(text);
  checkHeader(file, text);
  checkExports(file, text);
  checkImports(file, tokens);
  checkTokens(file, text);
  checkClassDispatch(file, tokens);
}
checkEntry(files);

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`check-godot-compat: ${problems.length} violation(s) of the compat contract (docs/GODOT.md §The compat contract).`);
  process.exit(1);
}
console.log(`check-godot-compat: ${files.length} file(s) conform.`);
