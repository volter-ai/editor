#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  THE OVERLAY — our workbench tier, copied onto a Code-OSS checkout at the pin.
 *
 *  TRIGGER: you are about to compile, run or package a workbench that has to contain the vgai
 *  editor — `scripts/workbench/dev.mjs` (a sources boot) and `scripts/workbench/build-release.mjs`
 *  (a release) both run this first, and it is the only thing that ever writes vgai files into a
 *  fork checkout.
 *
 *    node scripts/workbench/overlay.mjs --checkout <fork dir> --product <editor>
 *
 *  WHY IT EXISTS. ARCHITECTURE-CORE §The target shape, rule 6: *"Nothing of ours is built inside
 *  a fork: the product build OVERLAYS the tier on the fork at a pin."* Until 2026-09-21 the tier
 *  WAS the fork — 3,395 lines under `src/vs/workbench/contrib/vgaiBlender/`, a file named
 *  `vgaiGameSkew.ts`, two generated artifacts and two extensions — so every edit to our own
 *  workbench code was a commit in another repository, and the fork's diff against upstream was
 *  ours as much as it was patches. Now the three homes are here:
 *
 *    packages/editor-core/workbench/        the KIT's half         → contrib/vgai/browser/
 *    packages/<product>/workbench/     the PRODUCT's half     → contrib/vgaiProduct/browser/
 *
 *  and what the fork carries is upstream plus patches.
 *
 *  A THIRD HOME, ONLY WHEN NAMED: LOOK TIERS. A package outside this repository may carry the
 *  frame half of a look, declared as `package.json#vgai.workbench`:
 *
 *    { "contrib": "vgaiBrand", "root": "./editor/workbench", "media": { "fonts": "./fonts" } }
 *
 *  and a build carries it only when its directory is passed, `--look <package dir>` (repeatable):
 *  `<root>/src` → `contrib/<contrib>/browser/` (its `look.contribution.ts` is imported after the
 *  product's and before the kit's), `<root>/extensions/*` → `extensions/`, and each `media` entry
 *  → `contrib/<contrib>/browser/media/<name>/`. Nothing in the install brings one in by itself,
 *  so a build of this repository never carries a look package's code unless its builder named
 *  it — the Volter brand's private package (`volter-ai/brand`, its Plotter look) in particular.
 *
 *  WHY THE PRODUCT'S DIRECTORY IS ONE FIXED NAME. `vgaiProduct` rather than `vgaiModelEditor`:
 *  the registration import line, the build's resource glob and the product's own
 *  `FileAccess.asBrowserUri('vs/workbench/contrib/vgaiProduct/browser/media/Inter.woff2')` are
 *  then the same strings for every product, so the patch this writes is one shape and a product
 *  swap in the same checkout cannot leave a path behind. WHICH product a build is, is recorded
 *  in `.vgai-overlay.json` and in the release's `BUILD.json`, never in a path.
 *
 *  THE AI IN THE TAB RIDES HERE TOO (B9b). ARCHITECTURE-CORE §The core is Code-OSS rule 7: the
 *  workbench's own Chat view is the agent's front end, and what fills the default-participant
 *  slot is supercode's `sdk/frontend-vscode`, consumed as the PUBLISHED npm package. So this
 *  also writes `extensions/supercode-chat` (the package's own `pack-extension.mjs` output —
 *  one `package.json` cannot be both an npm manifest and an extension manifest, and that
 *  transform is supercode's, not a fifteen-line copy of it here), REMOVES `extensions/copilot`
 *  (272 MB of GitHub Copilot Chat, the open-source default agent Code-OSS vendors), and rewrites
 *  `product.json` to name ours and grant it the four proposals it asks for.
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KIT_DIR = join(REPO_ROOT, 'packages/editor-core/workbench');
const PIN_PATH = join(KIT_DIR, 'FORK.json');

/** Where each half lands inside the fork. Both are four levels under `src/vs/`, which is what
 *  makes the `../../../../base/...` imports our files carry resolve unchanged. */
const KIT_TARGET = 'src/vs/workbench/contrib/vgai/browser';
const PRODUCT_TARGET = 'src/vs/workbench/contrib/vgaiProduct/browser';
/** The two registration lines, in this order: the product registers itself at module scope and
 *  the kit reads it at module scope, so the product's import has to be evaluated first. */
const PRODUCT_IMPORT = "import './contrib/vgaiProduct/browser/product.contribution.js';";
const KIT_IMPORT = "import './contrib/vgai/browser/vgai.contribution.js';";
const MAIN_FILE = 'src/vs/workbench/workbench.common.main.ts';
const WEB_GULPFILE = 'build/gulpfile.vscode.web.ts';
const REH_GULPFILE = 'build/gulpfile.reh.ts';
const NPM_DIRS_FILE = 'build/npm/dirs.ts';
const PRODUCT_FILE = 'product.json';
const MARKER = '.vgai-overlay.json';

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
	package: '@volter-ai-dev/supercode-frontend-vscode',
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
 * The registration imports, as an idempotent rewrite: every vgai contribution import is
 * stripped and the two are appended after the LAST upstream contribution import — last, so our
 * command shadowing (the auxiliary-window refusal) is registered after the commands it shadows,
 * which `CommandsRegistry`'s most-recent-wins list is what makes work.
 */
function patchRegistrationImports(checkout, tiers) {
	const path = join(checkout, MAIN_FILE);
	const lines = readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => !/^import '\.\/contrib\/vgai[^']*';$/.test(line))
		.filter((line, index, all) => !line.startsWith('// VGAI (overlaid tier') && !(line === '' && all[index + 1]?.startsWith('// VGAI (overlaid tier')));
	let last = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^import '\.\/contrib\/.*\.js';$/.test(lines[i])) { last = i; }
	}
	if (last === -1) { fail(`${path} carries no \`import './contrib/….js';\` line to register beside.`); }
	const tierImports = tiers.map((tier) => `import './contrib/${tier.contrib}/browser/look.contribution.js';`);
	lines.splice(last + 1, 0, '', '// VGAI (overlaid tier — scripts/workbench/overlay.mjs; the product and its look tiers register, then the kit reads them)', PRODUCT_IMPORT, ...tierImports, KIT_IMPORT);
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
		.filter((line) => !line.includes('contrib/vgai') && !line.includes('// VGAI'))
		.join('\n')
		.replace(/,?\s*$/, ',');
	// `out-build` IS the compiled `src/`, so the glob drops that prefix: a path with it in
	// matches nothing and the packaged workbench 404s on the font with no build-time error.
	const outBuild = (target) => `out-build/${target.replace(/^src\//, '')}`;
	const ours = [
		'',
		'',
		'\t// VGAI (overlaid tier — scripts/workbench/overlay.mjs)',
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

function patchNativeChat(checkout) {
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

	// The editor owns agent runtimes through Supercode: its service choice registers after the
	// web defaults (packages/editor-core/workbench/src/vgaiChat.services.ts).
	const webMain = join(checkout, 'src/vs/workbench/workbench.web.main.ts');
	const servicesImport = "import './contrib/vgai/browser/vgaiChat.services.js';";
	writeFileSync(webMain, `${readFileSync(webMain, 'utf8').replaceAll(servicesImport, '').trimEnd()}\n\n${servicesImport}\n`);
}

/**
 * `product.json` — ours to write (ARCHITECTURE-CORE §The core is Code-OSS, rule 7). Two keys:
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
 *  - `extensionEnabledApiProposals` grants the extension the four proposals it asks for.
 *
 * REMOVING the key entirely would ALSO silence the Copilot setup machinery (`chatEntitlement
 * Service` returns early with no `defaultChatAgent`), but it would silence the Chat view's whole
 * entitlement/session surface with it. Rule 7 says name ours; this names ours.
 */
function patchProduct(checkout) {
	const path = join(checkout, PRODUCT_FILE);
	const product = JSON.parse(readFileSync(path, 'utf8'));
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
	product.extensionEnabledApiProposals = { [CHAT_EXTENSION.id]: [...CHAT_EXTENSION.proposals] };
	writeFileSync(path, `${JSON.stringify(product, null, '\t')}\n`);
}

/**
 * The REH package task shims ripgrep INTO the built-in Copilot extension and THROWS when that
 * extension is not there (`build/lib/copilot.ts`'s `prepareBuiltInCopilotRipgrepShim`: "Copilot
 * SDK directory not found"). This release does not bundle it, so the step has nothing to do —
 * and an unconditional throw is not a thing a caller can route around, which is why this is a
 * patch and not a flag. Same shape as the other two: strip our lines, re-insert from the file's
 * own text, refuse by name if upstream moved the block.
 */
function patchRehCopilotShim(checkout) {
	const path = join(checkout, REH_GULPFILE);
	const source = readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => !line.includes('// VGAI (overlaid tier') && !line.includes('VGAI_NO_BUILTIN_COPILOT'))
		.join('\n');
	const anchor = "\t\tconst builtInCopilotExtensionDir = path.join(outputDir, 'extensions', 'copilot');\n";
	if (!source.includes(anchor)) {
		fail(`${path} has no \`${anchor.trim()}\` — upstream moved the Copilot ripgrep shim and this patch needs re-aiming.`);
	}
	const guard =
		'\t\t// VGAI (overlaid tier — scripts/workbench/overlay.mjs): extensions/copilot is not in\n' +
		'\t\t// this release, so there is no built-in Copilot SDK to shim. VGAI_NO_BUILTIN_COPILOT.\n' +
		'\t\tif (!fs.existsSync(builtInCopilotExtensionDir)) { return; }\n';
	writeFileSync(path, source.replace(anchor, anchor + guard));
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
	const source = readFileSync(path, 'utf8');
	const entry = `\t'extensions/${COPILOT_EXTENSION}',\n`;
	const marker = `\t// VGAI (overlaid tier — scripts/workbench/overlay.mjs): 'extensions/${COPILOT_EXTENSION}' is not in this build.\n`;
	if (source.includes(marker)) { return; }
	if (!source.includes(entry)) {
		fail(`${path} has no \`${entry.trim()}\` entry and no vgai marker — upstream moved the install-directory list and this patch needs re-aiming. Leaving it would die later as \`spawn /bin/sh ENOENT\`, which names neither the file nor the cause.`);
	}
	writeFileSync(path, source.replace(entry, marker));
}

/** The look tiers the builder named (`--look <package dir>`), read from each package's own
 *  `package.json#vgai.workbench`. */
function lookTiers(dirs) {
	const tiers = [];
	for (const dir of dirs) {
		if (!existsSync(join(dir, 'package.json'))) { fail(`--look ${dir} is not a package directory.`); }
		const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
		const where = `${manifest.name ?? dir}'s package.json#vgai.workbench`;
		const declared = manifest.vgai?.workbench;
		if (declared === undefined) { fail(`--look ${dir}: ${where} is not declared, so it carries no look tier.`); }
		if (typeof declared?.contrib !== 'string' || !/^vgai[A-Z][A-Za-z0-9]*$/.test(declared.contrib) || declared.contrib === 'vgaiProduct') {
			fail(`${where} must name its "contrib" directory as vgai<Name> (not vgaiProduct), e.g. "vgaiBrand".`);
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
		tiers.push({ name: manifest.name ?? dir, version: manifest.version, contrib: declared.contrib, root, media });
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
	for (const dir of dirs) { if (existsSync(dir)) { hash.update(`\0${dir.split('/').pop()}`); walk(dir, dir); } }
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
	const previous = existsSync(join(checkout, MARKER)) ? JSON.parse(readFileSync(join(checkout, MARKER), 'utf8')) : {};
	for (const name of previous.extensions ?? []) { rmSync(join(extensionsDir, name), { recursive: true, force: true }); }
	for (const tier of previous.lookTiers ?? []) { rmSync(join(checkout, 'src/vs/workbench/contrib', tier.contrib), { recursive: true, force: true }); }
	rmSync(join(extensionsDir, CHAT_EXTENSION.directory), { recursive: true, force: true });
	// THE ONE DELETION THIS MAKES IN THE CLONE. `build/lib/extensions.ts` already lists `copilot`
	// in `excludedExtensions`, so `compile-non-native-extensions-build` skips it either way; what
	// packages it is the separate `compile-copilot-extension-build`, which `build-release.mjs`
	// no longer runs. Removing the directory as well is what makes a sources boot agree with a
	// release, and what makes "is Copilot in this workbench" answerable by looking.
	rmSync(join(extensionsDir, COPILOT_EXTENSION), { recursive: true, force: true });

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
		const extensions = existsSync(join(tier.root, 'extensions')) ? readdirSync(join(tier.root, 'extensions')) : [];
		for (const name of extensions) {
			// Everything ours was removed above, so a directory still here is upstream's or another
			// tier's: a look tier adds extensions and never replaces one.
			if (existsSync(join(extensionsDir, name))) { fail(`${tier.name}'s extension ${name} would replace extensions/${name}, which is not a look tier's.`); }
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
	patchRegistrationImports(checkout, tiers);
	patchWebResources(checkout, tiers);
	patchRehCopilotShim(checkout);
	patchNpmDirs(checkout);
	patchProduct(checkout);

	// THE MARKER IS WHAT MAKES A SOURCES WORKBENCH SELF-DESCRIBING. A release says what it is in
	// `BUILD.json`; a checkout has no such file, and "which product is this workbench" is not a
	// question `git rev-parse` can answer. `@vgai/editor-sdk/session/workbench-locator` reads it
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
