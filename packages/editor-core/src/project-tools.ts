import type { ProjectToolCatalog } from '@volter/editor-sdk/project-tool-catalog';
import { connectToolFileEvents } from './asset-events';
import { editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';
import { onProjectChange } from './project-manager';

export type {
  ProjectToolCatalog,
  ProjectToolCatalogEntry,
  ProjectToolContribution,
  ToolContributionPoint,
} from '@volter/editor-sdk/project-tool-catalog';

export type ProjectToolOutcome =
  | {
      ok: true;
      data: unknown;
      generation?: import('@volter/editor-sdk/generations').GenerationJob;
      generationWarning?: string;
    }
  | { ok: false; error: { code: string; message: string; data?: unknown; issues?: unknown[] } };

const EMPTY_CATALOG: ProjectToolCatalog = { tools: [], contributions: [], loadErrors: [] };
let catalog = EMPTY_CATALOG;
let version = 0;
const listeners = new Set<() => void>();

function publish(next: ProjectToolCatalog): void {
  catalog = next;
  version++;
  for (const listener of listeners) listener();
}

export function getProjectTools(): ProjectToolCatalog {
  return catalog;
}

export function projectToolsVersion(): number {
  return version;
}

export function subscribeProjectTools(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshProjectTools(): Promise<ProjectToolCatalog> {
  try {
    const response = await fetch('/__editor/project-tools');
    const next = await editorServerJson<ProjectToolCatalog>(response, 'Catalog request failed');
    publish(next);
    return next;
  } catch (error) {
    const next = {
      tools: [],
      contributions: [],
      loadErrors: [
        {
          sourcePath: 'package.json#vgai.tools',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
    publish(next);
    return next;
  }
}

export async function runProjectTool(
  name: string,
  input: unknown,
  options: { confirm?: boolean } = {},
): Promise<ProjectToolOutcome> {
  const response = await fetch('/__editor/project-tools/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, input, confirm: options.confirm === true }),
  });
  // Named BEFORE parsing. A host with no editor server answers this POST with
  // its page fallback, and `res.json()` on HTML throws `Unexpected token '<'` —
  // an error that names neither the tool nor the reason, surfacing to the user
  // as a broken tool rather than a host that never ran one.
  const outcome = await editorServerJson<ProjectToolOutcome>(
    response,
    `Running the project tool ${JSON.stringify(name)} failed`,
  );
  if (!outcome || typeof outcome !== 'object' || typeof outcome.ok !== 'boolean') {
    throw new Error(`Tool request returned an invalid response (${response.status}).`);
  }
  return outcome;
}

/** Editor-init lifecycle for the Node-side registered tool catalog. */
export function startProjectToolCatalog(): () => void {
  void refreshProjectTools();
  const stopProjectWatch = onProjectChange(() => void refreshProjectTools());
  const stopFileWatch = connectToolFileEvents(() => void refreshProjectTools());
  return () => {
    stopProjectWatch();
    stopFileWatch();
  };
}

export function __resetProjectToolsForTest(): void {
  catalog = EMPTY_CATALOG;
  version = 0;
  listeners.clear();
}
