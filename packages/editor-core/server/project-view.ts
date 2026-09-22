/** Server-side editor view of the single v2 project configuration. */

import { hasRootOnSurface } from '@volter/editor-project/adapter/manifest-interpreter';
import { loadGameManifestDir } from '@volter/editor-project/manifest/load-file';
import { ensureProjectConfigurationKinds } from './project-kinds';
import { errorsFor } from './project-validation';

export type ProjectView = Record<string, unknown>;

export type ProjectViewResult = { ok: true; view: ProjectView } | { ok: false; error: string };

/**
 * Read `vgai.project.json`, keeping the REASON a read failed.
 *
 * Boot routing needs that reason: a server serving a project whose manifest it
 * cannot read is not the same thing as a server with no project open, and
 * collapsing the two is what dropped the editor page onto the launcher for a
 * project the server was — and still is — serving. There is no fallback config
 * file; a missing or invalid manifest is still not a loadable project, it is
 * just a loud one.
 *
 * The reason is rendered by `project-validation.ts`'s `errorsFor` — the same
 * `path.to.field: message` form the watcher's terminal/console/`vgai status`
 * legs already print — because this string is read by people and by agents:
 * the editor's startup-error screen, `vgai sessions`, and `@vgai/live`'s
 * refusal all quote it. A bare `ZodError.message` is a pretty-printed JSON
 * array of issue objects; it contains the failing key and hides it.
 */
export async function readProjectViewResult(root: string): Promise<ProjectViewResult> {
  try {
    const kindErrors = await ensureProjectConfigurationKinds(root);
    if (kindErrors.length > 0) return { ok: false, error: kindErrors.join('\n') };
    const manifest = loadGameManifestDir(root);
    return {
      ok: true,
      view: {
        ...manifest,
        hasThreeRoot: hasRootOnSurface(manifest, 'three'),
        rootCount: manifest.roots.length,
      },
    };
  } catch (error) {
    return { ok: false, error: errorsFor(error).join('\n') };
  }
}

/** The view, or null when it could not be read. See `readProjectViewResult`
 *  when the caller must be able to say WHY. */
export async function readProjectView(root: string): Promise<ProjectView | null> {
  const result = await readProjectViewResult(root);
  return result.ok ? result.view : null;
}
