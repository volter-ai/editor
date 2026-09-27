/**
 * Editor project bootstrap: detect the open project before the editor builds
 * anything.
 */

import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { detectServerProject, getCurrentProject } from './project-manager';

/**
 * Resolves once the boot-time project bootstrap has SETTLED (either outcome).
 *
 * The gate is OPEN until {@link bootstrapProject} arms it (`_projectBootstrap`
 * starts resolved), and that is deliberate: a closed-until-armed initial value
 * has no non-hanging form — nothing can prove a bootstrap will ever arrive, so
 * any caller in a context that never boots the editor would wait forever.
 * The safety comes from an ordering invariant one level up instead:
 * `EditorProvider` calls `bootstrapProject()` in its RENDER BODY, so every
 * descendant lifecycle — Play's binding on the store's arrival, the `?play=1`
 * autoplay effect, `connectCommandListener`'s `vgai play` relay — observes an
 * already-armed gate, and `DefaultEditorLayout` additionally SUSPENDS on the
 * same promise via `use(useEditorInit())`. Moving that call into a `useEffect`
 * would break this silently (effects run child-first), which is why the
 * invariant is pinned by `test/editor-boot-gate-arming.test.tsx`.
 */
export function projectBootstrapSettled(): Promise<void> {
  return _projectBootstrap;
}

let _projectBootstrap: Promise<void> = Promise.resolve();

/**
 * The editor's boot-time project bootstrap: detect the project.
 * Tracked by `projectBootstrapSettled()` so play-mode (and any
 * other caller that must not observe a half-booted editor) can await it.
 *
 * Settlement tracker only — this caller still observes its OWN failure through
 * the returned promise (same convention as play-mode's `_enterQueue`).
 */
export function bootstrapProject(): Promise<void> {
  const run = bootstrapProjectInner();
  _projectBootstrap = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function bootstrapProjectInner(): Promise<void> {
  await initProject();
}

/** Detect the active project and log the result.
 *
 * The only fallback detection left is ASKING THE SESSION: a local
 * editor server holds which project is open, so there is nothing else to
 * consult. This used to read `getProjectPathFromURL()` first, which on the
 * HOSTED build handed an example ID to `openProject()` as if it were a
 * filesystem path — reachable only if AppRoot had not already resolved the
 * project, which is why it never bit. Both halves are gone with the param.
 */
export async function initProject(): Promise<void> {
  // If the project manager already has a project (AppRoot resolved one),
  // just log it and return — no need to re-detect.
  const existing = getCurrentProject();
  if (existing) {
    editorConsole.log(`Opened project: ${existing.config.name}`, 'project');
    return;
  }

  // Hosted has no server to ask; AppRoot's `detectProject` owns that surface.

  try {
    const project = await detectServerProject();
    if (project) {
      editorConsole.log(`Opened project: ${project.config.name}`, 'project');
    }
  } catch {
    // No server project — run without a project
  }
}
