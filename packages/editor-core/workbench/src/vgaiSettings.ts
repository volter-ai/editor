/*---------------------------------------------------------------------------------------------
 *  THE SETTINGS — under this frame they are the CONFIGURATION SERVICE'S, and the ADAPTER
 *  LAYER is that service's own MEMORY target.
 *
 *  ARCHITECTURE-CORE §The core is Code-OSS: *"the settings layers and settings UI → the
 *  configuration service (the ADAPTER layer between user and workspace … is the one
 *  addition)"*, and the mechanism ruled 2026-09-19:
 *
 *    When the project's adapter loads, write each adapter-declared key with
 *    `ConfigurationTarget.MEMORY` UNLESS `inspect(key)` shows a workspace or folder value,
 *    and re-evaluate on every configuration change so a project value appearing later clears
 *    the memory value.
 *
 *  WHY THAT IS EXACTLY "project over adapter over user", with no core edit. The platform's own
 *  `Configuration#getConsolidatedConfigurationModel` merges
 *  `default → application → user → workspace → MEMORY`, so memory is the TOP layer: writing
 *  the adapter's keys there puts the adapter above the user for free. What puts the PROJECT
 *  back above the adapter is the INSPECT GATE below — the frame declines to write a key the
 *  workspace (or a folder) already answers, and clears the one it wrote the moment the
 *  workspace starts answering. Nothing is added to the service and no file it owns is patched.
 *
 *  WHY NOT A FORK-ADDED LAYER, considered and rejected by the ruling: it is a core edit in a
 *  core service — a cost paid at every upstream release, against rule 1's named list, for a
 *  layer the service already has.
 *
 *  AND WHY `registerDefaultConfigurations` IS *ALSO* HERE, which is not a contradiction
 *  (ruled 2026-09-19, after U7 measured the gap). A DEFAULT alone cannot carry the adapter:
 *  defaults sit BELOW the user layer, so a person's cross-project `vgai.appearance.palette`
 *  would defeat a skew's look on a models project — the precise inversion §Adapters and
 *  contributions are code rules against. But a MEMORY value is INVISIBLE in the Settings
 *  editor, whose whole model is `inspect()`'s default/user/workspace/folder values, so with
 *  `blender` in force the `Vgai: Keymap` box read EMPTY and, once a user value existed,
 *  showed THAT value with "(Modified in User)" while the effective value was still `blender`.
 *  A person edited a key, saw one value and got another.
 *
 *  So the adapter's value is written to BOTH: to MEMORY, which is what makes it effective
 *  above a user value, and as this window's DEFAULT for that key, which is what makes the
 *  Settings editor SHOW it. The default is additive, per window, and withdrawn when the
 *  project closes — `configurationDefaults` is the door VS Code's own extensions use for
 *  exactly this, and nothing is written to any settings document. The two never disagree
 *  because one `apply()` pass computes both from the same `declared` map.
 *
 *  A user value on an adapter-declared key is therefore VISIBLE but INEFFECTIVE in that
 *  project, and the product says so rather than leaving a person to discover it: ONE
 *  notification per key per session, through the vgai editor's own `notify()` door (under
 *  this frame that IS `INotificationService`, `vgaiNotifications.ts`), naming the key, the
 *  user's value, the adapter's value, and that a workspace value would win.
 *
 *  THE RE-ENTRANCY TRAP, and why the write is guarded. A MEMORY write triggers
 *  `onDidChangeConfiguration` for that key, and this class listens to that event to
 *  re-evaluate — so an unguarded `apply()` writes, wakes itself, writes again, forever. The
 *  guard is two-part and both halves are load-bearing: a re-entrancy flag around the write
 *  pass, and a VALUE COMPARISON that skips a key whose memory value is already what it should
 *  be. The flag alone would still loop across microtask boundaries (`updateValue` is async);
 *  the comparison alone would still churn on the pass that legitimately changes something.
 *
 *  WHAT THE EDITOR SEES. The provider handed back through the bridge answers `get`, `inspect`
 *  and `set` per key, in the vgai editor's own four-layer vocabulary — default / user /
 *  adapter / project / effective — mapped onto `IConfigurationValue`'s `defaultValue`,
 *  `userValue`, `memoryValue`, `workspaceValue ?? workspaceFolderValue` and `value`. A
 *  person's write on an adapter-declared key routes to WORKSPACE, so the gesture lands where
 *  it wins; `settings-store.ts` is what decides that, through the same `inspect`.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationDefaults, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { VGAI_CONFIGURATION_NODE, VGAI_SETTING_KEYS } from './vgaiGeneratedSettings.js';
import { ThemeSettingDefaults } from '../../../services/themes/common/workbenchThemeService.js';
import { TITLE_BAR_HEIGHT_KEY } from './vgaiTitleBar.js';
import { type VgaiLookThemes, vgaiProduct } from './vgaiProduct.js';

// EVERY vgai SETTING, DECLARED AT LOAD. This is the `configuration` contribution point — the
// same door every core contribution under `src/vs/workbench/contrib/**` declares its own
// settings through — so VS Code's Settings editor lists each `vgai.*` key with the sentence
// its Zod `.describe()` call already carries, and `.vscode/settings.json` autocompletes them.
// It is additive and no core file is touched. A generated module rather than an extension
// manifest: configuration, unlike keybindings (U6b), is honoured at load from here.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(VGAI_CONFIGURATION_NODE);
// A product opens its project document; upstream onboarding is not a project.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{ overrides: { 'workbench.startupEditor': 'none', 'zenMode.showTabs': 'none', 'workbench.layoutControl.enabled': true, 'workbench.layoutControl.type': 'toggles' } }]);

/**
 * THE WORKBENCH KEYS A vgai PROJECT NEEDS, carried by the SAME adapter layer.
 *
 * These are VS Code's own settings, not vgai's, so they are not in the generated
 * contribution above and never will be — the workbench declares them, with its own
 * descriptions, and the Settings editor already shows them. What is ours is the CLAIM
 * that a project the vgai editor is editing needs these values, and that claim belongs in
 * exactly the layer every other project-scoped claim lives in: the MEMORY target, above the
 * user and below the workspace.
 *
 * `files.autoSave`. THE DEFECT IT CLOSES, and it is a real one: `vgaiFiles.write` REFUSES a
 * write to a file whose text model is DIRTY, because the editor computes its new source from
 * the file ON DISK and writing that over unsaved keystrokes would destroy them with no event
 * anywhere. Under the vgai editor unsaved state does not exist — "unsaved changes are handled
 * by autosave" (the repo's CLAUDE.md, §Dialogs) — so a person who types one character into
 * `MainScene.tsx` in Monaco and then drags the gizmo got their drag refused, with no
 * indication that the fix was ⌘S. With autoSave the dirty window shrinks from UNBOUNDED to
 * the delay, and the refusal stays exactly where it was: the loud fallback for the case the
 * window did not cover.
 *
 * `files.autoSaveDelay` IS DELIBERATELY INCLUDED, and it SHADOWS a person's own value while a
 * vgai project is open. That is the point rather than an oversight: the delay is the LENGTH of
 * the window in which a vgai write is refused, so a cross-project "save after 30 seconds" is a
 * thirty-second hole in this project's authoring. The value is the workbench's OWN default, so
 * what a person gets here is VS Code's normal behaviour and nothing invented. A project that
 * wants something else says so in `.vscode/settings.json` and the inspect gate hands it back —
 * the same escape every other key in this layer has.
 */
const WORKBENCH_ADAPTER_VALUES: readonly (readonly [string, unknown])[] = [
	['files.autoSave', 'afterDelay'],
	['files.autoSaveDelay', 1000],
];

/**
 * AND THE KEYS WHOSE VALUE THE *LOOK* ANSWERS, on the same layer for the same reason (U9).
 *
 * Unlike the two above these carry no constant here: the number is the active look's own, read
 * off the editor's resolved chrome (`--vgai-command-bar-height`) and handed over by the bridge
 * through `workbenchValues()`. They are listed separately only so `keys`/`appliedKeys` know
 * them — a key this layer may write must be declared, or it is refused by name — and so that a
 * bridge too old to answer `workbenchValues()` CLEARS them rather than leaving a stale height
 * pinned in memory. See `vgaiTitleBar.ts` for the core edit that reads the height.
 */
/**
 * AND THE COLOUR THEME AND PRODUCT ICON THEME, on the same layer, because THE LOOK SELECTS
 * THEM (closes the frame walk's beat 6, 2026-09-19).
 *
 * `extensions/theme-blender` used to carry `workbench.colorTheme: "Blender"` and
 * `workbench.productIconTheme: "blender-icons"` in its own `configurationDefaults`, which
 * applied to every window the extension was installed in — look or no look. MEASURED: with
 * Classic active (`data-vgai-theme=graphite-dark`, `--vgai-surface-panel: #242424`) the
 * workbench still carried `--vscode-vgai-view-background: #303030` and
 * `--vscode-vgai-nodeEditor-background: #1a1a1a`, Blender's traced values, and the Shader
 * Editor and Light Explorer bodies still painted #303030. U8's ruling (2) is that a view's
 * surface colour is a theme colour with a NULL default so **Classic paints nothing** — and a
 * colour theme that is always on is precisely what defeats a null default.
 *
 * So the extension declares the themes and the LOOK chooses one: Blender wears `theme-blender`,
 * Plotter wears the kit's `theme-plotter`, every other look wears the workbench's own defaults, which is what "Classic's reference frame
 * is our panels with no look declared" means. The mapping is the WORKBENCH side's, not the
 * editor's, and that is deliberate — `Blender` and `blender-icons` are names of artifacts in a
 * built workbench, and an editor package naming them would be the panel-knows-the-frame
 * inversion rule 2 forbids. The bridge hands over the LOOK's own id and nothing else.
 *
 * THE ROWS ARE THE PRODUCT'S (P3, 2026-09-21): a product declares, through
 * `registerVgaiProduct({ looks })`, the theme artifacts its build carries: its own extension's
 * (`packages/model-editor/workbench/extensions/theme-blender`) and the kit's, which every
 * product's build carries (`packages/editor-core/workbench/extensions/theme-plotter`). A look a
 * product declares no row for wears the workbench's own.
 */
const COLOR_THEME_KEY = 'workbench.colorTheme';
const PRODUCT_ICON_THEME_KEY = 'workbench.productIconTheme';

/** Look id (the editor's palette id) → the product's theme artifacts. A row is a reviewable
 *  claim that this build SHIPS a theme for that look; a look with no row wears the workbench's
 *  own, which is the honest answer rather than a half-applied Blender. */
const LOOK_THEMES: ReadonlyMap<string, VgaiLookThemes> = vgaiProduct()?.looks ?? new Map();

const WORKBENCH_LOOK_THEME = {
	color: ThemeSettingDefaults.COLOR_THEME_DARK,
	productIcon: ThemeSettingDefaults.PRODUCT_ICON_THEME,
} as const;

const LOOK_KEYS: readonly string[] = [TITLE_BAR_HEIGHT_KEY, COLOR_THEME_KEY, PRODUCT_ICON_THEME_KEY];

/**
 * WHAT THE FRAME HANDS THE EDITOR — the counterpart of the bridge's `VgaiSettingsHandle`,
 * declared here for the same reason `VgaiFilesBridge` is: nothing under `src/vs/` imports an
 * editor module.
 */
export interface VgaiSettingsBridge {
	/** Install the frame's settings provider on `EditorHost.settings`. Called once, after the
	 *  mount, because the services it needs exist only inside the command's own invocation. */
	setProvider(provider: VgaiSettingsProvider): void;
	/** What the open project's `vgai.adapter.ts` DECLARES, as dotted `vgai.*` keys. The editor
	 *  derives it from the adapter object; the frame never parses the adapter itself. */
	adapterValues(): readonly (readonly [string, unknown])[];
	/** VS CODE'S OWN keys whose value the active LOOK answers — today only the top bar's height
	 *  (U9, `vgaiTitleBar.ts`). Optional so a bridge older than this member is a missing door
	 *  rather than a crash; absent, the key is cleared and the title bar keeps its own 30/35.
	 *  `subscribe` below fires for these too. */
	workbenchValues?(): readonly (readonly [string, unknown])[];
	/** The ACTIVE LOOK's own id — the editor's palette id (`blender`, `graphite-dark`, …).
	 *  The frame maps it to the colour and product icon themes THIS FORK ships
	 *  ({@link LOOK_THEMES}); the editor never names a frame artifact. Optional so a bridge
	 *  older than this member is a missing door rather than a crash — absent, both theme keys
	 *  are cleared and the workbench keeps whatever a person or a `.vscode/settings.json`
	 *  chose. `subscribe` below fires for this too. */
	lookId?(): string | undefined;
	/** Fires when the adapter's declaration changes — a project opening, an adapter module
	 *  loading or unloading, the active look changing. Returns the unsubscribe. */
	subscribe(listener: () => void): () => void;
	/** Say something in the vgai editor's OWN console, where `vgai console` reads it. */
	report(level: 'warn' | 'error', message: string): void;
	/** Show one EVENT-shaped message to the person, through the editor's `notify()` door —
	 *  which under this frame is `INotificationService` (`vgaiNotifications.ts`). Not
	 *  `report`: the console is the record an agent reads back, and a user value that will
	 *  not take effect is something a person needs told while they are looking at it.
	 *  Optional so a bridge older than this member is a missing door rather than a crash. */
	notify?(notification: {
		readonly id: string;
		readonly tone: 'info' | 'warning' | 'error';
		readonly title: string;
		readonly detail?: string;
	}): void;
}

export interface VgaiSettingsInspection {
	readonly default: unknown;
	readonly user: unknown;
	readonly adapter: unknown;
	readonly project: unknown;
	readonly effective: unknown;
}

export interface VgaiSettingsProvider {
	get(key: string): unknown;
	inspect(key: string): VgaiSettingsInspection;
	set(key: string, value: unknown, target: 'user' | 'project'): void;
	subscribe(listener: () => void): () => void;
}

/** A setting's value as a PERSON reads it in a sentence: a string in curly quotes, anything
 *  else as its JSON. `JSON.stringify` alone put a string in straight quotes INSIDE the
 *  sentence's own curly ones — `“vgai.keymap” is "blender", not your “"vgai"”` — which reads
 *  as a quoting bug in a message whose whole job is to be believed. */
function displayValue(value: unknown): string {
	return typeof value === 'string' ? `“${value}”` : JSON.stringify(value) ?? String(value);
}

export class VgaiSettings extends Disposable {

	/** Every key this layer may carry: the generated `vgai.*` set plus the workbench keys
	 *  above. A key outside it is refused BY NAME rather than dropped. */
	private readonly keys = new Set([...VGAI_SETTING_KEYS, ...WORKBENCH_ADAPTER_VALUES.map(([key]) => key), ...LOOK_KEYS]);
	/** The order `apply()` walks. Same set, as a list. */
	private readonly appliedKeys: readonly string[] = [...VGAI_SETTING_KEYS, ...WORKBENCH_ADAPTER_VALUES.map(([key]) => key), ...LOOK_KEYS];
	private readonly listeners = new Set<() => void>();
	/** See the header: the write pass must not wake itself. */
	private applying = false;
	/** What is registered as this window's defaults right now, and the signature that decides
	 *  whether a pass has anything to change. Registering fires the registry's own change
	 *  event, which wakes `apply()` — so an unconditional re-register is the same loop the
	 *  memory write's value comparison exists to prevent. */
	private registeredDefaults: IConfigurationDefaults[] = [];
	private registeredDefaultsSignature = '';
	/** ONE notification per key per session (the ruling). A key leaves this set only when the
	 *  window is gone, which is what "per session" means. */
	private readonly notifiedUserValueKeys = new Set<string>();

	constructor(
		private readonly bridge: VgaiSettingsBridge,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.bridge.setProvider({
			get: key => this.configurationService.getValue(key),
			inspect: key => this.inspect(key),
			set: (key, value, target) => this.write(key, value, target),
			subscribe: listener => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			},
		});
		// RE-EVALUATED ON EVERY CONFIGURATION CHANGE — that is the half of the ruling that puts
		// the project back above the adapter. A `.vscode/settings.json` value appearing while
		// the window is open clears the memory value in the same beat, and one being removed
		// puts the adapter's back.
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (!this.appliedKeys.some(key => event.affectsConfiguration(key))) { return; }
			void this.apply();
			for (const listener of this.listeners) { listener(); }
		}));
		// And when the ADAPTER's own declaration moves — a project opening, its adapter module
		// loading. The editor is the only side that knows.
		this._register({ dispose: this.bridge.subscribe(() => void this.apply()) });
		// The defaults are THIS WINDOW'S, so they leave with it — a contribution that is
		// disposed and leaves a `vgai.keymap` default behind would be claiming a project that
		// is no longer open.
		this._register({ dispose: () => this.syncDefaults(new Map()) });
		void this.apply();
	}

	/**
	 * The four layers, in the editor's vocabulary. `workspaceFolderValue` falls in with the
	 * project because a folder IS the project here: the workbench opens exactly one.
	 *
	 * AND A KEY NO LAYER ANSWERS IS *ABSENT*, not an empty string. This is the half that was
	 * missing, and it cost walk 2 its beat 12. `scripts/workbench/generate-settings.mjs` declares every
	 * `vgai.*` key with NO `default` on purpose (a default sits below the user layer, so it
	 * could never carry the adapter's look) — but `configurationRegistry.ts` then fills one in
	 * from the TYPE: `getDefaultValue('string')` is `''`, `'boolean'` is `false`, `'number'` is
	 * `0`. So `inspect(key).value` for a key nobody set is `''`, and `settings-store.ts` rebuilt
	 * the editor's settings DOCUMENT with that empty string in it.
	 *
	 * MEASURED, and the consequence is not local: the Blender look declares ten of the eleven
	 * chrome regions and says nothing about `drawer`, so `appearance.regions` came back carrying
	 * `drawer: ""` — and `workspace-regions.ts`'s `isRegions` guard rejects the WHOLE object for
	 * one value outside `shown|hidden`. The preset layer was `{}` in every frame window: no
	 * workspace tab strip (beat 12), the telemetry cluster the look hides still drawn, the
	 * hierarchy's type suffix and instance rule still drawn, `groupTabs` still `words`. One
	 * synthesised empty string, the entire look's region half.
	 *
	 * The vgai settings document's fields are OPTIONAL — absence is a real answer there, and it
	 * is the answer every layer beneath the frame gives. So a key with no value on any layer
	 * reports `undefined` here, and `settingsFromEntries` skips it exactly as it skips a key the
	 * standalone shape never wrote. Only a value somebody actually set survives.
	 */
	private inspect(key: string): VgaiSettingsInspection {
		const layered = this.configurationService.inspect(key);
		const answered = layered.applicationValue !== undefined
			|| layered.userValue !== undefined
			|| layered.userLocalValue !== undefined
			|| layered.userRemoteValue !== undefined
			|| layered.workspaceValue !== undefined
			|| layered.workspaceFolderValue !== undefined
			|| layered.memoryValue !== undefined
			|| layered.policyValue !== undefined;
		return {
			// `defaultValue` follows the same rule: what the registry synthesised from the type
			// is not a vgai default, and reporting it would put `''` back in the document one
			// layer down. When the ADAPTER declares a key, `syncDefaults` has registered its
			// value as this window's default and `memoryValue` carries it, so `answered` is true
			// and the real default is reported.
			default: answered ? layered.defaultValue : undefined,
			user: layered.userValue ?? layered.userLocalValue,
			adapter: layered.memoryValue,
			project: layered.workspaceFolderValue ?? layered.workspaceValue,
			effective: answered ? layered.value : undefined,
		};
	}

	/**
	 * THE ADAPTER LAYER, applied. One pass over every declared key: write the adapter's value
	 * to MEMORY while the project is silent about it, clear the memory value when the project
	 * speaks or the adapter stops declaring it.
	 *
	 * A key whose memory value is already right is skipped — see the header's re-entrancy
	 * trap; without that comparison this pass wakes its own listener on every change.
	 */
	private async apply(): Promise<void> {
		if (this.applying) { return; }
		this.applying = true;
		try {
			// The workbench keys FIRST, so a project's adapter that somehow declares one of them
			// wins — the project's own code outranks this file's claim about what a vgai project
			// needs, which is the same precedence the layers already state.
			const declared = new Map<string, unknown>(WORKBENCH_ADAPTER_VALUES);
			// THE LOOK'S OWN (U9), before the adapter's for the same precedence reason: what the
			// project's code says outranks what the look computed.
			for (const [key, value] of this.bridge.workbenchValues?.() ?? []) {
				if (!LOOK_KEYS.includes(key)) { continue; }
				if (value !== undefined) { declared.set(key, value); }
			}
			// AND THE LOOK'S THEMES. A look with no row wears the workbench's own defaults
			// rather than nothing: clearing the keys would hand the window back to whatever a
			// person last picked, which is not "Classic" — it is "whatever was there".
			const look = this.bridge.lookId?.();
			if (look !== undefined) {
				const themes = LOOK_THEMES.get(look) ?? WORKBENCH_LOOK_THEME;
				declared.set(COLOR_THEME_KEY, themes.color);
				declared.set(PRODUCT_ICON_THEME_KEY, themes.productIcon);
			}
			for (const [key, value] of this.bridge.adapterValues()) {
				if (!this.keys.has(key)) {
					// A key the schema does not declare cannot be shown, read back or written by
					// anyone: name it rather than dropping it, because the silent version is an
					// adapter whose look simply does not apply and says nothing about why.
					this.bridge.report('warn', localize('vgaiSettingsUnknownKey', "The project's adapter declares “{0}”, which is not a vgai setting, so it was not applied. Regenerate the frame's settings contribution if the schema has grown: node scripts/workbench/generate-settings.mjs --write", key));
					continue;
				}
				declared.set(key, value);
			}
			// THE DEFAULTS, from the same `declared` map that feeds the memory writes below, so
			// the value the Settings editor SHOWS and the value in force cannot drift apart.
			this.syncDefaults(declared);
			for (const key of this.appliedKeys) {
				const layered = this.configurationService.inspect(key);
				// THE INSPECT GATE. A project value — `.vscode/settings.json`, or a folder's —
				// outranks the adapter, so the adapter's value is not written at all and one
				// written earlier is cleared.
				const projectSpeaks = layered.workspaceValue !== undefined || layered.workspaceFolderValue !== undefined;
				const wanted = projectSpeaks ? undefined : declared.get(key);
				this.reportIneffectiveUserValue(key, layered.userValue ?? layered.userLocalValue, wanted, projectSpeaks);
				if (layered.memoryValue === wanted) { continue; }
				await this.configurationService.updateValue(key, wanted, ConfigurationTarget.MEMORY);
			}
		} catch (error) {
			this.bridge.report('error', localize('vgaiSettingsApplyFailed', "The project's adapter settings could not be applied: {0}", error instanceof Error ? error.message : String(error)));
		} finally {
			this.applying = false;
		}
	}

	/**
	 * THIS WINDOW'S DEFAULTS for the adapter-declared keys — what makes the adapter's value
	 * VISIBLE in the Settings editor, which reads `inspect()` and has no memory-layer concept.
	 *
	 * Only the `vgai.*` keys: the workbench keys this layer also carries (`files.autoSave`,
	 * `window.titleBarHeight`) are VS Code's own, declared by the workbench with its own
	 * defaults, and re-defaulting somebody else's setting is a claim about their product
	 * rather than about this project.
	 *
	 * Registered and deregistered as ONE record so the withdrawal is exact: an adapter that
	 * stops declaring a key, or a project that closes, leaves the key's real default behind
	 * and nothing of ours. The signature check is the re-entrancy guard's other half — see the
	 * field's own note.
	 */
	private syncDefaults(declared: ReadonlyMap<string, unknown>): void {
		const overrides: Record<string, unknown> = {};
		for (const key of VGAI_SETTING_KEYS) {
			const value = declared.get(key);
			if (value !== undefined) { overrides[key] = value; }
		}
		const signature = JSON.stringify(overrides);
		if (signature === this.registeredDefaultsSignature) { return; }
		const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		if (this.registeredDefaults.length > 0) {
			registry.deregisterDefaultConfigurations(this.registeredDefaults);
			this.registeredDefaults = [];
		}
		this.registeredDefaultsSignature = signature;
		if (Object.keys(overrides).length === 0) { return; }
		this.registeredDefaults = [{ overrides }];
		registry.registerDefaultConfigurations(this.registeredDefaults);
	}

	/**
	 * A USER VALUE ON AN ADAPTER-DECLARED KEY: visible in the Settings editor, and ineffective
	 * in this project because the adapter's value sits above it on the memory layer. Said once
	 * per key per session, to the person, at the moment it is observed — at load or on change.
	 *
	 * Nothing is written and nothing is refused: the person's value is theirs and it is what
	 * every OTHER project will use. What the notification adds is the sentence they cannot get
	 * from the Settings editor, which has no way to draw a layer it does not model.
	 */
	private reportIneffectiveUserValue(key: string, userValue: unknown, adapterValue: unknown, projectSpeaks: boolean): void {
		if (projectSpeaks || userValue === undefined || adapterValue === undefined) { return; }
		if (userValue === adapterValue) { return; }
		if (this.notifiedUserValueKeys.has(key)) { return; }
		this.notifiedUserValueKeys.add(key);
		this.bridge.notify?.({
			id: `vgai-settings-user-value-${key}`,
			tone: 'info',
			title: localize('vgaiSettingsUserValueShadowed', "“{0}” is {1} in this project, not your {2}.", key, displayValue(adapterValue), displayValue(userValue)),
			detail: localize('vgaiSettingsUserValueShadowedDetail', "This project's adapter declares the value, and a project's declaration outranks a user setting. Your setting still applies everywhere else. To change it HERE, set it in this workspace ({0}) — a workspace value wins over both.", '.vscode/settings.json'),
		});
	}

	/**
	 * A person's write.
	 *
	 * `'project'` is the WORKSPACE target — `.vscode/settings.json`, the file the frame's own
	 * project layer IS — and it is where a gesture on an adapter-declared key lands, because
	 * the memory value above the user layer would swallow a user write whole. `'user'` is the
	 * ordinary user settings file.
	 */
	private write(key: string, value: unknown, target: 'user' | 'project'): void {
		if (!this.keys.has(key)) {
			this.bridge.report('error', localize('vgaiSettingsWriteUnknownKey', "“{0}” is not a vgai setting, so it was not written.", key));
			return;
		}
		const configurationTarget = target === 'project' ? ConfigurationTarget.WORKSPACE : ConfigurationTarget.USER;
		this.configurationService.updateValue(key, value, configurationTarget).then(
			// A write to the workspace that the project also declares through its adapter needs
			// the memory value gone, or the effective value does not move and the gesture looks
			// like it did nothing. The change event runs `apply()` too; this makes the ordering
			// explicit rather than incidental.
			() => void this.apply(),
			error => this.bridge.report('error', localize('vgaiSettingsWriteFailed', "“{0}” could not be written to the {1} settings: {2}", key, target, error instanceof Error ? error.message : String(error))),
		);
	}
}
