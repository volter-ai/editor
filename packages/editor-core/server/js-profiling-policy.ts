/**
 * `Document-Policy: js-profiling` — the permission the editor's own diagnostics
 * assume it already has.
 *
 * The `visible-tab-fps-floor` invariant tells the reader, by name, to "find the
 * cost with the Profiler's Overview (long-animation-frame attribution)"
 * (`coverage/ontology-invariants.ts`). But `new Profiler(...)` in the editor
 * page throws `NotAllowedError: JS profiling is disabled by Document Policy`:
 * the JS Self-Profiling API is gated on a policy the DOCUMENT's own response
 * has to grant, and no editor server was sending it. The product printed an
 * instruction its own page forbade.
 *
 * A document policy is granted by the response that created the document, so
 * this is a response header or it is nothing — there is no client-side way to
 * turn it on. It is set on EVERY response rather than on a sniffed subset:
 * the header is meaningless on a subresource (browsers read it only when
 * creating a document), the editor serves its index through three different
 * paths (`express.static`, the SPA `sendFile` fallback, and Vite's own HTML
 * middleware in dev), and a heuristic that tried to name "the document one"
 * would silently miss whichever path a future change routed through. Blanket
 * is the version that cannot be quietly wrong.
 *
 * It also reaches the game's own frame this way, which is the point: a game
 * mounted in a child document is exactly what the reader is profiling.
 */

/** The header name and value, together, so a test names them once. */
export const JS_PROFILING_POLICY_HEADER = 'Document-Policy';
export const JS_PROFILING_POLICY_VALUE = 'js-profiling';

interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

/**
 * Express middleware granting {@link JS_PROFILING_POLICY_VALUE} to every
 * document this server creates.
 *
 * Typed against the narrowest shape it uses (`setHeader`) so the unit test can
 * drive it without an HTTP server, and so both editor hosts can mount it
 * without agreeing on an express version.
 */
export function jsProfilingPolicy(): (
  request: unknown,
  response: HeaderSink,
  next: () => void,
) => void {
  return (_request, response, next) => {
    response.setHeader(JS_PROFILING_POLICY_HEADER, JS_PROFILING_POLICY_VALUE);
    next();
  };
}
