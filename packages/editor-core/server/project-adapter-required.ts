/**
 * A PRODUCT MAY REQUIRE A PROJECT'S ADAPTER.
 *
 * The adapter loader treats a project with no `editor/volter.adapter.ts` as the native default
 * (`@volter/sdk/kit/project-adapter`), and for many products that is a working state. A product
 * whose layout and document finders live in the adapter declares `volter.product.adapterRequired`:
 * opened on the default, its project would come up with none of them and nothing would say why.
 * Every door such a product starts a session through asks here first, and a folder without the
 * file is refused in one sentence that names the folder, the file and how to make a project.
 *
 * `product` is `null` where no product serves the project; nothing is asked of such a project.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILENAME } from '@volter/project/manifest/filename';
import { ADAPTER_MODULE_FILENAME } from '@volter/sdk/kit/adapter-module';
import { ProjectCompatibilityError } from '@volter/sdk/session/editor-compatibility';

interface AdapterRequirement {
  readonly name: string;
  readonly adapterRequired?: boolean;
}

export function assertProjectAdapter(projectRoot: string, product: AdapterRequirement | null): void {
  if (product === null || product.adapterRequired !== true) return;
  if (existsSync(join(projectRoot, ADAPTER_MODULE_FILENAME))) return;
  // A project made before 0.5.203 keeps its adapter at its root. It is a project, so it is told to upgrade (the
  // release's own `upgrade` moves the adapter and the kit's package names), never to make another.
  if (existsSync(join(projectRoot, 'volter.adapter.ts'))) {
    throw new ProjectCompatibilityError(
      `${projectRoot} keeps its adapter at its root (volter.adapter.ts), where projects made before 0.5.203 kept it; ` +
        `this editor reads ${ADAPTER_MODULE_FILENAME}.`,
      {
        kind: 'bring-project-up-to-date',
        title: 'Bring this project up to date',
        guidance: `To move it: npx ${product.name}@latest upgrade, in the project folder. It moves the adapter into editor/ and the kit's packages to their current names; then npm install, and open the project again.`,
        summary: 'adapter at the project root',
      },
    );
  }
  // A project with no adapter anywhere (made before projects had one) is still a project: it is told what file it
  // lacks and where one comes from, not to start over.
  if (existsSync(join(projectRoot, MANIFEST_FILENAME))) {
    throw new ProjectCompatibilityError(`${projectRoot} is a project with no ${ADAPTER_MODULE_FILENAME}.`, {
      kind: 'bring-project-up-to-date',
      title: 'Bring this project up to date',
      guidance: `Add one: a project made by npx ${product.name} create <another folder> has an ${ADAPTER_MODULE_FILENAME} to copy into this project's editor/ folder; then open this project again.`,
      summary: 'no adapter',
    });
  }
  throw new ProjectCompatibilityError(`${projectRoot} has no ${ADAPTER_MODULE_FILENAME}.`, {
    kind: 'make-project',
    title: 'Make a project',
    guidance: `To make a project: npx ${product.name} create <folder>.`,
  });
}

/** The refusal as the one sentence a command line prints. */
export function projectAdapterRefusal(projectRoot: string, product: AdapterRequirement | null): string | null {
  try {
    assertProjectAdapter(projectRoot, product);
    return null;
  } catch (error) {
    if (error instanceof ProjectCompatibilityError) return `${error.message} ${error.recovery.guidance}`;
    throw error;
  }
}
