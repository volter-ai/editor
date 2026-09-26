/**
 * Manifest-backed project detection for the play path — T3.3 slice 2 part C.
 *
 * The dev server serves the project's RAW `vgai.project.json` at `/vgai.project.json`
 * (editor-server.ts's project-file-serving middleware, mirroring how it
 * with no view synthesis — the browser parses it itself through the PURE half
 * of the manifest loader (`loadGameManifest`,
 * `@volter/editor-project/manifest/load`), never `load-file.ts` (that needs `node:fs`, which
 * has no place in a browser bundle).
 */

import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { loadGameManifest, type ResolvedGameManifest } from '@volter/editor-project/manifest/load';
import { servedUrl } from '@volter/editor-sdk/kit/served-url';

/**
 * "This project has no manifest" — a DIFFERENT answer from "this project's
 * manifest could not be read", and the reason {@link fetchGameManifest} needs
 * two rejections rather than one.
 *
 * A caller that cannot tell them apart has only one safe move: swallow both.
 * `ingest/mount-ingest-root.ts`'s three manifest routes did exactly that
 * (`.catch(() => null)` each), so a project declaring a perfectly good
 * `{ ingest }` root in a manifest the strict loader REJECTED — one
 * unrecognized key is enough, the schema is `.strict()` — was declined by
 * every route and mounted NOTHING, with not one line anywhere saying why.
 *
 * Recognized by `name`, not `instanceof`: this classification must survive a
 * caller holding a different module instance of this file, and a wrong answer
 * there is a silent mount, not a loud one.
 */
export const MANIFEST_ABSENT_ERROR_NAME = 'ManifestAbsentError';

/** True for the rejection {@link fetchGameManifest} uses to say "no manifest
 *  here" — see {@link MANIFEST_ABSENT_ERROR_NAME}. */
export function isManifestAbsence(error: unknown): boolean {
  return error instanceof Error && error.name === MANIFEST_ABSENT_ERROR_NAME;
}

function manifestAbsent(where: string): Error {
  const error = new Error(`${where} declares no ${MANIFEST_FILENAME}`);
  error.name = MANIFEST_ABSENT_ERROR_NAME;
  return error;
}

/**
 * Fetch + parse the current project's sole v2 config from the session that
 * serves it. Both failures are loud; ABSENCE is the one that is also
 * classifiable ({@link isManifestAbsence}).
 */
export async function fetchGameManifest(): Promise<ResolvedGameManifest> {
  const url = servedUrl('/vgai.project.json');
  const res = await fetch(url);
  if (res.status === 404) throw manifestAbsent(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  // A 404 is not the only way this route says "no manifest": a dev server with
  // an SPA fallback answers an unknown path with index.html and a 200, which
  // `res.json()` reports as `Unexpected token '<'` — an unreadable manifest,
  // when the truth is that there is none. `fetchRawGameManifest` below has
  // made the same distinction the same way since it was written.
  const body = await res.text();
  if (/^\s*</.test(body)) throw manifestAbsent(url);
  try {
    return loadGameManifest(JSON.parse(body), { configurationKinds: 'defer' });
  } catch (error) {
    throw new Error(
      `Failed to load ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * A1 (edit mode, defect 2): fetch the RAW, UN-validated `vgai.project.json` JSON
 * — or `null` when the project genuinely has none (the route 404s). Unlike
 * {@link fetchGameManifest}, this NEVER throws on a schema violation: edit mode
 * must tolerate a manifest with ONE bad world (e.g. an unknown `kind`) by
 * surfacing that world as an error node (#18) while the VALID roots declared
 * alongside it still open — strict `loadGameManifest` would reject the whole
 * file and make every declared world vanish. The caller (`edit-mode-authoring
 * .ts`) reads `roots[]` leniently; a genuinely absent manifest (this returns
 * `null`) is the only case that synthesizes a single-world game.
 */
export async function fetchRawGameManifest(): Promise<unknown | null> {
  const url = servedUrl('/vgai.project.json');
  const res = await fetch(url);
  if (!res.ok) return null;
  // A 404 is not the only way this route says "no manifest". A dev server with
  // an SPA fallback answers an unknown path with index.html and a **200**, so
  // `res.ok` passes and `res.json()` throws `Unexpected token '<', "<!DOCTYPE
  // "... is not valid JSON` — from a function whose whole contract is to return
  // `null` when there is no manifest. That throw escapes into callers that
  // only ever guarded against `null`: it aborted `tryManifestIngestRoute2D`
  // before it could look at the roots at all, so a perfectly well-formed
  // `{ ingest }` world silently fell through to the default-pixi path and
  // failed to mount, reporting the JSON error as the mount's cause with no
  // hint of which fetch produced it.
  const body = await res.text();
  if (/^\s*</.test(body)) return null; // HTML fallback === no manifest here
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    // A genuinely malformed manifest is NOT absence — say so, and say where.
    throw new Error(
      `${url} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
