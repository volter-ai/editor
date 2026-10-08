/**
 * A PRODUCT OPENS PROJECTS THAT HAVE AN ADAPTER.
 *
 * A project a product makes carries `editor/volter.adapter.ts`: it is where the project says which
 * layout, documents and regions it has. The adapter loader treats a project without one as the
 * native default (`@volter/sdk/kit/project-adapter`), which is right for a bare host and wrong for
 * a product: a Cyclotron project would come up with no Blender layout and no model documents, and
 * nothing would say why. So every door a product starts a session through asks here first, and a
 * project without the file is refused in one sentence that names the file and how to make a project.
 *
 * `product` is `null` where no product serves the project; nothing is asked of such a project.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTER_MODULE_FILENAME } from '@volter/sdk/kit/ui-source/adapter-region-includes';
import { ProjectCompatibilityError } from '@volter/sdk/session/editor-compatibility';

export function assertProjectAdapter(projectRoot: string, product: { readonly name: string } | null): void {
  if (product === null || existsSync(join(projectRoot, ADAPTER_MODULE_FILENAME))) return;
  throw new ProjectCompatibilityError(`This project has no ${ADAPTER_MODULE_FILENAME}.`, {
    kind: 'make-project',
    title: 'Make a project',
    guidance: `To make a project: npx ${product.name} create <folder>.`,
  });
}

/** The refusal as the one sentence a command line prints. */
export function projectAdapterRefusal(projectRoot: string, product: { readonly name: string } | null): string | null {
  try {
    assertProjectAdapter(projectRoot, product);
    return null;
  } catch (error) {
    if (error instanceof ProjectCompatibilityError) return `${error.message} ${error.recovery.guidance}`;
    throw error;
  }
}
