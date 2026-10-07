/*---------------------------------------------------------------------------------------------
 *  THE COMMAND PALETTE IS THE WORKBENCH'S — WORK.md §The core is Code-OSS U8.
 *
 *  U6 gave the editor's KEYBOARD to VS Code: 41 `volter.<action>` commands, one keybinding rule
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
 *  Nothing under `src/vs/` imports an editor module: what arrives is `VolterCommandsBridge`, the
 *  editor's own `@editor/commands-ownership` table reshaped into exactly the facts a menu item
 *  needs. Its counterpart is `bridge.tsx`'s `VolterCommandsHandle`.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';

/**
 * WHAT THE FRAME GETS OF THE EDITOR'S PALETTE — declared here for the same reason
 * `VolterKeyboardBridge` and `VolterFilesBridge` are: no file under `src/vs/` imports an editor
 * module, and the editor's own door keeps its own shape.
 */
export interface VolterCommandsBridge {
	/** Every action the editor's palette would list, right now. */
	list(): readonly { readonly id: string; readonly label: string; readonly category: string; readonly menu?: { readonly id: string; readonly label: string } }[];
	/** Run one by id. `false` means the editor no longer has that entry. */
	invoke(id: string): boolean;
	/** Fires when the table's membership or any label changes. */
	subscribe(listener: () => void): () => void;
	/** How the editor's own `view.commandPalette` action opens a palette in this window. */
	setPaletteOpener(open: () => void): void;
	/**
	 * How `editor.command(id, args)` — the editor's ONE door to a command by id — runs one in
	 * this window. This is `ICommandService.executeCommand`, so EVERY command id the workbench
	 * knows is reachable: a view's `volter.<view>.<verb>` (U8's ruling 1, "so the editor's `eval` command reaches
	 * it through the frame's command service"), an action's `volter.action.<id>`, or one of VS
	 * Code's own.
	 *
	 * Optional so a bridge older than this member is a missing door rather than a crash; absent,
	 * the editor answers a `volter.<view>.<verb>` id off the views registry itself and refuses any
	 * other by name — which is also exactly what standalone the editor's `edit` command does.
	 */
	setCommandExecutor?(run: (id: string, args?: unknown) => Promise<unknown>): void;
	/** Say something in the Volter editor's OWN console, where the editor's `console` command reads it. */
	/** `notify`: the refusal answers the person's own gesture, so it reaches the tray too. */
	report(level: 'warn' | 'error', message: string, options?: { readonly notify?: boolean }): void;
}

/** One VS Code command id per editor palette action. The `action` segment keeps this namespace
 *  clear of U6's `volter.<key action>` commands, which are a different table with different ids. */
function commandIdFor(actionId: string): string {
	return `volter.action.${actionId}`;
}

/**
 * The palette's three categories, kept because they are what our own palette grouped by — an
 * entity pick and an action pick with the same word in them are told apart by the category
 * exactly as they were by the group header before.
 */
function categoryFor(category: string) {
	switch (category) {
		case 'entity': return localize2('volterEntityCategory', "Volter Editor Entity");
		case 'asset': return localize2('volterAssetCategory', "Volter Editor Asset");
		default: return localize2('volterCategory', "Volter Editor");
	}
}

/**
 * THE EDITOR'S APPLICATION MENUS, IN THE WORKBENCH'S MENUBAR. A package's `workspace.menu` item
 * names one of the editor's menus; under this frame the editor draws no menubar of its own, so
 * the item goes where a person looks for it: `view` and `help` are VS Code's own View and Help,
 * and `debug`, `tools` and `window` — which VS Code does not have — are menus of their own,
 * appended to the menubar only while they have an item.
 */
interface VolterMenuTitle { readonly value: string; readonly original: string; readonly mnemonicTitle: string }
const VOLTER_MENUS: Readonly<Record<string, { readonly id: MenuId; readonly title?: VolterMenuTitle; readonly order?: number }>> = {
	view: { id: MenuId.MenubarViewMenu },
	help: { id: MenuId.MenubarHelpMenu },
	debug: { id: new MenuId('VolterMenubarDebugMenu'), title: { value: 'Debug', original: 'Debug', mnemonicTitle: localize({ key: 'volterMenuDebug', comment: ['&& denotes a mnemonic'] }, "&&Debug") }, order: 6.5 },
	tools: { id: new MenuId('VolterMenubarToolsMenu'), title: { value: 'Tools', original: 'Tools', mnemonicTitle: localize({ key: 'volterMenuTools', comment: ['&& denotes a mnemonic'] }, "T&&ools") }, order: 7.5 },
	window: { id: new MenuId('VolterMenubarWindowMenu'), title: { value: 'Window', original: 'Window', mnemonicTitle: localize({ key: 'volterMenuWindow', comment: ['&& denotes a mnemonic'] }, "&&Window") }, order: 7.6 },
};

export class VolterCommands extends Disposable {

	/** The current generation's command + menu registrations, replaced whole on every change. */
	private readonly generation = this._register(new DisposableStore());

	constructor(
		private readonly bridge: VolterCommandsBridge,
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
		// its state, and the session serialises it for the editor's `eval` command.
		bridge.setCommandExecutor?.((id, args) => commandService.executeCommand(id, args));
		this._register(toDisposable(bridge.subscribe(() => this.publish())));
		this._register(toDisposable(() => bridge.setPaletteOpener(() => { })));
		this.publish();
	}

	private publish(): void {
		this.generation.clear();
		const menusWithItems = new Set<string>();
		for (const entry of this.bridge.list()) {
			const id = commandIdFor(entry.id);
			const actionId = entry.id;
			if (actionId === 'account.open') {
				this.generation.add(MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
					command: { id, title: entry.label }, group: 'volter', order: 1,
				}));
			}
			this.generation.add(CommandsRegistry.registerCommand({
				id,
				metadata: { description: localize('volterPaletteAction', "volter: {0}", entry.label) },
				handler: () => {
					// The table can move between the palette listing it and the person picking it
					// (a selection changed, a tool document closed, a package unloaded). Say so in
					// the session's ledger rather than doing nothing.
					if (!this.bridge.invoke(actionId)) {
						this.bridge.report('warn', `The palette action "${actionId}" did not run: the editor no longer offers it.`, { notify: true });
					}
				},
			}));
			this.generation.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
				command: { id, title: entry.label, category: categoryFor(entry.category) },
			}));
			const menu = entry.menu && VOLTER_MENUS[entry.menu.id];
			if (entry.menu && menu) {
				menusWithItems.add(entry.menu.id);
				this.generation.add(MenuRegistry.appendMenuItem(menu.id, {
					command: { id, title: entry.menu.label }, group: 'volter',
				}));
			}
		}
		for (const key of menusWithItems) {
			const menu = VOLTER_MENUS[key];
			if (!menu?.title) { continue; }
			this.generation.add(MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
				submenu: menu.id, title: menu.title, order: menu.order,
			}));
		}
	}
}
