#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  A SOURCES WORKBENCH — the overlay, then the fork's own compile. Nothing else.
 *
 *  TRIGGER: a project's `.vgai/workbench.json` names a fork CHECKOUT rather than a release, and
 *  you are about to `vgai edit` it. A checkout answers as a workbench through
 *  `scripts/code-server.sh`, which serves `out/` — so what the page runs is whatever was last
 *  compiled there, and our tier is only in it if the overlay has been applied since the last
 *  edit to a workbench half in this repository.
 *
 *    node scripts/workbench/dev.mjs --checkout <fork dir> --product <editor>
 *
 *  IT IS THE WHOLE INNER LOOP. Stop sessions serving this checkout with `vgai close`, edit
 *  `packages/editor-core/workbench/src/…` here, run this, then reopen with `vgai edit`. Compilation
 *  cleans `out/` and extension output; serving it mid-build causes missing modules. ~30 s warm: the fork's own `compile-client` (it typechecks `src/`
 *  and emits `out/`; `out/server-main.js` is part of it, so no separate server compile exists),
 *  then `compile-web` for the built-in extensions' browser entries.
 *
 *  A NEW STYLESHEET NEEDS A NEW SESSION, not just a reload: in a sources workbench every `.css`
 *  import resolves through an import map the server builds ONCE per process
 *  (`CSSDevelopmentService.getCssModules`, cached), so a `.css` file added since the session
 *  started is missing from it, its importer fails to evaluate and the page never boots — a blank
 *  tab with no failed request. `vgai close`, then `vgai edit`.
 *
 *  IT RUNS NOTHING ELSE, deliberately: it does not start a session, open a tab or touch the
 *  project. `vgai edit` owns all three and the tab bijection is its invariant, so a second
 *  opener here would be a duplicate tab by construction.
 *
 *  NODE. The fork's toolchain is its own `.nvmrc`, and a major that does not match is refused
 *  by name rather than compiled hopefully: this is a compiler with native dependencies and a
 *  wrong-major failure surfaces deep inside gulp, minutes later.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function fail(message) {
	console.error(`workbench dev: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = { checkout: null, product: null };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--checkout') { args.checkout = argv[++i]; }
		else if (argv[i] === '--product') { args.product = argv[++i]; }
		else { fail(`unknown argument "${argv[i]}". Usage: node scripts/workbench/dev.mjs --checkout <fork dir> --product <id>`); }
	}
	if (!args.checkout) { fail('--checkout <fork dir> is required.'); }
	if (!args.product) { fail('--product <id> is required.'); }
	return { checkout: resolve(args.checkout), product: args.product };
}

function assertNodeMajor(checkout) {
	const nvmrc = join(checkout, '.nvmrc');
	if (!existsSync(nvmrc)) { return; }
	const wanted = readFileSync(nvmrc, 'utf8').trim().replace(/^v/, '').split('.')[0];
	const have = process.versions.node.split('.')[0];
	if (wanted && wanted !== have) {
		fail(
			`this fork compiles with node ${wanted} (its .nvmrc) and this is node ${process.versions.node}.\n` +
			`  export PATH=/opt/homebrew/opt/node@${wanted}/bin:$PATH`
		);
	}
}

function run(command, args, cwd) {
	console.log(`+ ${command} ${args.join(' ')}`);
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.status !== 0) { fail(`${command} ${args.join(' ')} exited ${result.status}`); }
}

const { checkout, product } = parseArgs(process.argv);
assertNodeMajor(checkout);
run(process.execPath, [join(REPO_ROOT, 'scripts/workbench/overlay.mjs'), '--checkout', checkout, '--product', product], REPO_ROOT);
run('npm', ['run', 'compile-client'], checkout);
// The web workbench loads each built-in extension's BROWSER entry, which only
// `compile-web` builds; without it an extension a release carries (GitHub
// authentication among them) never registers in a sources workbench.
run('npm', ['run', 'compile-web'], checkout);
console.log(`workbench dev: ${checkout} carries ${product} and is compiled. Reload the workbench tab.`);
