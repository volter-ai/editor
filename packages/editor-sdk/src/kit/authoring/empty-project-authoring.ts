/**
 * THE PLACEHOLDER A PROJECT WITH NO ROOTS WEARS. `installEditModeAuthoring`
 * installs it so the panels say what would give them something to show
 * ("Declare a root"); `mountedRootSubjects` asks here so the placeholder is
 * never graded as a mounted root. Zero roots is a valid project (a project of
 * documents only, like a music project's pieces): nothing is mounted, so there
 * is no root whose missing providers are a gap.
 *
 * Its own module so the subject derivation does not take the whole edit-mode
 * installer into its import closure.
 */
import type { AuthoringAdapter } from '@volter/editor-project/adapter';

let placeholder: AuthoringAdapter | null = null;

export function setEmptyProjectAuthoring(adapter: AuthoringAdapter | null): void {
  placeholder = adapter;
}

export function emptyProjectAuthoring(): AuthoringAdapter | null {
  return placeholder;
}
