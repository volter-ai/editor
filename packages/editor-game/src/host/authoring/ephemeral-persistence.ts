/**
 * Ephemeral persistence provider — for sessions whose edits must NOT survive past
 * the session (play-mode's adoption of the live game scene; design).
 *
 * `isDirty()` is hard-coded `false`: nothing here is ever "unsaved" because there
 * is nowhere for it to go — a no-op `save()` that pretended otherwise would lie in
 * the save-status UI. Per the contract, the host never calls `save()` when
 * `isDirty()` is false, so `save()` below is a documented no-op, not a silent
 * swallow of a real write.
 *
 * EPHEMERAL IS A PIPE DESTINATION, not a parallel stack: an edit made here
 * resolves `live-only` at {@link EPHEMERAL_DESTINATION} through
 * `write-pipe.ts`, which is why the destination string is owned there beside
 * the other two rather than here.
 */

import type { PersistenceProvider } from '@volter/editor-project/adapter';
import { EPHEMERAL_DESTINATION } from '@volter/editor-core/authoring/write-pipe';

export function createEphemeralPersistence(): PersistenceProvider {
  return {
    isDirty: () => false,
    save: async () => {
      // Never called by the host (isDirty() is always false — see doc comment
      // above). No-op: there is nothing to write, not a swallowed failure.
    },
    destination: EPHEMERAL_DESTINATION,
  };
}
