#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  THE OVERLAY — our workbench tier, copied onto a Code-OSS checkout at the pin.
 *
 *  TRIGGER: you are about to compile, run or package a workbench that has to contain the volter
 *  editor — `scripts/workbench/dev.mjs` (a sources boot) and `scripts/workbench/build-release.mjs`
 *  (a release) both run this first, and it is the only thing that ever writes volter files into a
 *  fork checkout.
 *
 *    node scripts/workbench/overlay.mjs --checkout <fork dir> --product <editor>
 *
 *  WHY IT EXISTS. ARCHITECTURE-CORE §The target shape, rule 6: *"Nothing of ours is built inside
 *  a fork: the product build OVERLAYS the tier on the fork at a pin."* Until 2026-09-21 the tier
 *  WAS the fork — 3,395 lines under `src/vs/workbench/contrib/volterBlender/`, a file named
 *  `volterGameSkew.ts`, two generated artifacts and two extensions — so every edit to our own
 *  workbench code was a commit in another repository, and the fork's diff against upstream was
 *  ours as much as it was patches. Now the three homes are here:
 *
 *    packages/editor-core/workbench/        the KIT's half         → contrib/volter/browser/
 *    packages/<product>/workbench/     the PRODUCT's half     → contrib/volterProduct/browser/
 *
 *  and what the fork carries is upstream plus patches.
 *
 *  A THIRD HOME, ONLY WHEN NAMED: LOOK TIERS. A package outside this repository may carry the
 *  frame half of a look, declared as `package.json#volter.workbench`:
 *
 *    { "contrib": "volterBrand", "root": "./editor/workbench", "media": { "fonts": "./fonts" } }
 *
 *  and a build carries it only when its directory is passed, `--look <package dir>` (repeatable):
 *  `<root>/src` → `contrib/<contrib>/browser/` (its `look.contribution.ts` is imported after the
 *  product's and before the kit's), `<root>/extensions/*` → `extensions/`, and each `media` entry
 *  → `contrib/<contrib>/browser/media/<name>/`. Nothing in the install brings one in by itself,
 *  so a build of this repository never carries a look package's code unless its builder named
 *  it — the Volter brand's private package (`volter-ai/brand`, its Plotter look) in particular.
 *
 *  WHY THE PRODUCT'S DIRECTORY IS ONE FIXED NAME. `volterProduct` rather than `volterModelEditor`:
 *  the registration import line, the build's resource glob and the product's own
 *  `FileAccess.asBrowserUri('vs/workbench/contrib/volterProduct/browser/media/Inter.woff2')` are
 *  then the same strings for every product, so the patch this writes is one shape and a product
 *  swap in the same checkout cannot leave a path behind. WHICH product a build is, is recorded
 *  in `.volter-overlay.json` and in the release's `BUILD.json`, never in a path.
 *
 *  THE AI IN THE TAB RIDES HERE TOO (B9b). ARCHITECTURE-CORE §The core is Code-OSS rule 7: the
 *  workbench's own Chat view is the agent's front end, and what fills the default-participant
 *  slot is supercode's `sdk/frontend-vscode`, consumed as the PUBLISHED npm package. So this
 *  also writes `extensions/supercode-chat` (the package's own `pack-extension.mjs` output —
 *  one `package.json` cannot be both an npm manifest and an extension manifest, and that
 *  transform is supercode's, not a fifteen-line copy of it here), REMOVES `extensions/copilot`
 *  (272 MB of GitHub Copilot Chat, the open-source default agent Code-OSS vendors), and rewrites
 *  `product.json` to name ours, grant reviewed proposed APIs and use Open VSX for user installs.
 *
 *  IT IS IDEMPOTENT, and that is a requirement rather than a nicety: `dev.mjs` runs it on every
 *  boot. The overlaid directories are REMOVED and re-copied (so a product swap cannot leave the
 *  other product's files), and the four patched upstream files are rewritten from their own
 *  contents with our lines stripped first.
 *
 *  WHAT IT REFUSES. A checkout whose HEAD is not `packages/editor-core/workbench/FORK.json`'s commit,
 *  by name, with the `git -C … checkout` line to run. A pin is what makes "the tier is not in
 *  the fork" honest: the kit's TypeScript reaches four levels up into `src/vs/`, so it compiles
 *  against the fork's own modules and a fork that moved is a fork our code was never read
 *  against.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KIT_DIR = join(REPO_ROOT, 'packages/editor-core/workbench');
const PIN_PATH = join(KIT_DIR, 'FORK.json');

/** Where each half lands inside the fork. Both are four levels under `src/vs/`, which is what
 *  makes the `../../../../base/...` imports our files carry resolve unchanged. */
const KIT_TARGET = 'src/vs/workbench/contrib/volter/browser';
const PRODUCT_TARGET = 'src/vs/workbench/contrib/volterProduct/browser';
/** The two registration lines, in this order: the product registers itself at module scope and
 *  the kit reads it at module scope, so the product's import has to be evaluated first. */
const PRODUCT_IMPORT = "import './contrib/volterProduct/browser/product.contribution.js';";
const KIT_IMPORT = "import './contrib/volter/browser/volter.contribution.js';";
const MAIN_FILE = 'src/vs/workbench/workbench.common.main.ts';
const WEB_GULPFILE = 'build/gulpfile.vscode.web.ts';
const REH_GULPFILE = 'build/gulpfile.reh.ts';
const NPM_DIRS_FILE = 'build/npm/dirs.ts';
const PRODUCT_FILE = 'product.json';
const MARKER = '.volter-overlay.json';

/**
 * THE CHAT EXTENSION — bundled from npm, never vendored and never forked.
 *
 * `id` is what vsce derives (`${publisher}.${name}`) and therefore what `product.json` has to
 * name; it is asserted against the packed manifest rather than trusted, because a wrong id here
 * is invisible until a person types into the Chat view and nothing answers.
 * `proposals` is the extension's own `enabledApiProposals` — a built-in extension gets them from
 * `product.json#extensionEnabledApiProposals` and needs no `--enable-proposed-api` flag. The
 * workbench NULLS a proposal it did not grant, and the extension reads the filtered list back
 * and degrades per part, so this list is a grant and not a promise.
 */
export const CHAT_EXTENSION = {
	package: '@volter/supercode-frontend-vscode',
	directory: 'supercode-chat',
	id: 'volter-ai-dev.supercode-frontend-vscode',
	proposals: [
		'defaultChatParticipant',
		'chatParticipantPrivate',
		'chatParticipantAdditions',
		'chatSessionsProvider',
		'chatProvider',
	],
	/** The glyph the workbench draws for its default chat agent — the status bar entry and the
	 *  chat title-bar actions. It is the CORE's, not the extension's, so removing
	 *  `extensions/copilot` does not remove GitHub Copilot's mark from the status bar: the ids
	 *  are literals in `chatStatus/chatStatusEntry.ts`. Fork core edit #3 (volter-ai/code-oss#48)
	 *  reads them from here, falling back to the Copilot family when a product names none.
	 *  `chat-sparkle` is what this Code-OSS already draws for the Chat VIEW itself
	 *  (`chatParticipant.contribution.ts`'s `chat-view-icon`), so the two now agree. */
	icon: 'chat-sparkle',
};
/** What leaves the release with it: the vendored GitHub Copilot Chat, 272 MB unpacked. */
const COPILOT_EXTENSION = 'copilot';

function fail(message) {
	console.error(`overlay: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = { checkout: null, product: null, looks: [] };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--checkout') { args.checkout = argv[++i]; }
		else if (argv[i] === '--product') { args.product = argv[++i]; }
		else if (argv[i] === '--look') { args.looks.push(resolve(argv[++i])); }
		else { fail(`unknown argument "${argv[i]}". Usage: node scripts/workbench/overlay.mjs --checkout <fork dir> --product <editor> [--look <package dir>]…`); }
	}
	if (!args.checkout) { fail('--checkout <fork dir> is required — the Code-OSS checkout to overlay.'); }
	if (!args.product) { fail(`--product <id> is required. Products with a workbench half here: ${knownProducts().join(', ')}.`); }
	return { checkout: resolve(args.checkout), product: args.product, looks: args.looks };
}

/** Every package that carries a workbench half, by its directory name under `packages/`. */
export function knownProducts() {
	return readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== 'editor-core')
		.filter((entry) => existsSync(join(REPO_ROOT, 'packages', entry.name, 'workbench/src')))
		.map((entry) => entry.name)
		.sort();
}

/** The pinned fork, read once. */
export function forkPin() {
	const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'));
	for (const key of ['repo', 'commit']) {
		if (typeof pin[key] !== 'string' || pin[key] === '') {
			fail(`${PIN_PATH} names no ${key}. The pin is { "repo", "branch", "commit" } and the commit is what every overlay is checked against.`);
		}
	}
	return pin;
}

/** Refuse a checkout that is not at the pin, by name. A dirty tree is fine — this is what
 *  makes it dirty. */
export function assertAtPin(checkout) {
	const pin = forkPin();
	if (!existsSync(join(checkout, MAIN_FILE))) {
		fail(`${checkout} is not a Code-OSS checkout: it has no ${MAIN_FILE}.`);
	}
	let head;
	try {
		head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
	} catch (error) {
		fail(`\`git rev-parse HEAD\` failed in ${checkout} (${error instanceof Error ? error.message : String(error)}). The overlay is checked against ${PIN_PATH}'s commit, so the checkout has to be a git working tree.`);
	}
	if (head !== pin.commit) {
		fail(
			`${checkout} is at ${head} and the pin is ${pin.commit}.\n` +
			`  The tier is compiled against the fork's own modules, so it is read against ONE commit.\n` +
			`  Move the checkout:   git -C ${checkout} fetch origin && git -C ${checkout} checkout ${pin.commit}\n` +
			`  Or move the pin:     ${PIN_PATH} (and say in the commit what was read against the new one).`
		);
	}
	return pin;
}

/** Copy a tree, having removed whatever was there. */
function replaceTree(from, to) {
	rmSync(to, { recursive: true, force: true });
	mkdirSync(dirname(to), { recursive: true });
	cpSync(from, to, { recursive: true });
}

/**
 * The registration imports, as an idempotent rewrite: every volter contribution import is
 * stripped and the two are appended after the LAST upstream contribution import — last, so our
 * command shadowing (the auxiliary-window refusal) is registered after the commands it shadows,
 * which `CommandsRegistry`'s most-recent-wins list is what makes work.
 */
function patchRegistrationImports(checkout, tiers) {
	const path = join(checkout, MAIN_FILE);
	const lines = readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => !/^import '\.\/contrib\/volter[^']*';$/.test(line))
		.filter((line, index, all) => !line.startsWith('// VOLTER (overlaid tier') && !(line === '' && all[index + 1]?.startsWith('// VOLTER (overlaid tier')));
	let last = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^import '\.\/contrib\/.*\.js';$/.test(lines[i])) { last = i; }
	}
	if (last === -1) { fail(`${path} carries no \`import './contrib/….js';\` line to register beside.`); }
	const tierImports = tiers.map((tier) => `import './contrib/${tier.contrib}/browser/look.contribution.js';`);
	lines.splice(last + 1, 0, '', '// VOLTER (overlaid tier — scripts/workbench/overlay.mjs; the product and its look tiers register, then the kit reads them)', PRODUCT_IMPORT, ...tierImports, KIT_IMPORT);
	writeFileSync(path, lines.join('\n'));
}

/**
 * The build's resource glob. Our media travels the way upstream's contribs' media does:
 * `vscodeWebResourceIncludes` is where every contrib's media is listed and `gulpfile.reh.ts`
 * spreads that list into `serverWithWebResourceIncludes`, so one entry there covers the REH
 * package and `vscode-web` both. Without it the packaged workbench 404s on `Inter.woff2` —
 * measured cutting U3's first release.
 */
function patchWebResources(checkout, tiers) {
	const path = join(checkout, WEB_GULPFILE);
	const source = readFileSync(path, 'utf8');
	const startMarker = 'export const vscodeWebResourceIncludes = [';
	const start = source.indexOf(startMarker);
	if (start === -1) { fail(`${path} has no \`${startMarker}\` — upstream moved the resource list and this patch needs re-aiming.`); }
	const end = source.indexOf('\n];', start);
	if (end === -1) { fail(`${path}'s vscodeWebResourceIncludes has no closing \`];\`.`); }
	const head = source.slice(0, start + startMarker.length);
	// `end` is the index of the newline before `];`, so the tail KEEPS that newline: our last
	// entry has no trailing comma and the array's closing bracket has to start its own line.
	const tail = source.slice(end);
	const body = source
		.slice(start + startMarker.length, end)
		.split('\n')
		.filter((line) => !line.includes('contrib/volter') && !line.includes('// VOLTER'))
		.join('\n')
		.replace(/,?\s*$/, ',');
	// `out-build` IS the compiled `src/`, so the glob drops that prefix: a path with it in
	// matches nothing and the packaged workbench 404s on the font with no build-time error.
	const outBuild = (target) => `out-build/${target.replace(/^src\//, '')}`;
	const ours = [
		'',
		'',
		'\t// VOLTER (overlaid tier — scripts/workbench/overlay.mjs)',
		...[KIT_TARGET, PRODUCT_TARGET, ...tiers.map((tier) => `src/vs/workbench/contrib/${tier.contrib}/browser`)]
			.map((target, index, all) => `\t'${outBuild(target)}/media/**'${index === all.length - 1 ? '' : ','}`),
	].join('\n');
	writeFileSync(path, `${head}${body}${ours}${tail}`);
}

/**
 * THE PIN IS THE DECLARED DEPENDENCY, and it is EXACT on purpose. `^0.1.1` would let a machine
 * whose install is a week old bundle different bytes into a release whose `BUILD.json` names one
 * version, and a release is the one artifact whose contents have to be a function of this
 * repository. There is deliberately no second pin file: the dependency IS the pin.
 */
export function chatExtension() {
	const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
	const pin = rootManifest.devDependencies?.[CHAT_EXTENSION.package];
	if (typeof pin !== 'string') {
		fail(`package.json declares no devDependency "${CHAT_EXTENSION.package}", and the release bundles it as extensions/${CHAT_EXTENSION.directory}. Declare it at an exact version.`);
	}
	if (!/^\d+\.\d+\.\d+/.test(pin)) {
		fail(`package.json pins "${CHAT_EXTENSION.package}" as "${pin}". A release's bytes are a function of this repository, so this one is pinned EXACTLY — drop the range.`);
	}
	const dir = join(REPO_ROOT, 'node_modules', CHAT_EXTENSION.package);
	if (!existsSync(join(dir, 'package.json'))) {
		fail(`${dir} is not installed, and the release bundles it as extensions/${CHAT_EXTENSION.directory}.\n  npm install`);
	}
	const installed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	if (installed.version !== pin) {
		fail(`${CHAT_EXTENSION.package} is installed at ${installed.version} and package.json pins ${pin}. The release would carry bytes its BUILD.json misnames.\n  npm install`);
	}
	const packer = join(dir, 'scripts/pack-extension.mjs');
	if (!existsSync(packer)) {
		fail(`${packer} is not in the installed package. It is what writes the EXTENSION manifest (unscoped name → ${CHAT_EXTENSION.id}) beside the built bytes; ${CHAT_EXTENSION.package}@${installed.version} predates its shipping. Pin a version that carries it.`);
	}
	return { dir, packer, version: installed.version };
}

/**
 * Write the extension INTO the clone, through the package's own packer. The packed folder is
 * `package.json` + `dist` + `vendor` + README + NOTICE and nothing else — no `scripts`, no
 * `node_modules`, no npm manifest fields a VS Code host would choke on.
 */
function writeChatExtension(checkout, extension) {
	const target = join(checkout, 'extensions', CHAT_EXTENSION.directory);
	execFileSync(process.execPath, [extension.packer, '--out', target], { stdio: 'pipe' });
	// The npm frontend includes its license declaration and NOTICE, but omits
	// the permission text. Preserve the reviewed repository MIT notice too.
	writeFileSync(join(target, 'LICENSE.txt'), readFileSync(join(REPO_ROOT, 'release/licenses/supercode.txt')));
	const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
	const id = `${manifest.publisher}.${manifest.name}`;
	if (id !== CHAT_EXTENSION.id) {
		fail(`the packed extension's id is ${id} and product.json is written for ${CHAT_EXTENSION.id}. A default chat participant nothing can name answers nothing; re-aim CHAT_EXTENSION.id here.`);
	}
	// This product grants defaultChatParticipant unconditionally. Advertise it
	// before activation so native Chat does not select an unimplemented core
	// fallback while waiting for the extension's context key to be published.
	for (const participant of manifest.contributes?.chatParticipants ?? []) {
		if (participant.isDefault) { delete participant.when; }
	}
	writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	return manifest.version;
}

/**
 * NATIVE CHAT REPAIRS at this pin. Each names the exact upstream text it replaces and fails
 * when upstream moved, so a re-pin re-aims it rather than silently dropping it.
 */
function patchChatSource(checkout, relative, original, replacement, what) {
	const file = join(checkout, relative);
	const source = readFileSync(file, 'utf8');
	if (source.includes(replacement)) { return; }
	if (!source.includes(original)) { fail(`${relative}: ${what} changed upstream; re-aim this repair.`); }
	writeFileSync(file, source.replace(original, replacement));
}

/** Open VSX installs use the same Node installer from commands and Extensions.
 * Like VSCodium and code-server, disable Microsoft's repository-signature check:
 * this Code-OSS build does not ship the proprietary verifier. See
 * docs/EXTENSION-SIGNATURES.md for pinned references and the remaining checks. */
function patchExtensionSignatures(checkout) {
	const path = join(checkout, 'src/vs/platform/extensionManagement/node/extensionManagementService.ts');
	let source = readFileSync(path, 'utf8');
	const before = '\t\t\tconst value = this.configurationService.getValue(VerifyExtensionSignatureConfigKey);\n\t\t\tverifySignature = isBoolean(value) ? value : true;';
	const after = '\t\t\t// VOLTER: Open VSX; no Microsoft repository-signature verifier.\n\t\t\tverifySignature = false;';
	if (source.includes(after)) { return; }
	const config = '\t\t@IConfigurationService private readonly configurationService: IConfigurationService,';
	if (source.split(before).length !== 2 || !source.includes(config) || !source.includes('\tVerifyExtensionSignatureConfigKey,\n')) {
		fail(`${path}: extension signature installer changed; review the Open VSX patch against the fork pin.`);
	}
	source = source.replace(before, after)
		.replace('\tVerifyExtensionSignatureConfigKey,\n', '')
		.replace(config, '\t\t// @ts-expect-error no-unused-variable (signature verification is unavailable)\n' + config);
	writeFileSync(path, source);
}

/** One awaited policy boundary, shared by cached reveals and direct native loads. */
function patchHarnessChatNavigation(checkout) {
	const widget = 'src/vs/workbench/contrib/chat/browser/widget/chatWidgetService.ts';
	const editor = 'src/vs/workbench/contrib/chat/browser/widgetHosts/editor/chatEditor.ts';
	const view = 'src/vs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane.ts';
	const group = 'src/vs/workbench/browser/parts/editor/editorGroupView.ts';
	const widgetImport = "import { HarnessChatNavigationPermit, IHarnessChatNavigationService } from '../../../volter/browser/volterChatNavigation.js';";
	const hostImport = "import { HarnessChatNavigationPermit, IHarnessChatNavigationService } from '../../../../volter/browser/volterChatNavigation.js';";
	patchChatSource(checkout, widget, "import { ChatViewPane } from '../widgetHosts/viewPane/chatViewPane.js';", "import { ChatViewPane } from '../widgetHosts/viewPane/chatViewPane.js';\n" + widgetImport, 'harness navigation service import');
	patchChatSource(checkout, widget, '\t\t@ILogService private readonly logService: ILogService,', '\t\t@ILogService private readonly logService: ILogService,\n\t\t@IHarnessChatNavigationService private readonly harnessNavigation: IHarnessChatNavigationService,', 'harness navigation service injection');
	patchChatSource(checkout, widget, "import { timeout } from '../../../../../base/common/async.js';", "import { timeout } from '../../../../../base/common/async.js';\nimport { CancellationError } from '../../../../../base/common/errors.js';", 'untitled opening cancellation import');
	patchChatSource(checkout, widget, "import { CancellationError } from '../../../../../base/common/errors.js';", "import { CancellationError } from '../../../../../base/common/errors.js';\nimport { CancellationTokenSource } from '../../../../../base/common/cancellation.js';", 'untitled opening cancellation token');
	patchChatSource(checkout, widget, '\tprivate _widgets: IChatWidget[] = [];', '\tprivate _widgets: IChatWidget[] = [];\n\tprivate harnessOpenGeneration = 0;\n\tprivate harnessUntitledOpening: (() => boolean) | undefined;\n\tprivate cancelHarnessUntitledOpening: (() => void) | undefined;', 'native open request generation');
	const open = '\tasync openSession(sessionResource: URI, target?: typeof ChatViewPaneTarget | PreferredGroup, options?: IChatEditorOptions): Promise<IChatWidget | undefined> {';
	patchChatSource(checkout, widget, open, `${open}
		this.cancelHarnessUntitledOpening?.();
		const generation = ++this.harnessOpenGeneration;
		const untitledSidebar = sessionResource.scheme === 'supercode' && sessionResource.path.startsWith('/untitled-')
			&& (target === ChatViewPaneTarget || typeof target === 'undefined') && !this.getWidgetBySessionResource(sessionResource);
		const focused = this.lastFocusedWidget;
		const focusedResource = focused?.viewModel?.sessionResource.toString();
		let bindingWidget: IChatWidget | undefined;
		let focusing = false;
		let unchanged = true;
		const cancellation = untitledSidebar ? new CancellationTokenSource() : undefined;
		const invalidate = () => { unchanged = false; cancellation?.cancel(); };
		const isCurrent = () => unchanged && generation === this.harnessOpenGeneration
			&& (!bindingWidget || this._widgets.includes(bindingWidget));
		if (untitledSidebar) { this.harnessUntitledOpening = isCurrent; this.cancelHarnessUntitledOpening = invalidate; }
		const focusListeners: IDisposable[] = [];
		const observeFocus = (widget: IChatWidget) => focusListeners.push(widget.onDidFocus(() => {
			if (!focusing || widget !== bindingWidget || widget.viewModel?.sessionResource.toString() !== sessionResource.toString()) { invalidate(); }
		}));
		if (untitledSidebar) {
			this._widgets.forEach(observeFocus);
			focusListeners.push(this.editorService.onDidActiveEditorChange(invalidate), this.editorGroupsService.onDidChangeActiveGroup(invalidate));
			focusListeners.push(this.onDidRemoveWidget(widget => { if (widget === bindingWidget) { invalidate(); } }));
		}
		const added = untitledSidebar ? this.onDidAddWidget(widget => {
			if (isIChatViewViewContext(widget.viewContext) && widget.viewContext.viewId === ChatViewId) { bindingWidget = widget; }
			observeFocus(widget);
		}) : undefined;
		const listener = untitledSidebar ? this.onDidChangeFocusedSession(() => {
			const widget = this.lastFocusedWidget;
			const key = widget?.viewModel?.sessionResource.toString();
			// The original focus may stay put, or its own load may bind the target.
			// Any other selection invalidates this opening permanently.
			if (widget === focused && key === focusedResource) { return; }
			if (bindingWidget && widget === bindingWidget && key === sessionResource.toString()) { return; }
			invalidate();
		}) : undefined;
		try {
			return await this.harnessNavigation.run(sessionResource, async permit => {
				const opening = untitledSidebar ? { isCurrent, token: cancellation!.token,
					willBind: (widget: IChatWidget) => { bindingWidget = widget; }, willFocus: () => { focusing = true; } } : undefined;
				const widget = await this.openSessionAfterGuard(sessionResource, target, options, permit, opening);
				if (untitledSidebar && !isCurrent()) { throw new CancellationError(); }
				if ((permit || untitledSidebar) && widget?.viewModel?.sessionResource.toString() !== sessionResource.toString()) {
					throw new Error('The requested conversation was not selected by native Chat.');
				}
				return widget;
			}, options?.harnessNavigationPermit, untitledSidebar ? isCurrent : undefined);
		} finally {
			listener?.dispose(); added?.dispose(); focusListeners.forEach(listener => listener.dispose()); cancellation?.dispose();
			if (this.harnessUntitledOpening === isCurrent) { this.harnessUntitledOpening = undefined; this.cancelHarnessUntitledOpening = undefined; }
		}
	}

	private async openSessionAfterGuard(sessionResource: URI, target?: typeof ChatViewPaneTarget | PreferredGroup, options?: IChatEditorOptions, permit?: HarnessChatNavigationPermit, opening?: { isCurrent: () => boolean; token: CancellationTokenSource['token']; willBind: (widget: IChatWidget) => void; willFocus: () => void }): Promise<IChatWidget | undefined> {
		if (permit) { options = { ...options, harnessNavigationPermit: permit }; }`, 'guard before native session selection');
	patchChatSource(checkout, widget, '\t\tif (!this._lastFocusedWidget) {\n\t\t\tthis.setLastFocusedWidget(newWidget);', `\t\t// An unfocused sidebar created by this current draft open is not a focus
		// gesture. Its requested focus will be published after target binding.
		if (!this._lastFocusedWidget && !(this.harnessUntitledOpening?.()
			&& isIChatViewViewContext(newWidget.viewContext) && newWidget.viewContext.viewId === ChatViewId)) {
			this.setLastFocusedWidget(newWidget);`, 'defer owned sidebar registration focus until binding');
	patchChatSource(checkout, widget, 'await chatView.loadSession(sessionResource, options?.sessionTypeSelectionReason);', `if (opening && !opening.isCurrent()) { throw new CancellationError(); }
				opening?.willBind(chatView.widget);
				await chatView.loadSession(sessionResource, options?.sessionTypeSelectionReason, permit, opening?.token);`, 'nested sidebar navigation permit and opening currentness');
	patchChatSource(checkout, widget, 'const chatView = await this.viewsService.openView<ChatViewPane>(ChatViewId, !options?.preserveFocus);', `// A harness draft owns its requested URI before this awaited open. Do not
			// publish the outgoing sidebar's focus before binding that URI.
			const chatView = await this.viewsService.openView<ChatViewPane>(ChatViewId, sessionResource.scheme === 'supercode' ? false : !options?.preserveFocus);`, 'bind harness sidebar before requested focus');
	patchChatSource(checkout, widget, 'await chatView.loadSession(sessionResource, options?.sessionTypeSelectionReason, permit, opening?.token);\n\t\t\t\tif (!options?.preserveFocus)', `await chatView.loadSession(sessionResource, options?.sessionTypeSelectionReason, permit, opening?.token);
				if (sessionResource.scheme === 'supercode' && chatView.widget?.viewModel?.sessionResource.toString() !== sessionResource.toString()) {
					throw new Error('The requested conversation was not bound by the native Chat view.');
				}
				if (opening && !opening.isCurrent()) { throw new CancellationError(); }
				if (!options?.preserveFocus)`, 'validate harness sidebar binding before requested focus');
	patchChatSource(checkout, widget, '\t\t\t\t\tchatView.focusInput();', '\t\t\t\t\topening?.willFocus();\n\t\t\t\t\tchatView.focusInput();', 'own final requested draft focus');
	const reveal = '\tasync reveal(widget: IChatWidget, preserveFocus?: boolean): Promise<boolean> {';
	patchChatSource(checkout, widget, reveal, `${reveal}
		const resource = widget.viewModel?.sessionResource;
		return resource ? this.harnessNavigation.run(resource, async permit => {
			const revealed = await this.revealAfterGuard(widget, preserveFocus, permit);
			if (permit && (!revealed || !this._widgets.includes(widget) || widget.viewModel?.sessionResource.toString() !== resource.toString())) {
				throw new Error('The requested conversation was not revealed by native Chat.');
			}
			return revealed;
		}, undefined,
			() => this._widgets.includes(widget) && widget.viewModel?.sessionResource.toString() === resource.toString()) : this.revealAfterGuard(widget, preserveFocus);
	}

	private async revealAfterGuard(widget: IChatWidget, preserveFocus?: boolean, permit?: HarnessChatNavigationPermit): Promise<boolean> {`, 'guard before cached widget reveal');
	patchChatSource(checkout, widget, 'this.revealSessionIfAlreadyOpen(widget.viewModel.sessionResource, { preserveFocus });', 'this.revealSessionIfAlreadyOpen(widget.viewModel.sessionResource, { preserveFocus, harnessNavigationPermit: permit });', 'nested cached editor navigation permit');

	patchChatSource(checkout, editor, "import { ChatEditorInput } from './chatEditorInput.js';", "import { ChatEditorInput } from './chatEditorInput.js';\nimport { HarnessChatNavigationPermit } from '../../../../volter/browser/volterChatNavigation.js';", 'editor navigation permit import');
	patchChatSource(checkout, editor, 'export interface IChatEditorOptions extends IEditorOptions {', 'export interface IChatEditorOptions extends IEditorOptions {\n\t/** Internal permit for a nested native load in the same guarded transaction. */\n\tharnessNavigationPermit?: HarnessChatNavigationPermit;', 'nested editor navigation permit option');
	// EditorPanes clears the old input and catches load errors before ChatEditor.setInput.
	// Guard the group owner instead, before selection/reveal/clear/recovery can begin.
	patchChatSource(checkout, group, "import { URI } from '../../../../base/common/uri.js';", "import { URI } from '../../../../base/common/uri.js';\nimport { HarnessChatNavigationPermit, IHarnessChatNavigationService } from '../../../contrib/volter/browser/volterChatNavigation.js';", 'editor group navigation service import');
	const openEditor = '\tprivate async doOpenEditor(editor: EditorInput, options?: IEditorOptions, internalOptions?: IInternalEditorOpenOptions): Promise<IEditorPane | undefined> {';
	patchChatSource(checkout, group, openEditor, `\tprivate harnessNavigationRequest = 0;

${openEditor}
		const request = ++this.harnessNavigationRequest;
		const resource = (editor as EditorInput & { readonly sessionResource?: URI }).sessionResource ?? editor.resource;
		const passive = (options as (IEditorOptions & { harnessPassive?: boolean }) | undefined)?.harnessPassive;
		if (!resource || resource.scheme !== 'supercode' || options?.inactive || passive) {
			return this.doOpenEditorAfterHarnessGuard(editor, options, internalOptions);
		}
		const parent = (options as (IEditorOptions & { harnessNavigationPermit?: HarnessChatNavigationPermit }) | undefined)?.harnessNavigationPermit;
		return this.instantiationService.invokeFunction(accessor => accessor.get(IHarnessChatNavigationService).run(resource, async permit => {
			const guardedOptions: IEditorOptions & { harnessNavigationPermit?: HarnessChatNavigationPermit } = { ...options, harnessNavigationPermit: permit };
			// The pane's cancellable input operation is created only inside this commit.
			const pane = await this.doOpenEditorAfterHarnessGuard(editor, guardedOptions, internalOptions);
			const selected = (pane as (IEditorPane & { widget?: { viewModel?: { sessionResource: URI } } }) | undefined)?.widget?.viewModel?.sessionResource;
			if (request !== this.harnessNavigationRequest || selected?.toString() !== resource.toString()) { throw new Error('The requested conversation was not selected by the native editor.'); }
			return pane;
		}, parent, () => request === this.harnessNavigationRequest && !this.disposed && !editor.isDisposed()
			&& ((editor as EditorInput & { readonly sessionResource?: URI }).sessionResource ?? editor.resource)?.toString() === resource.toString()));
	}

	private async doOpenEditorAfterHarnessGuard(editor: EditorInput, options?: IEditorOptions, internalOptions?: IInternalEditorOpenOptions): Promise<IEditorPane | undefined> {`, 'guard before native editor group selection');

	patchChatSource(checkout, view, "import './media/chatViewPane.css';", "import './media/chatViewPane.css';\n" + hostImport, 'sidebar navigation service import');
	const load = '\tasync loadSession(sessionResource: URI, sessionTypeSelectionReason?: SessionTypeSelectionReason): Promise<IChatModel | undefined> {';
	patchChatSource(checkout, view, load, `\tasync loadSession(sessionResource: URI, sessionTypeSelectionReason?: SessionTypeSelectionReason, permit?: HarnessChatNavigationPermit, openingToken?: CancellationToken): Promise<IChatModel | undefined> {
		// Keep refusal outside the load's cancellation, clear timer and empty-model recovery.
		return this.instantiationService.invokeFunction(accessor => accessor.get(IHarnessChatNavigationService).run(sessionResource, async navigationPermit => {
			const model = await this.loadSessionAfterGuard(sessionResource, sessionTypeSelectionReason, openingToken);
			if (navigationPermit && model?.sessionResource.toString() !== sessionResource.toString()) { throw new Error('The requested conversation was not selected by the native Chat view.'); }
			return model;
		}, permit));
	}

	private async loadSessionAfterGuard(sessionResource: URI, sessionTypeSelectionReason?: SessionTypeSelectionReason, openingToken?: CancellationToken): Promise<IChatModel | undefined> {`, 'guard before direct sidebar load mutation');
	patchChatSource(checkout, view, 'const cts = this.loadSessionCts.value = new CancellationTokenSource();', 'const cts = this.loadSessionCts.value = new CancellationTokenSource(openingToken);', 'cancel superseded native draft acquisition');
	patchChatSource(checkout, view, 'localFallbackSelectionReason?: SessionTypeSelectionReason): Promise<IChatModel | undefined> {\n\t\tconst oldModelResource', 'localFallbackSelectionReason?: SessionTypeSelectionReason, retainOutgoingModel = false): Promise<IChatModel | undefined> {\n\t\tconst oldModelResource', 'owned draft model lifetime option');
	patchChatSource(checkout, view, '\t\tthis.modelRef.value = undefined;\n\n\t\t// Baseline draft', `\t\t// Keep the outgoing holder alive during this owned draft's lock wait.
		// The new reference stays local until the widget actually binds it.
		let ref: IChatModelReference | undefined = startNewSession ? modelRef : undefined;
		let referenceTransferred = false;
		try {
		if (!retainOutgoingModel) { this.modelRef.value = undefined; }

		// Baseline draft`, 'retain outgoing reference until owned bind');
	patchChatSource(checkout, view, '\t\tlet ref: IChatModelReference | undefined;\n\t\tif (startNewSession)', '\t\t// The candidate is owned by the outer lifetime finally until transfer.\n\t\tif (startNewSession)', 'local owned model reference');
	patchChatSource(checkout, view, '\t\t\tref?.dispose();\n\t\t\treturn undefined;\n\t\t}\n\n\t\tthis.modelRef.value = ref;', `\t\t\tif (!retainOutgoingModel) { ref?.dispose(); }
			return undefined;
		}

		if (!retainOutgoingModel) { this.modelRef.value = ref; referenceTransferred = true; }`, 'owned candidate cancellation cleanup');
	patchChatSource(checkout, view, '\t\t\t\tthis.modelRef.value = undefined;\n\t\t\t\treturn undefined;', '\t\t\t\tif (!retainOutgoingModel && this.modelRef.value === ref) { this.modelRef.value = undefined; }\n\t\t\t\treturn undefined;', 'cancel only the owned model holder');
	patchChatSource(checkout, view, '\t\t// Update title control\n\t\tthis.titleControl?.update(model);', `\t\tif (retainOutgoingModel) {
			// Binding is synchronous and token-checked above. Release the old
			// holder only after its widget no longer observes that model.
			this.modelRef.value = ref;
			referenceTransferred = true;
		}

		// Update title control
		this.titleControl?.update(model);`, 'transfer reference after owned widget binding');
	patchChatSource(checkout, view, '\t\treturn model;\n\t}\n\n\tprivate async updateWidgetLockState', `\t\treturn model;
		} finally {
			// A cancelled/failed opening owns only this local candidate. Never
			// clear the shared holder, which a newer load may have replaced.
			if (retainOutgoingModel && !referenceTransferred) { ref?.dispose(); }
		}
	}

	private async updateWidgetLockState`, 'release unbound owned candidate on cancellation or error');
	patchChatSource(checkout, view, 'this.showModel(token, newModelRef, true, false, inputBeforeLoad, localFallbackSelectionReason);', `this.showModel(token, newModelRef, true, false, inputBeforeLoad, localFallbackSelectionReason,
					!!openingToken && sessionResource.scheme === 'supercode' && sessionResource.path.startsWith('/untitled-'));`, 'scope model retention to owned untitled loading');
	patchChatSource(checkout, view, 'await this.updateWidgetLockState(getChatSessionType(model.sessionResource));', 'await this.updateWidgetLockState(getChatSessionType(model.sessionResource), retainOutgoingModel ? token : undefined);', 'owned opening cancellation at lock owner');
	patchChatSource(checkout, view, '\tprivate async updateWidgetLockState(sessionType: string): Promise<void> {', `\tprivate async updateWidgetLockState(sessionType: string, openingToken?: CancellationToken): Promise<void> {
		if (openingToken?.isCancellationRequested) { return; }`, 'guard owned synchronous provider lock changes');
	patchChatSource(checkout, view, '\t\tif (!canResolve) {\n\t\t\tthis._widget.unlockFromCodingAgent();', `\t\t// An older resolver must not change the composer selected by a newer load.
		if (openingToken?.isCancellationRequested) { return; }
		if (!canResolve) {
			this._widget.unlockFromCodingAgent();`, 'guard owned provider lock after awaited resolution');
	patchChatSource(checkout, view, '\t\t\tconst clearWidget = disposableTimeout(() => {', `\t\t\tconst clearWidget = disposableTimeout(() => {
				// This opening already owns an untitled draft. Keep the outgoing model
				// until binding, rather than publishing an unrelated empty focus event.
				// Explicit user clear/new loads still cancel through loadSessionCts.
				if (openingToken && sessionResource.scheme === 'supercode' && sessionResource.path.startsWith('/untitled-')) { return; }`, 'retain model through owned untitled binding');
	// Synchronous move/close APIs relocate or expose an already stored pane passively.
	// They must not enqueue activation and then close the outgoing pane before its guard.
	patchChatSource(checkout, group, 'target.doOpenEditor(keepCopy ? editor.copy() : editor, options, internalOptions);', `const transferOptions: IEditorOptions & { harnessPassive?: boolean } = { ...options, harnessPassive: true };
		target.doOpenEditor(keepCopy ? editor.copy() : editor, transferOptions, internalOptions);`, 'passive group transfer without runtime activation');
	patchChatSource(checkout, group, 'this.doOpenEditor(nextActiveEditor, options, internalEditorOpenOptions);', `const fallbackOptions: IEditorOptions & { harnessPassive?: boolean } = { ...options, harnessPassive: true };
			this.doOpenEditor(nextActiveEditor, fallbackOptions, internalEditorOpenOptions);`, 'passive editor exposed after close');
	patchChatSource(checkout, group, 'const openEditorResult = this.doOpenEditor(activeReplacement.replacement, activeReplacement.options);', `const openEditorResult = this.doOpenEditor(activeReplacement.replacement, activeReplacement.options);
			const replacementResource = (activeReplacement.replacement as EditorInput & { readonly sessionResource?: URI }).sessionResource ?? activeReplacement.replacement.resource;
			if (replacementResource?.scheme === 'supercode') { await openEditorResult; }`, 'await harness replacement before closing source');
	patchHarnessMoveActions(checkout);
	patchHarnessPassiveViews(checkout);
	patchHarnessDraftAgentMention(checkout);
}

/** Moving a bound Chat is an intentional activation, guarded before source destruction. */
function patchHarnessMoveActions(checkout) {
	const move = 'src/vs/workbench/contrib/chat/browser/actions/chatMoveActions.ts';
	patchChatSource(checkout, move, "import { CHAT_CATEGORY } from './chatActions.js';",
		"import { CHAT_CATEGORY } from './chatActions.js';\nimport { IHarnessChatNavigationService } from '../../../volter/browser/volterChatNavigation.js';", 'move navigation owner import');
	for (const destination of ['Editor', 'Window']) {
		patchChatSource(checkout, move, `\t\t\texecuteMoveToAction(accessor, MoveToNewLocation.${destination}, isChatViewTitleActionContext(context) ? context.sessionResource : undefined);`,
			`\t\t\treturn executeMoveToAction(accessor, MoveToNewLocation.${destination}, isChatViewTitleActionContext(context) ? context.sessionResource : undefined);`, 'await native Chat move command');
	}
	patchChatSource(checkout, move, `\t// Todo: can possibly go away with https://github.com/microsoft/vscode/pull/278476
	const modelInputState = existingWidget.getInputState();

	await widget.clear();

	const options: IChatEditorOptions = { pinned: true, modelInputState, auxiliary };
	await widgetService.openSession(resourceToOpen, moveTo === MoveToNewLocation.Window ? AUX_WINDOW_GROUP : ACTIVE_GROUP, options);`,
		`\tawait accessor.get(IHarnessChatNavigationService).run(resourceToOpen, async permit => {
		// Capture the author draft only after the addressed source passed its guard.
		const modelInputState = existingWidget.getInputState();
		await widget.clear();
		const options: IChatEditorOptions = { pinned: true, modelInputState, auxiliary, harnessNavigationPermit: permit };
		const destination = await widgetService.openSession(resourceToOpen, moveTo === MoveToNewLocation.Window ? AUX_WINDOW_GROUP : ACTIVE_GROUP, options);
		if (permit && destination?.viewModel?.sessionResource.toString() !== resourceToOpen.toString()) {
			throw new Error('The moved conversation was not selected by the native editor.');
		}
	}, undefined, () => widget.viewModel?.sessionResource.toString() === resourceToOpen.toString()
		&& widgetService.getWidgetBySessionResource(resourceToOpen) === existingWidget);`, 'guard before source Chat clear and nested move');
	patchChatSource(checkout, move, `\t\tconst previousInputState = chatEditor.widget.getInputState();
		await editorService.closeEditor({ editor: chatEditor.input, groupId: editorGroupService.activeGroup.id });
		view = await viewsService.openView(ChatViewId) as ChatViewPane;

		// Todo: can possibly go away with https://github.com/microsoft/vscode/pull/278476
		const newModel = await view.loadSession(chatEditorInput.sessionResource);
		if (previousInputState && newModel && !newModel.inputModel.state.get()) {
			newModel.inputModel.setState(previousInputState);
		}`, `\t\tconst resource = chatEditorInput.sessionResource;
		const sourceGroup = editorGroupService.activeGroup;
		await accessor.get(IHarnessChatNavigationService).run(resource, async permit => {
			const previousInputState = chatEditor.widget.getInputState();
			const closed = await sourceGroup.closeEditor(chatEditorInput);
			if (permit && !closed) { throw new Error('The source conversation editor was not closed for its move.'); }
			view = await viewsService.openView(ChatViewId) as ChatViewPane;
			if (permit && !view) { throw new Error('The destination Chat view was not available for its move.'); }
			const newModel = await view.loadSession(resource, undefined, permit);
			if (permit && newModel?.sessionResource.toString() !== resource.toString()) {
				throw new Error('The moved conversation was not selected by the native Chat view.');
			}
			if (previousInputState && newModel && !newModel.inputModel.state.get()) {
				newModel.inputModel.setState(previousInputState);
			}
			view.focus();
		}, undefined, () => editorService.activeEditorPane === chatEditor && chatEditor.input === chatEditorInput
			&& editorGroupService.getGroup(sourceGroup.id) === sourceGroup
			&& !chatEditorInput.isDisposed() && chatEditorInput.sessionResource?.toString() === resource.toString());
		return;`, 'guard before source editor close and nested sidebar move');
}

/** Session-owned agent identity comes from its native picker, not a sticky text mention. */
function patchHarnessDraftAgentMention(checkout) {
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/widget/input/editor/chatInputEditorContrib.ts',
		'\tprivate async repopulateAgentCommand(agent: IChatAgentData, slashCommand: IChatAgentCommand | undefined) {',
		`\tprivate async repopulateAgentCommand(agent: IChatAgentData, slashCommand: IChatAgentCommand | undefined) {
		// This participant routes the whole session. Its name can change after the
		// draft's picker; inserting the previous name leaves a misleading mention.
		if (!slashCommand && agent.id === 'supercode' && this.widget.lockedAgentId === 'supercode'
			&& this.widget.viewModel?.sessionResource.scheme === 'supercode') { return; }`,
		'keep session-owned harness identity out of sticky composer text');
}

/** Reading an already-visible inactive pane is passive, with all interaction disabled. */
function patchHarnessPassiveViews(checkout) {
	const widget = 'src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts';
	const banner = 'src/vs/workbench/contrib/chat/browser/widget/chatReadOnlyBanner.ts';
	const command = 'src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatCommandContentPart.ts';
	patchChatSource(checkout, command, "import { Command } from '../../../../../../editor/common/languages.js';",
		"import { Command } from '../../../../../../editor/common/languages.js';\nimport { IHarnessChatNavigationService } from '../../../../volter/browser/volterChatNavigation.js';", 'passive command button policy import');
	patchChatSource(checkout, command, '\t\tcontext: IChatContentPartRenderContext,', '\t\tprivate readonly context: IChatContentPartRenderContext,', 'command button conversation ownership');
	patchChatSource(checkout, command, '\t\t@ICommandService private readonly commandService: ICommandService',
		'\t\t@ICommandService private readonly commandService: ICommandService,\n\t\t@IHarnessChatNavigationService private readonly harnessNavigation: IHarnessChatNavigationService', 'command button navigation policy injection');
	patchChatSource(checkout, command, '\t\tthis._register(button.onDidClick(() => this.commandService.executeCommand(command.id, ...(command.arguments ?? []))));',
		`\t\tthis._register(button.onDidClick(() => {
			this.harnessNavigation.assertInteractive(this.context.element.sessionResource);
			return this.commandService.executeCommand(command.id, ...(command.arguments ?? []));
		}));`, 'guard command button dispatch including native gesture');
	// Keyboard/command dispatch can originate outside transcript DOM capture.
	// Check the actual addressed conversation at those response owners too.
	const actionImport = "import { IHarnessChatNavigationService } from '../../../volter/browser/volterChatNavigation.js';";
	for (const action of ['chatToolActions.ts', 'chatElicitationActions.ts']) {
		patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/actions/' + action,
			"import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';",
			"import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';\n" + actionImport,
			'passive response command policy import');
	}
	const tools = 'src/vs/workbench/contrib/chat/browser/actions/chatToolActions.ts';
	patchChatSource(checkout, tools, '\t\tconst lastItem = widget?.viewModel?.getItems().at(-1);',
		'\t\taccessor.get(IHarnessChatNavigationService).assertInteractive(widget?.viewModel?.sessionResource);\n\t\tconst lastItem = widget?.viewModel?.getItems().at(-1);', 'guard tool approval command owner');
	const elicitation = 'src/vs/workbench/contrib/chat/browser/actions/chatElicitationActions.ts';
	patchChatSource(checkout, elicitation, '\t\tconst items = widget.viewModel?.getItems();',
		'\t\taccessor.get(IHarnessChatNavigationService).assertInteractive(widget.viewModel?.sessionResource);\n\t\tconst items = widget.viewModel?.getItems();', 'guard elicitation command owner');
	const execute = 'src/vs/workbench/contrib/chat/browser/actions/chatExecuteActions.ts';
	// This file imports the combined context helpers rather than ChatContextKeys alone.
	patchChatSource(checkout, execute,
		"import { ChatContextKeyExprs, ChatContextKeys } from '../../common/actions/chatContextKeys.js';",
		"import { ChatContextKeyExprs, ChatContextKeys } from '../../common/actions/chatContextKeys.js';\n" + actionImport,
		'passive submit and cancel policy import');
	patchChatSource(checkout, execute, '\t\t// Check if there\'s a pending delegation target',
		'\t\taccessor.get(IHarnessChatNavigationService).assertInteractive(widget?.viewModel?.sessionResource);\n\t\t// Check if there\'s a pending delegation target', 'guard submit before delegation');
	patchChatSource(checkout, execute, "\t\tconst chatService = accessor.get(IChatService);\n\t\tif (widget.viewModel) {\n\t\t\tawait chatService.cancelCurrentRequestForSession(widget.viewModel.sessionResource, 'cancelAction');",
		"\t\taccessor.get(IHarnessChatNavigationService).assertInteractive(widget.viewModel?.sessionResource);\n\t\tconst chatService = accessor.get(IChatService);\n\t\tif (widget.viewModel) {\n\t\t\tawait chatService.cancelCurrentRequestForSession(widget.viewModel.sessionResource, 'cancelAction');", 'guard cancel command owner');
	patchChatSource(checkout, execute, '\t\t// Resolve the source custom agent whose handoffs we search (case-insensitive)',
		'\t\taccessor.get(IHarnessChatNavigationService).assertInteractive(widget.viewModel?.sessionResource);\n\t\t// Resolve the source custom agent whose handoffs we search (case-insensitive)', 'guard handoff command owner');
	patchChatSource(checkout, widget, "import * as dom from '../../../../../base/browser/dom.js';", "import * as dom from '../../../../../base/browser/dom.js';\nimport { EventType as TouchEventType } from '../../../../../base/browser/touch.js';\nimport { IHarnessChatNavigationService } from '../../../volter/browser/volterChatNavigation.js';", 'passive conversation policy import');
	patchChatSource(checkout, widget, '\tprivate _readOnly = false;', '\tprivate _readOnly = false;\n\tprivate _modelReadOnly = false;\n\tprivate _harnessInactive = false;', 'durable inactive read-only reason');
	patchChatSource(checkout, widget, '\t\t@IInstantiationService private readonly instantiationService: IInstantiationService,', '\t\t@IInstantiationService private readonly instantiationService: IInstantiationService,\n\t\t@IHarnessChatNavigationService private readonly harnessNavigation: IHarnessChatNavigationService,', 'passive conversation policy injection');
	patchChatSource(checkout, widget, '\t\tthis._persistentContentHeight = viewOptions.persistentContentHeight ?? 0;', `\t\tthis._persistentContentHeight = viewOptions.persistentContentHeight ?? 0;
		this._register(this.harnessNavigation.onDidChangeActiveResource(() => this.updateHarnessInactive()));
		this._register(this.onDidChangeViewModel(() => this.updateHarnessInactive()));`, 'update inactive reason on binding and activation');
	patchChatSource(checkout, widget, '\tsetReadOnly(readOnly: boolean): void {\n\t\tconst wasReadOnly = this._readOnly;', `\tprivate updateHarnessInactive(): void {
		const resource = this.viewModel?.sessionResource;
		const inactive = resource?.scheme === 'supercode' && !resource.path.startsWith('/untitled-')
			&& resource.toString() !== this.harnessNavigation.activeResource;
		if (inactive !== this._harnessInactive) {
			this._harnessInactive = inactive;
			this.setReadOnly(this._modelReadOnly);
		}
	}

	setReadOnly(readOnly: boolean): void {
		this._modelReadOnly = readOnly;
		readOnly ||= this._harnessInactive;
		const wasReadOnly = this._readOnly;`, 'compose inactive and model read-only policies');
	patchChatSource(checkout, widget, '\t\tthis.readOnlyBanner?.setVisible(readOnly);', `\t\tthis.readOnlyBanner?.setMessage(this._harnessInactive && !this._modelReadOnly
			? localize('chat.inactiveConversation', "Inactive conversation. Open it from history to continue.") : undefined);
		this.readOnlyBanner?.setVisible(readOnly);`, 'accurate inactive conversation banner');
	patchChatSource(checkout, widget, "\t\tthis.container = dom.append(parent, $('.interactive-session'));", `\t\tthis.container = dom.append(parent, $('.interactive-session'));
		// Passive history remains focusable, selectable and copyable. It cannot invoke
		// transcript buttons/links, tool approvals, questions, restores or handoffs.
		const blockInactiveAction = (event: globalThis.Event) => {
			if (!this._harnessInactive) { return; }
			const target = event.target as Element | null;
			if (!target || typeof target.closest !== 'function') { return; }
			const question = target.closest('.chat-question-carousel-container');
			const interactive = target.closest('a,button,input,textarea,[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],[role="option"],[role="switch"],[role="slider"],[role="spinbutton"],[role^="menuitem"],[contenteditable="true"]');
			const keyboardScope = event.type === 'keydown' && (question || target.closest('.chat-tool-confirmation-carousel,.chat-confirmation-widget'));
			if (!interactive && !keyboardScope) { return; }
			if ('key' in event) {
				const key = String(event.key);
				const readingShortcut = 'ctrlKey' in event && (event.ctrlKey || ('metaKey' in event && event.metaKey)) && ['a', 'c', 'f'].includes(key.toLowerCase());
				if (readingShortcut || ['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'F3'].includes(key) || (key === 'Escape' && !question)) { return; }
			}
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		this._register(dom.addDisposableListener(this.container, 'click', blockInactiveAction, true));
		this._register(dom.addDisposableListener(this.container, TouchEventType.Tap, blockInactiveAction, true));
		this._register(dom.addDisposableListener(this.container, 'dblclick', blockInactiveAction, true));
		this._register(dom.addDisposableListener(this.container, 'keydown', blockInactiveAction, true));
		this._register(dom.addDisposableListener(this.container, 'pointerdown', blockInactiveAction, true));
		this._register(dom.addDisposableListener(this.container, 'beforeinput', blockInactiveAction, true));
		this._register(dom.addDisposableListener(this.container, 'change', blockInactiveAction, true));`, 'passive transcript interaction boundary');

	patchChatSource(checkout, banner, "import { Disposable } from '../../../../../base/common/lifecycle.js';", "import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';", 'banner hover lifetime');
	patchChatSource(checkout, banner, '\tprivate _visible = false;', '\tprivate _visible = false;\n\tprivate readonly text: HTMLElement;\n\tprivate readonly messageHover = this._register(new MutableDisposable());', 'mutable banner message ownership');
	patchChatSource(checkout, banner, '\t\tmessage: string = localize', '\t\tprivate readonly message: string = localize', 'remember original read-only banner meaning');
	patchChatSource(checkout, banner, '\t\t@IHoverService hoverService: IHoverService,', '\t\t@IHoverService private readonly hoverService: IHoverService,', 'banner hover service ownership');
	patchChatSource(checkout, banner, `\t\tconst text = dom.append(this.domNode, dom.$('span.chat-readonly-banner-text'));
		text.textContent = message;
		this._register(hoverService.setupDelayedHover(text, { content: message }));`, `\t\tthis.text = dom.append(this.domNode, dom.$('span.chat-readonly-banner-text'));
		this.setMessage();`, 'initialize mutable banner message');
	patchChatSource(checkout, banner, '\tget visible(): boolean {', `\tsetMessage(message: string = this.message): void {
		this.text.textContent = message;
		this.messageHover.value = this.hoverService.setupDelayedHover(this.text, { content: message });
	}

	get visible(): boolean {`, 'accurate visible and hover banner meaning');
}

/** This public recipe does not distribute Microsoft's optional VSDA payload.
 * Declare that capability explicitly, leaving other products' default unchanged.
 * AbstractSignService owns the existing fallback; do not request missing resources. */
function patchOptionalVsda(checkout) {
	patchChatSource(checkout, 'src/vs/base/common/product.ts',
		'\treadonly serverLicense?: string[];',
		'\treadonly serverLicense?: string[];\n\t/** False when this distribution omits the optional VSDA payload. */\n\treadonly vsdaEnabled?: boolean;',
		'optional VSDA product capability');
	patchChatSource(checkout, 'src/vs/platform/sign/browser/signService.ts',
		'\tprivate async vsda(): Promise<typeof vsda_web> {\n\t\tconst checkInterval',
		'\tprivate async vsda(): Promise<typeof vsda_web> {\n\t\tif (this.productService.vsdaEnabled === false) {\n\t\t\tthrow new Error("VSDA is not available in this product build");\n\t\t}\n\t\tconst checkInterval',
		'optional VSDA capability before resource loading');
}

function patchNativeChat(checkout) {
	// Live harness approvals answer through commands, not a second chat request.
	// Keep their choices in the native primary/secondary button row rather than
	// rendering every option as an unrelated primary action.
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/common/chatService/chatService.ts',
		'\tadditionalCommands?: Command[]; // rendered as secondary buttons',
		'\tadditionalCommands?: Command[]; // rendered as secondary buttons\n\t/** Presentation only: consecutive answers to one live harness request. */\n\tharnessAnswerGroup?: string;', 'live answer presentation group');
	patchChatSource(checkout, 'src/vs/workbench/api/common/extHostTypeConverters.ts',
		'\t\tconst command = commandsConverter.toInternal(part.value, commandDisposables) ?? { command: part.value.command, title: part.value.title };\n\t\treturn {\n\t\t\tkind: \'command\',\n\t\t\tcommand\n\t\t};',
		`\t\tconst command = commandsConverter.toInternal(part.value, commandDisposables) ?? { command: part.value.command, title: part.value.title };
\t\tconst answer = part.value.command === 'supercode.frontend.respond' ? part.value.arguments?.[0] : undefined;
\t\tconst harnessAnswerGroup = answer && typeof answer === 'object' && !Array.isArray(answer)
\t\t\t&& typeof answer.connectionId === 'string' && answer.connectionId.length > 0 && answer.connectionId.length <= 256
\t\t\t&& Number.isSafeInteger(answer.requestId) && answer.requestId >= 0
\t\t\t&& answer.response && typeof answer.response === 'object' && !Array.isArray(answer.response)
\t\t\t&& answer.response.request_id === answer.requestId
\t\t\t? JSON.stringify([answer.connectionId, answer.requestId]) : undefined;
\t\treturn {
\t\t\tkind: 'command',
\t\t\tcommand,
\t\t\tharnessAnswerGroup
\t\t};`, 'identify live answer grouping before command delegation');
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/common/widget/annotations.ts',
		"\t\t} else if (item.kind === 'voiceProgress') {",
		`\t\t} else if (item.kind === 'command' && item.harnessAnswerGroup
\t\t\t&& previousItem?.kind === 'command' && previousItem.harnessAnswerGroup === item.harnessAnswerGroup
\t\t\t&& previousEntry.sourceIndexes.at(-1) === currentSourceIndex - 1) {
\t\t\tresult[previousItemIndex] = {
\t\t\t\tcontent: { ...previousItem, additionalCommands: [...(previousItem.additionalCommands ?? []), item.command, ...(item.additionalCommands ?? [])] },
\t\t\t\tsourceIndexes: [...previousEntry.sourceIndexes, currentSourceIndex],
\t\t\t};
\t\t} else if (item.kind === 'voiceProgress') {`, 'group consecutive live answers without changing response content');
	const commandPart = 'src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatCommandContentPart.ts';
	patchChatSource(checkout, commandPart, '\t\tcommandButton: IChatCommandButton,', '\t\tprivate readonly commandButton: IChatCommandButton,', 'retain rendered answer group membership');
	patchChatSource(checkout, commandPart, "\t\treturn other.kind === 'command';",
		`\t\tif (other.kind !== 'command') { return false; }
\t\tif (!this.commandButton.harnessAnswerGroup && !other.harnessAnswerGroup) { return true; }
\t\treturn other.harnessAnswerGroup === this.commandButton.harnessAnswerGroup
\t\t\t&& other.command === this.commandButton.command
\t\t\t&& (other.additionalCommands?.length ?? 0) === (this.commandButton.additionalCommands?.length ?? 0)
\t\t\t&& (other.additionalCommands ?? []).every((command, index) => command === this.commandButton.additionalCommands?.[index]);`, 'refresh native answer alternatives during streaming');
	// Reuse the native tool-confirmation card, but keep live harness approval
	// dispatch inside the current turn. Stock confirmations retain their handler.
	const confirmationPart = 'src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatConfirmationContentPart.ts';
	patchChatSource(checkout, confirmationPart, "import { IChatContentPart, IChatContentPartRenderContext } from './chatContentParts.js';",
		"import { IChatContentPart, IChatContentPartRenderContext } from './chatContentParts.js';\nimport { HarnessChatApprovalContentPart, isHarnessApproval } from '../../../../volter/browser/volterChatApproval.js';", 'native in-turn approval presentation import');
	patchChatSource(checkout, confirmationPart, '\t\tconfirmation: IChatConfirmation,', '\t\tprivate readonly confirmation: IChatConfirmation,', 'native approval content identity');
	patchChatSource(checkout, confirmationPart, '\t\tsuper();\n\n\t\tconst element', `\t\tsuper();
\t\tif (isHarnessApproval(confirmation.data)) {
\t\t\tconst approval = this._register(this.instantiationService.createInstance(HarnessChatApprovalContentPart, confirmation, context));
\t\t\tthis.domNode = approval.domNode;
\t\t\treturn;
\t\t}

\t\tconst element`, 'native approval without a new chat request');
	patchChatSource(checkout, confirmationPart, "\t\treturn other.kind === 'confirmation';",
		"\t\treturn other.kind === 'confirmation' && (!isHarnessApproval(this.confirmation.data) || other === this.confirmation);", 'native approval response identity');

	patchHarnessChatNavigation(checkout);
	// Participant welcome uses native buttons for standalone trusted command links.
	// It stays outside transcript history and shares the extension's guarded action.
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/viewsWelcome/chatViewWelcomeController.ts', `	readonly firstLinkToButton?: boolean;`, `	readonly firstLinkToButton?: boolean;
	readonly additionalMessageLinksToButtons?: boolean;`, 'participant welcome button option');
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/viewsWelcome/chatViewWelcomeController.ts', `this.renderMarkdownMessageContent(content.additionalMessage, options);`, `this.renderMarkdownMessageContent(content.additionalMessage, options, options?.additionalMessageLinksToButtons);`, 'participant welcome button rendering');
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/viewsWelcome/chatViewWelcomeController.ts', `	private renderMarkdownMessageContent(content: IMarkdownString, options: IChatViewWelcomeRenderOptions | undefined): IRenderedMarkdown {
		const messageResult = this._register(this.markdownRendererService.render(content));
		// eslint-disable-next-line no-restricted-syntax
		const firstLink = options?.firstLinkToButton ? messageResult.element.querySelector('a') : undefined;
		if (firstLink) {
			const target = firstLink.getAttribute('data-href');
			const button = this._register(new Button(firstLink.parentElement!, defaultButtonStyles));
			button.label = firstLink.textContent ?? '';
			if (target) {
				this._register(button.onDidClick(() => {
					this.openerService.open(target, { allowCommands: true });
				}));
			}
			firstLink.replaceWith(button.element);
		}
		return messageResult;
	}`, `	private renderMarkdownMessageContent(content: IMarkdownString, options: IChatViewWelcomeRenderOptions | undefined, standaloneCommands = false): IRenderedMarkdown {
		const messageResult = this._register(this.markdownRendererService.render(content));
		const allowedCommands = content.isTrusted === true ? true
			: typeof content.isTrusted === 'object' ? content.isTrusted.enabledCommands : [];
		// Like viewsWelcome, a paragraph containing only a link is an action.
		// Inline links and untrusted commands retain ordinary Markdown rendering.
		// eslint-disable-next-line no-restricted-syntax
		const firstLink = options?.firstLinkToButton ? messageResult.element.querySelector('a') : undefined;
		// eslint-disable-next-line no-restricted-syntax
		const links = standaloneCommands ? Array.from(messageResult.element.querySelectorAll('p > a:only-child')).filter(link => {
			const target = link.getAttribute('data-href');
			return link.parentElement?.textContent?.trim() === link.textContent?.trim()
				&& target?.startsWith('command:')
				&& (allowedCommands === true || allowedCommands.includes(URI.parse(target).path));
		}) : firstLink ? [firstLink] : [];
		for (const link of links) {
			const target = link.getAttribute('data-href');
			const button = this._register(new Button(link.parentElement!, defaultButtonStyles));
			button.label = link.textContent ?? '';
			if (target) {
				this._register(button.onDidClick(() => {
					this.openerService.open(target, { allowCommands: standaloneCommands ? allowedCommands : true });
				}));
			}
			link.replaceWith(button.element);
		}
		return messageResult;
	}`, 'standalone trusted welcome commands');
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts', `							isWidgetAgentWelcomeViewContent: this.input?.currentModeKind === ChatModeKind.Agent`, `							isWidgetAgentWelcomeViewContent: this.input?.currentModeKind === ChatModeKind.Agent,
							additionalMessageLinksToButtons: true`, 'participant welcome action styling');

	// The toolbar/keyboard New Chat door must honor a provider-owned creation menu.
	// Keep this out of the shared clear helper: Send to New Chat also calls that
	// helper, and cancelling an interactive picker must never submit into the old chat.
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/actions/chatNewActions.ts', `import { IChatService } from '../../common/chatService/chatService.js';`, `import { IChatService } from '../../common/chatService/chatService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IChatSessionsService } from '../../common/chatSessionsService.js';
import { getDefaultNewChatSessionTypeAndReason } from '../../common/constants.js';
import { getChatSessionType } from '../../common/model/chatUri.js';`, 'provider-owned New Chat imports');
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/actions/chatNewActions.ts', `	const model = widget.viewModel?.model;
	if (model && !(await handleCurrentEditingSession(model, undefined, dialogService))) {`, `	// A non-delegating provider owns creation through chatSessions/newSession.
	// Dispatch before native confirmation/stop: cancelling its picker must leave
	// the old conversation, draft and edit-review tabs untouched, just as opening
	// that provider's contributed creation command directly does.
	const resolved = getDefaultNewChatSessionTypeAndReason(accessor, {
		explicitOverride: sessionType,
		currentSessionType: currentSession ? getChatSessionType(currentSession) : undefined,
	});
	if (accessor.get(IChatSessionsService).getChatSessionContribution(resolved.sessionType)?.canDelegate === false) {
		await accessor.get(ICommandService).executeCommand(\`workbench.action.chat.openNewChatSessionExternal.\${resolved.sessionType}\`);
		return;
	}

	const model = widget.viewModel?.model;
	if (model && !(await handleCurrentEditingSession(model, undefined, dialogService))) {`, 'provider-owned New Chat creation');

	// The native input-state API must not broadcast one conversation's permission
	// changes into every other conversation owned by the same provider.
	patchChatSource(checkout, 'src/vs/workbench/api/common/extHostChatSessions.ts', `\t\t// Temporary workaround: input state changes for one resource are propagated to all
\t\t// input states for the same resource type until we can make this session-specific.
\t\tfor (const inputState of controllerData?.inputStates ?? []) {`, `\t\t// Route changes only to input states bound to this exact conversation.
\t\tfor (const inputState of controllerData.inputStates) {
\t\t\tif (!isEqual(inputState.sessionResource ?? inputState.untitledSessionResource, sessionResource)) { continue; }`, 'input-state routing');

	// Tree height changes mutate layout. Deliver them outside ResizeObserver's
	// notification phase, retaining the latest measurement and the row's identity.
	const renderer = 'src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts';
	patchChatSource(checkout, renderer, `\t\tconst resizeObserver = templateDisposables.add(new dom.DisposableResizeObserver('ChatListItemRenderer.itemHeight', (entries) => {
\t\t\tconst entry = entries[0];
\t\t\tif (entry) {
\t\t\t\tthis.fireItemHeightChange(template, entry.borderBoxSize.at(0)?.blockSize);
\t\t\t}
\t\t}));`, `\t\tconst pendingResize = templateDisposables.add(new MutableDisposable<IDisposable>());
\t\tconst resizeObserver = templateDisposables.add(new dom.DisposableResizeObserver('ChatListItemRenderer.itemHeight', (entries) => {
\t\t\tconst entry = entries[0];
\t\t\tif (entry) {
\t\t\t\tconst element = template.currentElement;
\t\t\t\tpendingResize.value = dom.scheduleAtNextAnimationFrame(dom.getWindow(rowContainer), () => {
\t\t\t\t\tpendingResize.clear();
\t\t\t\t\tif (template.currentElement === element && rowContainer.isConnected) {
\t\t\t\t\t\tthis.fireItemHeightChange(template, entry.borderBoxSize.at(0)?.blockSize);
\t\t\t\t\t}
\t\t\t\t});
\t\t\t}
\t\t}));`, 'item-height delivery');
	patchChatSource(checkout, renderer, '\t\t\tresizeObservation.clear();\n', '\t\t\tresizeObservation.clear();\n\t\t\tpendingResize.clear();\n', 'row disconnect');

	// Activating the extension can retire the setup agent selected before the await, which
	// surfaced as "No default agent registered" on a first boot.
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts',
		'const defaultAgent = this.chatAgentService.getActivatedAgents().find(agent => agent.id === defaultAgentData.id);',
		'const defaultAgent = this.chatAgentService.getDefaultAgent(location) ?? this.chatAgentService.getDefaultAgent(ChatAgentLocation.Chat);',
		'default-agent activation');

	// Session providers may start with an intro response, without inventing a user
	// message. The native model needs a parent request internally; hide only that
	// empty parent, leaving the response and its native command buttons visible.
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts',
		'\t\t\t\t// response\n\t\t\t\tif (lastRequest) {',
		`\t\t\t\t// response
\t\t\t\tif (!lastRequest) {
\t\t\t\t\tconst agent = message.participant ? this.chatAgentService.getAgent(message.participant) : undefined;
\t\t\t\t\tlastRequest = model.addRequest(parseAgentHostHistoryPrompt('', agent), { variables: [] }, 0,
\t\t\t\t\t\tundefined, agent, undefined, undefined, undefined, undefined, false,
\t\t\t\t\t\tundefined, undefined, undefined, true, undefined, undefined, false, null,
\t\t\t\t\t\tfalse, undefined, true); // response-only history: no visible user message
\t\t\t\t}
\t\t\t\tif (lastRequest) {`, 'response-only session intro');

	// A product with no authentication provider — ours: `patchProduct` leaves the provider ids
	// empty, and Supercode fills Chat — has no setup to run. Upstream still registered
	// Copilot's setup agents, its status entry ("Sign In"), the title-bar and accounts-menu
	// Sign In, and their dialog "Sign in to use GitHub Copilot", which a person reached from
	// the status bar (seen by the owner on the game editor). None of them registers now.
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts',
		'\t\tif (!context || !requests) {\n\t\t\treturn; // disabled\n\t\t}',
		'\t\tif (!context || !requests || !product.defaultChatAgent?.provider?.default?.id) {\n\t\t\treturn; // disabled: no provider to set up\n\t\t}',
		'setup without a provider');
	patchChatSource(checkout, 'src/vs/workbench/contrib/chat/browser/chatStatus/chatStatusEntry.ts',
		'\t\tif (!sentiment.hidden) {',
		'\t\tif (!sentiment.hidden && product.defaultChatAgent?.provider?.default?.id) {',
		'status entry without a provider');

	// The editor owns agent runtimes through Supercode: its service choice registers after the
	// web defaults (packages/editor-core/workbench/src/volterChat.services.ts).
	const webMain = join(checkout, 'src/vs/workbench/workbench.web.main.ts');
	const servicesImport = "import './contrib/volter/browser/volterChat.services.js';";
	writeFileSync(webMain, `${readFileSync(webMain, 'utf8').replaceAll(servicesImport, '').trimEnd()}\n\n${servicesImport}\n`);
}

/**
 * `product.json` — ours to write (ARCHITECTURE-CORE §The core is Code-OSS, rule 7):
 *
 *  - `defaultChatAgent` names OUR extension. The Copilot-only URLs, commands and quota context
 *    keys go with the extension they describe: every reader in `chatSetup/` and
 *    `chatEntitlementService` takes them through `?? ''` or `?.`.
 *
 *    `provider` AND `providerScopes` STAY, and that is a measurement, not caution. A release cut
 *    without them 404'd nothing and threw during boot: `TypeError: Cannot read properties of
 *    undefined (reading 'default')` inside `initServices`, from
 *    `services/accounts/browser/defaultAccount.ts`'s `toDefaultAccountConfig`, which reads
 *    `defaultChatAgent.provider.default.id` with no guard at all — a WORKBENCH service, not a
 *    chat one, which is why a survey of `contrib/chat` missed it. The values are upstream's own
 *    representation of "no provider" (`chatSetupProviders.ts`'s fallback is
 *    `{ default: { id: '', name: '' }, … }`), so nothing here names an authentication provider
 *    this product does not have. `${MAIN_FILE}`-style refusal is not possible for a shape a
 *    minified service dereferences, so the shape is simply kept.
 *  - `extensionEnabledApiProposals` grants Supercode its proposals and the user-installed
 *    official Codex extension only the two proposals its reviewed manifest declares.
 *  - `trustedExtensionPublishers` trusts only OpenAI for the person's one-click Codex install.
 *  - `extensionsGallery` enables user installation from Open VSX; neither official agent
 *    extension is bundled. Code-OSS retains its user-controlled update/recommendation defaults.
 *
 * REMOVING the key entirely would ALSO silence the Copilot setup machinery (`chatEntitlement
 * Service` returns early with no `defaultChatAgent`), but it would silence the Chat view's whole
 * entitlement/session surface with it. Rule 7 says name ours; this names ours.
 */
function patchProduct(checkout) {
	const path = join(checkout, PRODUCT_FILE);
	const product = JSON.parse(readFileSync(path, 'utf8'));
	for (const manifest of ['package.json', 'remote/package.json', 'remote/web/package.json']) {
		const declared = JSON.parse(readFileSync(join(checkout, manifest), 'utf8'));
		if (declared.dependencies?.vsda || declared.optionalDependencies?.vsda) {
			fail(`${manifest} now declares VSDA; review the public workbench capability and packaging before disabling its loader.`);
		}
	}
	product.vsdaEnabled = false;
	const current = product.defaultChatAgent;
	if (!current || typeof current.extensionId !== 'string') {
		fail(`${path} declares no defaultChatAgent.extensionId — upstream moved the block this patch replaces, and the Chat view's default participant is what it decides.`);
	}
	if (current.extensionId !== 'GitHub.copilot' && current.extensionId !== '') {
		fail(`${path}'s defaultChatAgent names ${current.extensionId} as its completions extension, which is neither upstream's GitHub.copilot nor ours (we ship none, so ours is empty). Somebody else has aimed this key; decide before overwriting it.`);
	}
	product.defaultChatAgent = {
		// `extensionId` IS NOT `chatExtensionId`, and naming ours twice is what disabled it.
		// MEASURED: `chat.extensionUnification.enabled` defaults to TRUE
		// (`chat.shared.contribution.ts`), and with a remote authority
		// `BrowserExtensionEnablementService._isDisabledByUnification()` disables the extension
		// whose id equals `defaultChatAgent.extensionId` — upstream's "all GitHub Copilot
		// functionality is now served from the Copilot Chat extension". `extensionId` names the
		// COMPLETIONS extension; this product ships none, so it is empty, which is the same
		// "nothing here" spelling `chatSetupProviders.ts` uses for `provider`. With ours in both
		// fields the extension was scanned, valid, and never activated; emptying this one makes
		// it activate on the next launch with nothing else changed.
		extensionId: '',
		chatExtensionId: CHAT_EXTENSION.id,
		icon: CHAT_EXTENSION.icon,
		// The shape `defaultAccount.ts` dereferences, with upstream's own empty values.
		provider: { default: { id: '', name: '' }, enterprise: { id: '', name: '' } },
		providerScopes: [],
	};
	product.extensionEnabledApiProposals = {
		[CHAT_EXTENSION.id]: [...CHAT_EXTENSION.proposals],
		'openai.chatgpt': ['chatSessionsProvider', 'languageModelProxy'],
	};
	product.trustedExtensionPublishers = ['openai'];
	// Open VSX's Code-OSS adapter, including resources for web extensions.
	// https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code
	product.extensionsGallery = {
		serviceUrl: 'https://open-vsx.org/vscode/gallery',
		itemUrl: 'https://open-vsx.org/vscode/item',
		resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
		extensionUrlTemplate: 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
	};
	writeFileSync(path, `${JSON.stringify(product, null, '\t')}\n`);
}

/**
 * The REH package task shims ripgrep INTO the built-in Copilot extension and THROWS when that
 * extension is not there (`build/lib/copilot.ts`'s `prepareBuiltInCopilotRipgrepShim`: "Copilot
 * SDK directory not found"). This release does not bundle it, so the step has nothing to do —
 * and an unconditional throw is not a thing a caller can route around, which is why this is a
 * patch and not a flag. Detect the complete applied block before removing legacy markers;
 * stripping only its comments left the executable guard behind and added another on each run.
 */
function patchRehCopilotShim(checkout) {
	const path = join(checkout, REH_GULPFILE);
	const source = readFileSync(path, 'utf8');
	const anchor = "\t\tconst builtInCopilotExtensionDir = path.join(outputDir, 'extensions', 'copilot');\n";
	if (!source.includes(anchor)) {
		fail(`${path} has no \`${anchor.trim()}\` — upstream moved the Copilot ripgrep shim and this patch needs re-aiming.`);
	}
	const guard =
		'\t\t// VOLTER (overlaid tier — scripts/workbench/overlay.mjs): extensions/copilot is not in\n' +
		'\t\t// this release, so there is no built-in Copilot SDK to shim. VOLTER_NO_BUILTIN_COPILOT.\n' +
		'\t\tif (!fs.existsSync(builtInCopilotExtensionDir)) { return; }\n';
	if (source.includes(anchor + guard)) { return; }
	const unmarked = source.split('\n')
		.filter((line) => !line.includes('// VOLTER (overlaid tier') && !line.includes('VOLTER_NO_BUILTIN_COPILOT'))
		.join('\n');
	writeFileSync(path, unmarked.replace(anchor, anchor + guard));
}

/**
 * A WIN32 RELEASE KEEPS ITS NATIVE BINARIES' PUBLISHED BYTES. Upstream's package task strips
 * the Authenticode signature from every `.node`, `rg.exe` and `tgrep.exe` and rewrites its
 * version resource with rcedit, so Microsoft's signing service can sign them afterwards. This
 * release is never signed by that service, and the rewrite only changes each file's hash —
 * which is what Smart App Control's reputation check reads. Measured 2026-10-06 on a Windows 11
 * machine with Smart App Control on: the published rg.exe and a node-gyp built
 * @vscode/deviceid ran, the rcedited copies were blocked ("An Application Control policy has
 * blocked this file"), and search and the terminal's tools failed with `spawn UNKNOWN`.
 */
function patchWin32Dependencies(checkout) {
	patchChatSource(checkout, REH_GULPFILE,
		"\t\t\tif (platform === 'win32') {\n\t\t\t\tpackageTasks.push(patchWin32DependenciesTask(destinationFolderName));\n\t\t\t}\n",
		"\t\t\t// VOLTER (overlaid tier — scripts/workbench/overlay.mjs): no signing service re-signs\n" +
		"\t\t\t// this release, so win32 binaries keep their published bytes (patchWin32Dependencies).\n" +
		"\t\t\tvoid patchWin32DependenciesTask;\n",
		'the win32 dependency patch task');
}

/**
 * `build/npm/dirs.ts` NAMES `extensions/copilot`, and the extension is not there any more.
 *
 * MEASURED 2026-09-21, twice, before this patch existed: `npm ci` in an overlaid clone ran
 * every other install and then died with `spawn /bin/sh ENOENT` — node's signature for a
 * spawn whose `cwd` DOES NOT EXIST, not for a missing shell, which is why it reads as a
 * machine fault and is not one. `build/npm/postinstall.ts` walks this list and runs
 * `npm install` in each entry with `{ cwd, shell: true }`.
 *
 * Written as a REPLACEMENT rather than a deletion so the file says what happened and so a
 * second run can tell "already patched" from "upstream moved the entry".
 */
function patchNpmDirs(checkout) {
	const path = join(checkout, NPM_DIRS_FILE);
	let source = readFileSync(path, 'utf8');
	for (const extension of [COPILOT_EXTENSION, 'vscode-api-tests']) {
		const entry = `\t'extensions/${extension}',\n`;
		const marker = `\t// VOLTER (overlaid tier — scripts/workbench/overlay.mjs): 'extensions/${extension}' is not in this build.\n`;
		if (source.includes(marker)) { continue; }
		if (!source.includes(entry)) {
			fail(`${path} has no \`${entry.trim()}\` entry and no volter marker — upstream moved the install-directory list and this patch needs re-aiming. Leaving it would die later as \`spawn /bin/sh ENOENT\`, which names neither the file nor the cause.`);
		}
		source = source.replace(entry, marker);
	}
	writeFileSync(path, source);
}

/** The look tiers the builder named (`--look <package dir>`), read from each package's own
 *  `package.json#volter.workbench`. */
function lookTiers(dirs) {
	const tiers = [];
	for (const dir of dirs) {
		if (!existsSync(join(dir, 'package.json'))) { fail(`--look ${dir} is not a package directory.`); }
		const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
		const where = `${manifest.name ?? dir}'s package.json#volter.workbench`;
		const declared = manifest.volter?.workbench;
		if (declared === undefined) { fail(`--look ${dir}: ${where} is not declared, so it carries no look tier.`); }
		if (typeof declared?.contrib !== 'string' || !/^volter[A-Z][A-Za-z0-9]*$/.test(declared.contrib) || declared.contrib === 'volterProduct') {
			fail(`${where} must name its "contrib" directory as volter<Name> (not volterProduct), e.g. "volterBrand".`);
		}
		if (tiers.some((tier) => tier.contrib === declared.contrib)) { fail(`two --look packages name the contrib directory ${declared.contrib}.`); }
		if (typeof declared.root !== 'string') { fail(`${where} must name its "root", the directory holding src/ and extensions/.`); }
		const root = join(dir, declared.root);
		if (!existsSync(join(root, 'src/look.contribution.ts'))) { fail(`${where}: ${join(root, 'src/look.contribution.ts')} does not exist; a look tier registers itself there.`); }
		const media = Object.entries(declared.media ?? {}).map(([as, from]) => {
			if (!/^[a-z][a-z0-9-]*$/.test(as) || typeof from !== 'string' || !existsSync(join(dir, from))) {
				fail(`${where}.media maps a media directory name to a directory in the package; "${as}" → "${from}" is not one.`);
			}
			return { as, from: join(dir, from) };
		});
		const extensions = existsSync(join(root, 'extensions')) ? readdirSync(join(root, 'extensions')) : [];
		tiers.push({ name: manifest.name ?? dir, version: manifest.version, contrib: declared.contrib, root, media, extensions });
	}
	return tiers;
}

/** A tier's bytes, hashed: its package version alone does not change when a git dependency moves. */
function treeHash(dirs) {
	const hash = createHash('sha1');
	const walk = (root, dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) { walk(root, path); } else { hash.update(path.slice(root.length)).update(readFileSync(path)); }
		}
	};
	for (const dir of dirs) { if (existsSync(dir)) { hash.update(`\0${basename(dir)}`); walk(dir, dir); } }
	return hash.digest('hex');
}

function main() {
	const { checkout, product, looks } = parseArgs(process.argv);
	const productDir = join(REPO_ROOT, 'packages', product, 'workbench');
	if (!existsSync(join(productDir, 'src/product.contribution.ts'))) {
		fail(`${product} has no workbench half: ${join(productDir, 'src/product.contribution.ts')} does not exist. Products with one: ${knownProducts().join(', ')}.`);
	}
	const pin = assertAtPin(checkout);
	const tiers = lookTiers(looks);
	const previous = existsSync(join(checkout, MARKER)) ? JSON.parse(readFileSync(join(checkout, MARKER), 'utf8')) : {};
	// A look tier ADDS extensions and never replaces one, checked before anything is written: an
	// extension directory that is neither the last overlay's nor the kit's or this product's is
	// upstream's, and a name another half ships is that half's.
	const shipped = new Set([...[KIT_DIR, productDir].flatMap((owner) => (existsSync(join(owner, 'extensions')) ? readdirSync(join(owner, 'extensions')) : [])), CHAT_EXTENSION.directory]);
	const ours = new Set([...(previous.extensions ?? []), ...shipped]);
	const claimed = new Set();
	for (const tier of tiers) {
		for (const name of tier.extensions) {
			if (shipped.has(name) || claimed.has(name) || (!ours.has(name) && existsSync(join(checkout, 'extensions', name)))) {
				fail(`${tier.name}'s extension ${name} would replace extensions/${name}, which is not its own.`);
			}
			claimed.add(name);
		}
	}
	// Resolved BEFORE anything is written, so a stale or missing install refuses on a clean tree.
	const extension = chatExtension();

	// EVERY product's extensions are removed before this product's are copied, so a checkout
	// overlaid for the model editor and then for the game editor does not keep `theme-blender`.
	const extensionsDir = join(checkout, 'extensions');
	for (const owner of [KIT_DIR, ...knownProducts().map((id) => join(REPO_ROOT, 'packages', id, 'workbench'))]) {
		const dir = join(owner, 'extensions');
		if (!existsSync(dir)) { continue; }
		for (const name of readdirSync(dir)) { rmSync(join(extensionsDir, name), { recursive: true, force: true }); }
	}
	// And everything the LAST overlay recorded copying, by its own record: an extension or look
	// tier whose owner has since left the tree or the install leaves nothing behind.
	for (const name of previous.extensions ?? []) { rmSync(join(extensionsDir, name), { recursive: true, force: true }); }
	for (const tier of previous.lookTiers ?? []) { rmSync(join(checkout, 'src/vs/workbench/contrib', tier.contrib), { recursive: true, force: true }); }
	rmSync(join(extensionsDir, CHAT_EXTENSION.directory), { recursive: true, force: true });
	// `build/lib/extensions.ts` already lists `copilot`
	// in `excludedExtensions`, so `compile-non-native-extensions-build` skips it either way; what
	// packages it is the separate `compile-copilot-extension-build`, which `build-release.mjs`
	// no longer runs. Removing the directory as well is what makes a sources boot agree with a
	// release, and what makes "is Copilot in this workbench" answerable by looking.
	rmSync(join(extensionsDir, COPILOT_EXTENSION), { recursive: true, force: true });
	// Release packaging also excludes the upstream API-test extension. A sources boot scans
	// its manifest anyway: it declares a fake `copilot` language-model vendor (and a default
	// test chat participant), without registering a provider outside the API tests. Model
	// discovery and thinking-title generation then try to activate that nonexistent provider.
	// Remove the test contribution at its source, just as the release does; keep real missing
	// provider warnings intact. Re-applying the overlay is harmless when it is already absent.
	rmSync(join(extensionsDir, 'vscode-api-tests'), { recursive: true, force: true });

	replaceTree(join(KIT_DIR, 'src'), join(checkout, KIT_TARGET));
	replaceTree(join(productDir, 'src'), join(checkout, PRODUCT_TARGET));
	const copiedExtensions = [];
	for (const owner of [KIT_DIR, productDir]) {
		const dir = join(owner, 'extensions');
		if (!existsSync(dir)) { continue; }
		for (const name of readdirSync(dir)) {
			replaceTree(join(dir, name), join(extensionsDir, name));
			copiedExtensions.push(name);
		}
	}

	const tierRecords = tiers.map((tier) => {
		const target = join(checkout, 'src/vs/workbench/contrib', tier.contrib, 'browser');
		replaceTree(join(tier.root, 'src'), target);
		for (const { as, from } of tier.media) { replaceTree(from, join(target, 'media', as)); }
		const { extensions } = tier;
		for (const name of extensions) {
			replaceTree(join(tier.root, 'extensions', name), join(extensionsDir, name));
			copiedExtensions.push(name);
		}
		return {
			package: tier.name,
			version: tier.version,
			contrib: tier.contrib,
			extensions,
			sha1: treeHash([join(tier.root, 'src'), join(tier.root, 'extensions'), ...tier.media.map(({ from }) => from)]),
		};
	});

	const chatExtensionVersion = writeChatExtension(checkout, extension);
	copiedExtensions.push(CHAT_EXTENSION.directory);

	patchNativeChat(checkout);
	patchExtensionSignatures(checkout);
	patchOptionalVsda(checkout);
	patchRegistrationImports(checkout, tiers);
	patchWebResources(checkout, tiers);
	patchRehCopilotShim(checkout);
	patchWin32Dependencies(checkout);
	patchNpmDirs(checkout);
	// Sources builds use the same exclusions as the packaged editor. The API
	// test extension is removed above; leaving its tsconfig in the dev compiler
	// makes `dev.mjs` fail before it can produce the updated workbench.
	patchChatSource(checkout, 'build/gulpfile.extensions.ts',
		"\t'extensions/vscode-api-tests/tsconfig.json',\n",
		"\t// VOLTER (overlaid tier): vscode-api-tests is not in this build.\n",
		'the removed API test extension compilation');
	patchProduct(checkout);

	// THE MARKER IS WHAT MAKES A SOURCES WORKBENCH SELF-DESCRIBING. A release says what it is in
	// `BUILD.json`; a checkout has no such file, and "which product is this workbench" is not a
	// question `git rev-parse` can answer. `@volter/editor-sdk/session/workbench-locator` reads it
	// and refuses a workbench built for another product than the project's own.
	writeFileSync(join(checkout, MARKER), `${JSON.stringify({
		product,
		commit: pin.commit,
		editorSource: {
			repository: 'https://github.com/volter-ai/editor',
			revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
			dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim() !== '',
		},
		kit: 'packages/editor-core/workbench',
		productHalf: `packages/${product}/workbench`,
		extensions: copiedExtensions,
		lookTiers: tierRecords,
		chatExtension: { id: CHAT_EXTENSION.id, version: chatExtensionVersion },
		overlaidAt: new Date().toISOString(),
	}, null, 2)}\n`);

	console.log(`overlay: ${product} + the editor kit onto ${checkout} at ${pin.commit.slice(0, 12)}`);
	console.log(`  ${KIT_TARGET}`);
	console.log(`  ${PRODUCT_TARGET}`);
	for (const tier of tierRecords) { console.log(`  src/vs/workbench/contrib/${tier.contrib}/browser   (look tier: ${tier.package}@${tier.version})`); }
	console.log(`  extensions/{${copiedExtensions.join(', ')}}   (${CHAT_EXTENSION.id}@${chatExtensionVersion})`);
	console.log(`  removed extensions/${COPILOT_EXTENSION}; ${PRODUCT_FILE}#defaultChatAgent names ${CHAT_EXTENSION.id}`);
	console.log(`  patched ${MAIN_FILE}, ${WEB_GULPFILE}, ${REH_GULPFILE} and ${NPM_DIRS_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { main(); }
