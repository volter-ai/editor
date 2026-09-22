/*---------------------------------------------------------------------------------------------
 *  A VIEW'S PRODUCT DOOR IS A VS CODE COMMAND — WORK.md §The core is Code-OSS U8, ruling (1).
 *
 *  `editor.document.*` reaches only the ACTIVE CENTRE DOCUMENT, by its own contract, so every
 *  drawer utility — Console, Profiler, Network, I5's node editor — was undrivable by the
 *  product, and each one that needed driving was shipping its OWN session verb to compensate.
 *  The ruling refused both a utility scope on the document door (for a dock U10 deletes) and a
 *  verb per view: under the frame every one of our views is a VS Code view in a view
 *  container, and its state and verbs are reached through `vgai.<view>.<verb>` commands the
 *  bridge dispatches into the view — the same one-name door as every other verb, so
 *  `vgai eval` reaches it through the frame's command service.
 *
 *  ARGUMENTS ARE THE VIEW'S. A command here passes its argument object straight through: what
 *  an argument MEANS belongs to the view, and a registry that validated them would be a second
 *  place to keep a vocabulary in step. A view refuses by name; this file only reports it.
 *
 *  Registered at RUNTIME, for `vgaiCommands.ts`'s reason and with its measurement: a menu item
 *  registered late is not inert, and which views exist is a fact about the open project's
 *  packages rather than build-time data.
 *
 *  Nothing under `src/vs/` imports an editor module: what arrives is `VgaiViewsBridge`, the
 *  SDK's `@vgai/editor-sdk/views` registry reshaped into the facts a command needs. Its
 *  counterpart is `bridge.tsx`'s `VgaiViewsHandle`.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';

export interface VgaiViewsBridge {
	/** Every view publishing verbs, right now. */
	list(): readonly {
		readonly view: string;
		readonly title: string;
		readonly verbs: readonly { readonly id: string; readonly title?: string }[];
	}[];
	/** Run one. Throws with the view's own refusal, which the command re-throws so the caller
	 *  — `vgai eval` through the command service, or the palette — sees the sentence. */
	invoke(view: string, verb: string, args?: Record<string, unknown>): unknown;
	/** Fires when a view registers or unregisters its verbs. */
	subscribe(listener: () => void): () => void;
}

/** `blender-node-view` + `view-all` → `vgai.blender-node-view.view-all`. */
function commandIdFor(view: string, verb: string): string {
	return `vgai.${view}.${verb}`;
}

export class VgaiViews extends Disposable {

	private readonly generation = this._register(new DisposableStore());

	constructor(private readonly bridge: VgaiViewsBridge) {
		super();
		this._register(toDisposable(bridge.subscribe(() => this.publish())));
		this.publish();
	}

	private publish(): void {
		this.generation.clear();
		for (const view of this.bridge.list()) {
			for (const verb of view.verbs) {
				const id = commandIdFor(view.view, verb.id);
				this.generation.add(CommandsRegistry.registerCommand({
					id,
					metadata: { description: localize('vgaiViewVerb', "{0}: {1}", view.title, verb.id) },
					handler: (_accessor, args?: Record<string, unknown>) => this.bridge.invoke(view.view, verb.id, args),
				}));
				// ONLY A TITLED VERB IS LISTED. A read (`state`) or a refusal probe is reachable
				// by command id and by the session and is not a menu item — the palette is what a
				// PERSON opens, and a vocabulary is not a menu.
				if (!verb.title) { continue; }
				this.generation.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
					command: { id, title: verb.title, category: localize2('vgaiViewCategory', "Volter Editor View") },
				}));
			}
		}
	}
}
