/**
 * "MATERIALIZE PASTEBOARD" (queue item 4): turn the UI board's DERIVED,
 * ephemeral auto-grid into an AUTHORED pasteboard `.tsx` — the one action the
 * ratified design names ("ephemeral auto-grid when no file; one action
 * materializes it"). The generated file is ordinary project source: it
 * imports each board story's OWNER COMPONENT and places it under `<At x y>`
 * at the position the auto-grid gave its frame, so the derived layout becomes
 * literals a drag can then rewrite. Nothing regenerates the file afterwards —
 * it is the project's, exactly like every `vgai add` copy.
 *
 * Refusals are loud and name their remedy: no open project, no storage, no
 * pasteboard helpers (`vgai add pasteboard`), a file already at the target
 * path, or a board with nothing on it. A story whose owner component cannot
 * be resolved to an importable export is SKIPPED BY NAME in the returned
 * sentence rather than emitting an import that does not compile.
 *
 * ## Why it is this package's
 *
 * Its subject is THE UI BOARD — the design-time surface `@vgai/dom` registers
 * a mount for (`design-time-react-mount.ts`, unit 12) — and it reads that
 * board's own frame placements. It stayed a host file only because its one
 * caller was a host `action-registry.ts` row; the action POINT
 * (`@vgai/editor-sdk/chrome`, `workspace.action`) is what that row becomes,
 * and `contributions/pasteboard.action.ts` is the row now. Unit 12's header
 * called this file "NOT the dom lane's" on the strength of that caller; the
 * caller is what moved (WORK.md §The open-source launch item 17, the edge map
 * in `scripts/validate-editor-closure.mjs`).
 */

import { listProjectComponents } from '@editor/api/assets';
import type { ProjectComponentEntry } from '@editor/asset-workflow/project-content';
import { reactStoryBoardFramePlacements } from '@editor/authoring/react-story-board';
import { getProjectPreviewStories } from '@editor/stories/story-registry';
import { domStoryBoardMembers } from '@editor/stories/three-story-model';
import { createProjectSourceFile } from '@editor/ui-source/source-write-backend';

export const PASTEBOARD_HELPERS_PATH = 'src/lib/pasteboard/pasteboard.tsx';
export const MATERIALIZED_PASTEBOARD_PATH = 'src/design/pasteboard.tsx';

/** The story's owner-module convention: `Hud.stories.tsx` → `Hud.tsx`. */
function storyOwnerModulePath(storyModulePath: string): string {
  return storyModulePath.replace(/\.stories(?=\.[^.]+$)/, '');
}

/** Relative import specifier from `src/design/` to a project-relative path. */
function importSpecifierFromDesign(componentPath: string): string {
  const withoutExtension = componentPath.replace(/\.[cm]?[jt]sx?$/, '');
  return `../${withoutExtension.replace(/^src\//, '')}`;
}

function componentForOwnerModule(
  components: readonly ProjectComponentEntry[],
  ownerModulePath: string,
): ProjectComponentEntry | null {
  const inModule = components.filter(
    (entry) => entry.path === ownerModulePath && (entry.exported || entry.defaultExport),
  );
  return (
    inModule.find((entry) => entry.defaultExport) ?? (inModule.length === 1 ? inModule[0]! : null)
  );
}

export async function materializePasteboard(): Promise<string> {
  const helpers = await fetch('/__ui-source/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: PASTEBOARD_HELPERS_PATH }),
  });
  if (!helpers.ok) {
    throw new Error(
      `Materialize pasteboard needs the pasteboard helpers at ${PASTEBOARD_HELPERS_PATH} — ` +
        'run `vgai add pasteboard` first.',
    );
  }
  const layer = document.querySelector<HTMLElement>('[data-vgai-react-story-board="true"]');
  const placements = reactStoryBoardFramePlacements(layer);
  if (!placements || placements.length === 0) {
    throw new Error(
      'Materialize pasteboard reads the live UI board and it has no frames — open the UI ' +
        'document (a project with dom stories) first.',
    );
  }
  const stories = domStoryBoardMembers(getProjectPreviewStories());
  const listing = await listProjectComponents();
  const components = listing.ok ? listing.entries : [];
  const placed: Array<{ importLine: string; name: string; x: number; y: number }> = [];
  const skipped: string[] = [];
  const importsBySpecifier = new Map<string, string>();
  for (const placement of placements) {
    const story = stories.find((candidate) => candidate.id === placement.storyId);
    if (!story) continue;
    const owner = storyOwnerModulePath(story.modulePath);
    const component = componentForOwnerModule(components, owner);
    if (!component) {
      skipped.push(story.label ?? story.id);
      continue;
    }
    const specifier = importSpecifierFromDesign(component.path);
    const importLine = component.defaultExport
      ? `import ${component.name} from '${specifier}';`
      : `import { ${component.name} } from '${specifier}';`;
    importsBySpecifier.set(specifier, importLine);
    placed.push({ importLine, name: component.name, x: placement.x, y: placement.y });
  }
  if (placed.length === 0) {
    throw new Error(
      'Materialize pasteboard resolved no importable owner component for any board frame ' +
        `(skipped: ${skipped.join(', ') || 'none'}). A story's owner module must export the ` +
        'component its frames render.',
    );
  }
  const width = Math.max(...placed.map((entry) => entry.x)) + 960;
  const height = Math.max(...placed.map((entry) => entry.y)) + 720;
  const body = placed
    .map(
      (entry) => `      <At x={${entry.x}} y={${entry.y}}>\n        <${entry.name} />\n      </At>`,
    )
    .join('\n');
  const code = `${[...importsBySpecifier.values()].sort().join('\n')}
import { At, Pasteboard } from '../lib/pasteboard/pasteboard';

/**
 * Materialized from the UI board's derived auto-grid — this file is now the
 * AUTHORED canvas: edit freely, and a drag in the editor writes each At's
 * x/y literals right here.
 */
export default function DesignPasteboard() {
  return (
    <Pasteboard width={${width}} height={${height}}>
${body}
    </Pasteboard>
  );
}
`;
  const created = await createProjectSourceFile(MATERIALIZED_PASTEBOARD_PATH, code);
  if (!created.created) {
    throw new Error(
      created.error ??
        `${MATERIALIZED_PASTEBOARD_PATH} already exists — the pasteboard is already authored; ` +
          'edit it directly (there is deliberately no regeneration).',
    );
  }
  // The AssetBrowser owns asset-open routing; the event is its documented door.
  window.dispatchEvent(
    new CustomEvent('editor:open-project-asset', {
      detail: { path: MATERIALIZED_PASTEBOARD_PATH, kind: 'source' },
    }),
  );
  return (
    `Materialized ${placed.length} frame(s) into ${MATERIALIZED_PASTEBOARD_PATH}` +
    (skipped.length > 0 ? ` (skipped, no importable owner component: ${skipped.join(', ')})` : '')
  );
}
