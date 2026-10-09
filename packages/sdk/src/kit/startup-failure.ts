/**
 * A TERMINAL STARTUP FAILURE, as the FRAME needs it: the product's loading
 * cover (`volterCover.ts`, z-index above every part) sits over the whole
 * editor while it opens, so an error screen drawn beneath it is seen by
 * nobody. Measured on the owner's stream 2026-10-06: a pinned-engine refusal
 * rendered under the cover while it said "Starting Blender…" with a moving bar
 * forever. So whoever decides that startup failed publishes it here, and the
 * bridge hands it to the cover (`mountEditor`'s `startup` door), which replaces
 * its splash with the message and its fix.
 *
 * ANY PART OF THE BOOT PUBLISHES, not only AppRoot: a project that cannot be
 * detected, a page with no project, an editor surface that crashed, a Blender
 * worker that could not open the model. The newest failure is the one shown;
 * `clearStartupFailure(source)` withdraws only that source's, so a Retry that
 * cures one cause does not hide another.
 *
 * ONE REGISTRY PER PAGE, whichever copy of this module a contribution loaded
 * it through (the packaged shell inlines the SDK while a package's
 * contribution is served from the project's own copy), hence the
 * `Symbol.for` key, as `document-play-extension.ts` does.
 */
export interface StartupFailureNotice {
  readonly message: string;
  readonly guidance: string | null;
  /** The recovery to paste, one command per line (`commandSequence`), when it has one. */
  readonly command: string | null;
  /**
   * STILL TRYING, not refused: a slow start that may yet succeed (detection that keeps being
   * re-asked). The cover shows it as progress under its splash, never as a refusal — a
   * refusal is one-way, and a healthy slow start called failed is the reverse of the silent
   * hang this door exists for (#147 review).
   */
  readonly transient?: boolean;
}

interface Registry {
  /** Live failures by source, oldest first; the last is the one shown. */
  readonly failures: Map<string, StartupFailureNotice>;
  readonly listeners: Set<(notice: StartupFailureNotice | null) => void>;
}

const key = Symbol.for('volter.startup-failure');
const page = globalThis as typeof globalThis & { [key]?: Registry };
const registry: Registry = page[key] ??= { failures: new Map(), listeners: new Set() };

/** The newest refusal, else the newest still-trying notice: a refusal is the stronger fact. */
function current(): StartupFailureNotice | null {
  const all = [...registry.failures.values()];
  return all.filter((notice) => !notice.transient).at(-1) ?? all.at(-1) ?? null;
}

function publish(): void {
  const notice = current();
  for (const listener of [...registry.listeners]) {
    try { listener(notice); } catch { /* A reader's failure is not the boot's. */ }
  }
}

/** This page's boot failed for `source`'s reason; the cover shows it at once. */
export function reportStartupFailure(source: string, notice: StartupFailureNotice): void {
  registry.failures.delete(source);
  registry.failures.set(source, notice);
  publish();
}

/** `source`'s failure is over (a Retry got past it). Other sources' stand. */
export function clearStartupFailure(source: string): void {
  if (registry.failures.delete(source)) publish();
}

/** Hear this page's startup failure — at once if one is standing — and `null`
 *  when the last one clears. */
export function subscribeStartupFailure(
  listener: (notice: StartupFailureNotice | null) => void,
): () => void {
  registry.listeners.add(listener);
  const notice = current();
  if (notice) listener(notice);
  return () => { registry.listeners.delete(listener); };
}
