/*---------------------------------------------------------------------------------------------
 *  THE SETTINGS GENERATOR — vgai's settings keys, as a `configuration` contribution.
 *
 *  WORK.md §The core is Code-OSS U7. The vgai editor's settings are a Zod document
 *  (`packages/project/src/settings/schema.ts`); the configuration service speaks FLAT DOTTED
 *  KEYS. One derivation has to produce both, or the Settings editor shows a key set that
 *  drifts from the one the editor reads — which is invisible rather than loud, because a
 *  missing declaration simply means the key is not listed.
 *
 *  WHAT IT READS: `packages/project/schemas/vgai-settings.schema.json` — the JSON Schema
 *  `npm run generate-schema` already commits from that Zod document, and the SAME derivation
 *  `@vgai/project/settings/keys` walks at runtime to build the editor's own key table. So this
 *  generator adds no second notion of what a settings key is; it re-spells one that exists,
 *  and the engine's own pre-commit hook is what keeps the schema honest against the Zod.
 *
 *  WHAT IT WRITES, checked in:
 *
 *    packages/editor-core/workbench/src/vgaiGeneratedSettings.ts
 *
 *  WHY A TS MODULE AND NOT AN EXTENSION MANIFEST. U6b's chords went into
 *  `extensions/vgai-keymaps` because `contributes.keybindings` is the ONLY door to the
 *  keybinding resolver at load — a runtime registration was inert and cost a core edit.
 *  Configuration has no such constraint: `IConfigurationRegistry.registerConfiguration` is
 *  what every core contribution in `src/vs/workbench/contrib/**` uses for its own settings,
 *  it is honoured at load, and it is as additive as an extension manifest. Measured in files:
 *  one generated module here, against an extension manifest PLUS a module carrying the same
 *  keys in code for `vgaiSettings.ts` to write and clear (the keymap generator needs both for
 *  exactly that reason). One artifact wins.
 *
 *  DRIFT. The artifact carries the sha256 of the schema it was generated from. Run without
 *  `--write` the generator RE-READS it and refuses, naming the file whose hash moved; that is
 *  the check a unit runs before it trusts the artifact, and `--write` is the fix.
 *
 *  Usage:
 *    node scripts/workbench/generate-settings.mjs [--write]
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_PATH = join(REPO_ROOT, 'packages/editor-core/workbench/src/vgaiGeneratedSettings.ts');
const SCHEMA_RELATIVE = 'packages/project/schemas/vgai-settings.schema.json';

/** The namespace every key carries. `@vgai/project/settings/keys`'s SETTINGS_KEY_PREFIX. */
const PREFIX = 'vgai';

function fail(message) {
	console.error(`vgai settings generator: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = { write: false };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--write') { args.write = true; }
		else { fail(`unknown argument ${argv[i]}. Usage: node scripts/workbench/generate-settings.mjs [--write]`); }
	}
	return args;
}

/**
 * Walk the settings document's JSON Schema to one entry per LEAF.
 *
 * `$schema` is skipped: it is the autocomplete pointer a person hand-editing the file
 * carries, it describes the file rather than the editor, and there is nothing for a settings
 * UI to show. Everything else that is not an object with properties IS a setting — the walk
 * has no key list of its own, which is the whole point.
 */
function walk(node, path, out) {
	if (node.type === 'object' && node.properties) {
		for (const [name, child] of Object.entries(node.properties)) { walk(child, [...path, name], out); }
		return;
	}
	if (path.length === 1 && path[0] === '$schema') { return; }
	const property = { description: node.description ?? '' };
	if (typeof node.type === 'string') { property.type = node.type; }
	if (Array.isArray(node.enum)) { property.enum = node.enum; }
	out.push([[PREFIX, ...path].join('.'), property]);
}

function main() {
	const args = parseArgs(process.argv);
	const schemaPath = join(REPO_ROOT, SCHEMA_RELATIVE);
	if (!existsSync(schemaPath)) { fail(`${schemaPath} does not exist — run \`npm run generate-schema\` first.`); }
	const raw = readFileSync(schemaPath);
	const hash = createHash('sha256').update(raw).digest('hex');
	const entries = [];
	walk(JSON.parse(raw.toString('utf8')), [], entries);
	if (entries.length === 0) { fail(`${SCHEMA_RELATIVE} declared no settings keys, so nothing was written`); }

	const undescribed = entries.filter(([, property]) => property.description === '').map(([key]) => key);
	if (undescribed.length > 0) {
		// The engine's own rule is that every schema field carries `.describe()`; a key with no
		// sentence is a blank row in the one settings UI, so it stops the write here rather than
		// shipping.
		fail(`${undescribed.length} key(s) carry no description, so nothing was written:\n  ${undescribed.join('\n  ')}`);
	}

	const properties = entries.map(([key, property]) => {
		const lines = [`\t\t'${key}': {`];
		if (property.type) { lines.push(`\t\t\ttype: '${property.type}',`); }
		if (property.enum) { lines.push(`\t\t\tenum: [${property.enum.map(value => `'${value}'`).join(', ')}],`); }
		lines.push(`\t\t\tdescription: localize('${key}', ${JSON.stringify(property.description)}),`);
		lines.push('\t\t\tscope: ConfigurationScope.WINDOW,');
		lines.push('\t\t},');
		return lines.join('\n');
	}).join('\n');

	const text = `/*---------------------------------------------------------------------------------------------
 *  GENERATED by scripts/workbench/generate-settings.mjs — do not edit.
 *
 *  Every vgai settings key, as the \`configuration\` contribution VS Code's Settings editor
 *  reads. Derived from \`${SCHEMA_RELATIVE}\`, which
 *  \`npm run generate-schema\` writes from the Zod settings document and
 *  \`@vgai/project/settings/keys\` walks at runtime — so the keys the editor READS and the keys
 *  a person can SEE are one derivation, not two lists.
 *
 *  SCOPE is WINDOW for every key: the layers are the person's (USER) and the project's
 *  (WORKSPACE, \`.vscode/settings.json\`), which is exactly what WINDOW permits. RESOURCE would
 *  offer a per-folder value no vgai reader asks for, and APPLICATION/MACHINE would put the
 *  project's own look out of the project's reach.
 *
 *  THERE ARE NO DEFAULTS here, and that is the ruling (ARCHITECTURE-CORE §The core is
 *  Code-OSS, U7): a default sits BELOW the user layer, so declaring a skew's look as one
 *  would let a person's cross-project palette defeat it. The adapter's declaration goes to
 *  the MEMORY target instead — see \`vgaiSettings.ts\`.
 *
 *  Regenerate:  node scripts/workbench/generate-settings.mjs --write
 *  Source (sha256 at generation; the generator refuses when it has moved):
 *    ${hash}  ${SCHEMA_RELATIVE}
 *  ${entries.length} keys.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';

/** Every vgai settings key, in the settings document's own declaration order. */
export const VGAI_SETTING_KEYS: readonly string[] = [
${entries.map(([key]) => `\t'${key}',`).join('\n')}
];

export const VGAI_CONFIGURATION_NODE: IConfigurationNode = {
	id: 'vgai',
	order: 100,
	title: localize('vgaiConfigurationTitle', "vgai"),
	type: 'object',
	properties: {
${properties}
	},
};
`;

	if (args.write) {
		writeFileSync(OUT_PATH, text);
		console.log(`vgai settings generator: wrote ${entries.length} keys.`);
		console.log(`  ${hash.slice(0, 12)}  ${SCHEMA_RELATIVE}`);
		return;
	}

	if (!existsSync(OUT_PATH) || readFileSync(OUT_PATH, 'utf8') !== text) {
		const committed = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : '';
		const moved = committed.includes(`${hash}  ${SCHEMA_RELATIVE}`) ? '' : `\n  Moved since it was generated: ${SCHEMA_RELATIVE}`;
		fail(`${relative(REPO_ROOT, OUT_PATH)} is stale.${moved}\n  Fix: node scripts/workbench/generate-settings.mjs --write`);
	}
	console.log(`vgai settings generator: up to date — ${entries.length} keys.`);
}

main();
