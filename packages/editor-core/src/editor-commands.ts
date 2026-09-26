/**
 * THE EDITOR'S COMMANDS: the ONE table of what its palette actions ARE, and
 * the ONE door to running a command by id.
 *
 * 1. **The ACTION TABLE.** What the palette lists, published as DATA so the
 *    frame can register one VS Code command plus one
 *    `MenuId.CommandPalette` item per entry — which is what makes ⌘⇧P list
 *    OUR actions with OUR labels. `components/palette-action-publisher.tsx`
 *    is its one author.
 *
 * ## Why this is published at RUNTIME and the keymap is GENERATED
 *
 * The chords are a generated built-in extension because a keybinding rule
 * registered after `workbench.common.main.ts` has loaded is INERT, and the
 * chords are package data known at build time. Neither half holds here,
 * measured 2026-09-19:
 *
 *   - A MENU ITEM registered late is not inert. `MenuRegistry` fires
 *     `onDidChangeMenu` and the palette rebuilds its picks on every open
 *     (`commandsQuickAccess.ts`'s `getGlobalCommandPicks`), which is how
 *     every extension-contributed command reaches ⌘⇧P.
 *   - The table is not static. Its ids are a different namespace from the
 *     keymap's (`editor.undo` here, `edit.undo` there), several labels are
 *     templated per selection (`View Through <camera name>`), and the
 *     entity, tool-document, board-open and package-contributed (`tool:*`)
 *     entries do not exist until something mounts or a package loads.
 *
 * So the generator is left alone and the frame reads a live table instead.
 *
 * 2. **`editor.command(id, args)`**, the door a product surface drives a VIEW
 *    through. `editor.document.*` reaches only the ACTIVE CENTRE DOCUMENT by
 *    its own contract, so every drawer utility — Console, Profiler, Network,
 *    the node editor — was undrivable until this existed; a walk looking for
 *    one tried `editor.view`, `editor.frame` and `editor.present` in turn and
 *    was refused by each, because there was no door.
 *
 *    It is the frame's `ICommandService.executeCommand`, installed by the
 *    contribution, so ANY workbench command id is reachable — ours and
 *    upstream's alike. That is the point of running inside a workbench.
 *    Before the executor lands, a `vgai.<view>.<verb>` id still resolves off
 *    `@volter/editor-sdk/views` — the same table the frame's command would have
 *    called — and any OTHER id is refused BY NAME, because a silent nothing
 *    is how an agent concludes a command "did not work".
 */
/**
 * How the frame opens ITS palette when one of our own actions asks for one
 * (`view.commandPalette`, whose chord U6 left unbound under the frame because
 * ⌘K is VS Code's chord prefix). Installed by the contribution after the
 * bridge has mounted; absent, the action is refused rather than silently
 * toggling a palette nobody renders.
 */
let paletteOpener: (() => void) | null = null;

export function setPaletteOpener(open: (() => void) | null): void {
  paletteOpener = open;
}

/** Open the command palette. `false` before the opener lands — the window
 *  between the bridge mounting and the contribution's `setPaletteOpener`. */
export function openCommandPalette(): boolean {
  if (!paletteOpener) return false;
  paletteOpener();
  return true;
}

export interface PaletteActionEntry {
  readonly id: string;
  readonly label: string;
  /** `action` | `entity` | `asset`, as `action-registry.ts` spells it. */
  readonly category: string;
  readonly run: () => void | Promise<void>;
  /** The application menu it is an item of, and its label there. */
  readonly menu?: { readonly id: string; readonly label: string };
}

let entries: readonly PaletteActionEntry[] = [];
let entriesVersion = 0;
const entryListeners = new Set<() => void>();

/**
 * Publish the table the palette would list. Called from the editor's own
 * tree (`components/palette-action-publisher.tsx`) so the hooks that build it
 * — the shell store, the history commands, the contributed-chrome version —
 * are read exactly where React reads them, rather than reached for out of
 * band. The array is replaced, never merged: the builders return the whole
 * live set each time.
 */
export function publishPaletteActions(next: readonly PaletteActionEntry[]): void {
  entries = next;
  entriesVersion++;
  for (const listener of entryListeners) listener();
}

/** Every palette action the editor currently offers. */
export function paletteActions(): readonly PaletteActionEntry[] {
  return entries;
}

export function paletteActionsVersion(): number {
  return entriesVersion;
}

export function subscribePaletteActions(listener: () => void): () => void {
  entryListeners.add(listener);
  return () => entryListeners.delete(listener);
}

/**
 * Run one palette action by id — the door the workbench's own command calls.
 * `false` means the editor no longer has that entry (a selection changed, a
 * tool document closed, a package unloaded), which the caller reports by name
 * rather than swallowing.
 */
export function invokePaletteAction(id: string): boolean {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return false;
  void entry.run();
  return true;
}

/**
 * The workbench's command service, handed over by the contribution once it has
 * one. Installed AFTER the bridge mounts, for the reason every other seam
 * here states: a `ServicesAccessor` is valid only inside the synchronous part
 * of a command's invocation.
 */
let commandExecutor: ((id: string, args?: unknown) => unknown) | null = null;

export function setCommandExecutor(run: ((id: string, args?: unknown) => unknown) | null): void {
  commandExecutor = run;
}

/**
 * Reveal a workbench view by id (`vgai.properties`, `vgai.outliner`) through its `.focus`
 * command, which the workbench registers for every view. Without the Code-OSS frame there is
 * no workbench and the editor's own panels are in the page, so there is nothing to reveal.
 */
export function revealWorkbenchView(viewId: string): void {
  if (!commandExecutor) return;
  void Promise.resolve(commandExecutor(`${viewId}.focus`)).catch(() => {});
}

/** The `vgai.<view>.<verb>` shape the views registry keys, and the ONLY id
 *  shape standalone can answer. */
const VIEW_VERB_COMMAND = /^vgai\.([^.]+)\.(.+)$/;

/**
 * Run a command by id — `editor.command(id, args)`'s one implementation.
 *
 * The workbench's `ICommandService` when it has landed; before that, the
 * views registry, reached through a DYNAMIC import so a module only a
 * `vgai eval` reaches never joins the editor entry's static closure.
 *
 * A refusal is always BY NAME. `invokeViewVerb` names the view's whole
 * vocabulary when it does not carry the verb (that refusal is the VIEW's, and
 * moving it here would put it somewhere the view does not draw), and an id
 * that is not a view verb at all is refused with the shape that would have
 * worked.
 */
export async function executeCommand(id: string, args?: unknown): Promise<unknown> {
  if (commandExecutor) return await commandExecutor(id, args);
  const parts = VIEW_VERB_COMMAND.exec(id);
  if (!parts) {
    throw new Error(
      `No command "${id}". Without the Code-OSS frame there is no command service, so the ` +
        "only commands this editor answers are a view's own verbs, spelled " +
        'vgai.<view>.<verb> (for example vgai.blender-node-view.view-all).',
    );
  }
  const { invokeViewVerb } = await import('@volter/editor-sdk/views');
  return invokeViewVerb(
    parts[1] as string,
    parts[2] as string,
    args as Record<string, unknown> | undefined,
  );
}
