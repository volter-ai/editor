/**
 * `screenshot [<target>]` — target classification, kept pure. Transferred
 * from vgai's `packages/vgai-cli/src/screenshot-target.ts`, narrowed to the
 * readings the project guides teach.
 *
 *   (none)              what the session is showing: the running game while
 *                       play runs, otherwise the active document
 *   hero.glb            a model file — the Asset Lab contact sheet / shot set
 *   src/models/tree.ts  a project module — built headlessly, then photographed
 *   diner-sign          anything else: a live entity, framed where it stands
 *
 * Classification is EXTENSION-FIRST and lives here, away from the I/O. Disk
 * resolution is separate ({@link resolveModelTarget}) and takes its `exists`
 * probe as an argument for the same reason.
 */
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Extensions the Asset Lab's own loader parses. A target with one of these
 *  is a MODEL target whether or not the bytes load — the editor names a
 *  corrupt file. */
export const MODEL_TARGET_EXTENSIONS = ['.glb', '.gltf', '.spz'] as const;

/** Project module extensions `project.bake.preview` can import. */
const MODULE_TARGET_EXTENSIONS = ['.ts', '.tsx'] as const;

export type ScreenshotTargetClass =
  | { lane: 'session' }
  | { lane: 'model'; path: string }
  | { lane: 'module'; path: string }
  | { lane: 'entity'; entityId: string };

const endsWithAny = (value: string, suffixes: readonly string[]): boolean => {
  const lower = value.toLowerCase();
  return suffixes.some((suffix) => lower.endsWith(suffix));
};

/** Route one target string. Pure: no disk, no session, no cwd. */
export function classifyScreenshotTarget(target: string | undefined): ScreenshotTargetClass {
  if (target === undefined || target === '') return { lane: 'session' };
  if (endsWithAny(target, MODEL_TARGET_EXTENSIONS)) return { lane: 'model', path: target };
  if (endsWithAny(target, MODULE_TARGET_EXTENSIONS)) return { lane: 'module', path: target };
  return { lane: 'entity', entityId: target };
}

export interface ModelTargetResolution {
  /** The file on disk the target names. */
  file: string;
  /** The same-origin path the editor loads it from (`/models/hero.glb`). */
  assetPath: string;
}

/**
 * Turn a model target into the file it names and the served path the Asset
 * Lab fetches it from. Two readings: an ordinary path (resolved against the
 * cwd), and the SERVED path (`/models/generated/hero.glb` — project-root
 * absolute, `public/` stripped), tried only for a target starting with `/`.
 * Every reading tried is named in the failure.
 */
export function resolveModelTarget(
  target: string,
  options: { cwd: string; projectRoot: string | null; exists: (path: string) => boolean },
): ModelTargetResolution | { error: string } {
  const { cwd, projectRoot, exists } = options;
  const candidates: string[] = [resolve(cwd, target)];
  if (target.startsWith('/') && projectRoot) {
    candidates.push(join(projectRoot, target), join(projectRoot, 'public', target));
  }
  const file = candidates.find((candidate) => exists(candidate));
  if (file === undefined) {
    return {
      error:
        `no file at ${candidates.join(' or ')}.\n` +
        'A model target is a path on disk (or the served path the editor loads it from, ' +
        'e.g. /models/generated/hero.glb).',
    };
  }
  if (!projectRoot) {
    return {
      error:
        `${file} is not inside a project.\n` +
        'The editor loads models same-origin from the project it is serving; run this from inside the project.',
    };
  }
  const withinProject = relative(projectRoot, file);
  if (withinProject.startsWith('..') || isAbsolute(withinProject)) {
    return {
      error:
        `${file} is outside ${projectRoot}.\n` +
        'The editor loads models same-origin from the project it is serving; copy the model into the project first.',
    };
  }
  const served = `/${withinProject.split(/[\\/]/).join('/')}`.replace(/^\/public(\/|$)/, '/');
  return { file, assetPath: served };
}

/** One row of the live hierarchy as `status` reports it (`entities`). */
export interface EntityTargetRow {
  id?: string;
  name?: string;
}

/**
 * Turn an entity target into the id the relay speaks. An entity has two
 * public identities — its id and its authored name — and both are accepted. A
 * name several entities share is refused with their ids listed; `undefined`
 * rows (the editor never answered) pass the target through untouched.
 */
export function resolveEntityTarget(
  target: string,
  entities: ReadonlyArray<EntityTargetRow> | undefined,
): { entityId: string } | { error: string } {
  if (entities === undefined) return { entityId: target };
  if (entities.some((entity) => entity.id === target)) return { entityId: target };
  const byName = entities.filter((entity) => entity.name === target && entity.id !== undefined);
  if (byName.length === 1) return { entityId: byName[0]!.id as string };
  if (byName.length > 1) {
    return {
      error:
        `'${target}' is the name of ${byName.length} entities — pass the id of the one you mean:\n` +
        byName.map((entity) => `  ${entity.id}`).join('\n'),
    };
  }
  return {
    error:
      `no entity named '${target}' in this scene, and no entity has that id.\n` +
      'A live-entity target is either the NAME or the id shown by `status` ' +
      '(a path ending .glb/.gltf/.spz or .ts/.tsx is read as a file target instead).',
  };
}

/** The refusal for a target that reads BOTH as a file and as a live entity. */
export function ambiguousTargetRefusal(target: string, file: string): string {
  return (
    `'${target}' is ambiguous — it names both a file on disk (${file}) and a live entity in this scene.\n` +
    `Disambiguate: pass a path that only reads as a file (./${target}), or rename the entity.`
  );
}
