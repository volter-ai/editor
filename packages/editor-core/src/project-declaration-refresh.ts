import { assignActiveProject, getCurrentProject, type ProjectConfig } from '@volter/editor-sdk/kit/active-project';
import { connectProjectDeclarationEvents } from './asset-events';
import { probeCurrentServerProject } from './editor-api';

/** Refresh declarations in the current session without reopening its project. */
export function startProjectDeclarationRefresh(): () => void {
  let revision = 0;
  const refresh = async (): Promise<void> => {
    const request = ++revision;
    const project = getCurrentProject();
    if (!project) return;
    try {
      const probe = await probeCurrentServerProject();
      // Invalid intermediate saves retain the last valid configuration;
      // validate-on-save owns their diagnostics.
      if (probe.status !== 'project' || probe.project.path !== project.rootPath) return;
      const config: ProjectConfig = probe.project.config as ProjectConfig;
      if (request !== revision || getCurrentProject() !== project) return;
      assignActiveProject({ ...project, config });
    } catch (error) {
      if (request === revision && getCurrentProject() === project) {
        console.error('[project] Could not refresh project declarations:', error);
      }
    }
  };
  const stop = connectProjectDeclarationEvents(() => void refresh());
  return () => {
    revision++;
    stop();
  };
}
