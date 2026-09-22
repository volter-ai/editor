/**
 * Structural detection of a PASTEBOARD MODULE — an ordinary project `.tsx`
 * whose default export renders the pasteboard capability's `Pasteboard`
 * helper at its root (`src/lib/pasteboard/pasteboard.tsx` in the project,
 * marker `data-vgai-pasteboard`). Same doctrine as `LiveModuleDocument`'s
 * Object3D probe and the quarks JSON probe: detection is structural, never a
 * filename convention, so a project's freely edited copy of the helper keeps
 * working.
 *
 * The probe is a BARE UNWRAP, not a render: the default export is invoked as
 * a plain function and the returned element chain is followed by invoking
 * each function `type` until a host element appears, whose props either carry
 * the marker or do not. This keeps the probe free of react-dom and of the
 * two-React-copies trap (the editor's react-dom driving a project component
 * would crash on the project React's own hook dispatcher). The CONTRACT that
 * buys: the chain from the default export down to `<Pasteboard>` is hook-free
 * static composition — which a pasteboard is by design. Children BELOW the
 * Pasteboard root may do anything; the probe never descends past the first
 * host element. A chain that throws (hooks, wrong shape) is simply not a
 * pasteboard: the module falls back to the ordinary source viewer.
 */

import { liveModuleImportUrl } from '@volter/editor-sdk/session/project-module-url';

const PASTEBOARD_MARKER = 'data-vgai-pasteboard';

/** Follow a React element's function-component chain to its first host
 *  element and answer whether that element carries the pasteboard marker. */
export function isPasteboardElementTree(value: unknown): boolean {
  let current = value;
  for (let depth = 0; depth < 12; depth++) {
    if (!current || typeof current !== 'object') return false;
    const element = current as { type?: unknown; props?: Record<string, unknown> | null };
    if (typeof element.type === 'string') {
      return element.props?.[PASTEBOARD_MARKER] === 'true';
    }
    if (typeof element.type === 'function') {
      try {
        current = (element.type as (props: unknown) => unknown)(element.props ?? {});
      } catch {
        return false;
      }
      continue;
    }
    // memo/forwardRef/fragment wrappers are outside the static-composition
    // contract; an author who wants one keeps it below the Pasteboard root.
    return false;
  }
  return false;
}

/**
 * Import the module (same revisioned url the live-module probe uses, so the
 * two probes share one fetch) and answer whether its DEFAULT export is a
 * pasteboard component. Named exports are deliberately not considered — the
 * pasteboard contract is "the file IS the canvas", and a file whose canvas is
 * a side export has no one subject.
 */
export async function probePasteboardModule(
  projectRoot: string,
  modulePath: string,
  revision: number,
): Promise<boolean> {
  let namespace: Record<string, unknown>;
  try {
    namespace = (await import(
      /* @vite-ignore */ liveModuleImportUrl(projectRoot, modulePath, revision)
    )) as Record<string, unknown>;
  } catch {
    return false;
  }
  const candidate = namespace['default'];
  if (typeof candidate !== 'function') return false;
  let element: unknown;
  try {
    element = (candidate as (props: Record<string, unknown>) => unknown)({});
  } catch {
    return false;
  }
  return isPasteboardElementTree(element);
}
