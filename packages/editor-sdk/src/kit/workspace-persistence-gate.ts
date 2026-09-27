/**
 * Tiny shared gate: while suppressed, workspace-layout persistence
 * (`workspace-state-persistence.ts`) drops every write-through/flush.
 *
 * Immersive Glass + Floating play hides the dock chrome for the whole play
 * session (`play-transition.ts`); the resulting hidden-group layout is
 * transient presentation, not user intent, and must never overwrite the
 * saved layout — including via the `pagehide` flush if the tab closes
 * mid-play. Classic/Docked play never enables this gate. Kept in its
 * own module (not in workspace-state-persistence.ts) so play-transition can
 * set it without importing the persistence module's heavy dependency graph.
 *
 * The flag lives on `globalThis`, not a module-local `let`: the play-mode
 * boot path dynamically imports the project bundle (`play-mode.ts`'s
 * `/@fs/…?t=…` / `import(modulePath)`), and Vite dev can then serve a SECOND
 * evaluated copy of this gate module through that graph. A module-local flag
 * would split — `play-transition` setting `true` on one copy while
 * `workspace-state-persistence` reads `false` on the other (proven: the
 * hidden-chrome layout leaked into localStorage during play, 71-play-
 * transition). A single `globalThis` cell is shared by every copy and is a
 * plain boolean in production (no duplication, zero overhead).
 */

const GATE_KEY = '__vgaiWorkspacePersistenceSuppressed';

interface GateHost {
  [GATE_KEY]?: boolean;
}

function host(): GateHost {
  return globalThis as unknown as GateHost;
}

export function setWorkspacePersistenceSuppressed(suppressed: boolean): void {
  host()[GATE_KEY] = suppressed;
}

export function isWorkspacePersistenceSuppressed(): boolean {
  return host()[GATE_KEY] === true;
}
