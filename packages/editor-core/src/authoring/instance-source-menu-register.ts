/**
 * H3 side-effect registration module (imported by `main.tsx` alongside the
 * other contribution-seam imports): installs the instance row's
 * `Go to Callsite` / `Open Component Source` hierarchy items at editor boot.
 *
 * Kept separate from `instance-source-menu.ts` itself so unit tests can
 * import that module (and the double-click helper it also exports) without
 * mutating the shared hierarchy-menu registry as a side effect of the import.
 */

import { ensureInstanceSourceMenuRegistered } from './instance-source-menu';

ensureInstanceSourceMenuRegistered();
