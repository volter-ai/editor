/**
 * THE one owner of "is this a development context". Every reader that has to
 * answer that question calls {@link devBuildEnabled}; there is deliberately NO
 * second source of truth — not a module-level cached boolean, not a
 * `globalThis` flag, not a per-host copy of the `import.meta.env` read below.
 * Instrumentation that ships to players because two places disagreed about
 * what "dev" means is exactly the failure this single owner exists to make
 * impossible.
 *
 * Ownership, stated in one place (the build rule):
 *  - OWNER: this function. It resolves the answer; nothing else derives it.
 *  - SHARERS: the three-root adapter (`world3d-react/r3f-root-factory.tsx`),
 *    which seeds live render vitals only
 *    under it, and the `static-batch` capability's mutation watch and `Frozen`
 *    warning. Any future dev-only instrument calls this too, with its own
 *    `override`.
 *  - TEARDOWN: none. This is a pure predicate over build config and one
 *    caller-supplied argument — it owns no resource, allocates nothing, and
 *    has no lifecycle to end.
 *
 * The three inputs, highest precedence first:
 *  1. `override` — the explicit per-call answer. A headless test, a capture
 *     harness, or a host that knows better passes `true`/`false` and gets
 *     exactly that. Passing `undefined` (or omitting it) means "decide for
 *     me" and falls through. The editor's own preview mount is the worked
 *     case: it is a dev session by definition even when the editor SPA it
 *     runs inside is a production build.
 *  2. A dev build — `import.meta.env.DEV`. The ordinary local/editor case.
 *  3. A production build's EXPLICIT opt-in — `VITE_VGAI_DEV_BUILD=true`.
 *     Instrumenting a production bundle is a real, legitimate choice (an
 *     internal playtest build, a QA build), and it must be an opt-in someone
 *     had to type, never something a default drifts into.
 *
 * Anything else — a production build with no opt-in — is `false`.
 */
export function devBuildEnabled(override?: boolean | undefined): boolean {
  if (override !== undefined) return override;
  // `import.meta` is cast whole, not just its `.env`: this module is reachable
  // from programs whose tsconfig does not pull in `vite/client` (the session
  // client's, for one, which reaches the three adapter transitively), and there
  // `ImportMeta` has no declared `env` at all. The cast keeps the single owner
  // of the dev answer importable from ANY program rather than forcing every
  // downstream tsconfig to adopt Vite's ambient types.
  const env = (import.meta as unknown as { env?: unknown }).env as
    | { DEV?: boolean | undefined; VITE_VGAI_DEV_BUILD?: string | undefined }
    | undefined;
  if (env?.DEV === true) return true;
  return env?.VITE_VGAI_DEV_BUILD === 'true';
}
