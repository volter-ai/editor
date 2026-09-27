// Trigger: a commit that stages Godot lane source or this baseline (.githooks/pre-commit). The
// patterns the architecture review keeps finding (docs/GODOT.md §The lane's law, rows 3 to 5),
// counted rule by rule against the baseline committed at HEAD: a count may only shrink. Moving a
// finding between files passes; a new one refuses the commit; editing the working baseline changes
// nothing, since HEAD's is the reference. When findings disappear or move, the baseline is
// rewritten and staged. The reviewer judges structure; this stops the slow creep a review run only
// at milestones misses.
//
//   node scripts/check-godot-architecture.mjs          check, rewriting the baseline when it shrinks
//   node scripts/check-godot-architecture.mjs --init   write the baseline (refused if any rule grew)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const BASELINE = 'release/godot-architecture-baseline.json';
const LANE = 'packages/gd-analyze';
const COMPAT = `${LANE}/capabilities/catalog/project-source/src/lib/godot-compat`;
const EMIT = `${LANE}/src/translate/emit`;
const LOWERING = `${LANE}/src/translate/code`;
const API_DUMP = `${LANE}/vendor/extension-api/godot-4.7-extension_api.json`;

/** Godot's class and built-in type names, from the pinned API dump. */
const dump = JSON.parse(readFileSync(join(root, API_DUMP), 'utf8'));
const CLASSES = [...dump.classes.map((entry) => entry.name), ...dump.builtin_classes.map((entry) => entry.name)];
const NAMES = CLASSES.map((name) => name.replace(/[$^.*+?()[\]{}|\\]/g, '\\$&')).join('|');

/** Each rule: the row it guards, where it looks, and the code it finds. */
const RULES = [
  {
    id: 'class-name-switch',
    row: 3,
    dirs: [EMIT, LOWERING, COMPAT],
    pattern: /switch\s*\([^)]*[cC]lass[^)]*\)/g,
  },
  {
    id: 'class-name-lookup',
    row: 3,
    dirs: [EMIT, LOWERING, COMPAT],
    pattern: /\[[\w.]*[cC]lassName\]|\.get\([\w.]*[cC]lassName\b/g,
  },
  {
    // A Godot class name as a case, a comparison, a table key or a Map entry's key.
    id: 'class-name-literal',
    row: 3,
    dirs: [EMIT, LOWERING, COMPAT],
    pattern: new RegExp(
      `\\bcase\\s+'(?:${NAMES})'|[!=]==\\s*'(?:${NAMES})'|'(?:${NAMES})'\\s*[!=]==|^\\s+'?(?:${NAMES})'?\\s*:|\\[\\s*'(?:${NAMES})'\\s*,`,
      'gm',
    ),
  },
  {
    id: 'class-mount-registry',
    row: 3,
    dirs: [COMPAT],
    pattern: /godot_node_class_mount\(|\bCLASS_MOUNTS\b/g,
  },
  {
    id: 'compat-owns-time',
    row: 4,
    dirs: [COMPAT],
    pattern:
      /\bgodot_main_iteration\b|\bMainTimerSync\b|\bgodot_viewport_frame_work\(|\bgodot_tree_physics_step\b|\brequestAnimationFrame\(|\bsetInterval\(|\bsetTimeout\(|\bperformance\.now\(|\bworld\.step\(/g,
  },
  {
    // What the emitted world exports besides its component (`export default`).
    id: 'world-exports',
    row: 5,
    files: [`${EMIT}/direct-project-world-syntax.ts`],
    pattern: /modifiers:\s*\['export'\]|\bgodot_input_debug\b/g,
  },
];

const SKIP = new Set(['node_modules', 'authority']);
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
};
// Comments are not code: a doc comment naming `MainTimerSync` is not a finding.
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every finding as `rule | file | matched text #n`, n counting repeats of the same text in a file. */
const findings = [];
for (const rule of RULES) {
  const files = rule.files ?? rule.dirs.flatMap((dir) => walk(join(root, dir)).map((file) => relative(root, file)));
  for (const rel of files) {
    const seen = new Map();
    for (const match of withoutComments(readFileSync(join(root, rel), 'utf8')).matchAll(rule.pattern)) {
      const text = match[0].trim().replace(/\s+/g, ' ');
      const n = (seen.get(text) ?? 0) + 1;
      seen.set(text, n);
      findings.push(`${rule.id} | ${rel} | ${text} #${n}`);
    }
  }
}
findings.sort();

const countByRule = (list) => {
  const counts = new Map(RULES.map((rule) => [rule.id, 0]));
  for (const finding of list) {
    const id = finding.split(' | ')[0];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
};

/** HEAD's committed baseline: the reference, whatever the working copy says. */
let committed;
try {
  committed = JSON.parse(execFileSync('git', ['show', `HEAD:${BASELINE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  committed = undefined;
}
const reference = committed ?? (existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined);

const now = countByRule(findings);
const grown = reference === undefined ? [] : RULES.filter((rule) => (now.get(rule.id) ?? 0) > (countByRule(reference).get(rule.id) ?? 0));
if (grown.length > 0) {
  const before = new Set(reference);
  console.error(
    `New architecture findings (docs/GODOT.md §The lane's law; each rule's count only shrinks):\n${grown
      .map((rule) => {
        const added = findings.filter((finding) => finding.startsWith(`${rule.id} |`) && !before.has(finding));
        return `  row ${String(rule.row)} ${rule.id}: ${String(countByRule(reference).get(rule.id))} -> ${String(now.get(rule.id))}\n    ${added.join('\n    ')}`;
      })
      .join('\n')}`,
  );
  process.exit(1);
}

const text = `${JSON.stringify(findings, null, 2)}\n`;
if (process.argv.includes('--init') || reference === undefined) {
  writeFileSync(BASELINE, text);
  console.log(`godot architecture baseline written: ${findings.length} findings.`);
  process.exit(0);
}
if (text !== `${JSON.stringify(reference, null, 2)}\n`) {
  writeFileSync(BASELINE, text);
  try {
    execFileSync('git', ['add', BASELINE], { stdio: 'ignore' });
  } catch {
    // Outside a commit the rewritten baseline is left for the author to stage.
  }
  console.log(`godot architecture baseline rewritten: ${findings.length} findings (was ${reference.length}).`);
} else {
  console.log(`godot architecture baseline holds (${findings.length} findings).`);
}
