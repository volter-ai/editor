/*---------------------------------------------------------------------------------------------
 *  THE KEYMAP GENERATOR — vgai's chords, as a built-in extension's `contributes.keybindings`.
 *
 *  WORK.md §The core is Code-OSS U6b, and it is what RETIRED the fork's third core edit.
 *  U6 registered the vgai editor's keybinding rules at RUNTIME, from the keymap tables the
 *  bridge read out of the open project's session — and an upstream rule registered after
 *  `workbench.common.main.ts` has loaded is INERT, so it cost a four-line emitter on
 *  `KeybindingsRegistry` wired to the workbench keybinding service's `updateResolver()`.
 *
 *  The reading that retires it: the chords are PACKAGE DATA, known at BUILD time. Only the
 *  CHOICE of keymap is dynamic, and `vgai.keymap` already carries it as a context key. So a
 *  keymap is a keybinding SET in a built-in extension's manifest, gated on that context key,
 *  and VS Code's own keymap-extension path (the one `ms-vscode.sublime-keybindings` uses)
 *  carries it — at load, through `keybindingsExtPoint`, with no core file touched.
 *
 *  WHAT IT READS, and why THIS way. Three files of the vgai-engine checkout it is pointed at:
 *
 *    packages/editor-sdk/src/kit/keymap-presets.ts        the `vgai` table — the editor's own chords
 *    packages/<pkg>/contributions/*.keymap.ts     each package's keymap (`@vgai/blender`'s G/R/S)
 *    packages/editor-sdk/src/kit/editor-hotkeys.ts        each action's SCOPE, from its `bind()` call
 *
 *  It reads them STATICALLY, with the TypeScript compiler API, rather than importing them
 *  through the SDK-facing door the bridge uses (`@vgai/editor-sdk/host`'s `keyboard`). That
 *  door is the right one at RUNTIME and the wrong one at build time: reaching it means
 *  mounting the editor in a browser against a live session, because the action table is
 *  filled as a side effect of `registerEditorShellHotkeys`/`StageHost` mounting. `tsx` is no
 *  better — `keymap-presets.ts` reaches the settings store and `editor-hotkeys.ts` reaches
 *  three.js and the DOM. What these three files hold at the points read is LITERAL DATA
 *  (frozen object literals of chords; one string-literal action id and one scope expression
 *  per `bind()` call), so a static read is exact, hermetic and instant. The generator PROVES
 *  its read rather than trusting it: every emitted chord is parsed back with VS Code's OWN
 *  `KeybindingParser` (from the fork's compiled `out/`) and compared, key for key, against
 *  the `KeyCode` and modifiers the chord means. A chord it cannot express is a REFUSAL that
 *  names the action and stops the write — never a rule quietly left out.
 *
 *  WHAT IT WRITES, both checked in:
 *
 *    packages/editor-core/workbench/extensions/vgai-keymaps/package.json   the keybinding sets
 *    packages/editor-core/workbench/src/vgaiGeneratedKeymaps.ts            the ids the frame CARRIES
 *
 *  The second exists for one reason: a keymap a PROJECT contributes (a capability's copied
 *  `*.keymap.ts`, which the project then owns and edits — `unreal.keymap.ts` is the shipped
 *  case) cannot be in a manifest built here. `vgaiKeyboard.ts` compares the project's active
 *  keymap against this list and says so in the vgai console when it is not carried. A
 *  standing warning naming its mechanism, never a silent degrade.
 *
 *  DRIFT. Both artifacts carry the sha256 of every source they were generated from. Run
 *  without `--write` the generator RE-READS those sources and refuses, naming each file whose
 *  hash moved and the artifact that is now stale. That is the check the fork's dev script
 *  runs; `--write` is the fix.
 *
 *  WHY IT STILL WANTS A FORK CHECKOUT. The chords are read from THIS repository — the tables
 *  live here and so do the artifacts — but the PROOF does not: every chord is parsed back with
 *  VS Code's own `KeybindingParser`, and the only honest copy of that is a compiled fork. So
 *  `--checkout <fork dir>` is required and its `out/` must exist; there is deliberately no
 *  unverified path, and a second implementation of VS Code's chord grammar here would be a
 *  worse one.
 *
 *  Usage:
 *    node scripts/workbench/generate-keymaps.mjs --checkout <fork dir> [--write]
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_DIR = join(REPO_ROOT, 'packages/editor-core/workbench/extensions/vgai-keymaps');
const MANIFEST_PATH = join(EXTENSION_DIR, 'package.json');
const CARRIED_PATH = join(REPO_ROOT, 'packages/editor-core/workbench/src/vgaiGeneratedKeymaps.ts');

// ---------------------------------------------------------------------------------------------
// Arguments

function parseArgs(argv) {
	const args = { checkout: null, write: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--write') { args.write = true; }
		else if (argv[i] === '--checkout') { args.checkout = argv[++i]; }
		else if (argv[i].startsWith('--checkout=')) { args.checkout = argv[i].slice('--checkout='.length); }
		else { fail(`unknown argument "${argv[i]}". Usage: node scripts/workbench/generate-keymaps.mjs --checkout <fork dir> [--write]`); }
	}
	if (!args.checkout) { fail('--checkout <fork dir> is required: every chord is parsed back with VS Code\'s own KeybindingParser out of a compiled fork checkout, and this generator deliberately reads no env var and guesses no path.'); }
	args.checkout = resolve(args.checkout);
	if (!existsSync(join(args.checkout, 'src/vs/workbench/workbench.common.main.ts'))) {
		fail(`--checkout ${args.checkout} does not look like a Code-OSS checkout: src/vs/workbench/workbench.common.main.ts is not there.`);
	}
	return args;
}

function fail(message) {
	console.error(`vgai keymap generator: ${message}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// The fork's own compiled core — the authority on what a chord STRING means.

async function loadForkKeyApis(checkout) {
	const keyCodesJs = join(checkout, 'out/vs/base/common/keyCodes.js');
	const parserJs = join(checkout, 'out/vs/base/common/keybindingParser.js');
	if (!existsSync(keyCodesJs) || !existsSync(parserJs)) {
		fail(`the fork's compiled core is not in ${join(checkout, 'out')} — run \`npm run compile-client\` there first. Every chord this writes is parsed back with VS Code's own KeybindingParser before it is written, so there is deliberately no unverified path.`);
	}
	const { KeyCode, KeyCodeUtils } = await import(pathToFileURL(keyCodesJs).href);
	const { KeybindingParser } = await import(pathToFileURL(parserJs).href);
	return { KeyCode, KeyCodeUtils, KeybindingParser };
}

// ---------------------------------------------------------------------------------------------
// Reading the engine's TypeScript, statically.

function loadTypeScript() {
	const ts = join(REPO_ROOT, 'node_modules/typescript/lib/typescript.js');
	if (!existsSync(ts)) { fail(`typescript is not installed here (${ts}) — the tables this reads are this repository's.`); }
	return import(pathToFileURL(ts).href).then(m => m.default ?? m);
}

function parseSource(ts, file) {
	return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** The literal value of an expression, for the literal-only shapes these three files hold. */
function literalOf(ts, node, constants) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { return node.text; }
	if (node.kind === ts.SyntaxKind.TrueKeyword) { return true; }
	if (node.kind === ts.SyntaxKind.FalseKeyword) { return false; }
	if (ts.isNumericLiteral(node)) { return Number(node.text); }
	if (ts.isArrayLiteralExpression(node)) { return node.elements.map(e => literalOf(ts, e, constants)); }
	if (ts.isObjectLiteralExpression(node)) {
		const out = {};
		for (const prop of node.properties) {
			if (!ts.isPropertyAssignment(prop)) { return undefined; }
			const name = ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name) ? prop.name.text : undefined;
			if (name === undefined) { return undefined; }
			out[name] = literalOf(ts, prop.initializer, constants);
		}
		return out;
	}
	// `Object.freeze({…})`, `{…} as const`, `{…} satisfies T`, `(…)`
	if (ts.isCallExpression(node) && node.expression.getText() === 'Object.freeze' && node.arguments.length === 1) {
		return literalOf(ts, node.arguments[0], constants);
	}
	if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression?.(node)) {
		return literalOf(ts, node.expression, constants);
	}
	if (ts.isIdentifier(node) && constants && Object.prototype.hasOwnProperty.call(constants, node.text)) {
		return constants[node.text];
	}
	return undefined;
}

/** Every `const <name> = <literal>` in a file, so a scope named by a constant resolves. */
function fileConstants(ts, source) {
	const constants = {};
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const value = literalOf(ts, node.initializer, constants);
			if (value !== undefined) { constants[node.name.text] = value; }
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return constants;
}

/** `keymap-presets.ts`'s own table: the chords every project gets. */
function readVgaiTable(ts, file) {
	const source = parseSource(ts, file);
	let table;
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'VGAI_KEYMAP' && node.initializer) {
			table = literalOf(ts, node.initializer, {});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (!table) { fail(`${file}: could not read the VGAI_KEYMAP table. It is expected to be a literal \`const VGAI_KEYMAP = Object.freeze({…})\`; if it stopped being one, this generator is what has to change.`); }
	return table;
}

/** One package's `*.keymap.ts` contribution: id, title, and the chords it moves. */
function readKeymapContribution(ts, file) {
	const source = parseSource(ts, file);
	let contribution;
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'keymap' && node.initializer) {
			contribution = literalOf(ts, node.initializer, {});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (!contribution || typeof contribution.id !== 'string' || typeof contribution.bindings !== 'object') {
		fail(`${file}: could not read a literal \`export const keymap: KeymapContribution = { id, title, bindings }\`.`);
	}
	return contribution;
}

/**
 * Each action's SCOPE, from the one place it is written: its `bind()` call in
 * `editor-hotkeys.ts`. `frameScopeOf` there is the rule this reproduces — global anywhere in
 * it, the viewport alone is the stage, everything else is our panels — and reproducing it is
 * the point of the hash check: move a scope in that file and this generator refuses until it
 * is re-run.
 */
function readActionScopes(ts, file) {
	const source = parseSource(ts, file);
	const constants = fileConstants(ts, source);
	const scopes = new Map();
	const visit = (node) => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'bind' && node.arguments.length >= 2) {
			const id = literalOf(ts, node.arguments[0], constants);
			const options = node.arguments[1];
			// The lane door binds what a lane hands it; those actions are read at their own
			// `bindActions([...])` call (readLaneActionScopes).
			const inLaneDoor = ts.findAncestor(node, n => ts.isFunctionDeclaration(n) && n.name?.text === 'bindKeyActions');
			if (typeof id !== 'string' && inLaneDoor) { ts.forEachChild(node, visit); return; }
			if (typeof id !== 'string' || !ts.isObjectLiteralExpression(options)) {
				fail(`${file}: a bind() call this generator cannot read statically at line ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}.`);
			}
			const scopeProp = options.properties.find(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'scope');
			const raw = scopeProp ? literalOf(ts, scopeProp.initializer, constants) : undefined;
			if (raw === undefined) {
				fail(`${file}: bind('${id}') has a \`scope\` this generator cannot resolve statically. Spell it as a string, an array of strings, or a const in this file.`);
			}
			const list = Array.isArray(raw) ? raw : [raw];
			const frameScope = list.includes('global') ? 'global' : (list.length === 1 && list[0] === 'viewport' ? 'stage' : 'panel');
			scopes.set(id, frameScope);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (scopes.size === 0) { fail(`${file}: found no bind() calls.`); }
	return scopes;
}

/**
 * The actions a LANE binds through the host door (`host.keyboard.bindActions([...])`, the
 * three viewport's trio and views among them): each entry's literal `id` and `scope`, which
 * `bindKeyActions` in `editor-hotkeys.ts` maps as `'stage'` to the stage and anything else to
 * global.
 */
function readLaneActionScopes(ts, files, scopes) {
	for (const file of files) {
		const source = parseSource(ts, file);
		const constants = fileConstants(ts, source);
		const visit = (node) => {
			if (
				ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === 'bindActions' && node.arguments.length === 1
			) {
				const list = node.arguments[0];
				if (!ts.isArrayLiteralExpression(list)) {
					fail(`${file}: a bindActions() call this generator cannot read statically at line ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}.`);
				}
				for (const entry of list.elements) {
					const read = (key) => {
						const prop = ts.isObjectLiteralExpression(entry)
							? entry.properties.find(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key)
							: undefined;
						return prop ? literalOf(ts, prop.initializer, constants) : undefined;
					};
					const id = read('id');
					const scope = read('scope');
					if (typeof id !== 'string' || typeof scope !== 'string') {
						fail(`${file}: a bindActions() entry without a literal id and scope at line ${source.getLineAndCharacterOfPosition(entry.getStart()).line + 1}.`);
					}
					scopes.set(id, scope === 'stage' ? 'stage' : 'global');
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
}

/** Every package source file that calls `bindActions(`. */
function laneActionFiles(packagesDir) {
	const found = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name.startsWith('dist') || entry.name.startsWith('.')) { continue; }
			const path = join(dir, entry.name);
			if (entry.isDirectory()) { walk(path); }
			else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && readFileSync(path, 'utf8').includes('.bindActions([')) { found.push(path); }
		}
	};
	for (const pkg of readdirSync(packagesDir)) {
		const src = join(packagesDir, pkg, 'src');
		if (existsSync(src)) { walk(src); }
	}
	return found.sort();
}

// ---------------------------------------------------------------------------------------------
// A vgai chord, as a VS Code keybinding string.

/**
 * The vgai keymap tables spell a chord as `KeyboardEvent.key` (lowercased), or as
 * `KeyboardEvent.code` where the typed character varies by layout or modifier. This is the
 * same translation `vgaiKeyboard.ts` did at runtime in U6, moved to build time.
 */
function keyCodeFor(chord, KeyCode) {
	if (chord.code) {
		const numpad = /^Numpad([0-9])$/.exec(chord.code);
		if (numpad) { return KeyCode.Numpad0 + Number(numpad[1]); }
		switch (chord.code) {
			case 'NumpadDecimal': return KeyCode.NumpadDecimal;
			case 'PageDown': return KeyCode.PageDown;
			case 'PageUp': return KeyCode.PageUp;
			case 'End': return KeyCode.End;
			case 'Home': return KeyCode.Home;
			case 'NumpadAdd': return KeyCode.NumpadAdd;
			case 'NumpadSubtract': return KeyCode.NumpadSubtract;
			case 'NumpadMultiply': return KeyCode.NumpadMultiply;
			case 'NumpadDivide': return KeyCode.NumpadDivide;
			case 'Equal': return KeyCode.Equal;
			case 'Minus': return KeyCode.Minus;
		}
		const letter = /^Key([A-Z])$/.exec(chord.code);
		if (letter) { return KeyCode.KeyA + (letter[1].charCodeAt(0) - 'A'.charCodeAt(0)); }
		const digit = /^Digit([0-9])$/.exec(chord.code);
		if (digit) { return KeyCode.Digit0 + Number(digit[1]); }
		return null;
	}
	const key = chord.key;
	if (key.length === 1 && key >= 'a' && key <= 'z') { return KeyCode.KeyA + (key.charCodeAt(0) - 'a'.charCodeAt(0)); }
	if (key.length === 1 && key >= '0' && key <= '9') { return KeyCode.Digit0 + (key.charCodeAt(0) - '0'.charCodeAt(0)); }
	switch (key) {
		case 'delete': return KeyCode.Delete;
		case 'backspace': return KeyCode.Backspace;
		case 'escape': return KeyCode.Escape;
		case 'enter': return KeyCode.Enter;
		case 'tab': return KeyCode.Tab;
		case ' ': return KeyCode.Space;
		case 'pagedown': return KeyCode.PageDown;
		case 'pageup': return KeyCode.PageUp;
		case 'home': return KeyCode.Home;
		case 'end': return KeyCode.End;
		case 'arrowup': return KeyCode.UpArrow;
		case 'arrowdown': return KeyCode.DownArrow;
		case 'arrowleft': return KeyCode.LeftArrow;
		case 'arrowright': return KeyCode.RightArrow;
		case '`': return KeyCode.Backquote;
		case '.': return KeyCode.Period;
		case ',': return KeyCode.Comma;
		case '/': return KeyCode.Slash;
		case ';': return KeyCode.Semicolon;
		case "'": return KeyCode.Quote;
		case '-': return KeyCode.Minus;
		case '=': return KeyCode.Equal;
		case '[': return KeyCode.BracketLeft;
		case ']': return KeyCode.BracketRight;
		case '\\': return KeyCode.Backslash;
		default: return null;
	}
}

/**
 * `key` is the default (and Windows/Linux) binding; `mac` is the same chord with ⌘ where the
 * table says `mod`. That IS what `mod` means — `KeyMod.CtrlCmd`, which U6 translated the same
 * way — and it is why a chord without `mod` needs no `mac` at all. `ctrl` is the Control key
 * itself (`KeyMod.WinCtrl`), the same on every platform.
 */
function keybindingStrings(chord, apis) {
	const keyCode = keyCodeFor(chord, apis.KeyCode);
	if (keyCode === null || keyCode === apis.KeyCode.Unknown) { return null; }
	const name = apis.KeyCodeUtils.toUserSettingsUS(keyCode);
	if (!name) { return null; }
	const tail = [];
	if (chord.shift) { tail.push('shift'); }
	if (chord.alt) { tail.push('alt'); }
	const control = chord.mod || chord.ctrl;
	const key = [...(control ? ['ctrl'] : []), ...tail, name].join('+');
	const mac = chord.mod ? [...(chord.ctrl ? ['ctrl'] : []), ...tail, 'cmd', name].join('+') : undefined;
	// PROVE the strings, with VS Code's own parser: what we wrote has to mean what the chord
	// means, modifier for modifier and key for key. Nothing here is emitted on faith.
	const check = (text, expectCtrl, expectMeta) => {
		const parsed = apis.KeybindingParser.parseKeybinding(text);
		const one = parsed?.chords?.length === 1 ? parsed.chords[0] : undefined;
		return !!one && one.keyCode === keyCode && one.ctrlKey === expectCtrl && one.shiftKey === !!chord.shift
			&& one.altKey === !!chord.alt && one.metaKey === expectMeta;
	};
	if (!check(key, !!control, false)) { return null; }
	if (mac !== undefined && !check(mac, !!chord.ctrl, true)) { return null; }
	return mac === undefined ? { key } : { key, mac };
}

// ---------------------------------------------------------------------------------------------
// The `when` clause — U6's classification, unchanged.
//
// stage  the focused stage alone: the transform trio, the view presets, the viewport verbs.
// panel  any of our parts (stage, outliner, properties).
// global the host dispatcher fires these regardless of which of ITS panels is active — but
//        "regardless of our panels" is not "regardless of the window": under the frame the
//        Explorer, a terminal and Monaco share it, so a bare backtick must type a backtick in
//        a text editor. Global is `vgai.focused` too.
//
// A RUNNING GAME'S STAGE is the game's keyboard: with the Game document active, a stage or
// panel chord is the player's key, not an editor verb (measured on `arena`: W held in Play ran
// `transform.translate`, which refused and warned). Global chords still reach the editor there.
function whenFor(id, scope, keymapId) {
	const focus = scope === 'stage' ? 'vgai.stage.focused' : 'vgai.focused';
	const game = scope === 'global' ? '' : " && vgai.document.kind != 'game'";
	return `${focus}${game} && vgai.keymap == '${keymapId}'`;
}

// ---------------------------------------------------------------------------------------------
// THE ONE ⌘Z (U4). `edit.undo`/`edit.redo` get a COMMAND like every other action, and
// deliberately NO KEYBINDING RULE: under the frame ⌘Z is VS Code's own `undo`/`redo`
// `MultiCommand`, which `vgaiHistory.ts` answers for a focused vgai stage
// (`UndoCommand.addImplementation`, the same door upstream's custom editors use) and Monaco
// answers for a focused text editor. Both end at the one `IUndoRedoService`, keyed on the
// document's own file — which is what makes a gizmo drag on `cube.ts`'s model and a keystroke
// in `cube.ts`'s text editor undo IN ORDER from one stack.
//
// A rule here would take that back: an extension keybinding outweighs `undo`'s EditorCore
// weight, so `vgai.edit.undo` would win the chord with a stage focused and walk the editor's
// OWN cursor instead - a second stack, which is precisely the defect U4 closes. The commands
// stay registered because the editor's palette and `vgai eval` still name them, and the
// standalone shape (which never loads this extension) keeps its own chords unchanged.
const UNBOUND_UNDER_THE_FRAME = new Set(['edit.undo', 'edit.redo']);

// ---------------------------------------------------------------------------------------------

function sha256(file) {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const ts = await loadTypeScript();
	const apis = await loadForkKeyApis(args.checkout);

	const presetsFile = join(REPO_ROOT, 'packages/editor-sdk/src/kit/keymap-presets.ts');
	const hotkeysFile = join(REPO_ROOT, 'packages/editor-sdk/src/kit/editor-hotkeys.ts');
	const packagesDir = join(REPO_ROOT, 'packages');
	// Every keymap a PACKAGE of this engine contributes. A capability's copied
	// `src/contributions/*.keymap.ts` is deliberately not here: once copied it is the
	// PROJECT's file to edit, so its chords are not build-time data of this fork.
	const contributionFiles = readdirSync(packagesDir)
		.map(pkg => join(packagesDir, pkg, 'contributions'))
		.filter(dir => existsSync(dir))
		.flatMap(dir => readdirSync(dir).filter(f => f.endsWith('.keymap.ts')).map(f => join(dir, f)))
		.sort();

	const laneFiles = laneActionFiles(packagesDir);
	const sources = [presetsFile, hotkeysFile, ...laneFiles, ...contributionFiles];
	const hashes = Object.fromEntries(sources.map(file => [relative(REPO_ROOT, file), sha256(file)]));

	const vgaiTable = readVgaiTable(ts, presetsFile);
	const scopes = readActionScopes(ts, hotkeysFile);
	readLaneActionScopes(ts, laneFiles, scopes);
	const keymaps = [
		{ id: 'vgai', title: 'vgai', chords: vgaiTable },
		...contributionFiles.map(file => {
			const contribution = readKeymapContribution(ts, file);
			// Exactly what `registerContributedKeymap` does: the editor's own table with the
			// contribution's chords over it, so a keymap declares only where it differs.
			return { id: contribution.id, title: contribution.title, chords: { ...vgaiTable, ...contribution.bindings } };
		}),
	];

	const rules = [];
	const refusals = [];
	const carriedActions = new Set();
	for (const keymap of keymaps) {
		for (const [id, chords] of Object.entries(keymap.chords)) {
			const scope = scopes.get(id);
			// An action no `bind()` call registers has no handler to reach, so it gets no
			// command and no rule — `viewport.vertexSnapHold` is the standing case (a
			// keybinding rule fires on keydown and has no HELD concept; WORK.md U6 records it).
			if (!scope) { continue; }
			// The command exists whatever happens to its chords (see UNBOUND_UNDER_THE_FRAME).
			carriedActions.add(id);
			if (UNBOUND_UNDER_THE_FRAME.has(id)) { continue; }
			for (const chord of chords) {
				const strings = keybindingStrings(chord, apis);
				if (!strings) {
					refusals.push(`${keymap.id}: "${id}" chord ${JSON.stringify(chord)} is not expressible as a VS Code keybinding`);
					continue;
				}
				rules.push({ command: `vgai.${id}`, ...strings, when: whenFor(id, scope, keymap.id) });
			}
		}
	}
	if (refusals.length > 0) {
		fail(`${refusals.length} chord(s) could not be expressed, so nothing was written:\n  ${refusals.join('\n  ')}`);
	}

	const perKeymap = keymaps.map(k => `${k.id} ${rules.filter(r => r.when.endsWith(`'${k.id}'`)).length}`).join(', ');
	const provenance = {
		generatedBy: 'scripts/workbench/generate-keymaps.mjs',
		doc: 'docs/CODE-OSS.md §The keyboard, under the frame; WORK.md §The core is Code-OSS U6b',
		keymaps: keymaps.map(k => k.id),
		commands: [...carriedActions].sort(),
		rules: rules.length,
		sources: hashes,
	};

	const manifest = {
		name: 'vgai-keymaps',
		displayName: 'vgai keymaps',
		description: "GENERATED — do not edit. The vgai editor's keyboard actions as keybinding sets, one per keymap, gated on the `vgai.keymap` context key the frame publishes from the open project's own choice. Regenerate with `node scripts/workbench/generate-keymaps.mjs --checkout <fork dir> --write`.",
		categories: ['Keymaps'],
		version: '0.0.1',
		publisher: 'vscode',
		license: 'MIT',
		engines: { vscode: '*' },
		vgai: provenance,
		contributes: { keybindings: rules },
	};

	const carried = `/*---------------------------------------------------------------------------------------------
 *  GENERATED by scripts/workbench/generate-keymaps.mjs — do not edit.
 *
 *  The keymaps the FRAME carries, and the commands they bind. The chords themselves are in
 *  \`extensions/vgai-keymaps/package.json\`, which VS Code's own keymap-extension path
 *  (\`contributes.keybindings\`) resolves at load; this file is what \`vgaiKeyboard.ts\` needs in
 *  CODE: the command ids to register, and the keymap ids to compare the open project's choice
 *  against so a keymap the frame does NOT carry is a named warning in the vgai console rather
 *  than a keyboard that silently does nothing.
 *
 *  Regenerate:  node scripts/workbench/generate-keymaps.mjs --checkout <fork dir> --write
 *  Sources (sha256 at generation; the generator refuses when one has moved):
${Object.entries(hashes).map(([file, hash]) => ` *    ${hash}  ${file}`).join('\n')}
 *  ${rules.length} rules over ${carriedActions.size} commands (${perKeymap}).
 *--------------------------------------------------------------------------------------------*/

/** Every keymap the generated extension carries chords for. */
export const CARRIED_KEYMAP_IDS: readonly string[] = [${keymaps.map(k => `'${k.id}'`).join(', ')}];

/** Every vgai editor action the generated extension binds, without the \`vgai.\` prefix. */
export const CARRIED_ACTION_IDS: readonly string[] = [
${[...carriedActions].sort().map(id => `\t'${id}',`).join('\n')}
];
`;

	const wanted = [
		{ path: MANIFEST_PATH, text: JSON.stringify(manifest, null, '\t') + '\n' },
		{ path: CARRIED_PATH, text: carried },
	];

	if (args.write) {
		for (const { path, text } of wanted) { writeFileSync(path, text); }
		console.log(`vgai keymap generator: wrote ${rules.length} rules over ${carriedActions.size} commands (${perKeymap}).`);
		for (const [file, hash] of Object.entries(hashes)) { console.log(`  ${hash.slice(0, 12)}  ${file}`); }
		return;
	}

	const stale = wanted.filter(({ path, text }) => !existsSync(path) || readFileSync(path, 'utf8') !== text);
	if (stale.length > 0) {
		const committed = existsSync(CARRIED_PATH) ? readFileSync(CARRIED_PATH, 'utf8') : '';
		const moved = Object.entries(hashes).filter(([file, hash]) => !committed.includes(`${hash}  ${file}`)).map(([file]) => file);
		fail(`${stale.map(s => relative(REPO_ROOT, s.path)).join(' and ')} ${stale.length > 1 ? 'are' : 'is'} stale.${moved.length ? `\n  Moved since it was generated:\n    ${moved.join('\n    ')}` : ''}\n  Fix: node scripts/workbench/generate-keymaps.mjs --checkout ${args.checkout} --write`);
	}
	console.log(`vgai keymap generator: up to date — ${rules.length} rules over ${carriedActions.size} commands (${perKeymap}).`);
}

main().catch(error => fail(error instanceof Error ? (error.stack ?? error.message) : String(error)));
