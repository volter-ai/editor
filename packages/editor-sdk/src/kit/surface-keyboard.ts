/**
 * DOES OUR SURFACE HOLD THE KEYBOARD? — the term the play-input predicate was
 * missing, and it was missing because until the Code-OSS frame there was
 * nothing else on the page that could want a keystroke.
 *
 * The documented rule is "game input only fires while play is running AND the
 * Game tab is active" (the repo's CLAUDE.md, §Play-mode input isolation), and
 * standalone `vgai edit` those two clauses are the whole truth: the editor page
 * IS the surface, so a keystroke that reaches it was meant for it. Under the
 * frame (WORK.md §The core is Code-OSS, U2) the page is a VS Code workbench and
 * our stage is ONE EDITOR PANE in it. A person typing into Monaco in the group
 * beside a running game is typing into the same `document` the game's listeners
 * are on, and both clauses above are still true — the game is playing and the
 * Game document is still the active vgai document, because activating another
 * EDITOR did not close it. So the keystroke lands in the file AND moves the
 * game. That is U6's incident (keys typed into Monaco reaching the vgai
 * viewport as hotkeys, twice measured) repeated one layer down, on the GAME's
 * input rather than the editor's, and U6's fix does not cover it: keyboard
 * OWNERSHIP decides which dispatcher owns a chord, while this decides whether a
 * running game hears raw DOM events at all.
 *
 * ## Why this is a third TERM and not a correction to the second
 *
 * The obvious-looking fix — have the frame write `activeViewportTab = 'edit'`
 * when the pane stops being the active editor — is a defect, and the code says
 * so out loud: `syncCenterDocuments` (`components/CenterDocuments.tsx`) reads an
 * `'edit'` tab with the GAME document active as a genuine disagreement and
 * activates the SCENE document to correct it. Under the frame the layout host
 * renders the ACTIVE document into the editor pane, so that correction would
 * unmount the Game document, release the live document's container out from
 * under the running runtime, and end the game. The tab is about WHICH DOCUMENT
 * is open, the probe below is about WHO IS TYPING, and conflating them costs
 * the game.
 *
 * ## The shape
 *
 * A single installed probe, default absent, and absent means TRUE. Standalone
 * nothing installs one and every predicate reads exactly as it did before this
 * module existed — the same "an unset value is upstream's own behaviour"
 * discipline U9's core edit follows. The frame installs one from the workbench's
 * own notion of the active editor (`ActiveEditorContext` over the vgai pane's
 * type id), which is the right question rather than DOM focus: clicking a game
 * canvas that carries no `tabindex` moves focus to `body` while the pane stays
 * the active editor, and gating on focus would have killed input on the first
 * click into the game.
 *
 * ## Its readers, both of them, and why they are both needed
 *
 * `gated-globals.ts` covers every RAW `window`/`document` listener a project
 * module registers — first-party games, ingest mounts and the module lane
 * alike, since the dev server's lexical shadow is what they all go through.
 * `@vgai/game`'s `play-mode.ts` covers the engine's own `InputManager`, which
 * is NOT a project module (it is `@vgai/game-runtime`, resolved as a dependency) and
 * therefore attaches to the real `window` unshadowed; it reads this through
 * `instanceInputActive` and re-gates on this module's notification.
 */

type SurfaceKeyboardProbe = () => boolean;

let probe: SurfaceKeyboardProbe | null = null;
const listeners = new Set<() => void>();

/**
 * True while the surface a game is mounted in holds the keyboard.
 *
 * Absent probe = true, deliberately: the standalone editor page is the only
 * surface there is, and a host that has not answered must never be read as a
 * refusal — a silently dead keyboard is the worst failure this module could
 * have.
 */
export function surfaceHoldsKeyboard(): boolean {
  if (!probe) return true;
  try {
    return probe();
  } catch {
    // A probe that throws is a broken frame, not a person who stopped typing.
    return true;
  }
}

/**
 * Install the frame's answer. Returns the uninstall, which restores the
 * always-true default rather than leaving the last answer pinned — a frame
 * going away must not leave a game deaf.
 */
export function setSurfaceKeyboardProbe(next: SurfaceKeyboardProbe | null): () => void {
  probe = next;
  notifySurfaceKeyboard();
  return () => {
    if (probe !== next) return;
    probe = null;
    notifySurfaceKeyboard();
  };
}

/** The frame calls this when its answer changes; `gated-globals`' gates re-read
 *  per event and need no notification, but `InputManager` is a latched
 *  `setEnabled` and does. */
export function notifySurfaceKeyboard(): void {
  for (const listener of listeners) listener();
}

export function subscribeSurfaceKeyboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only reset. */
export function __resetSurfaceKeyboardForTest(): void {
  probe = null;
  listeners.clear();
}
