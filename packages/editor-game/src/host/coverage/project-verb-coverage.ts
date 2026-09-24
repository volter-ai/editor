/**
 * THE `project.*` RULES — the pure half of `@volter/editor-game/coverage/live-project-verbs.ts`.
 *
 * ## The defect this closes
 *
 * Derived coverage had exactly two families, and both are pinned to an
 * INTERFACE: `editor.*` to `AuthoringAdapter`'s provider vocabulary
 * (`AUTHORING_PROVIDER_PRESENCE`) and `system.*` to `SystemAdapters`' slots.
 * That is what makes them exhaustive — of what an ADAPTER can be asked. Native
 * verbs like the export/build path are not an adapter's to answer at all,
 * because their subject is the PROJECT rather than a mounted root: whether
 * this project can produce the standalone build that is the ONLY way it runs
 * outside the editor.
 *
 * So a project could be green in both families and silently lack it, which
 * violates the standing rule that an unreached capability is an OPEN warning
 * and never silence.
 *
 * ## Every row is a real fact with a real reader
 *
 * Nothing here is a schema field invented for the report. Each rule reads
 * something the product itself already acts on:
 *
 *  - `export` reads what the export path ACTUALLY requires of a project, taken
 *    from the door's own source: `create-vgai-project/src/deploy.ts` runs
 *    `npm run build` in the project (`runProjectBuild`) and stages the `dist/`
 *    that emits (`stageBuildOutput`). Ingest roots pass that door because the
 *    ingest project's own build is already its standalone game; arbitrary
 *    module roots and unsupported built-ins remain a named refusal. These are
 *    static, manifest/package-readable preconditions; neither is a guess.
 *
 * Pure over its inputs, so the whole table is unit-testable with no browser and
 * no live session — same shape and same reason as
 * `coverage/system-adapter-coverage.ts`.
 */

import {
  PROJECT_VERB_SLOTS,
  type ProjectVerbMeasurement,
  type ProjectVerbSlot,
} from './capability-coverage';

/** One manifest root, in the terms the export door's wall reads. */
export interface ProjectRootFact {
  readonly id: string;
  /** `ResolvedAdapter['type']` — `builtin` | `module` | `ingest`. */
  readonly type: string;
  /** `ResolvedAdapter['identity']` — `three`/`dom`/`ingest-three`/… */
  readonly identity: string;
}

/** Everything the rules read. Every field arrives as data, and every `null`
 *  means NOBODY LOOKED — never "there is none". */
export interface ProjectVerbFacts {
  /**
   * The script names the project's `package.json` declares, `[]` when it has a
   * `package.json` with no scripts, and `null` when the question could not be
   * asked (a fetch that has not landed, no server).
   */
  readonly scripts: readonly string[] | null;
  /** Does the project have a `package.json` at all? `false` with `scripts: []`
   *  is a measured absence and reads differently from an empty scripts block. */
  readonly hasPackageJson: boolean;
  /** The manifest's roots as the export wall reads them; `null` ⇒ unasked. */
  readonly roots: readonly ProjectRootFact[] | null;
  /** Why the file-read facts above are `null`, in the fetcher's own words.
   *  Shown verbatim, so an unanswered row can never read as a clean one. */
  readonly unavailable: string | null;
}

/** The sentence an unanswered row prints. One place, so all three agree. */
function unanswered(
  slot: ProjectVerbMeasurement['slot'],
  why: string | null,
): ProjectVerbMeasurement {
  return {
    slot,
    state: 'unanswered',
    evidence:
      `nobody has read this project's own files yet, so ${slot} is unmeasured — ` +
      (why ?? 'the editor has not asked its dev server for them'),
  };
}

/** Is every root this project declares an ingest root? An ingest-only
 *  project's own build is already its standalone game, which changes what the
 *  export wall says about it. */
function ingestOnly(roots: readonly ProjectRootFact[]): boolean {
  return roots.length > 0 && roots.every((root) => root.type === 'ingest');
}

function exportVerb(facts: ProjectVerbFacts): ProjectVerbMeasurement {
  const { scripts, roots } = facts;
  if (scripts === null || roots === null) return unanswered('export', facts.unavailable);
  if (!scripts.includes('build')) {
    return {
      slot: 'export',
      state: 'absent',
      evidence: facts.hasPackageJson
        ? "this project's package.json declares no `build` script, and the export path runs " +
          '`npm run build` in the project and stages the `dist/` it emits'
        : 'this project has no package.json, so there is no `build` script for the export path to run',
      missing:
        'this project cannot produce a standalone build, so it runs NOWHERE but the editor — the ' +
        'dev-served standalone page refuses an unexported game outright',
      fix: "add the scaffold's `build` script (`build: tsc && vite build`), which is what every deploy path runs",
    };
  }
  const refused = roots.filter(
    (root) => root.type !== 'ingest' && (root.type !== 'builtin' || root.identity !== 'three'),
  );
  const wallLeg =
    refused.length > 0
      ? `; note that the legacy \`vgai deploy\` verb additionally refuses ${refused
          .map((root) => `root "${root.id}" (${root.identity})`)
          .join(
            ', ',
          )} — use the project-owned deploy scripts (\`vgai add deploy-cloudflare\`/\`deploy-vercel\`, then \`npm run deploy\`)`
      : '';
  const deployLeg = scripts.includes('deploy')
    ? ', and a `deploy` script to ship it'
    : ' (no `deploy` script yet — `vgai add deploy-cloudflare`/`deploy-vercel` adds one)';
  const ingestLeg = ingestOnly(roots)
    ? '; this ingest project ships the standalone bundle produced by its own build unchanged'
    : '';
  return {
    slot: 'export',
    state: 'present',
    evidence: `this project declares a \`build\` script, which is what the export path runs to emit the \`dist/\` it stages${deployLeg}${ingestLeg}${wallLeg}`,
  };
}

/**
 * The terminal state of every native verb for the OPEN PROJECT.
 *
 * Order is `PROJECT_VERB_SLOTS`, so two reports of the same project stay
 * diffable line for line — the same property the other two families have.
 */
export function measureProjectVerbs(facts: ProjectVerbFacts): readonly ProjectVerbMeasurement[] {
  // A `Record` keyed by the slot union, so a verb added to the vocabulary fails
  // to compile until it has a rule — the same compile pin the vocabulary itself
  // carries in `coverage/capability-coverage.ts`.
  const rules: Record<ProjectVerbSlot, (f: ProjectVerbFacts) => ProjectVerbMeasurement> = {
    export: exportVerb,
  };
  return PROJECT_VERB_SLOTS.map((slot) => rules[slot](facts));
}
