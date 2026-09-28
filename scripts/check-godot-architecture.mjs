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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const BASELINE = 'release/godot-architecture-baseline.json';
const LANE = 'packages/gd-analyze';
const COMPAT = `${LANE}/capabilities/catalog/project-source/src/lib/godot-compat`;
const EMIT = `${LANE}/src/translate/emit`;
const LOWERING = `${LANE}/src/translate/code`;
const API_DUMP = `${LANE}/vendor/extension-api/godot-4.7-extension_api.json`;

/**
 * Godot's class names (nodes, resources, servers), from the pinned API dump. Built-in value types
 * (`bool`, `float`, `Vector3`) are not classes: a Variant's kind is data, not a node's class.
 */
const dump = JSON.parse(readFileSync(join(root, API_DUMP), 'utf8'));
const CLASSES = dump.classes.map((entry) => entry.name);
const NAMES = CLASSES.map((name) => name.replace(/[$^.*+?()[\]{}|\\]/g, '\\$&')).join('|');
/** Godot's built-in value types (`Array`, `Dictionary`, `Vector3`): lowering selects by them through rule data, never by name. */
const BUILTINS = (dump.builtin_classes ?? []).map((entry) => entry.name).join('|');

/** Each rule: the row it guards, where it looks, and the code it finds. */
const RULES = [
  {
    // The pipeline's phases called anywhere in the lane but `import-project.ts` and the modules that
    // define them: a report or runner observes through its entry points (`withCapturedGodotProject`, …).
    id: 'phase-call-outside-pipeline',
    row: 1,
    dirs: [`${LANE}/src`, `${LANE}/scripts`],
    exclude: [`${LANE}/src/import-project.ts`, `${LANE}/src/translate/plan.ts`, `${LANE}/src/translate/emit/index.ts`, `${LANE}/src/materialize.ts`, `${LANE}/src/read/godot-project.ts`, `${LANE}/src/snapshot/project-snapshot.ts`, `${LANE}/src/godot-frontend/run-bound-program.ts`, `${LANE}/src/analyze/bound-project.ts`],
    pattern: /\b(?:planGodotTranslation|emitGodotTranslation|materializeGodotProjectSnapshot|readGodotProjectSnapshot|captureGodotBoundProgram(?:FromSnapshot)?|bindGodotProject|captureGodotProjectSnapshot)\s*\(/g,
  },
  {
    // Emit deciding by a setter's name: comparing it, looking it up in a table or set, or reading a
    // setter's value by name (`setterValue(setters, 'set_x')`). The plan stamps what a setter is
    // (its idiom, slot, prop or written form) and emit prints it.
    id: 'emit-setter-name-decision',
    row: 2,
    dirs: [EMIT],
    pattern: /exportName\s*[!=]==\s*['"`][^'"`]+['"`]|['"`][^'"`]+['"`]\s*[!=]==\s*[\w.?]*exportName\b|\bsetterValue\([^,()]+,\s*['"`]|\.(?:has|includes)\([\w.?]*exportName\)|\[[\w.?]*exportName\]/g,
  },
  {
    // Emit reaching the project's scenes to decide something about the one it prints: the plan
    // decides it (`scene-refs.ts`) and emit prints it.
    id: 'emit-project-walk',
    row: 2,
    dirs: [EMIT],
    pattern: /\b(?:project|composition)\.scenes\b/g,
  },
  {
    // Lowering comparing a built-in type's name (a literal's own kind, `.kind === 'int'`, is not a
    // type): which shape a type lowers to is rule data (`language-rules.json`, `lowering-shapes.ts`).
    id: 'lowering-builtin-name',
    row: 3,
    dirs: [LOWERING],
    pattern: new RegExp(`(?<!\\bkind\\s*)[!=]==\\s*['"](?:${BUILTINS})['"]|['"](?:${BUILTINS})['"]\\s*[!=]==|\\bcase\\s+['"](?:${BUILTINS})['"]|\\.includes\\(\\s*['"](?:${BUILTINS})['"]|\\bnew Set\\(\\[[^\\]]*['"](?:${BUILTINS})['"]`, 'g'),
  },
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
    // A Godot class name as a case, a comparison, a table key or a Map entry's key. A list of class
    // names alone (a class's ancestry, which `is` reads) is type data, not an entry keyed by a class.
    id: 'class-name-literal',
    row: 3,
    dirs: [EMIT, LOWERING, COMPAT],
    pattern: new RegExp(
      `\\bcase\\s+'(?:${NAMES})'|[!=]==\\s*'(?:${NAMES})'|'(?:${NAMES})'\\s*[!=]==|^\\s+'?(?:${NAMES})'?\\s*:|\\[\\s*'(?:${NAMES})'\\s*,(?!\\s*'(?:${NAMES})')`,
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
    // The host's frame and physics hooks in compat anywhere but `advance.tsx`, where a node advances
    // itself from its own component (as a drei component does). Anywhere else a frame hook in
    // compat drives other nodes' work: a scheduler.
    id: 'compat-scheduler-hooks',
    row: 4,
    dirs: [COMPAT],
    exclude: [`${COMPAT}/advance.tsx`],
    pattern: /\buse(?:Frame|BeforePhysicsStep|AfterPhysicsStep)\b/g,
  },
  {
    // The violations the import's output check still lets the emitted game carry.
    id: 'output-known-violations',
    row: 5,
    files: [`${LANE}/src/translate/output-conformance.ts`],
    pattern: /^\s+'(?:framework-import|world-export) [^']+',/gm,
  },
  {
    // What the emitted world exports besides its component (`export default`).
    id: 'world-exports',
    row: 5,
    files: [`${EMIT}/direct-project-world-syntax.ts`],
    pattern: /modifiers:\s*\['export'\]|\bgodot_input_debug\b/g,
  },
];

const SKIP = /(^|\/)(node_modules|authority)(\/|$)/;
/**
 * What the check reads is the index, not the working tree: HEAD plus what a commit stages. Another
 * author's uncommitted edits in the same checkout neither hide nor add a finding, and a baseline is
 * only ever written from content that is committed or being committed.
 */
const indexed = (dir) =>
  execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '' && /\.(ts|tsx|mts|mjs)$/.test(file) && !/\.d\.ts$/.test(file) && !SKIP.test(file));
const staged = (rel) => {
  try {
    return execFileSync('git', ['show', `:${rel}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return undefined;
  }
};
// Comments are not code: a doc comment naming `MainTimerSync` is not a finding.
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every finding as `rule | file | matched text #n`, n counting repeats of the same text in a file. */
const findings = [];
for (const rule of RULES) {
  const files = [...new Set([...(rule.files ?? []), ...(rule.dirs ?? []).flatMap((dir) => indexed(dir))])].filter((file) => !(rule.exclude ?? []).includes(file));
  for (const rel of files) {
    const text = staged(rel);
    if (text === undefined) continue;
    const seen = new Map();
    for (const match of withoutComments(text).matchAll(rule.pattern)) {
      const found = match[0].trim().replace(/\s+/g, ' ');
      const n = (seen.get(found) ?? 0) + 1;
      seen.set(found, n);
      findings.push(`${rule.id} | ${rel} | ${found} #${n}`);
    }
  }
}
findings.sort();

/** A rule's definition: its pattern and where it looks. A rule whose definition changes starts its count anew. */
const signature = (rule) => JSON.stringify([rule.pattern.source, rule.pattern.flags, rule.dirs ?? [], rule.files ?? [], rule.exclude ?? []]);
const SIGNATURES = new Map(RULES.map((rule) => [rule.id, signature(rule)]));

const countByRule = (list) => {
  const counts = new Map(RULES.map((rule) => [rule.id, 0]));
  for (const finding of list) {
    const id = finding.split(' | ')[0];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
};

/**
 * A baseline: each rule's count (zeros included, so a rule the baseline knows is told from one it
 * does not) and the findings. A rule the reference does not know is new and starts from its count
 * now; an older baseline, a bare list of findings, knows the rules it has findings for.
 */
const read = (json) => {
  const value = JSON.parse(json);
  if (Array.isArray(value)) {
    const counts = countByRule(value);
    return { counts: new Map([...counts].filter(([id]) => value.some((finding) => finding.startsWith(`${id} |`)))), findings: value };
  }
  // A rule whose definition changed since the baseline is new to it. A baseline written before rules
  // carried signatures knows the eight original rules as they still are; the four rules added on
  // 2026-09-28 were redefined when signatures came in, so it does not know them.
  const signatures = value.signatures;
  const REDEFINED_BEFORE_SIGNATURES = ['phase-call-outside-pipeline', 'emit-setter-name-decision', 'emit-project-walk', 'lowering-builtin-name'];
  const knows = (id) => (signatures === undefined ? !REDEFINED_BEFORE_SIGNATURES.includes(id) : signatures[id] === SIGNATURES.get(id));
  const counts = new Map(Object.entries(value.counts).filter(([id]) => knows(id)));
  return { counts, findings: value.findings };
};

/** HEAD's committed baseline: the reference, whatever the working copy says. */
let reference;
try {
  reference = read(execFileSync('git', ['show', `HEAD:${BASELINE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  reference = existsSync(BASELINE) ? read(readFileSync(BASELINE, 'utf8')) : undefined;
}

const now = countByRule(findings);
const grown = reference === undefined ? [] : RULES.filter((rule) => reference.counts.has(rule.id) && (now.get(rule.id) ?? 0) > (reference.counts.get(rule.id) ?? 0));
if (grown.length > 0) {
  const before = new Set(reference.findings);
  console.error(
    `New architecture findings (docs/GODOT.md §The lane's law; each rule's count only shrinks):\n${grown
      .map((rule) => {
        const added = findings.filter((finding) => finding.startsWith(`${rule.id} |`) && !before.has(finding));
        return `  row ${String(rule.row)} ${rule.id}: ${String(reference.counts.get(rule.id))} -> ${String(now.get(rule.id))}\n    ${added.join('\n    ')}`;
      })
      .join('\n')}`,
  );
  process.exit(1);
}

const text = `${JSON.stringify({ counts: Object.fromEntries(now), signatures: Object.fromEntries(SIGNATURES), findings }, null, 2)}\n`;
if (process.argv.includes('--init') || reference === undefined) {
  writeFileSync(BASELINE, text);
  console.log(`godot architecture baseline written: ${findings.length} findings.`);
  process.exit(0);
}
if (!existsSync(BASELINE) || text !== readFileSync(BASELINE, 'utf8')) {
  writeFileSync(BASELINE, text);
  try {
    execFileSync('git', ['add', BASELINE], { stdio: 'ignore' });
  } catch {
    // Outside a commit the rewritten baseline is left for the author to stage.
  }
  console.log(`godot architecture baseline rewritten: ${findings.length} findings (was ${reference.findings.length}).`);
} else {
  console.log(`godot architecture baseline holds (${findings.length} findings).`);
}
