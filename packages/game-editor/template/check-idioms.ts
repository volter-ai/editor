import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Usage: npx tsx check-idioms.ts [folder] [--strict]
//
// A dependency-free static drift scanner for the "idiomatic engine usage"
// checklist shipped alongside this file as IDIOMS.md — read that first, it's
// the one-page human-readable version of every rule below (⚙ = checked here,
// 👁 = review-only, not machine-checkable). Shipped IN the project template,
// mirroring validate-manifest.ts's shape (same
// project-root-arg convention, same fs-walk-and-report style, zero deps
// beyond node:fs/node:path — plus node:child_process for the git history
// queries of W7 and W9, the only rules here asking a question the file tree
// cannot answer on its own).
//
// Two severities:
//   ERROR (exit 1 always) — unambiguous drift, one canonical fix each:
//     E1. `playwright`/`@playwright/test` imported anywhere in the project —
//         the resident tester (directed through its running game module via
//         `vgai eval`) is the ONE bot harness, and a
//         hand-rolled browser boot is banned.
//         VALUE imports only: a type-only import (`import type {Page}`, or
//         an inline `{ type Page }` with no value specifier) binds nothing
//         that could boot a browser, so it never flags.
//         `@volter/game-live` re-exports the Playwright types a `game.page(step)`
//         step normally needs, so the direct import is usually avoidable
//         anyway.
//     E2. package.json scripts invoking `playwright` directly.
//     E3. `window.__vgai` accessed in src/** (the bot/CLI consumer
//         surface, not the authoring surface — export the state from a module).
//     E4. `?bot=`-style query-param bot plumbing in src/** — the project's
//         resident tester owns bot entry.
//     E5. raw `Math.random()`/`Date.now()`/`performance.now()` in
//         src/scripts/** gameplay code — ONLY when this project's OWN
//         vgai.project.json declares `determinism.seededRandom: true`; silent
//         when undeclared (D15, T-D15.3's third enforcer leg — the other
//         two, the engine-src permanent scan and the examples/ burn-down
//         scan, live in the engine repo's own test suite; see
//         packages/engine/test/gameplay-rng-ban.test.ts).
//     E6. `VGAI_STUB_UNIMPLEMENTED` remains in src/tools/** or src/contributions/** — this
//         is the starter's explicit unfinished-work sentinel, so a completion
//         check containing it cannot be green. Replace the Tester/Data/Analytics stub
//         whole in the game's vocabulary; a game with no content tables may
//         delete the Data stub.
//     E9. nonzero R3F authoring warnings (the `R3F00x` codes — unnamed
//         spatial instances, unforwarded transforms, multiple spatial
//         roots). SHIP-TIER (below).
//     E10. a prefab module under `src/prefabs/**` with no colocated
//         `<Name>.stories.tsx`, or whose story does not declare that component.
//         Always an error: the folder already declares prefab intent.
//     E11. anything under `src/scenes/` that is not a complete `*Scene.tsx`
//         composition, or any story there. Folder names state what a file IS.
//     E12. automated-test furniture anywhere in the project — a `*.test.*`/
//         `*.spec.*` file, a test-runner dependency (vitest/jest/mocha/ava),
//         or a script invoking one. Games are fundamentally unpredictable in
//         behavior, so a pre-written assertion file enters an endless cycle
//         of rewriting assertions and actions (owner ruling 2026-08-21).
//         Playtesting is INTERACTIVE — eval + cheats + bot behavior + event
//         logs read on an interval, redirected live until satisfied — and
//         the play log (`logs/play-*.jsonl`) is the playtest's receipt.
//   SHIP-TIER (E9) — the required naming floor for shipped 3D source (owner
//   decision 2026-08-10; `.agents/references/project-manual.md`). E9 reports as a WARNING with a standing count the
//   operator reads. An unnamed primitive is normal mid-build;
//   declaring a prefab folder entry without its registration is not.
//   WARN (exit 0 unless --strict) — heuristics, more prone to false
//   positives, escape hatch is the suppression comment below:
//     W1. setInterval/setTimeout in a game-state UI file that owns React state
//         (`src/ui/**` and every manifest-declared dom root entry) — looks like
//         a manual polling pump instead of an ordinary project-store
//         subscription.
//     W3. a static top-level Colyseus import in src/** — pulls the
//         networking client into single-player bundles unconditionally.
//     W4. a display-name equality check (`.name ===` / `.name !==`) inside
//         an onTriggerEnter/onTriggerExit body in src/** — identity belongs
//         to components; an editor rename silently breaks name-gated logic.
//     W8. a POSITIVE numeric `useFrame(cb, N)` priority in src/** on a
//         callback that does not itself render. In react-three-fiber a
//         positive priority means "I am taking over rendering": fiber stops
//         calling `gl.render` and draws nothing unless a callback does. The
//         world goes BLANK while state, mounts, logs and health checks all
//         stay green — the one failure this scanner exists to catch and
//         previously reported as 0 findings. Silent for 0 (the default) and
//         for negatives (which only ORDER callbacks), and silent when the
//         callback calls `.render(` itself, which is what taking over
//         actually looks like.
//     W9. gameplay source has accumulated since this project was scaffolded
//         with NO evidence Play has ever run — no `logs/play-*.jsonl`
//         receipt. "Author in playable slices" is the
//         doctrine this mechanizes: a whole game written before the first
//         Play is how pixel-only bugs (blank canvas, invisible mesh, camera
//         inside geometry) survive every green typecheck and test. Same
//         git-history discipline as W7, and SILENT whenever the question
//         cannot be asked (no git, no scaffold anchor, no gameplay commits
//         yet) or has already been answered (any play evidence at all).
//     W10. the manifest declares a Three root but the project contains no
//          correctly story-backed world prefab. Fully procedural or wholly
//          simulation-owned worlds may be honest exceptions; ordinary games
//          should not silently lose the prefab architecture when replacing
//          the starter subject.
//
// E9 is the one rule that does NOT answer its question from the file tree
// alone: the R3F00x codes come from the editor's own source analyzer
// (`ui-source/r3f-project-contracts.ts`), the same pass validate-on-save and
// `vgai status` report from. It is loaded OFFLINE — the analyzer is a pure
// `(code, file) => diagnostics` function over `typescript`, with no dev
// server, browser or editor session anywhere in it — through this project's
// own `@editor/*` tsconfig mapping, so check-idioms never requires a running
// editor. See `loadR3fAnalyzer`.
//
// Suppression: put `// idioms-ignore <rule-id> <reason>` on the flagged
// line. The reason is REQUIRED — an empty/missing reason does not suppress
// (the finding is still reported, with a note that the comment is
// incomplete). This is intentionally a dumb line/regex scanner, not an AST
// pass — it comment-strips PURE comment lines (lines whose trimmed text
// starts with `//`, `/*`, `*`, or is exactly `*/`) before matching rule
// patterns, so doc-comment prose that merely MENTIONS e.g. `window.__vgai`
// doesn't trip a finding, but it does not understand string literals,
// template strings, or multi-statement lines. False positives are expected
// occasionally; suppress them with a reason rather than fighting the regex.
// ---------------------------------------------------------------------------

type Severity = 'error' | 'warn';

interface Finding {
  file: string; // relative to rootDir, forward-slash separated
  line: number;
  severity: Severity;
  rule: string; // e.g. "E1"
  idiom: string; // short name — matches an IDIOMS.md item
  message: string;
  fix: string;
}

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const positional = args.filter((a) => a !== '--strict');
const rootDir = resolve(positional[0] ?? '.');

if (!existsSync(rootDir)) {
  console.error(`No such directory: ${rootDir}`);
  process.exit(1);
}

// This script's own resolved path — excluded from every scan so its rule
// regexes (which literally contain the strings they look for, e.g.
// 'colyseus.js', 'window.__vgai', '@playwright/test') never self-flag.
const SELF_PATH = resolve(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

// Agent instructions and their vendor projections may legitimately contain
// executable reference helpers (including Playwright-based capture scripts).
// They are tooling context, never game source, and must not poison a generated
// project's idiom scan.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.agents',
  '.claude',
  '.github',
  'dist',
  'build',
  '.vgai',
  'coverage',
  '.turbo',
]);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIRS.has(entry)) continue;
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
}

function relPath(file: string): string {
  return resolve(file)
    .slice(rootDir.length + 1)
    .split(sep)
    .join('/');
}

const allFiles: string[] = [];
walk(rootDir, allFiles);

const codeFiles = allFiles
  .filter((f) => CODE_EXT.has(extname(f)))
  .filter((f) => resolve(f) !== SELF_PATH);

const srcFiles = codeFiles.filter((f) => relPath(f).startsWith('src/'));

// ---------------------------------------------------------------------------
// Comment-stripping + suppression helpers
// ---------------------------------------------------------------------------

interface FileText {
  rawLines: string[];
  /** Same line count as rawLines; pure-comment lines are blanked so rule
   *  regexes never match prose inside a doc comment. Joined with '\n' when a
   *  rule needs to match across a multi-line statement (e.g. a wrapped
   *  import). */
  blanked: string;
}

function readFileText(file: string): FileText {
  const raw = readFileSync(file, 'utf-8');
  const rawLines = raw.split('\n');
  const blankedLines = rawLines.map((line) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t === '*/') return '';
    return line;
  });
  return { rawLines, blanked: blankedLines.join('\n') };
}

function lineNumberAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') n++;
  }
  return n;
}

/** Looks for `idioms-ignore <rule> <reason>` on the given raw source line. */
function suppressionStatus(
  rawLine: string,
  ruleId: string,
): 'suppressed' | 'missing-reason' | 'none' {
  const m = rawLine.match(/idioms-ignore\s+(\S+)(?:\s+(.*))?$/);
  if (!m) return 'none';
  const [, rule, reasonRaw] = m;
  if (rule !== ruleId) return 'none';
  const reason = (reasonRaw ?? '').trim();
  return reason.length > 0 ? 'suppressed' : 'missing-reason';
}

const findings: Finding[] = [];

function addFinding(
  file: string,
  rawLines: string[],
  lineNo: number,
  rule: string,
  severity: Severity,
  idiom: string,
  message: string,
  fix: string,
): void {
  const rawLine = rawLines[lineNo - 1] ?? '';
  const status = suppressionStatus(rawLine, rule);
  if (status === 'suppressed') return;
  const finalMessage =
    status === 'missing-reason'
      ? `${message} [an "idioms-ignore ${rule}" comment is present but has no reason — NOT suppressed]`
      : message;
  findings.push({
    file: relPath(file),
    line: lineNo,
    severity,
    rule,
    idiom,
    message: finalMessage,
    fix,
  });
}

/** Project-wide (no single line) findings, e.g. "zero registrations anywhere
 *  in src/". Suppressed by an `idioms-ignore <rule> <reason>` comment
 *  ANYWHERE inside src/**. */
function addProjectFinding(
  rule: string,
  severity: Severity,
  idiom: string,
  message: string,
  fix: string,
): void {
  for (const file of srcFiles) {
    const { rawLines } = readFileText(file);
    for (const rawLine of rawLines) {
      if (suppressionStatus(rawLine, rule) === 'suppressed') return;
    }
  }
  findings.push({ file: 'src/', line: 0, severity, rule, idiom, message, fix });
}

// ---------------------------------------------------------------------------
// E1 — playwright imported anywhere in the project
// ---------------------------------------------------------------------------

/** True when an import clause — everything between the `import` keyword and
 *  `from` — binds NO value at all.
 *
 *  E1's rationale is about value bindings: the objection is a hand-rolled
 *  browser boot. A type-only import binds nothing usable — under
 *  `verbatimModuleSyntax` the inline form degenerates to a bare
 *  `import {} from '…'` module load, which still cannot
 *  launch a browser — so E1 must not fire on it. (`type` is not a reserved
 *  word, hence the care below: `import type from 'x'` is a DEFAULT import of
 *  a binding literally named `type`, and `{ type as T }` renames that same
 *  binding — both are real value imports.)
 */
function bindsNoValue(clause: string): boolean {
  const c = clause.trim();
  // Whole-clause form: `import type {A}` / `import type * as ns` /
  // `import type Default`. Requires a real clause after the keyword, which
  // is what separates it from `import type from '…'` (clause is just `type`)
  // and `import type, {A} from '…'` (a default binding named `type`).
  if (/^type\s*[{*]/.test(c) || /^type\s+[A-Za-z_$]/.test(c)) return true;
  // Inline form: type-only iff EVERY named specifier carries `type`. A mixed
  // `{ test, type Page }` keeps its value binding and still flags.
  const named = c.match(/^\{([^}]*)\}$/);
  if (!named) return false;
  const specifiers = named[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return specifiers.length > 0 && specifiers.every((s) => /^type\s+(?!as\s)/.test(s));
}

function checkPlaywrightImports(): void {
  const importRe =
    /\bimport\b([^;]*?)\bfrom\s+['"](@playwright\/test|playwright)['"]|\brequire\(\s*['"](@playwright\/test|playwright)['"]\s*\)/g;
  for (const file of codeFiles) {
    const { rawLines, blanked } = readFileText(file);
    for (const m of blanked.matchAll(importRe)) {
      const pkg = m[2] ?? m[3];
      // `require(...)` (the m[3] branch) has no clause and is always a value.
      if (m[1] !== undefined && bindsNoValue(m[1])) continue;
      const lineNo = lineNumberAt(blanked, m.index);
      addFinding(
        file,
        rawLines,
        lineNo,
        'E1',
        'error',
        'bot-canonical',
        `"${pkg}" imported — the resident tester, directed through the running game's own module, is the ONE bot harness; hand-rolled Playwright boots are banned.`,
        "Drive the game through the live session (vgai eval + the running tester module), or take the Playwright types from '@volter/game-live' as a type-only import.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// E2 — package.json scripts invoking playwright directly
// ---------------------------------------------------------------------------

function checkPackageJsonScripts(): void {
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) return;
  const raw = readFileSync(pkgPath, 'utf-8');
  const rawLines = raw.split('\n');
  let pkg: { scripts?: Record<string, unknown> };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return; // malformed JSON is not this scanner's job to report
  }
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (typeof cmd !== 'string' || !/\bplaywright\b/.test(cmd)) continue;
    const lineIdx = rawLines.findIndex((l) => l.includes(`"${name}"`) && l.includes(':'));
    const lineNo = lineIdx >= 0 ? lineIdx + 1 : 1;
    addFinding(
      pkgPath,
      rawLines,
      lineNo,
      'E2',
      'error',
      'bot-canonical',
      `script "${name}" invokes playwright directly ("${cmd}") — this project has no Playwright lane to own a browser binary or config.`,
      `Delete the "${name}" script — playtesting is the live session (vgai eval + the running tester module), not a script.`,
    );
  }
}

// ---------------------------------------------------------------------------
// E12 — automated-test furniture in a game project
// ---------------------------------------------------------------------------

/** Games are fundamentally unpredictable in behavior: a pre-written assertion
 *  file enters an endless cycle of rewriting assertions and actions (owner
 *  ruling, 2026-08-21 — measured live: three assertion renegotiations in
 *  twenty minutes on one balance suite). The playtest loop is INTERACTIVE:
 *  `vgai eval` + cheats set the situation, bot policy runs behavior, event
 *  logs are read on an interval, and the run is redirected live until the
 *  operator is satisfied. The play log (logs/play-*.jsonl) is the receipt. This
 *  rule keeps the furniture out so the cheapest path stays the sanctioned
 *  one. */
function checkNoTestFurniture(): void {
  const E12_FIX =
    'Delete it and playtest LIVE: eval + cheats set the situation, bot goals run behavior, the ' +
    'event log is read on an interval, the run is redirected until satisfied; the play log ' +
    '(logs/play-*.jsonl) is the receipt.';
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vgai', 'logs', 'media', 'public']);
  const testFile = /\.(test|spec)\.[cm]?[jt]sx?$/;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (testFile.test(entry)) {
        const { rawLines } = readFileText(full);
        addFinding(
          full,
          rawLines,
          1,
          'E12',
          'error',
          'no-automated-tests',
          'an automated-test file in a game project — games are fundamentally unpredictable in ' +
            'behavior, so a pre-written assertion file enters an endless cycle of rewriting ' +
            'assertions and actions. Playtesting is interactive (see AGENTS.md).',
          E12_FIX,
        );
      }
    }
  };
  walk(rootDir);

  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) return;
  const raw = readFileSync(pkgPath, 'utf-8');
  const rawLines = raw.split('\n');
  let pkg: {
    scripts?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return;
  }
  const runners = ['vitest', 'jest', 'mocha', 'ava', 'uvu', '@playwright/test'];
  for (const dep of runners) {
    if (pkg.dependencies?.[dep] === undefined && pkg.devDependencies?.[dep] === undefined) continue;
    const lineIdx = rawLines.findIndex((l) => l.includes(`"${dep}"`));
    addFinding(
      pkgPath,
      rawLines,
      lineIdx >= 0 ? lineIdx + 1 : 1,
      'E12',
      'error',
      'no-automated-tests',
      `test runner "${dep}" declared as a dependency — a game project ships no automated tests; ` +
        'the playtest is interactive and the play log is its receipt.',
      E12_FIX,
    );
  }
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (typeof cmd !== 'string' || !/\b(vitest|jest|mocha|ava|uvu)\b/.test(cmd)) continue;
    const lineIdx = rawLines.findIndex((l) => l.includes(`"${name}"`) && l.includes(':'));
    addFinding(
      pkgPath,
      rawLines,
      lineIdx >= 0 ? lineIdx + 1 : 1,
      'E12',
      'error',
      'no-automated-tests',
      `script "${name}" invokes a test runner ("${cmd}") — a game project ships no automated tests.`,
      E12_FIX,
    );
  }
}

// ---------------------------------------------------------------------------
// E3 — window.__vgai accessed in src/**
// ---------------------------------------------------------------------------

function checkWindowVgai(): void {
  // Two-part, same-line heuristic rather than a single `window\.__vgai`
  // regex: this codebase's OWN canonical way to reach the bridge (see
  // @volter/game-live's game-client/client.ts) is a cast in between —
  // `(window as unknown as { __vgai?: ... }).__vgai` — so `window` and
  // `.__vgai` are literal-adjacent only coincidentally. Flag any line that
  // mentions the `window` token AND a bare `.__vgai`/`['__vgai']` property
  // access. The negative lookahead on the dotted form keeps this off
  // `__vgaiScene`/`__vgaiCamera`/`__vgaiRender`/`__vgaiBatch` etc. — those
  // are different, unrelated dev-only globals, not the frozen `window.__vgai`
  // debug-bridge shape (D18). A file-scoped `window` ALIAS on its own line
  // (`const w = window as …; w['__vgai']`) is a known miss — this is a
  // line-scan, not an AST pass.
  const windowRe = /\bwindow\b/;
  const vgaiAccessRe = /\.__vgai(?![A-Za-z0-9_])|\[\s*['"]__vgai['"]\s*\]/g;
  for (const file of srcFiles) {
    const { rawLines, blanked } = readFileText(file);
    const blankedLines = blanked.split('\n');
    blankedLines.forEach((line, i) => {
      if (!windowRe.test(line)) return;
      vgaiAccessRe.lastIndex = 0;
      if (!vgaiAccessRe.test(line)) return;
      addFinding(
        file,
        rawLines,
        i + 1,
        'E3',
        'error',
        'bot-canonical',
        'window.__vgai accessed directly in src/** — this is the bot/CLI consumer surface, not the authoring surface.',
        'Read and drive the game through its own exported modules instead (game.run(({ modules }) => …)).',
      );
    });
  }
}

// ---------------------------------------------------------------------------
// E4 — ?bot= query-param bot plumbing in src/**
// ---------------------------------------------------------------------------

function checkBotParam(): void {
  const re = /searchParams\.get\(\s*['"]bot['"]|['"]bot=['"]/g;
  for (const file of srcFiles) {
    const { rawLines, blanked } = readFileText(file);
    for (const m of blanked.matchAll(re)) {
      const lineNo = lineNumberAt(blanked, m.index);
      addFinding(
        file,
        rawLines,
        lineNo,
        'E4',
        'error',
        'bot-canonical',
        '?bot= query-param plumbing found in src/** — the resident tester is game code reached through its running module; hand-rolled boot flags are banned.',
        "Delete this bot-param handling; direct the resident tester through the game's exported tester functions from the live session.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// W1 — polling pump in a game-state UI
// ---------------------------------------------------------------------------

/** Every file the manifest names as a `dom` root's entry, project-relative and
 *  forward-slashed. A dom root IS the React UI over game state, so its entry is
 *  in W1's scope whatever it happens to import. Missing/malformed manifest
 *  reads as "none" — validating its shape is validate-manifest.ts's job. */
function manifestDomRootEntries(): Set<string> {
  const entries = new Set<string>();
  const manifestPath = join(rootDir, 'vgai.project.json');
  if (!existsSync(manifestPath)) return entries;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      roots?: Array<{ adapter?: unknown; entry?: unknown }>;
    };
    for (const root of manifest.roots ?? []) {
      if (root.adapter === 'dom' && typeof root.entry === 'string') {
        entries.add(root.entry.replace(/^\.\//, ''));
      }
    }
  } catch {
    /* malformed manifest: no entries, no findings */
  }
  return entries;
}

/**
 * Scope is `src/ui/**` plus every manifest-declared dom-root entry. The rule
 * does not look for a particular engine hook: UI state is the project's own
 * React context/store, and prescribing a hook would merely make the scanner
 * blind when the project chose another native store.
 */
function pollingPumpScope(file: string, blanked: string, domRootEntries: Set<string>): boolean {
  const rel = relPath(file);
  if (!(rel.startsWith('src/ui/') || domRootEntries.has(rel))) return false;
  // "driving component state" is the rule's actual subject, so the UI leg asks
  // for it: a timer in a UI file that owns no React state is a transition, a
  // debounce, or a one-shot — not a pump.
  return /\b(useState|useReducer|useSyncExternalStore)\s*[(<]/.test(blanked);
}

function checkPollingPump(): void {
  const timerRe = /\b(setInterval|setTimeout)\s*\(/g;
  const domRootEntries = manifestDomRootEntries();
  for (const file of srcFiles) {
    const { rawLines, blanked } = readFileText(file);
    if (!pollingPumpScope(file, blanked, domRootEntries)) continue;
    for (const m of blanked.matchAll(timerRe)) {
      const lineNo = lineNumberAt(blanked, m.index);
      addFinding(
        file,
        rawLines,
        lineNo,
        'W1',
        'warn',
        'state-via-project-store',
        `${m[1]} driving component state in a game-state UI file — looks like a manual polling pump.`,
        "Subscribe to this game's own React context/store (for example useSyncExternalStore) instead of polling.",
      );
    }
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// W3 — static top-level Colyseus import in src/**
// ---------------------------------------------------------------------------

function checkColyseusStaticImport(): void {
  // Matches a static `import ... from '<pkg>'` at the START of a (blanked,
  // trimmed) line only — a dynamic `await import('@colyseus/sdk')` call is
  // NOT a line starting with the `import` keyword, so it's unaffected.
  // Covers both the current SDK package name (`@colyseus/sdk`) and the
  // legacy pre-0.15 package name (`colyseus.js`) doctrine still refers to.
  // Excludes `import type { ... } from '@colyseus/sdk'` — erased entirely at
  // build time (zero runtime bundle impact), so it can't be what this rule's
  // "pulls the client into single-player bundles" rationale is about; the
  // canonical `--example third-person-arena` uses exactly this form for its
  // ambient `Room` type. A mixed `import { Client, type Room } from ...`
  // still flags correctly, since only the leading `import type` form is
  // fully erased.
  const re = /^\s*import\s+(?!type\b).*\bfrom\s+['"](colyseus\.js|@colyseus\/sdk)['"]/;
  for (const file of srcFiles) {
    const { rawLines, blanked } = readFileText(file);
    const blankedLines = blanked.split('\n');
    blankedLines.forEach((line, i) => {
      const m = line.match(re);
      if (!m) return;
      addFinding(
        file,
        rawLines,
        i + 1,
        'W3',
        'warn',
        'networking-colyseus-direct',
        `static top-level "${m[1]}" import in src/** — pulls the networking client into single-player bundles unconditionally.`,
        "Dynamic-import it instead: const { Client } = await import('@colyseus/sdk');",
      );
    });
  }
}

// ---------------------------------------------------------------------------
// W4 — display-name equality checks inside trigger callbacks
// ---------------------------------------------------------------------------

function checkTriggerNameIdentity(): void {
  // Entity identity belongs to explicit project-owned data/components, not to
  // the display name: `other.name === 'Coin'` works
  // until someone renames the entity in the editor's hierarchy panel, then
  // silently never matches again. Scope: only inside an
  // onTriggerEnter/onTriggerExit body — a name comparison elsewhere (e.g.
  // asset lookup by GLTF node name) is a different, legitimate pattern.
  // Body detection is brace-counting from the callback's opening line — the
  // same dumb-line-scan honesty budget as every other rule here.
  const startRe = /\bonTrigger(?:Enter|Exit)\s*[(=]/;
  const nameEqRe = /\.name\s*[!=]==?/;
  for (const file of srcFiles) {
    const { rawLines, blanked } = readFileText(file);
    const lines = blanked.split('\n');
    let i = 0;
    while (i < lines.length) {
      if (!startRe.test(lines[i] ?? '')) {
        i++;
        continue;
      }
      let depth = 0;
      let seenOpen = false;
      let j = i;
      for (; j < lines.length; j++) {
        const line = lines[j] ?? '';
        for (const ch of line) {
          if (ch === '{') {
            depth++;
            seenOpen = true;
          } else if (ch === '}') {
            depth--;
          }
        }
        // A signature with no `{` within a few lines is a DECLARATION (interface/
        // abstract member), not a definition — without this bail the scan would
        // run to EOF and flag every `.name ===` in the rest of the file.
        if (!seenOpen) {
          if (j >= i + 3) break;
          continue;
        }
        if (nameEqRe.test(line)) {
          addFinding(
            file,
            rawLines,
            j + 1,
            'W4',
            'warn',
            'trigger-name-identity',
            'display-name equality check inside an onTriggerEnter/onTriggerExit body — an editor rename silently breaks name-gated logic.',
            'Attach explicit project-owned identity data to the entities you care about and gate on that, not object.name.',
          );
        }
        if (seenOpen && depth <= 0) break;
      }
      i = j + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// git-history plumbing shared by slice-proxy rules (W9)
// ---------------------------------------------------------------------------
// The vgai CLI mirrors this exact measurement (source path, gameplay
// pathspecs, threshold, silent-on-unaskable) as `vgai status`'s ambient
// bot-drift line — engine repo, packages/vgai-cli/src/instrumentation-signal.ts.
// If you change any of the three constants below, change them there too, or
// the ambient signal and this rule will disagree about whether a bot drifted.

/** The files that ARE the game, for slice-proxy measurements (W9). Deliberately
 *  NOT all of src/ — churn in src/ui/, src/tools/ or src/data/ is not by
 *  itself a gameplay slice. */
const GAMEPLAY_PATHS = [
  'src/components',
  'src/scenes',
  'src/prefabs',
  'src/lib',
  'src/world.tsx',
  'src/hooks',
];

/** Runs git in the project root. Returns null for ANY failure — git missing,
 *  not a repository, unborn HEAD, non-zero exit — because every one of those
 *  means "this project cannot be asked the question", not "this project is
 *  drifting". */
function git(args: string[]): string | null {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf-8' });
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? '').trim();
}

/** Memoized: every git-history rule (W9) opens with this question, and a
 *  process spawn is by far the most expensive thing this scanner does. The
 *  whole run has to stay cheap enough to invoke constantly — that is the
 *  point of a rule like W9, which only pays off when it is run early and
 *  often. */
let insideWorkTree: boolean | null = null;
function isGitWorkTree(): boolean {
  if (insideWorkTree === null)
    insideWorkTree = git(['rev-parse', '--is-inside-work-tree']) === 'true';
  return insideWorkTree;
}

// ---------------------------------------------------------------------------
// W8 — a positive useFrame priority silently takes over rendering
// ---------------------------------------------------------------------------

/** The `(` … `)` span of the call whose open paren is at `open`, as offsets
 *  into `text` (exclusive of both parens). Null when unbalanced. */
function callArgumentSpan(text: string, open: number): { start: number; end: number } | null {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const ch = text[index];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return { start: open + 1, end: index };
    }
  }
  return null;
}

/** The offset of the last TOP-LEVEL argument inside `[start,end)`, or null when
 *  the call has one argument (or none). Brackets/braces/parens/quotes are
 *  tracked so a comma inside an arrow body or an array never splits a call. */
function lastArgumentOffset(text: string, start: number, end: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  let lastComma = -1;
  for (let index = start; index < end; index++) {
    const ch = text[index]!;
    if (quote) {
      if (ch === '\\') index++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) lastComma = index;
  }
  return lastComma === -1 ? null : lastComma + 1;
}

function checkUseFramePriority(): void {
  const useFrameRe = /\buseFrame\s*\(/g;
  // A callback that draws the scene is the DOCUMENTED reason to pass a
  // positive priority, and it is visible in the call itself:
  // `useFrame(({gl, scene, camera}) => gl.render(scene, camera), 1)`.
  const takesOverRenderingRe = /\.\s*render\s*\(/;
  for (const file of srcFiles) {
    const { rawLines, blanked } = readFileText(file);
    for (const match of blanked.matchAll(useFrameRe)) {
      const open = match.index + match[0].length - 1;
      const span = callArgumentSpan(blanked, open);
      if (!span) continue;
      const priorityAt = lastArgumentOffset(blanked, span.start, span.end);
      if (priorityAt === null) continue;
      const priorityText = blanked.slice(priorityAt, span.end);
      // A non-literal priority (`useFrame(cb, order)`) is beyond a line
      // scanner's honesty budget — this rule stays quiet rather than guess.
      const literal = priorityText.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
      if (!literal || Number.parseFloat(literal[1]!) <= 0) continue;
      if (takesOverRenderingRe.test(blanked.slice(span.start, span.end))) continue;
      addFinding(
        file,
        rawLines,
        lineNumberAt(blanked, priorityAt + (priorityText.length - priorityText.trimStart().length)),
        'W8',
        'warn',
        'useframe-priority-render-ownership',
        `useFrame priority ${literal[1]} is positive — react-three-fiber reads that as "this callback owns rendering" and stops calling gl.render itself. ` +
          'The canvas goes blank while state, mounts and logs all stay healthy.',
        'Drop the priority (0 is the default) or make it NEGATIVE to order this callback before the render — negatives sequence, they never disable the render. ' +
          'Keep a positive priority only if this callback draws the scene itself (gl.render(scene, camera)); if it renders indirectly, suppress with "// idioms-ignore W8 <reason>".',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// W9 — the game has never been played
// ---------------------------------------------------------------------------

/** The one way a project shows that Play has actually run: `logs/play-*.jsonl`
 *  — the editor server opens one per Play session
 *  (packages/editor/server/editor-server.ts, POST /__editor/log-session).
 *  A working-tree fact, not a git fact (`logs/` is gitignored), written by
 *  the tool itself, so it cannot be produced by intending to play. This
 *  receipt is also the playtest's proof (owner ruling 2026-08-21). */
function hasPlayEvidence(): boolean {
  const logsDir = join(rootDir, 'logs');
  if (!existsSync(logsDir)) return false;
  try {
    return readdirSync(logsDir).some((f) => f.startsWith('play-') && f.endsWith('.jsonl'));
  } catch {
    return false; // unreadable logs dir is not evidence
  }
}

/** The scaffolder's own record of where this project came from
 *  (packages/create-vgai-project/src/baseline.ts). W9's history ANCHOR.
 *
 *  W7 anchors its window on a file's last commit; W9 does the same, and this
 *  is the file that means "this project began here". Anchoring matters: an
 *  ABSOLUTE count of gameplay commits is only this game's history when the
 *  project owns the repository. Measured on this engine checkout, an
 *  unanchored count reads 70 gameplay commits for the starter template and 61
 *  for examples/top-down-strategy — real commits, but the ENGINE's
 *  maintenance history, and a rule that shouts at our own reference material
 *  on every run is noise, not a tripwire. A project with no committed
 *  baseline cannot be asked when it started, so W9 stays silent there. */
const SCAFFOLD_BASELINE_SOURCE = '.vgai/scaffold-baseline.json';

/** Gameplay commits since the scaffold anchor, at or above which a project
 *  that has never been played is reported.
 *
 *  Why 5, and why this shape: the doctrine is "author in playable slices —
 *  enter Play and drive each slice before writing the next", so the honest
 *  question is "how many slices went by unplayed?" and a commit touching
 *  GAMEPLAY_PATHS is the cheapest available proxy for a slice. One or two
 *  must stay quiet — the first commits after a scaffold are often plumbing
 *  (an asset drop, a manifest edit, a rename) with nothing to look at yet.
 *  Five is deliberately the same number W7 uses for the same reason, and it
 *  is an order of magnitude below the measured failure this exists to catch:
 *  in the blind-probe build that motivated the rule, the agent spent 59
 *  minutes and 187 tool calls — 60% of its session — writing the whole game
 *  before its first Play, and 4 of its 5 worst bugs were pixel-only, every
 *  one of them found only afterwards. Reuses W7's GAMEPLAY_PATHS on purpose:
 *  "which files are the game" is one question, and it should not get two
 *  answers in one file. */
const UNPLAYED_GAMEPLAY_COMMIT_THRESHOLD = 5;

function checkPlayedBeforeAuthoring(): void {
  if (hasPlayEvidence()) return; // already answered — and answered without spawning git
  if (!isGitWorkTree()) return; // not a repo: silent
  const scaffoldCommit = git(['log', '-1', '--format=%H', '--', SCAFFOLD_BASELINE_SOURCE]);
  if (!scaffoldCommit) return; // no commits, or no baseline anchor: silent
  const raw = git(['rev-list', '--count', `${scaffoldCommit}..HEAD`, '--', ...GAMEPLAY_PATHS]);
  if (raw === null) return;
  const gameplayCommits = Number.parseInt(raw, 10);
  if (!Number.isFinite(gameplayCommits) || gameplayCommits < UNPLAYED_GAMEPLAY_COMMIT_THRESHOLD)
    return;
  addProjectFinding(
    'W9',
    'warn',
    'author-in-playable-slices',
    `${gameplayCommits} commit(s) have touched gameplay source (${GAMEPLAY_PATHS.join(', ')}) ` +
      'since this project was scaffolded, and nothing here shows Play has EVER run — no ' +
      'logs/play-*.jsonl receipt. A game written blind fails in ways ' +
      'typecheck and unit tests cannot see: a blank canvas, an invisible mesh, a camera inside ' +
      'the geometry.',
    'Author in playable slices (AGENTS.md) — enter Play before writing the next slice: run ' +
      '`npm run vgai -- play`, look at the game, playtest live, then continue; reading the ' +
      'code again does not count.',
  );
}

// ---------------------------------------------------------------------------
// E5 — raw Math.random()/Date.now()/performance.now() in src/scripts/**,
// only when THIS project's own vgai.project.json declares
// determinism.seededRandom (D15, T-D15.3's third enforcer leg).
// ---------------------------------------------------------------------------

/** Reads rootDir/vgai.project.json and reports whether it declares
 *  `determinism.seededRandom: true`. Missing/malformed manifests read as
 *  "not declared" (silent) — validating the manifest's own shape is
 *  validate-manifest.ts's job, not this scanner's. */
function projectDeclaresSeededRandom(): boolean {
  const manifestPath = join(rootDir, 'vgai.project.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      determinism?: { seededRandom?: boolean };
    };
    return manifest.determinism?.seededRandom === true;
  } catch {
    return false;
  }
}

function checkDeterminismRng(): void {
  if (!projectDeclaresSeededRandom()) return; // undeclared project: no contract, no findings (T4.1)
  const rawRngRe = /\b(Math\.random|Date\.now|performance\.now)\s*\(/g;
  const scriptFiles = srcFiles.filter((f) => relPath(f).startsWith('src/scripts/'));
  for (const file of scriptFiles) {
    const { rawLines, blanked } = readFileText(file);
    for (const m of blanked.matchAll(rawRngRe)) {
      const lineNo = lineNumberAt(blanked, m.index);
      addFinding(
        file,
        rawLines,
        lineNo,
        'E5',
        'error',
        'gameplay-rng-ctx-random',
        `raw "${m[1]}(" in src/scripts/** — this project's vgai.project.json declares ` +
          'determinism.seededRandom, so ALL gameplay RNG/wall-clock reads must flow through ' +
          'ctx.random, not raw Math.random()/Date.now()/performance.now().',
        'Use ctx.random() (or ctx.random.stream(name) for an independent named stream) instead.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// E6 — starter contribution obligation left in place
// ---------------------------------------------------------------------------

function checkUnconfiguredProjectTools(): void {
  const sentinel = /\bVGAI_STUB_UNIMPLEMENTED\b/g;
  const toolFiles = srcFiles.filter((file) => /^(src\/tools|src\/contributions)\//.test(relPath(file)));
  for (const file of toolFiles) {
    const { rawLines, blanked } = readFileText(file);
    for (const match of blanked.matchAll(sentinel)) {
      addFinding(
        file,
        rawLines,
        lineNumberAt(blanked, match.index),
        'E6',
        'error',
        'studio-surfaces-complete',
        'VGAI_STUB_UNIMPLEMENTED remains in an editor contribution — this is an explicit starter obligation, not a usable game-specific surface.',
        "Rewrite the stub whole in this game's vocabulary and remove its warning. If this is the Data stub and the game genuinely has no authored content tables, delete the file.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// E9/E10 — the required floor for shipped 3D assets, and when it BINDS
// ---------------------------------------------------------------------------

/** Always WARN: the committed-route ship gate died with the route registry
 *  (owner ruling 2026-08-21 — pre-written assertions, including routes, enter
 *  the endless rewrite cycle). The naming floor stays a standing count the
 *  operator reads; handoff judgment is the DEVLOG'd playtest, not a rule
 *  escalation. */
function floorSeverity(): Severity {
  return 'warn';
}

// ---------------------------------------------------------------------------
// E9 — R3F authoring warnings (R3F00x) must be ZERO at handoff
// ---------------------------------------------------------------------------

interface R3fDiagnostic {
  code: string;
  line: number;
  component: string;
  message: string;
}

type R3fAnalyzer = (
  code: string,
  file: string,
  opts?: { knownThreeSurface?: boolean },
) => R3fDiagnostic[];

/**
 * The editor's OWN R3F source analyzer, resolved from this project's
 * `@editor/*` tsconfig mapping and loaded synchronously.
 *
 * Why not re-implement the codes here: they are a real TypeScript AST pass
 * over the project's import graph (relative imports, re-exports, shared prop
 * aliases, simulation-owned roots, keyed list items), and a second regex
 * approximation living in this file would disagree with the editor's panels
 * about the same source — which is worse than no rule. The pass itself is
 * pure (`(code, file) => diagnostics`, `typescript` + `node:fs` and nothing
 * else), so nothing about reusing it needs a server or a session.
 *
 * The mapping is read from the project's own `tsconfig.json` instead of
 * hardcoding a path because it is exactly what the scaffolder rewrites per
 * dependency mode: an in-checkout project points at the engine checkout's
 * `packages/editor/src`, an installed one at
 * `node_modules/@volter/editor-core/src` (the published package ships `src/`).
 * Reading the alias means one code path serves both without knowing which.
 * A node_modules target uses Node's package resolution as a fallback so the
 * same mapping also works when a workspace manager hoists the package.
 *
 * Returns null when the analyzer genuinely cannot be reached. E9 reports that
 * as a finding of its own rather than passing silently — a floor rule that
 * disappears when its instrument is missing reads as a clean bill of health,
 * which is the one thing an analyzer must never produce.
 */
function resolveEditorModule(relative: string): string | null {
  const tsconfig = join(rootDir, 'tsconfig.json');
  if (!existsSync(tsconfig)) return null;
  let mapped: string;
  try {
    const raw = readFileSync(tsconfig, 'utf-8');
    // Deliberately a text match, not JSON.parse: tsconfigs legitimately carry
    // comments, and this needs one string out of a known key.
    const alias = raw.match(/"@editor\/\*"\s*:\s*\[\s*"([^"]+)"/);
    if (!alias) return null;
    const baseUrl = raw.match(/"baseUrl"\s*:\s*"([^"]+)"/)?.[1] ?? '.';
    const aliasTarget = alias[1]!.replace('*', relative);
    mapped = resolve(rootDir, baseUrl, aliasTarget);
    if (!existsSync(mapped)) {
      const nodeModulesMarker = 'node_modules/';
      const normalizedTarget = aliasTarget.replaceAll('\\', '/');
      const markerIndex = normalizedTarget.lastIndexOf(nodeModulesMarker);
      if (markerIndex < 0) return null;
      const packageTarget = normalizedTarget.slice(markerIndex + nodeModulesMarker.length);
      mapped = createRequire(join(rootDir, 'package.json')).resolve(packageTarget);
    }
  } catch {
    return null;
  }
  return existsSync(mapped) ? mapped : null;
}

function loadR3fAnalyzer(): R3fAnalyzer | null {
  const mapped = resolveEditorModule('ui-source/r3f-project-contracts.ts');
  if (!mapped) return null;
  try {
    const loaded = createRequire(import.meta.url)(mapped) as {
      r3fAuthoringDiagnostics?: unknown;
    };
    return typeof loaded.r3fAuthoringDiagnostics === 'function'
      ? (loaded.r3fAuthoringDiagnostics as R3fAnalyzer)
      : null;
  } catch {
    return null;
  }
}

/**
 * WHICH files the R3F floor applies to: the ones this project's own `three`
 * REGION owns. The analyzer stopped guessing that from a file's text — a
 * project that centralizes its `@react-three/fiber` imports had almost every
 * component silently skipped and reported as clean — so the answer comes from
 * the same resolver the editor uses: the manifest's roots, the adapter's
 * `include` globs, and this project's own import edges.
 *
 * Null means the resolver could not be reached, which E9 reports as a finding
 * of its own rather than analyzing nothing and calling it a pass.
 */
interface RegionSurfaces {
  surfaces: ReadonlyMap<string, string>;
  /** This project's `vgai.adapter.ts` declares a `regions` binding the static
   *  reader could not evaluate, so its `include` globs were not consulted.
   *  Carried rather than dropped: the editor's own loader EVALUATES that module
   *  and would honor those globs, so silence here means the two readers
   *  disagree with nobody told. */
  includesUnreadable: boolean;
}

function loadRegionSurfaces(): RegionSurfaces | null {
  const mapped = resolveEditorModule('asset-workflow/project-content.ts');
  if (!mapped) return null;
  try {
    const loaded = createRequire(import.meta.url)(mapped) as {
      projectFileSurfaces?: unknown;
      projectRegionEntriesFromSources?: unknown;
    };
    if (
      typeof loaded.projectFileSurfaces !== 'function' ||
      typeof loaded.projectRegionEntriesFromSources !== 'function'
    ) {
      return null;
    }
    const read = (name: string): string => {
      try {
        return readFileSync(join(rootDir, name), 'utf-8');
      } catch {
        return '';
      }
    };
    const { regions, unreadable } = (
      loaded.projectRegionEntriesFromSources as (
        m: string,
        a: string,
      ) => { regions: unknown[]; unreadable: boolean }
    )(read('vgai.project.json'), read('vgai.adapter.ts'));
    const sources = srcFiles.map((file) => ({
      path: relPath(file),
      source: readFileSync(file, 'utf-8'),
    }));
    const surfaces = (
      loaded.projectFileSurfaces as (
        files: unknown[],
        regions: unknown[],
      ) => ReadonlyMap<string, string>
    )(sources, regions);
    return { surfaces, includesUnreadable: unreadable };
  } catch {
    return null;
  }
}

function checkAuthoringWarnings(): void {
  const analyze = loadR3fAnalyzer();
  if (!analyze) {
    // Silent for a folder that is not a vgai project at all — this scanner
    // is pointed at scratch directories by its own tests and by curious
    // agents, and a rule about a missing tsconfig mapping is a rule about a
    // project. Inside a real project the mapping is scaffolded, so its
    // absence is worth saying out loud rather than passing quietly.
    if (!existsSync(join(rootDir, 'vgai.project.json'))) return;
    addProjectFinding(
      'E9',
      'warn',
      'authoring-warnings-zero',
      'the R3F authoring analyzer could not be loaded, so authoring warnings were NOT checked — this run says nothing about them. It resolves through this project\'s tsconfig.json "@editor/*" path mapping.',
      'Restore the "@editor/*" mapping in tsconfig.json (it points at the engine checkout, or at node_modules/@volter/editor-core/src) and re-run. `npm run vgai -- status` reports the same counts from the live editor meanwhile.',
    );
    return;
  }

  const resolved = loadRegionSurfaces();
  if (!resolved) {
    if (!existsSync(join(rootDir, 'vgai.project.json'))) return;
    addProjectFinding(
      'E9',
      'warn',
      'authoring-warnings-zero',
      "the region resolver could not be loaded, so no file could be attributed to this project's `three` region and authoring warnings were NOT checked — this run says nothing about them.",
      'Restore the "@editor/*" mapping in tsconfig.json (it points at the engine checkout, or at node_modules/@volter/editor-core/src) and re-run. `npm run vgai -- status` reports the same counts from the live editor meanwhile.',
    );
    return;
  }
  const { surfaces } = resolved;
  if (resolved.includesUnreadable) {
    addProjectFinding(
      'E9',
      'warn',
      'authoring-warnings-zero',
      "vgai.adapter.ts declares a `regions` binding that cannot be read statically, so its `include` globs were NOT consulted — any file those globs place is missing from this run, while the editor's own loader still honors them.",
      'Write the regions as an array of object literals passed directly to defineAdapter({…}), with literal `id` and `include` values (not a hoisted const, not a spread).',
    );
  }

  const found: { file: string; diagnostic: R3fDiagnostic }[] = [];
  for (const file of srcFiles) {
    // The rules are about R3F source and would misfire on a `<div>`-rooted
    // component (R3F002 would tell it to forward `position`), so a file the
    // three region does not own is not analyzed. That is the resolver's call,
    // never this file's reading of the source.
    if (surfaces.get(relPath(file)) !== 'three') continue;
    let diagnostics: R3fDiagnostic[];
    try {
      diagnostics = analyze(readFileSync(file, 'utf-8'), resolve(file), {
        knownThreeSurface: true,
      });
    } catch {
      continue; // an unparseable file is tsc's finding to report, not this one
    }
    for (const diagnostic of diagnostics) found.push({ file, diagnostic });
  }
  if (found.length === 0) return;

  const fix =
    'Fix each one at its callsite — the R3F00x codes are the named-nodes half of the required floor: a named prefab with a story (.agents/references/project-manual.md). R3F004 wants an ordinary `name` prop, R3F002 wants the ThreeElements transform props forwarded to the one native root, R3F003 wants a single wrapping group, R3F005 wants runtime motion on an inner child. `idioms-ignore E9 <reason>` is the escape when a code is genuinely wrong about your source.';

  if (floorSeverity() === 'warn') {
    const codes = [...new Set(found.map((f) => f.diagnostic.code))].sort();
    const files = [...new Set(found.map((f) => f.file))];
    addProjectFinding(
      'E9',
      'warn',
      'authoring-warnings-zero',
      `${found.length} R3F authoring warning(s) across ${files.length} file(s) — ${codes
        .map((code) => `${code}×${found.filter((f) => f.diagnostic.code === code).length}`)
        .join(
          ', ',
        )}. Normal mid-build; the required floor is ZERO at handoff — the operator reads this count in every live playtest.`,
      fix,
    );
    return;
  }

  for (const { file, diagnostic } of found) {
    const { rawLines } = readFileText(file);
    addFinding(
      file,
      rawLines,
      diagnostic.line,
      'E9',
      'error',
      'authoring-warnings-zero',
      `${diagnostic.code}: ${diagnostic.message} Authoring warnings are ZERO at handoff — the required floor: a named prefab with a story (.agents/references/project-manual.md).`,
      fix,
    );
  }
}

// ---------------------------------------------------------------------------
// E10 — every shipped prefab has a colocated story
// ---------------------------------------------------------------------------

/**
 * `src/prefabs/` and nothing wider, on purpose.
 *
 * The editor does NOT discover prefabs by path — a component becomes a
 * Content-tab prefab when a portable story names it as `meta.component`
 * (`AssetBrowser.tsx`), and that is deliberate: source shape alone cannot
 * tell a reusable prefab from scene composition or an implementation detail.
 * So there is exactly one place in a project where a file DECLARES itself a
 * shipped prefab without a story already existing, and it is this folder —
 * the scaffold's own prefab home and the path the 3D-asset floor names
 * (`src/prefabs/<Name>.tsx`). Widening the scan to `src/components/` or
 * `src/lib/` would demand stories from HUD connectors, dev-tools widgets and
 * singleton world entities that were never prefabs, which is how a floor rule
 * becomes noise nobody clears.
 *
 * The other direction matters just as much: residence in this folder is a
 * CLAIM. A prefab is what a designer STAMPS — selects, places, duplicates as
 * one piece, transform at the call site. If E10 fires on a file nobody would
 * stamp (a sky dome, a scene atmosphere, a one-per-scene singleton, dev
 * scenery), the finding is a MISCLASSIFICATION: move the file to
 * `src/components/` (environment infrastructure) or its lib — do NOT write a
 * story. A story for a non-placeable registers noise into the Content
 * palette, and clearing this rule with hollow stories is the exact failure
 * it exists to prevent (found live 2026-08-13: a project cleared three E10
 * findings by registering unused scaffold scenery into its palette).
 */
const PREFAB_DIR = 'src/prefabs/';
const STORY_EXTENSIONS = ['.stories.tsx', '.stories.ts', '.stories.jsx', '.stories.js'] as const;

function prefabModules(): string[] {
  return srcFiles.filter((file) => {
    const rel = relPath(file);
    return (
      rel.startsWith(PREFAB_DIR) &&
      (rel.endsWith('.tsx') || rel.endsWith('.jsx')) &&
      !STORY_EXTENSIONS.some((extension) => rel.endsWith(extension))
    );
  });
}

function prefabStory(file: string): string | undefined {
  const name = basename(file).replace(/\.[jt]sx$/, '');
  return STORY_EXTENSIONS.map((extension) => join(dirname(file), `${name}${extension}`)).find(
    (candidate) => existsSync(candidate),
  );
}

function hasRegisteredWorldPrefab(): boolean {
  return prefabModules().some((file) => {
    const name = basename(file).replace(/\.[jt]sx$/, '');
    const story = prefabStory(file);
    return (
      story !== undefined &&
      new RegExp(`\\bcomponent\\s*:\\s*${name}\\b`).test(readFileText(story).blanked)
    );
  });
}

/** The line a prefab's own component is declared on — the honest place to
 *  report, and the line an `idioms-ignore E10 <reason>` belongs on. */
function componentDeclarationLine(blanked: string, name: string): number {
  const declaration = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|class)\\s+${name}\\b`,
  ).exec(blanked);
  return declaration ? lineNumberAt(blanked, declaration.index) : 1;
}

function checkPrefabStories(): void {
  const prefabs = prefabModules();

  for (const file of prefabs) {
    const name = basename(file).replace(/\.[jt]sx$/, '');
    const story = prefabStory(file);
    const { rawLines, blanked } = readFileText(file);
    const line = componentDeclarationLine(blanked, name);
    if (!story) {
      addFinding(
        file,
        rawLines,
        line,
        'E10',
        'error',
        'prefab-ships-a-story',
        `${name} is a shipped prefab with no colocated story — the required floor: a named prefab with a story (.agents/references/project-manual.md). Without one it is invisible to the editor's Content tab, which is where a designer finds, previews and places it.`,
        `Add ${relPath(file).replace(/\.[jt]sx$/, '.stories.tsx')} with \`component: ${name}\` in its \`meta\` — copy src/prefabs/HeroBox.stories.tsx and rename. If this module is not a shipped prefab, it does not belong in ${PREFAB_DIR}.`,
      );
      continue;
    }
    // The story IS the Content-tab registration only when its `meta` names
    // the component; a copy-pasted story still pointing at its source
    // component registers that one twice and this one not at all.
    if (!new RegExp(`\\bcomponent\\s*:\\s*${name}\\b`).test(readFileText(story).blanked)) {
      addFinding(
        file,
        rawLines,
        line,
        'E10',
        'error',
        'prefab-ships-a-story',
        `${relPath(story)} does not name ${name} as its \`meta.component\`, so ${name} is still unregistered — the story IS the Content-tab registration.`,
        `Set \`component: ${name}\` in that story's \`meta\`.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// W10 — a Three game should not silently lose the prefab architecture
// ---------------------------------------------------------------------------

function manifestHasThreeRoot(): boolean {
  const manifestPath = join(rootDir, 'vgai.project.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      roots?: Array<{ adapter?: unknown }>;
    };
    return (manifest.roots ?? []).some((root) => root.adapter === 'three');
  } catch {
    return false;
  }
}

function checkThreeProjectHasPrefab(): void {
  if (!manifestHasThreeRoot() || hasRegisteredWorldPrefab()) return;
  addProjectFinding(
    'W10',
    'warn',
    'three-project-has-prefab',
    'this project declares a Three root but has no correctly story-backed prefab. Deleting the starter subject must not silently collapse independently placeable entities into scenery or a scene monolith.',
    'For each object a designer should place, duplicate, or reuse as one piece, create src/prefabs/<Name>.tsx and a colocated story with `meta.component: <Name>`; keep owned construction pieces inside that prefab. If the world is genuinely fully procedural or every entity is simulation-owned, record that judgment in DEVLOG.md and suppress W10 with a reason in the relevant source.',
  );
}

// ---------------------------------------------------------------------------
// E11 — scenes/ contains scenes, not things merely used by scenes
// ---------------------------------------------------------------------------

const SCENE_DIR = 'src/scenes/';

function checkSceneFolderContract(): void {
  const sceneFiles = allFiles.filter((file) => relPath(file).startsWith(SCENE_DIR));
  for (const file of sceneFiles) {
    const rel = relPath(file);
    if (STORY_EXTENSIONS.some((extension) => rel.endsWith(extension))) {
      addFinding(
        file,
        readFileText(file).rawLines,
        1,
        'E11',
        'error',
        'scene-folder-means-scene',
        `${rel} is a story under ${SCENE_DIR}, but complete scenes are compositions, not Content prefabs.`,
        `Remove the Content story. If the component is independently placeable, move the component and its story to src/prefabs/ instead.`,
      );
      continue;
    }
    if (!(rel.endsWith('.tsx') || rel.endsWith('.jsx'))) {
      addFinding(
        file,
        readFileText(file).rawLines,
        1,
        'E11',
        'error',
        'scene-folder-means-scene',
        `${rel} is support code under ${SCENE_DIR}, but that folder contains only complete JSX scene compositions.`,
        `Move this module to src/components/ by concern. If it has no runtime component, use the nearest owning src/lib/ or src/data/ module instead.`,
      );
      continue;
    }
    const sceneName = basename(file).replace(/\.[jt]sx$/, '');
    const { rawLines, blanked } = readFileText(file);
    if (!sceneName.endsWith('Scene')) {
      addFinding(
        file,
        rawLines,
        1,
        'E11',
        'error',
        'scene-folder-means-scene',
        `${rel} does not name a complete *Scene component. A file used by a scene is not therefore a scene.`,
        `Move non-placeable support to src/components/ by concern. If this is the complete composition, rename it to <Name>Scene.tsx.`,
      );
      continue;
    }
    const declaresScene = new RegExp(
      `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|class)\\s+${sceneName}\\b`,
    ).test(blanked);
    if (!declaresScene) {
      addFinding(
        file,
        rawLines,
        1,
        'E11',
        'error',
        'scene-folder-means-scene',
        `${rel} is named like a scene but does not export ${sceneName}. The folder and filename must identify the actual complete composition, not disguise a helper.`,
        `Export the complete composition as ${sceneName}, or move this support module to src/components/ by concern.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

checkPlaywrightImports();
checkPackageJsonScripts();
checkNoTestFurniture();
checkWindowVgai();
checkBotParam();
checkPollingPump();
checkColyseusStaticImport();
checkTriggerNameIdentity();
checkPlayedBeforeAuthoring();
checkUseFramePriority();
checkDeterminismRng();
checkUnconfiguredProjectTools();
checkAuthoringWarnings();
checkPrefabStories();
checkThreeProjectHasPrefab();
checkSceneFolderContract();

const errorFindings = findings.filter((f) => f.severity === 'error');
const warnFindings = findings.filter((f) => f.severity === 'warn');

/**
 * Leave the findings where a READER can find them before handoff.
 *
 * Measured failure: a blind probe ran `typecheck` seven times and this scanner
 * once, at minute 19, which turned every open finding into an end-of-build
 * scramble. `vgai status` — the command an agent polls constantly — reads this
 * file and surfaces the open ERROR findings as an advisory count, so they are
 * visible from the first status call while THIS script stays the gate.
 *
 * Machine-local and gitignored; best effort, because a scanner must not fail
 * on an unwritable cache directory.
 */
function writeFindingsRecord(): void {
  try {
    mkdirSync(join(rootDir, '.vgai'), { recursive: true });
    writeFileSync(
      join(rootDir, '.vgai', 'check-idioms.json'),
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          findings: findings.map((f) => ({
            rule: f.rule,
            idiom: f.idiom,
            severity: f.severity,
            file: f.file,
            line: f.line,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } catch {
    // See this function's doc comment.
  }
}

writeFindingsRecord();

function formatFinding(f: Finding): string {
  const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
  return `  ${where}  [${f.severity.toUpperCase()}] ${f.rule} (${f.idiom})\n      ${f.message}\n      fix: ${f.fix}`;
}

if (findings.length === 0) {
  console.log(`check-idioms: ${rootDir} — clean, 0 findings across ${codeFiles.length} file(s).`);
  process.exit(0);
}

if (errorFindings.length > 0) {
  console.error(`check-idioms: ${errorFindings.length} ERROR finding(s):\n`);
  for (const f of errorFindings) console.error(formatFinding(f));
}

if (warnFindings.length > 0) {
  console.error(
    `\ncheck-idioms: ${warnFindings.length} WARN finding(s)${strict ? ' (promoted to errors by --strict)' : ' (not failing without --strict)'}:\n`,
  );
  for (const f of warnFindings) console.error(formatFinding(f));
}

console.error(`\nSee IDIOMS.md for the full checklist these rules cover.`);

const failed = errorFindings.length > 0 || (strict && warnFindings.length > 0);
process.exit(failed ? 1 : 0);
