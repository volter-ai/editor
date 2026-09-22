/**
 * The manifest's SOLE INTERPRETER (owner ruling, 2026-08-20 — see
 * docs/ARCHITECTURE-CORE.md §adapter). `vgai.project.json` is static
 * inventory; the adapter seam is the ONE layer that turns it into execution
 * bindings, and host code consumes the manifest through THESE derivations —
 * never by reading `manifest.roots` directly (the guard is
 * `packages/engine/test/manifest-sole-interpreter.test.ts`).
 *
 * Why a doorway and not a convention: one deriver means one direction of
 * truth (manifest → adapter → host). When the project's own `vgai.adapter.ts`
 * later interposes on a derivation, every host path that asked the
 * interpreter gets the project's answer for free; a path that read the raw
 * field would silently keep the mechanical one.
 *
 * The module-free audiences named by the ruling (a bundled CLI's raw
 * discovery over unvalidated files, Vite config time, synchronous
 * dep-optimization, and the loader that CONSTRUCTS the resolution) remain
 * direct readers by design; everything else asks here.
 *
 * These functions are pure and synchronous over an already-loaded manifest —
 * interpreting inventory never evaluates project modules, so any host realm
 * may import this. They are structurally generic so both the loader's
 * `ResolvedGameManifest` and the editor's lenient `EditModeManifest` view
 * flow through the same doorway.
 */

/**
 * The declared adapter roots, in mount order (the loader already sorted by
 * `zOrder`, ties by declaration order). This is the mount plan, the readiness
 * roster, and the enumeration every other derivation composes from.
 */
export function declaredRoots<Root>(manifest: {
  readonly roots: readonly Root[];
}): readonly Root[] {
  return manifest.roots;
}

/** The root declaring `id`, or undefined — never a silent first-wins pick. */
export function rootById<Root extends { readonly id: string }>(
  manifest: { readonly roots: readonly Root[] },
  id: string,
): Root | undefined {
  return manifest.roots.find((root) => root.id === id);
}

/** Whether any declared root mounts on `surface` (e.g. the editor's
 *  "does this project have a Three world" gates). The parameter is the closed
 *  surface union, not `string` — a typo'd literal must stay a compile error,
 *  not a silent forever-false. */
export function hasRootOnSurface(
  manifest: { readonly roots: readonly { readonly surface: string }[] },
  surface: 'three' | 'canvas' | 'dom',
): boolean {
  return manifest.roots.some((root) => root.surface === surface);
}

/** The declared ingest roots (`adapter.type === 'ingest'`), in mount order.
 *  Composite-manifest rules (exactly one, ≥2 is a loud named error) belong to
 *  the call sites that state them. */
export function ingestRoots<
  Root extends { readonly adapter: { readonly type: string } },
>(manifest: { readonly roots: readonly Root[] }): Root[] {
  return manifest.roots.filter((root) => root.adapter.type === 'ingest');
}
