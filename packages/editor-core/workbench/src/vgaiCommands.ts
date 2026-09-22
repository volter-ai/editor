/*---------------------------------------------------------------------------------------------
 *  THE COMMAND PALETTE IS THE WORKBENCH'S — WORK.md §The core is Code-OSS U8.
 *
 *  U6 gave the editor's KEYBOARD to VS Code: 41 `vgai.<action>` commands, one keybinding rule
 *  per chord per keymap, in a generated built-in extension (U6b). What it did NOT give away is
 *  the PALETTE, and the measurement says why the two are different problems:
 *
 *    - Those 41 commands are registered with `CommandsRegistry.registerCommand` alone, and a
 *      bare `CommandsRegistry` command DOES NOT APPEAR IN the palette. Its picks come from
 *      `MenuId.CommandPalette` MENU ITEMS (`commandsQuickAccess.ts`'s `getGlobalCommandPicks`
 *      reads `menuService.getMenuActions(MenuId.CommandPalette, …)`), so today they are both
 *      invisible there and — where they are reachable at all — labelled with the raw action id.
 *    - The editor's PALETTE table is not the keymap's. Its ids are a different namespace
 *      (`editor.undo` here, `edit.undo` there), several of its labels are templated per
 *      selection ("View Through <camera name>"), and its entity, tool-document, board-open and
 *      package-contributed (`tool:*`) entries do not exist until something mounts or a package
 *      loads. No static read can see any of it, so no generator can carry it.
 *
 *  A MENU ITEM registered late is not inert, which is the asymmetry that decides the shape: a
 *  keybinding rule registered after `workbench.common.main.ts` has loaded never fires (U6's
 *  third core edit, retired by U6b), while `MenuRegistry` fires `onDidChangeMenu` and the
 *  palette rebuilds its picks on every open — which is how every extension-contributed command
 *  reaches it. So this file registers the editor's live table AT RUNTIME, re-registering it
 *  whenever the table's signature changes, and `scripts/workbench/generate-keymaps.mjs` is left alone.
 *
 *  Nothing under `src/vs/` imports an editor module: what arrives is `VgaiCommandsBridge`, the
 *  editor's own `@editor/commands-ownership` table reshaped into exactly the facts a menu item
 *  needs. Its counterpart is `bridge.tsx`'s `VgaiCommandsHandle`.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';

/**
 * WHAT THE FRAME GETS OF THE EDITOR'S PALETTE — declared here for the same reason
 * `VgaiKeyboardBridge` and `VgaiFilesBridge` are: no file under `src/vs/` imports an editor
 * module, and the editor's own door keeps its own shape.
 */
export interface VgaiCommandsBridge {
	/** Every action the editor's palette would list, right now. */
	list(): readonly { readonly id: string; readonly label: string; readonly category: string }[];
	/** Run one by id. `false` means the editor no longer has that entry. */
	invoke(id: string): boolean;
	/** Fires when the table's membership or any label changes. */
	subscribe(listener: () => void): () => void;
	/** How the editor's own `view.commandPalette` action opens a palette in this window. */
	setPaletteOpener(open: () => void): void;
	/**
	 * How `editor.command(id, args)` — the editor's ONE door to a command by id — runs one in
	 * this window. This is `ICommandService.executeCommand`, so EVERY command id the workbench
	 * knows is reachable: a view's `vgai.<view>.<verb>` (U8's ruling 1, "so `vgai eval` reaches
	 * it through the frame's command service"), an action's `vgai.action.<id>`, or one of VS
	 * Code's own.
	 *
	 * Optional so a bridge older than this member is a missing door rather than a crash; absent,
	 * the editor answers a `vgai.<view>.<verb>` id off the views registry itself and refuses any
	 * other by name — which is also exactly what standalone `vgai edit` does.
	 */
	setCommandExecutor?(run: (id: string, args?: unknown) => Promise<unknown>): void;
	/** Say something in the vgai editor's OWN console, where `vgai console` reads it. */
	report(level: 'warn' | 'error', message: string): void;
}

/** One VS Code command id per editor palette action. The `action` segment keeps this namespace
 *  clear of U6's `vgai.<key action>` commands, which are a different table with different ids. */
function commandIdFor(actionId: string): string {
	return `vgai.action.${actionId}`;
}

/**
 * The palette's three categories, kept because they are what our own palette grouped by — an
 * entity pick and an action pick with the same word in them are told apart by the category
 * exactly as they were by the group header before.
 */
function categoryFor(category: string) {
	switch (category) {
		case 'entity': return localize2('vgaiEntityCategory', "Volter Editor Entity");
		case 'asset': return localize2('vgaiAssetCategory', "Volter Editor Asset");
		default: return localize2('vgaiCategory', "Volter Editor");
	}
}

export class VgaiCommands extends Disposable {

	/** The current generation's command + menu registrations, replaced whole on every change. */
	private readonly generation = this._register(new DisposableStore());

	constructor(
		private readonly bridge: VgaiCommandsBridge,
		@ICommandService commandService: ICommandService,
	) {
		super();
		// THE EDITOR'S OWN `view.commandPalette` ACTION, answered by the workbench. Its CHORD is
		// unbound under the frame (U6: Cmd+K is VS Code's chord prefix), so this is reached from a
		// keybinding a person made or from the action itself — and without it the action would
		// toggle a palette that is not mounted, which is a silent nothing.
		bridge.setPaletteOpener(() => { void commandService.executeCommand('workbench.action.showCommands'); });
		// AND THE COMMAND DOOR ITSELF. The palette opener runs ONE fixed id; this runs whichever
		// id the caller names, which is what makes a drawer view drivable by the product at all —
		// `editor.document.*` reaches the active centre document by its own contract, and a view
		// is not one. The command's own result is handed straight back: a view verb answers with
		// its state, and the session serialises it for `vgai eval`.
		bridge.setCommandExecutor?.((id, args) => commandService.executeCommand(id, args));
		this._register(toDisposable(bridge.subscribe(() => this.publish())));
		this._register(toDisposable(() => bridge.setPaletteOpener(() => { })));
		this.publish();
	}

	private publish(): void {
		this.generation.clear();
		for (const entry of this.bridge.list()) {
			const id = commandIdFor(entry.id);
			const actionId = entry.id;
			if (actionId === 'account.open') {
				this.generation.add(MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
					command: { id, title: entry.label }, group: 'vgai', order: 1,
				}));
			}
			this.generation.add(CommandsRegistry.registerCommand({
				id,
				metadata: { description: localize('vgaiPaletteAction', "vgai: {0}", entry.label) },
				handler: () => {
					// The table can move between the palette listing it and the person picking it
					// (a selection changed, a tool document closed, a package unloaded). Say so in
					// the session's ledger rather than doing nothing.
					if (!this.bridge.invoke(actionId)) {
						this.bridge.report('warn', `The palette action "${actionId}" did not run: the editor no longer offers it.`);
					}
				},
			}));
			this.generation.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
				command: { id, title: entry.label, category: categoryFor(entry.category) },
			}));
		}
	}
}
