/**
 * WORK THAT FINISHES AFTER A FRAME WAS APPLIED, announced.
 *
 * A presented frame is not the last change to what the presenter draws: a
 * PNG decodes after the frame that named it, a clone's sampler uploads after
 * that decode, a sky is derived on a worker, the area-light tables load on
 * demand, and a graph's program swaps in once `compileAsync` links it. A
 * stage that draws only when something changed (`BlenderRuntimeView.onChange`)
 * needs every one of those to say so, or the viewport holds the picture from
 * before it -- an untextured mesh, a missing sky -- until something else
 * happens to move. Each such completion calls {@link presenterChanged}.
 */
const listeners = new Set<() => void>();

export function presenterChanged(): void {
  for (const listener of [...listeners]) listener();
}

export function onPresenterChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
