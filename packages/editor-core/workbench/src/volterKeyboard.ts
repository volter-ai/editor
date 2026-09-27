/*---------------------------------------------------------------------------------------------
 *  KEYBOARD OWNERSHIP — under this frame there is ONE keyboard owner, and it is VS Code.
 *
 *  ARCHITECTURE-CORE §The core is Code-OSS rule 3: "Keyboard ownership is VS Code's. One
 *  keybinding system: ours becomes keybinding contributions gated by `when` on our panes'
 *  context keys. Two listeners cannot both own the keyboard." The measurement behind the
 *  rule, twice: keys typed into Monaco beside a mounted volter stage reached the STAGE —
 *  a bevel recorded into `cube.ts` in the web harness, and on desktop `1,1,1,2,2,2`
 *  arriving as `,,,,,` and saving as `BoxGeometry(,,,,,)` while a `Control+W` meant for
 *  VS Code fired a modeling tool.
 *
 *  THE CHORDS ARE NOT HERE, and that is U6b. U6 registered a keybinding rule per chord at
 *  RUNTIME, from the keymap tables the bridge read out of the open project — which cost the
 *  fork's third core edit, because an upstream rule registered after `workbench.common.main.ts`
 *  has loaded never reaches the resolver. The chords are PACKAGE DATA known at BUILD time;
 *  only the CHOICE of keymap is dynamic, and `volter.keymap` below already carries it. So they
 *  are generated into a built-in extension's `contributes.keybindings`
 *  (`scripts/workbench/generate-keymaps.mjs` → `extensions/volter-keymaps/`), one set per keymap, gated on
 *  that context key — VS Code's own keymap-extension path, honoured at load — and the core
 *  edit is gone.
 *
 *  What this file does, and nothing else:
 *
 *  1. PUBLISHES the context keys our panes' state answers — `volter.focused`,
 *     `volter.stage.focused`, `volter.stage.surface`, `volter.stage.mode`, `volter.document.kind`,
 *     `volter.play`, `volter.keymap` — from the bridge's own door and from real focus tracking
 *     on the parts the contribution hands over. `volter.keymap` is what SELECTS a generated
 *     set; the project's own `editor.keymap` choice stays authoritative and there is
 *     deliberately no second setting.
 *  2. REGISTERS one `volter.<action id>` command per generated action, AT LOAD, dispatching
 *     into the volter editor's own action through the bridge. At load because the extension's
 *     rules exist from load: a chord must never resolve to a command that is not there. A
 *     command whose action the editor has no live handler for answers by SAYING so in the
 *     session's own console, exactly as it did in U6.
 *  3. WARNS, once, when the project selected a keymap the frame does not carry — a keymap a
 *     project contributes from its own copied source (a capability's `*.keymap.ts`, which the
 *     project then owns and edits) cannot be in a manifest built here. A standing warning
 *     naming its mechanism, never a silent dead keyboard.
 *--------------------------------------------------------------------------------------------*/

import { trackFocus } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { CARRIED_ACTION_IDS, CARRIED_KEYMAP_IDS } from './volterGeneratedKeymaps.js';

// ---- What the bridge hands over. The volter editor's own door (`@volter/editor-sdk/host`'s
// `keyboard` member) reshaped by `bridge.tsx` into the facts this frame needs, so this file
// imports nothing of the editor.

export interface VolterKeyboardBridge {
	/** The keymap the PROJECT selected. */
	activeKeymap(): string;
	/** Run one action; false when nothing handles it now or its own gate refused. */
	invoke(id: string): boolean;
	subscribe(listener: () => void): () => void;
	/** The stage/document/play facts the context keys publish. */
	facts(): {
		readonly surface: string | null;
		readonly mode: string | null;
		readonly documentKind: string | null;
		readonly play: string;
	};
	/** Say something in the volter editor's OWN console, where the editor's `console` command reads it —
	 *  the frame's refusals belong in the session's ledger, not in a toast. */
	report(level: 'warn' | 'error', message: string): void;
}

// ---- The context keys.

export const VolterFocused = new RawContextKey<boolean>('volter.focused', false, localize('volterFocused', "Whether keyboard focus is inside one of the Volter Editor's parts (its stage, outliner or properties)."));
export const VolterStageFocused = new RawContextKey<boolean>('volter.stage.focused', false, localize('volterStageFocused', "Whether keyboard focus is on a volter stage."));
export const VolterStageSurface = new RawContextKey<string>('volter.stage.surface', '', localize('volterStageSurface', "The surface the focused volter stage paints: 'three', 'canvas' (a mounted 2D canvas document), or empty."));
export const VolterStageMode = new RawContextKey<string>('volter.stage.mode', '', localize('volterStageMode', "The focused volter document's own interaction mode (Blender's object, edit or sculpt), when it reports one."));
export const VolterDocumentKind = new RawContextKey<string>('volter.document.kind', '', localize('volterDocumentKind', "The kind of the active volter document."));
export const VolterPlay = new RawContextKey<string>('volter.play', 'stopped', localize('volterPlay', "The volter session's play state: stopped, playing or paused."));
export const VolterKeymap = new RawContextKey<string>('volter.keymap', '', localize('volterKeymap', "The keymap the open volter project selected (its adapter's editor.keymap). A keymap is a keybinding SET — `extensions/volter-keymaps` contributes one per keymap — and this is what selects it."));

// ---- The commands, registered AT LOAD.
//
// The generated extension's rules exist from the moment the workbench reads its manifest, so
// the commands they name have to exist from then too. There is no bridge yet at that point,
// and no rule can match either (every one of them is gated on `volter.keymap`, which nothing has
// published), so the handler's job before a mount is only to be honest about it.

let liveBridge: VolterKeyboardBridge | undefined;

for (const id of CARRIED_ACTION_IDS) {
	CommandsRegistry.registerCommand({
		id: `volter.${id}`,
		metadata: { description: localize('volterAction', "volter: {0}", id) },
		handler: () => {
			if (!liveBridge) {
				// Reachable only by running the command by hand (the palette, a user
				// keybinding) before the Model workspace is open: no `when` clause can be
				// true yet.
				throw new Error(localize('volterNoEditor', "The Volter Editor is not mounted in this window. Run \"Volter Editor: Open Workspace\" first."));
			}
			if (!liveBridge.invoke(id)) {
				liveBridge.report('warn', `The keyboard action "${id}" did not run: the editor has no live handler for it right now (its stage or panel is not mounted), or the action's own gate refused.`);
			}
		},
	});
}

/**
 * Install the one keyboard owner's view of the volter editor: the context keys the generated
 * keybinding sets are gated on, and the bridge the commands dispatch through. Called once,
 * after the bridge has mounted and handed back its keyboard door.
 */
export class VolterKeyboard extends Disposable {

	private readonly focused: IContextKey<boolean>;
	private readonly stageFocused: IContextKey<boolean>;
	private readonly stageSurface: IContextKey<string>;
	private readonly stageMode: IContextKey<string>;
	private readonly documentKind: IContextKey<string>;
	private readonly play: IContextKey<string>;
	private readonly keymap: IContextKey<string>;

	/** Which handed-over parts currently hold DOM focus. */
	private readonly focusedParts = new Set<string>();
	/** One focus tracker per handed-over part, disposed when the part is withdrawn. */
	private readonly partTrackers = new Map<string, DisposableStore>();
	/** Keymaps this frame carries no chords for, said ONCE each rather than every re-read. */
	private readonly uncarried = new Set<string>();

	constructor(
		private readonly bridge: VolterKeyboardBridge,
		contextKeyService: IContextKeyService,
	) {
		super();
		this.focused = VolterFocused.bindTo(contextKeyService);
		this.stageFocused = VolterStageFocused.bindTo(contextKeyService);
		this.stageSurface = VolterStageSurface.bindTo(contextKeyService);
		this.stageMode = VolterStageMode.bindTo(contextKeyService);
		this.documentKind = VolterDocumentKind.bindTo(contextKeyService);
		this.play = VolterPlay.bindTo(contextKeyService);
		this.keymap = VolterKeymap.bindTo(contextKeyService);

		liveBridge = bridge;
		this._register(toDisposable(() => { if (liveBridge === bridge) { liveBridge = undefined; } }));
		this._register(toDisposable(bridge.subscribe(() => this.syncFacts())));
		this.syncFacts();
	}

	/**
	 * Track focus on one part the contribution handed to the bridge. VS Code's own
	 * `trackFocus` is what decides — the part is a real focusable element (the pane and the
	 * views set `tabIndex` and focus themselves on a pointer down), so "is the stage
	 * focused" is the workbench's answer to the same question it asks of every other part,
	 * not a guess from a class name.
	 */
	trackPart(id: string, element: HTMLElement): void {
		this.partTrackers.get(id)?.dispose();
		const store = new DisposableStore();
		const tracker = store.add(trackFocus(element));
		store.add(tracker.onDidFocus(() => { this.focusedParts.add(id); this.syncFocus(); }));
		store.add(tracker.onDidBlur(() => { this.focusedParts.delete(id); this.syncFocus(); }));
		this.partTrackers.set(id, store);
		this._register(store);
		if (element.contains(element.ownerDocument.activeElement)) { this.focusedParts.add(id); this.syncFocus(); }
	}

	/**
	 * FORGET A PART THAT IS GONE — a pane disposed with its group (W12).
	 *
	 * Without this the tracker outlived the element it watched and `focusedParts` kept an id
	 * whose part no longer exists, so `volter.focused` could stay TRUE with nothing of ours on
	 * screen. The tracker is disposed here rather than only at shutdown because a part is
	 * withdrawn and re-offered many times in one session.
	 */
	untrackPart(id: string): void {
		const store = this.partTrackers.get(id);
		if (!store) { return; }
		this.partTrackers.delete(id);
		store.dispose();
		if (this.focusedParts.delete(id)) { this.syncFocus(); }
	}

	private syncFocus(): void {
		this.focused.set(this.focusedParts.size > 0);
		// EVERY volter EDITOR PANE IS THE STAGE, not just the mount's. A workspace AREA is a
		// second editor group and therefore a second `VolterDocumentPane` (WORK.md's Timeline
		// item 1), offered as `center:<n>`; a keystroke in the Timeline is a keystroke in our
		// surface exactly as one in the Model pane is, and the distinction that matters to
		// `volter.stage.focused` is ours-versus-Monaco.
		this.stageFocused.set([...this.focusedParts].some(id => id === 'center' || id.startsWith('center:')));
	}

	private syncFacts(): void {
		const facts = this.bridge.facts();
		this.stageSurface.set(facts.surface ?? '');
		this.stageMode.set(facts.mode ?? '');
		this.documentKind.set(facts.documentKind ?? '');
		this.play.set(facts.play);
		const keymap = this.bridge.activeKeymap();
		this.keymap.set(keymap);
		// The one thing a build-time manifest cannot carry: a keymap the PROJECT contributes
		// from source it owns. Say which, and say what to do, rather than leave a keyboard
		// that quietly answers nothing.
		if (keymap && !CARRIED_KEYMAP_IDS.includes(keymap) && !this.uncarried.has(keymap)) {
			this.uncarried.add(keymap);
			this.bridge.report('warn', `This project selected the "${keymap}" keymap, and the VS Code frame carries chords for ${CARRIED_KEYMAP_IDS.map(id => `"${id}"`).join(' and ')} only — so under the frame no chord of "${keymap}" is bound and its actions run only from the command palette. The frame's keybinding sets are generated from the engine repository's keymap tables at build time (scripts/workbench/generate-keymaps.mjs); a keymap contributed from a project's own copied source is not among them.`);
		}
	}
}
