/**
 * One reader for "did the EDITOR SERVER answer this, and what did it say?"
 *
 * ## Why `response.ok` is not that question
 *
 * Every editor route lives under `/__editor/*` on the same origin as the
 * editor page. When no editor server is in front of that origin — a static
 * preview of `dist/`, a misconfigured deployment — the host still answers:
 * with the SPA FALLBACK, which is `200 OK` and
 * `text/html`. So `response.ok` is TRUE for a request nothing handled.
 *
 * That turned into two different fabrications, depending on what the caller did
 * next:
 *
 *  - callers that PARSED died inside `res.json()` on `Unexpected token '<'`, an
 *    error naming neither the route nor the cause, usually into a bare `catch`
 *    that returned an empty value the UI then reported as a fact about the
 *    project ("No project tools registered", "no portable CSF previews");
 *  - callers that did NOT parse — a POST whose only interest is "did it work?"
 *    — read the fallback as SUCCESS. Marking a generation job read, forgetting
 *    one, reconciling providers: each reported done, having reached nothing.
 *
 * The second is the worse half, and it is invisible: there is no exception to
 * catch, so the only symptom is state that never actually changed.
 *
 * ## The rule
 *
 * A response is from the editor server when its content type is JSON. Every
 * `/__editor/*` route answers JSON — including its FAILURES, which carry
 * `{ error }` — while the page fallback never does, so the check has no false
 * negatives to trade against. Callers that already guard the REALM
 * (`getEditorMode()`) still use this: the realm guard says "don't ask", this
 * says "that answer isn't ours", and a deployment can put a page fallback in
 * front of a mode the client believes is served.
 *
 * The header's question is really two, so there are two entry points:
 *
 *  - {@link assertEditorServerAnswered} — "did the editor server answer this?"
 *    alone, for the many callers that then read the server's OWN `{ error }`
 *    body on a non-OK status. Asserting `ok` for them would replace a real,
 *    user-facing server message ("Insufficient credits") with a bare status
 *    code, so they get the fallback check and keep their own status handling.
 *  - {@link assertEditorServerResponse} / {@link editorServerJson} — answered
 *    AND OK, for callers with no interest in the failure body.
 */

/** The single sentence a page-fallback answer gets, so the reader is sent to
 *  the host rather than to their own project. */
function fallbackMessage(what: string, contentType: string): string {
  return (
    `${what}: this origin answered with its page fallback (${contentType || 'no content-type'}) ` +
    'rather than JSON, so no editor server handled the request.'
  );
}

/**
 * Throw unless `response` came from the editor server AT ALL — ignoring its
 * status, which is the caller's own business.
 *
 * For callers that read the route's `{ error }` body on failure: run this
 * BEFORE `response.json()`, so a page fallback reports itself instead of dying
 * as `Unexpected token '<'` in the parse.
 */
export function assertEditorServerAnswered(response: Response, what: string): void {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(fallbackMessage(what, contentType));
  }
}

/**
 * Throw unless `response` really came from the editor server AND succeeded.
 *
 * For callers whose only question is whether the call took effect (POST/DELETE
 * routes with no interesting body).
 */
export function assertEditorServerResponse(response: Response, what: string): void {
  if (!response.ok) throw new Error(`${what} (${response.status}).`);
  assertEditorServerAnswered(response, what);
}

/** {@link assertEditorServerResponse}, then the parsed body. */
export async function editorServerJson<T>(response: Response, what: string): Promise<T> {
  assertEditorServerResponse(response, what);
  return (await response.json()) as T;
}
