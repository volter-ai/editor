/*---------------------------------------------------------------------------------------------
 *  KEYBOARD OWNERSHIP — under this frame there is ONE keyboard owner, and it is VS Code.
 *
 *  ARCHITECTURE-CORE §The core is Code-OSS rule 3: "Keyboard ownership is VS Code's. One
 *  keybinding system: ours becomes keybinding contributions gated by `when` on our panes'
 *  context keys. Two listeners cannot both own the keyboard." The measurement behind the
 *  rule, twice: keys typed into Monaco beside a mounted vgai stage reached the STAGE —
 *  a bevel recorded into `cube.ts` in the web harness, and on desktop `1,1,1,2,2,2`
 *  arriving as `,,,,,` and saving as `BoxGeometry(,,,,,)` while a `Control+W` meant for
 *  VS Code fired a modeling tool.
 *
 *  THE CHORDS ARE NOT HERE, and that is U6b. U6 registered a keybinding rule per chord at
 *  RUNTIME, from the keymap tables the bridge read out of the open project — which cost the
 *  fork's third core edit, because an upstream rule registered after `workbench.common.main.ts`
 *  has loaded never reaches the resolver. The chords are PACKAGE DATA known at BUILD time;
 *  only the CHOICE of keymap is dynamic, and `vgai.keymap` below already carries it. So they
 *  are generated into a built-in extension's `contributes.keybindings`
 *  (`scripts/workbench/generate-keymaps.mjs` → `extensions/vgai-keymaps/`), one set per keymap, gated on
 *  that context key — VS Code's own keymap-extension path, honoured at load — and the core
 *  edit is gone.
 *
 *  What this file does, and nothing else:
 *
 *  1. PUBLISHES the context keys our panes' state answers — `vgai.focused`,
 *     `vgai.stage.focused`, `vgai.stage.surface`, `vgai.stage.mode`, `vgai.document.kind`,
 *     `vgai.play`, `vgai.keymap` — from the bridge's own door and from real focus tracking
 *     on the parts the contribution hands over. `vgai.keymap` is what SELECTS a generated
 *     set; the project's own `editor.keymap` choice stays authoritative and there is
 *     deliberately no second setting.
 *  2. REGISTERS one `vgai.<action id>` command per generated action, AT LOAD, dispatching
 *     into the vgai editor's own action through the bridge. At load because the extension's
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
import { CARRIED_ACTION_IDS, CARRIED_KEYMAP_IDS } from './vgaiGeneratedKeymaps.js';

// ---- What the bridge hands over. The vgai editor's own door (`@vgai/editor-sdk/host`'s
// `keyboard` member) reshaped by `bridge.tsx` into the facts this frame needs, so this file
// imports nothing of the editor.

export interface VgaiKeyboardBridge {
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
	/** Say something in the vgai editor's OWN console, where `vgai console` reads it —
	 *  the frame's refusals belong in the session's ledger, not in a toast. */
	report(level: 'warn' | 'error', message: string): void;
}

// ---- The context keys.

export const VgaiFocused = new RawContextKey<boolean>('vgai.focused', false, localize('vgaiFocused', "Whether keyboard focus is inside one of the Volter Editor's parts (its stage, outliner or properties)."));
export const VgaiStageFocused = new RawContextKey<boolean>('vgai.stage.focused', false, localize('vgaiStageFocused', "Whether keyboard focus is on a vgai stage."));
export const VgaiStageSurface = new RawContextKey<string>('vgai.stage.surface', '', localize('vgaiStageSurface', "The surface the focused vgai stage paints: three, canvas or dom."));
export const VgaiStageMode = new RawContextKey<string>('vgai.stage.mode', '', localize('vgaiStageMode', "The focused vgai document's own interaction mode (Blender's object, edit or sculpt), when it reports one."));
export const VgaiDocumentKind = new RawContextKey<string>('vgai.document.kind', '', localize('vgaiDocumentKind', "The kind of the active vgai document."));
export const VgaiPlay = new RawContextKey<string>('vgai.play', 'stopped', localize('vgaiPlay', "The vgai session's play state: stopped, playing or paused."));
export const VgaiKeymap = new RawContextKey<string>('vgai.keymap', '', localize('vgaiKeymap', "The keymap the open vgai project selected (its adapter's editor.keymap). A keymap is a keybinding SET — `extensions/vgai-keymaps` contributes one per keymap — and this is what selects it."));

// ---- The commands, registered AT LOAD.
//
// The generated extension's rules exist from the moment the workbench reads its manifest, so
// the commands they name have to exist from then too. There is no bridge yet at that point,
// and no rule can match either (every one of them is gated on `vgai.keymap`, which nothing has
// published), so the handler's job before a mount is only to be honest about it.

let liveBridge: VgaiKeyboardBridge | undefined;

for (const id of CARRIED_ACTION_IDS) {
	CommandsRegistry.registerCommand({
		id: `vgai.${id}`,
		metadata: { description: localize('vgaiAction', "vgai: {0}", id) },
		handler: () => {
			if (!liveBridge) {
				// Reachable only by running the command by hand (the palette, a user
				// keybinding) before the Model workspace is open: no `when` clause can be
				// true yet.
				throw new Error(localize('vgaiNoEditor', "The Volter Editor is not mounted in this window. Run \"Volter Editor: Open Workspace\" first."));
			}
			if (!liveBridge.invoke(id)) {
				liveBridge.report('warn', `The keyboard action "${id}" did not run: the editor has no live handler for it right now (its stage or panel is not mounted), or the action's own gate refused.`);
			}
		},
	});
}

/**
 * Install the one keyboard owner's view of the vgai editor: the context keys the generated
 * keybinding sets are gated on, and the bridge the commands dispatch through. Called once,
 * after the bridge has mounted and handed back its keyboard door.
 */
export class VgaiKeyboard extends Disposable {

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
		private readonly bridge: VgaiKeyboardBridge,
		contextKeyService: IContextKeyService,
	) {
		super();
		this.focused = VgaiFocused.bindTo(contextKeyService);
		this.stageFocused = VgaiStageFocused.bindTo(contextKeyService);
		this.stageSurface = VgaiStageSurface.bindTo(contextKeyService);
		this.stageMode = VgaiStageMode.bindTo(contextKeyService);
		this.documentKind = VgaiDocumentKind.bindTo(contextKeyService);
		this.play = VgaiPlay.bindTo(contextKeyService);
		this.keymap = VgaiKeymap.bindTo(contextKeyService);

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
	 * whose part no longer exists, so `vgai.focused` could stay TRUE with nothing of ours on
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
		// EVERY vgai EDITOR PANE IS THE STAGE, not just the mount's. A workspace AREA is a
		// second editor group and therefore a second `VgaiDocumentPane` (WORK.md's Timeline
		// item 1), offered as `center:<n>`; a keystroke in the Timeline is a keystroke in our
		// surface exactly as one in the Model pane is, and the distinction that matters to
		// `vgai.stage.focused` is ours-versus-Monaco.
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
