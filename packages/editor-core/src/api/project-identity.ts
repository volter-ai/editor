/**
 * `/__editor/compatibility` — WHICH Node process is serving this editor, and
 * whether its source is still the source it started with.
 *
 * Every other call in `api/` assumes the answer is stable for the page's
 * lifetime; `requireEditorCompatibility` is what turns "the server moved
 * underneath us" into a loud error instead of a confusing one later.
 */

import {
  assertEditorCompatibility,
  type EditorServerCompatibility,
  editorServerUnavailableError,
  missingCompatibilityError,
} from '@volter/editor-sdk/session/editor-compatibility';
import { assertEditorServerResponse } from '@volter/editor-sdk/kit/editor-server-response';
import { BASE } from '@volter/editor-sdk/kit/api-base';

function parseEditorCompatibility(value: unknown): EditorServerCompatibility | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<EditorServerCompatibility>;
  if (
    candidate.apiVersion !== 1 ||
    (typeof candidate.engineVersion !== 'string' && candidate.engineVersion !== null) ||
    typeof candidate.manifestVersion !== 'number' ||
    typeof candidate.startedAt !== 'string' ||
    !candidate.source ||
    (candidate.source.state !== 'current' && candidate.source.state !== 'restart-required')
  ) {
    return null;
  }
  if (
    candidate.source.state === 'restart-required' &&
    (typeof candidate.source.changedPath !== 'string' ||
      typeof candidate.source.changedAt !== 'string')
  ) {
    return null;
  }
  return candidate as EditorServerCompatibility;
}

/** Read the immutable identity of the local Node process serving this editor. */
export async function getEditorCompatibility(): Promise<EditorServerCompatibility | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/compatibility`, { cache: 'no-store' });
  } catch (error) {
    throw editorServerUnavailableError(error instanceof Error ? error.message : String(error));
  }
  if (res.status >= 500) throw editorServerUnavailableError(`HTTP ${res.status}`);
  try {
    // This route's own copy of the page-fallback discrimination predates
    // `editor-server-response.ts`; the reader now owns it. `null` (not a throw)
    // stays the answer for "no editor server here" — that is the whole question
    // this probe exists to ask, and `requireEditorCompatibility` turns it into
    // the named `missingCompatibilityError()`.
    assertEditorServerResponse(res, `GET ${BASE}/compatibility`);
  } catch {
    return null;
  }
  try {
    return parseEditorCompatibility(await res.json());
  } catch {
    return null;
  }
}

/** Require a current handshake before any operation that activates a project. */
export async function requireEditorCompatibility(): Promise<EditorServerCompatibility> {
  const identity = await getEditorCompatibility();
  if (!identity) throw missingCompatibilityError();
  assertEditorCompatibility(identity);
  return identity;
}
