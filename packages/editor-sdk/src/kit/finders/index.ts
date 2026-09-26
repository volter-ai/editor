/**
 * THE FINDER NAMESPACE — host-owned discovery algorithms an adapter SELECTS.
 *
 * ARCHITECTURE-CORE §The editor protocol, "Zero inference": what zero
 * inference forbids is the ENGINE running a finder nobody selected. A
 * convention (`src/scenes/`, a story registration) is legitimate exactly when
 * it is an adapter's declared finder parameter, and illegitimate as implicit
 * engine behavior.
 *
 * That is enforced MECHANICALLY, not by policy: everything under this
 * directory has exactly ONE sanctioned importer — the editor's adapter loader
 * (`packages/editor/src/project-adapter.ts`) — and
 * `packages/engine/test/finder-import-boundary.test.ts` fails by name when any
 * other engine/editor file imports it. Do not add a second importer; make the
 * loader answer instead.
 *
 * Dependency direction is one-way: finders import their parameter types from
 * `../adapter-module`, and `adapter-module.ts` imports nothing from here. That
 * is what keeps a game's `vgai.adapter.ts` free of finder implementations.
 */

import {
  EXPORTED_COMPOSITION_REGIONS,
  type FinderSelection,
  type ScenesFromEntrypointSelectionParams,
} from '@volter/editor-project/adapter/adapter-module';
import type { FinderResult } from '@volter/editor-project/adapter/finders/finder-result';
import { registerFinder, runRegisteredFinder } from '@volter/editor-project/adapter/finders/registry';
import { type ZodType, z } from 'zod';
import {
  type ScenesFromEntrypointSelectionInput,
  scenesFromEntrypointSelection,
} from './scenes-from-entrypoint-selection';

export type { FinderResult } from '@volter/editor-project/adapter/finders/finder-result';
export type {
  FinderContribution,
  FinderRegistration,
} from '@volter/editor-project/adapter/finders/registry';
export {
  registerContributedFinder,
  registeredFinderNames,
  registerFinder,
  runRegisteredFinder,
} from '@volter/editor-project/adapter/finders/registry';
export type {
  EntrypointSource,
  ScenesFromEntrypointSelectionInput,
} from './scenes-from-entrypoint-selection';
export { scenesFromEntrypointSelection } from './scenes-from-entrypoint-selection';

/** Everything any shipped finder can be handed, gathered once by the loader. */
/** A project source the host read for a selection's `include` globs. */
export interface ProjectSourceFile {
  /** Project-relative path. */
  readonly path: string;
  readonly source: string;
}

/** One entry of the host's project component index. */
export interface ProjectComponentRef {
  readonly name: string;
  /** Project-relative source path of the component's own module. */
  readonly path: string;
  /** Region this component's surface belongs to, when the host knows it. */
  readonly region?: string | null;
}

export type FinderInput = ScenesFromEntrypointSelectionInput & {
  /**
   * The project's component index — what a finder joins its own discovery
   * against (a prefab's source path and region).
   *
   * There is deliberately no `stories` here. `prefabsFromStories` used to be
   * an engine finder whose story registrations the EDITOR filled, which is how
   * the editor's adapter loader came to import the story registry and, through
   * it, Storybook. It is a registered finder that reads its own ledger now
   * (`packages/editor/src/stories/prefabs-finder.ts`): a finder's data arrives
   * with the finder.
   */
  readonly components?: readonly ProjectComponentRef[];
  /** The sources matching every selection's `include` globs — empty when
   *  no selection declares any. A contributed finder reads the project
   *  through this and {@link FinderInput.files} and nothing else. */
  readonly sources?: readonly ProjectSourceFile[];
  /**
   * The PATHS matching those same globs — every one of them, including the
   * files `sources` has no text for.
   *
   * A finder over BINARY documents needs this and could not use `sources`:
   * `@volter/editor-blender`'s `modelsFromBlendFiles` lists `.blend` files, and there
   * is nothing in a `.blend` a text walk could honestly read — the entry IS
   * the file. Handing it a decoded binary instead would have been the shim.
   */
  readonly files?: readonly string[];
};

/**
 * Run one adapter-declared selection. The switch is exhaustive over
 * {@link FinderSelection}: a new finder that forgets a case fails to COMPILE
 * here rather than silently contributing nothing.
 */
export function runFinderSelection(selection: FinderSelection, input: FinderInput): FinderResult {
  return runRegisteredFinder(selection, input);
}

// The engine's own finders register here, schemas beside them: what an
// adapter may select by name is exactly what this registry holds.
const ScenesFromEntrypointSelectionSchema = z
  .object({
    finder: z.literal('scenesFromEntrypointSelection'),
    regions: z
      .union([z.array(z.string().min(1)).min(1), z.literal(EXPORTED_COMPOSITION_REGIONS)])
      .describe('Region ids whose entrypoints carry the selection, or the rule form'),
    selection: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Identifier of the entrypoint's module-level scene selection table; omit for a " +
          'single-composition entrypoint',
      ),
  })
  .strict()
  .refine((value) => value.selection === undefined || Array.isArray(value.regions), {
    message:
      'scenesFromEntrypointSelection: `selection` names an identifier in ONE entrypoint’s ' +
      `source, so it cannot be paired with the \`${EXPORTED_COMPOSITION_REGIONS}\` rule — ` +
      'name the region explicitly (`regions: ["<rootId>"]`).',
  });
registerFinder<ScenesFromEntrypointSelectionParams, FinderInput>({
  name: 'scenesFromEntrypointSelection',
  schema:
    ScenesFromEntrypointSelectionSchema as unknown as ZodType<ScenesFromEntrypointSelectionParams>,
  run: scenesFromEntrypointSelection,
});
