/**
 * The module→`Object3D` step, IN THE BROWSER — the live twin of the bake
 * lane's Node-side `module-source.ts`
 * (`catalog/project-source/src/tools/module-source.ts`), and deliberately the
 * SAME contract: a project TypeScript module whose export builds a native
 * `THREE.Object3D`. `project.bake.module` / `project.bake.preview` /
 * `vgai screenshot <module>` already define that contract; the live modeling
 * document opens the same thing, so a module that bakes opens, and a module
 * that opens bakes (docs/BLENDER-PARITY.md §The model file).
 *
 * TWO HALVES, ONE CONTRACT. Node imports a `file://` url and has no GPU; the
 * browser imports the dev server's `/@fs/` url and IS the GPU. Nothing else
 * differs, which is why this file re-states the resolution rather than
 * importing the tool's copy: that copy is `host: 'node'` capability source
 * (`node:fs/promises`, `node:url`) that a project's own tsconfig excludes from
 * its browser build. Sharing the module would drag Node into the editor
 * bundle; sharing the CONTRACT is what matters, and the contract is small
 * enough to be stated twice and obviously identical.
 *
 * DETECTION IS STRUCTURAL, not a filename convention — the quarks precedent
 * (`components/asset-viewers/JsonAssetDocument.tsx`: three.quarks names no
 * extension of its own, so the file's own structure is what says whether it is
 * a particle document). There is no `.model.ts`: a project `.ts`/`.tsx`
 * whose export RESOLVES to an `Object3D` is a model module, and everything
 * else falls back to the ordinary source viewer.
 */

import { liveModuleImportUrl } from '@volter/editor-sdk/session/project-module-url';
import type * as THREE from 'three';

/** Why this module is not a live model module — the sentence the document
 *  shows, and the reason it fell back to the source viewer. */
export type LiveModuleRefusal =
  /** Nothing importable at all: a syntax error, a throwing top level, a
   *  missing dependency. The one refusal that is USUALLY a defect in a module
   *  that WAS a model module a moment ago, which is why the document keeps its
   *  last good root on screen for it. */
  | { readonly kind: 'import-failed'; readonly message: string; readonly stack?: string }
  /** It imported fine, it is simply not a model module. */
  | { readonly kind: 'not-a-model'; readonly message: string };

export interface LiveModuleBuild {
  readonly root: THREE.Object3D;
  /** Which export produced it — `default`, or the single named export. */
  readonly exportName: string;
  /** The BUILDER's own teardown, when the export returned a build result that
   *  carried one. The document runs it in place of the generic graph dispose:
   *  a rig holds mixers, actions and materials a `traverse` walk cannot see. */
  readonly dispose?: () => void;
}

export class LiveModuleError extends Error {
  constructor(readonly refusal: LiveModuleRefusal) {
    super(refusal.message);
    this.name = 'LiveModuleError';
  }
}

/** The module-namespace keys that are never a candidate export. */
function candidateExportNames(namespace: Record<string, unknown>): string[] {
  return Object.keys(namespace).filter(
    (name) => name !== '__esModule' && name !== 'Symbol.toStringTag',
  );
}

function isObject3D(value: unknown): value is THREE.Object3D {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isObject3D?: unknown }).isObject3D === true
  );
}

/**
 * Pick the export this module offers as its subject, matching the bake lane's
 * `exportName` default: the DEFAULT export, or — when there is no default —
 * the single named export. Two named exports and no default is ambiguous and
 * refuses by name rather than guessing; the bake verbs make the caller say
 * which one, and a document has nobody to ask.
 */
export function pickLiveModuleExport(
  namespace: Record<string, unknown>,
): { readonly name: string; readonly value: unknown } | LiveModuleRefusal {
  if ('default' in namespace) return { name: 'default', value: namespace['default'] };
  const named = candidateExportNames(namespace);
  if (named.length === 0) {
    return { kind: 'not-a-model', message: 'This module exports nothing.' };
  }
  if (named.length > 1) {
    return {
      kind: 'not-a-model',
      message:
        `This module has no default export and ${named.length} named exports ` +
        `(${named.join(', ')}), so there is no single subject to build. A model module ` +
        'default-exports its builder.',
    };
  }
  return { name: named[0]!, value: namespace[named[0]!] };
}

/**
 * THE TWO SHAPES A MODEL MODULE MAY PRODUCE — the same pair the Node twin
 * normalizes (`catalog/project-source/src/tools/module-source.ts`'s
 * `asModuleBuild`), because a module that bakes must open and a module that
 * opens must bake:
 *
 * 1. a bare `THREE.Object3D`;
 * 2. a BUILD RESULT `{ root, animations?, dispose? }` — what every parametric
 *    lib in the kit returns (`createBird`'s `BirdBuild` and its descendants),
 *    and what `bakeObject3DSource`'s `build` callback has always taken.
 *
 * `animations` is written onto `root.animations`, three's own carrier for a
 * model's clips — so the clip list travels with the graph the document mounts
 * and every reader downstream (the Object3D document session, its animation
 * transport) finds it where it finds a GLTF's.
 */
function asLiveModuleBuild(
  built: unknown,
): { root: THREE.Object3D; dispose?: () => void } | undefined {
  if (isObject3D(built)) return { root: built };
  if (!built || typeof built !== 'object') return undefined;
  const result = built as { root?: unknown; animations?: unknown; dispose?: unknown };
  if (!isObject3D(result.root)) return undefined;
  const root = result.root;
  if (Array.isArray(result.animations) && root.animations.length === 0) {
    root.animations = result.animations as THREE.AnimationClip[];
  }
  return {
    root,
    ...(typeof result.dispose === 'function'
      ? { dispose: () => (result.dispose as () => void).call(built) }
      : {}),
  };
}

/** What the export returned, for a refusal that can be acted on — `object`
 *  alone cannot tell a build result with a mistyped key from a wrong value. */
function describeReturn(built: unknown): string {
  if (built === undefined) return 'undefined';
  if (built === null) return 'null';
  if (typeof built !== 'object') return typeof built;
  if (Array.isArray(built)) return 'an array';
  const keys = Object.keys(built);
  return keys.length > 0
    ? `an object with keys ${keys.slice(0, 8).join(', ')}`
    : 'an object with no own keys';
}

const ACCEPTED_SHAPES =
  'a model module returns a THREE.Object3D, or a build result ' +
  '`{ root, animations?, dispose? }` whose `root` is one.';

/**
 * Resolve a picked export to an `Object3D`. A FUNCTION is called (its result
 * may be a promise — the bake lane awaits it too); a VALUE is taken as-is, so
 * `export default new THREE.Group()` is as legitimate a model module as
 * `export default () => …`.
 */
export async function resolveLiveModuleExport(
  name: string,
  value: unknown,
): Promise<LiveModuleBuild | LiveModuleRefusal> {
  const direct = asLiveModuleBuild(value);
  if (direct) return { ...direct, exportName: name };
  if (typeof value !== 'function') {
    return {
      kind: 'not-a-model',
      message:
        `Export '${name}' is ${describeReturn(value)}, not a function and not a model — ` +
        ACCEPTED_SHAPES,
    };
  }
  let built: unknown;
  try {
    built = await (value as () => unknown)();
  } catch (error) {
    return {
      kind: 'import-failed',
      message: `Export '${name}' threw while building: ${messageOf(error)}`,
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    };
  }
  const build = asLiveModuleBuild(built);
  if (!build) {
    return {
      kind: 'not-a-model',
      message: `Export '${name}' ran but returned ${describeReturn(built)} — ${ACCEPTED_SHAPES}`,
    };
  }
  return { ...build, exportName: name };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Import `modulePath` from the dev server and build its `Object3D`.
 *
 * `revision` is the document's rebuild counter — see
 * {@link liveModuleImportUrl} for why the url carries it and why that is only
 * half the freshness story.
 *
 * Throws {@link LiveModuleError}; the `refusal.kind` is what the caller routes
 * on (`not-a-model` falls back to the source viewer, `import-failed` keeps the
 * last good root and shows the failure).
 */
export async function buildLiveModuleObject3D(
  projectRoot: string,
  modulePath: string,
  revision: number,
): Promise<LiveModuleBuild> {
  let namespace: Record<string, unknown>;
  try {
    namespace = (await import(
      /* @vite-ignore */ liveModuleImportUrl(projectRoot, modulePath, revision)
    )) as Record<string, unknown>;
  } catch (error) {
    throw new LiveModuleError({
      kind: 'import-failed',
      message: messageOf(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    });
  }
  const picked = pickLiveModuleExport(namespace);
  if ('kind' in picked) throw new LiveModuleError(picked);
  const resolved = await resolveLiveModuleExport(picked.name, picked.value);
  if ('kind' in resolved) throw new LiveModuleError(resolved);
  return resolved;
}
