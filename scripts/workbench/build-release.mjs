#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  THE RELEASE — one product's workbench, bundled, on a machine that can build it.
 *
 *    node scripts/workbench/build-release.mjs --product <editor> \
 *         --platform <darwin-arm64|linux-x64> --checkout <fork dir> [--out <dir>] [--work <dir>] \
 *         [--look <package dir>]… [--publish] [--dry-run]
 *    node scripts/workbench/build-release.mjs --publish --out <dir>     # publish a release cut earlier
 *
 *  A CUT RELEASE IS NOT A PRODUCT'S WORKBENCH UNTIL IT IS PUBLISHED. `--publish` uploads the
 *  tarball and its `BUILD.json` as a GitHub Release on the fork's own repository, tagged
 *  `<product>-<fork sha 12>-<editor sha 12>-<platform>` — both source revisions,
 *  immutable, refused by name on a tag that exists. That tag and the tarball's sha256 are what a
 *  product declares in `package.json#vgai.product.workbench`, and what `npx @volter/editor
 *  create <name>` fetches when the machine has no workbench at all. The publish step prints the
 *  declaration to paste.
 *
 *  A RELEASE WITH A LOOK PACKAGE IS NEVER PUBLISHED. `--look` overlays a look package's frame
 *  tier (`overlay.mjs`), such as the Volter brand's private Plotter look, and `BUILD.json`
 *  records every tier it carries; `--publish` refuses such a release, because the fork's GitHub
 *  Releases are public and the tier is the package's own code.
 *
 *  TRIGGER: you are cutting the bytes a project's `.vgai/workbench.json` will name. This is not
 *  a script you run on a laptop that is also doing something else — it is the heaviest thing in
 *  the estate. It was `vgai/build-reh-web.sh` inside the fork until P3 (2026-09-21); it is here
 *  because the thing it builds is OURS overlaid on upstream, and the overlay is this
 *  repository's (ARCHITECTURE-CORE §The target shape, rule 6).
 *
 *  ONE RELEASE IS ONE PRODUCT. The kit's workbench half and exactly one product's are compiled
 *  into the bundle together, so `BUILD.json` names the product and the tarball carries it in
 *  its name. `@volter/editor-sdk/session/workbench-locator` refuses a release built for a product
 *  other than the one the project declares — the mismatch is otherwise invisible, because the
 *  page mounts and what differs is the title, the look and the commands.
 *
 *  WALL TIMES, from the first green run of its bash ancestor (2026-09-20, 36 GiB MacBook Pro,
 *  node 24, warm npm cache) — so the next person knows what to expect:
 *
 *      clone 3 s · npm ci 1 m 46 s · compile-build-without-mangling 3 m 52 s ·
 *      extensions 1 m 42 s · bundle 5 s · package 23 s · tar 25 s   ≈ 8 m
 *
 *  Lowest system free memory across it: 48 % on a 60 s sampler. The product of it, for scale: a
 *  220 MB tarball, 753 MB unpacked, 41.75 MB over the wire in 14 requests to a workbench.
 *
 *  DO NOT RUN THIS BESIDE ANOTHER `npm ci`. The first attempt died 8 minutes in because a
 *  second install in another checkout held Playwright's shared browser lock
 *  (`~/Library/Caches/ms-playwright/__dirlock`). The install is an EXCLUSIVE resource across
 *  every checkout on the box, not just this one.
 *
 *  WHY IT IS NOT `gulp vscode-reh-web-<platform>`, every fact MEASURED (docs/CODE-OSS.md §Web +
 *  server traps, U3 2026-09-20):
 *
 *    * THE REH TARGETS TAKE THE MANGLER ON BOTH VARIANTS. `build/gulpfile.reh.ts` runs
 *      `['', 'min'].forEach(…)` with `compileBuildWithManglingTask` for BOTH; `gulpfile.vscode.ts`
 *      is the one that branches on `minified`. So "run the non-min target to dodge the mangler"
 *      is a DESKTOP trick and does nothing here: the REH target dies in the same eight
 *      "Protected fields have been made PUBLIC" warnings — upstream's own `mcpManagementService`,
 *      `sessionChangesEditor`, `delegationSessionPickerActionItem`, not one file of ours — 23 s
 *      in, BEFORE `out-build` exists at all. The mangler is dead at 1.138.0; re-measure it at
 *      the next release gate, and until it is alive again this runs the series by hand.
 *    * `compile-build-without-mangling` IS THE ONLY PATH TO `out-build`, AND IT MUST BE GREEN.
 *      There is no partial package: after a throw, `out-build/vs/workbench/` held its seven
 *      directories and not one top-level file, so `workbench.web.main.internal.js` did not exist
 *      and the bundle died on it.
 *    * THE EMIT NEEDS A 9 GB HEAP, and the flag cannot come from `NODE_OPTIONS`: the fork's own
 *      `gulp` npm script already passes `--max-old-space-size=8192` and node applies
 *      NODE_OPTIONS as if it came FIRST, so the script's value wins. Gulp is therefore invoked
 *      directly, with the flag this wants.
 *    * `clean-extensions-build` AND `bundle-vscode-reh-web` ARE NOT REGISTERED CLI TASKS (both
 *      defined and never `task.task`'d), so the rimraf is spelled out and the bundle is reached
 *      through `minify-vscode-reh-web`, which is `series(bundleTask, rimraf, minifyTask)`.
 *    * OUR CONTRIBUTION'S MEDIA TRAVELS THE WAY UPSTREAM'S DOES — `vscodeWebResourceIncludes`
 *      in `build/gulpfile.vscode.web.ts`, which `gulpfile.reh.ts` spreads into
 *      `serverWithWebResourceIncludes`. The overlay writes that entry; without it the packaged
 *      workbench 404s on `Inter.woff2` while `out-build` has it.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAtPin, CHAT_EXTENSION, knownProducts } from './overlay.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** The measured floor. The emit alone wants a 9 GB heap and the process's RSS is larger than
 *  its heap; 16 GB is where it took a machine to 18 % free and the standing memory rule killed
 *  it with 34 of `out-build`'s entries written. */
const MIN_RAM_GIB = 32;
const PLATFORMS = ['darwin-arm64', 'linux-x64'];
/** WHERE A RELEASE LIVES ONCE IT IS CUT. The fork's own repository holds it, because a release
 *  IS the fork at a commit with our overlay on it — one place for the bytes and the tree they
 *  were built from. The public release is downloadable without credentials. */
const RELEASE_REPO = 'volter-ai/code-oss';

function fail(message) {
	console.error(`build-release: ${message}`);
	process.exit(1);
}

/** Both source owners participate in release identity: an editor overlay can change
 *  without changing the upstream fork. This is
 *  the string a product declares in `package.json#vgai.product.workbench.release`, so it is
 *  derived from `BUILD.json`'s own fields and never typed twice. */
function releaseTag(record) {
	return `${record.product}-${record.commit.slice(0, 12)}-${record.editorSource.revision.slice(0, 12)}-${record.platform}`;
}

function parseArgs(argv) {
	const args = { product: null, platform: null, checkout: null, out: null, work: null, dryRun: false, publish: false, looks: [] };
	for (let i = 2; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === '--dry-run') { args.dryRun = true; }
		else if (flag === '--publish') { args.publish = true; }
		else if (flag === '--product') { args.product = argv[++i]; }
		else if (flag === '--platform') { args.platform = argv[++i]; }
		else if (flag === '--checkout') { args.checkout = argv[++i]; }
		else if (flag === '--out') { args.out = argv[++i]; }
		else if (flag === '--work') { args.work = argv[++i]; }
		else if (flag === '--look') { args.looks.push(resolve(argv[++i])); }
		else { fail(`unknown argument "${flag}"`); }
	}
	// PUBLISH WITHOUT BUILDING is the whole of `--publish --out <dir>`: the release in that
	// directory already names its product, its platform and its commit in BUILD.json, so
	// demanding them again on the command line would be asking for three facts the bytes
	// already carry — and getting one of them wrong would publish a mislabelled tag.
	if (args.publish && args.looks.length > 0) {
		fail('--publish with --look: a release carrying a look tier is never published (the fork\'s Releases are public and a tier is its package\'s own code). Cut it without --publish, or publish one cut without --look.');
	}
	if (args.publish && !args.checkout) {
		if (args.product || args.platform) {
			fail('--publish --out <dir> publishes the release already in <dir>, and BUILD.json there names its product, platform and commit. Drop --product/--platform, or pass --checkout to build one first.');
		}
		return { ...args, publishOnly: true };
	}
	if (!args.product) { fail(`--product <id> is required (${knownProducts().join(' | ')}).`); }
	if (!knownProducts().includes(args.product)) { fail(`--product ${args.product} has no workbench half here. Products with one: ${knownProducts().join(', ')}.`); }
	if (!args.platform) { fail(`--platform is required (${PLATFORMS.join(' | ')}).`); }
	if (!PLATFORMS.includes(args.platform)) {
		fail(`--platform ${args.platform} is not one this builds. The two shapes the launch ships are ${PLATFORMS.join(' and ')}; anything else means editing the gulp targets' consumers, not passing a flag.`);
	}
	if (!args.checkout) { fail('--checkout <fork dir> is required — the Code-OSS checkout this clones at the pin. A build from "whatever is checked out" cannot name what it built.'); }
	return args;
}

function ramGib() {
	if (process.platform === 'darwin') {
		const out = spawnSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' });
		return Math.floor(Number(out.stdout.trim()) / 1024 ** 3);
	}
	const meminfo = readFileSync('/proc/meminfo', 'utf8').match(/MemTotal:\s+(\d+)/);
	return meminfo ? Math.floor(Number(meminfo[1]) / 1024 ** 2) : 0;
}

function directoryBytes(dir) {
	let total = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) { total += directoryBytes(path); }
		else if (entry.isFile()) { total += statSync(path).size; }
	}
	return total;
}

/**
 * PUBLISH A CUT RELEASE — the tarball and its BUILD.json, as a GitHub Release on the fork's
 * own repository, so a product can fetch its workbench with nothing on the machine but the
 * product itself (`@volter/editor-sdk/session/workbench-locator` is the fetching half).
 *
 * A RELEASE IS IMMUTABLE. Re-running on a tag that exists refuses by name rather than
 * uploading a second asset beside the first: a product pins `tarballSha256`, and a tag whose
 * bytes changed would make every machine that already fetched it disagree with every machine
 * that fetches it next. Change either source revision to cut a new tag.
 */
function publishRelease(dir, dryRun) {
	const recordPath = join(dir, 'BUILD.json');
	if (!existsSync(recordPath)) {
		fail(`${recordPath} is not there, so there is no release in ${dir} to publish. Cut one first:\n  node scripts/workbench/build-release.mjs --product <id> --platform <platform> --checkout <fork dir> --out ${dir}`);
	}
	const record = JSON.parse(readFileSync(recordPath, 'utf8'));
	for (const key of ['product', 'platform', 'commit', 'tarball', 'tarballBytes', 'tarballSha256']) {
		if (record[key] === undefined) { fail(`${recordPath} names no ${key}; it is not a release record this can publish.`); }
	}
	if ((record.lookTiers ?? []).length > 0) {
		fail(`This release carries look tiers (${record.lookTiers.map((tier) => tier.package).join(', ')}), built with --look. The fork's Releases are public and a look tier is its package's own code, so it is not published; cut the release without --look.`);
	}
	if (!record.editorSource?.revision || record.editorSource.dirty !== false) {
		fail('This workbench has no clean editor-source revision. Rebuild from a committed editor checkout before publishing.');
	}
	const tarballPath = join(dir, record.tarball);
	if (!existsSync(tarballPath)) {
		fail(`${recordPath} names ${record.tarball}, and it is not beside it in ${dir}. The tarball IS the release; re-cut it.`);
	}
	const bytes = statSync(tarballPath).size;
	if (bytes !== record.tarballBytes) {
		fail(`${tarballPath} is ${bytes} bytes and ${recordPath} records ${record.tarballBytes}. These are not the bytes that record describes.`);
	}
	const sha = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
	if (sha !== record.tarballSha256) {
		fail(`${tarballPath} hashes to ${sha} and ${recordPath} records ${record.tarballSha256}. A product pins that hash; publishing these bytes under it would refuse on every machine that fetched them.`);
	}
	if (spawnSync('gh', ['--version'], { stdio: 'ignore' }).status !== 0) {
		fail('`gh` is not on PATH, and the upload is a GitHub Release. Install it (`brew install gh`) and `gh auth login`.');
	}
	const tag = releaseTag(record);
	if (spawnSync('gh', ['release', 'view', tag, '--repo', RELEASE_REPO], { stdio: 'ignore' }).status === 0) {
		fail(`${RELEASE_REPO} already has a release tagged ${tag}, and a release is immutable — a product pins its tarball's sha256, so replacing the asset would split the machines that already fetched it from the ones that have not. Nothing was uploaded.`);
	}
	const title = `${record.product} · Code-OSS ${record.commit.slice(0, 12)} · ${record.platform}`;
	console.log(`+ gh release create ${tag} --repo ${RELEASE_REPO}   (${(bytes / 1024 ** 2).toFixed(0)} MB — the upload is the slow part)`);
	if (!dryRun) {
		const created = spawnSync('gh', [
			'release', 'create', tag,
			'--repo', RELEASE_REPO,
			'--target', record.commit,
			'--title', title,
			'--notes-file', recordPath,
			tarballPath, recordPath,
		], { stdio: 'inherit' });
		if (created.status !== 0) { fail(`gh release create exited ${created.status}`); }
	}
	console.log(`
  ${dryRun ? `Would publish ${tag} on ${RELEASE_REPO} (dry run — nothing was uploaded).` : `Published ${tag} on ${RELEASE_REPO}.`}

  Declare it — this is what makes \`npx @volter/${record.product} create <name>\` open with nothing
  else on the machine (packages/${record.product}/package.json):

      "vgai": {
        "product": {
          "workbench": {
            "release": "${tag}",
            "tarballSha256": "${record.tarballSha256}"
          }
        }
      }
`);
}

const args = parseArgs(process.argv);
if (args.publishOnly) {
	publishRelease(resolve(args.out ?? join(REPO_ROOT, '.vgai/releases')), args.dryRun);
	process.exit(0);
}
const pin = assertAtPin(resolve(args.checkout));
const checkout = resolve(args.checkout);
const out = resolve(args.out ?? join(REPO_ROOT, '.vgai/releases'));
const work = resolve(args.work ?? join(process.env['TMPDIR'] ?? '/tmp', `vgai-workbench-build-${args.product}`));
const clone = join(work, 'code-oss');
const packageDir = join(work, `vscode-reh-web-${args.platform}`);
const tarball = join(out, `vscode-reh-web-${args.platform}-${pin.commit.slice(0, 12)}-${args.product}.tar.gz`);
const buildRecord = join(out, 'BUILD.json');

/** THE NODE THIS RUNS UNDER IS THE NODE EVERY CHILD RUNS UNDER. The `.nvmrc` check below
 *  reads `process.versions.node` — this process's — but `npm ci` resolves `npm` from PATH and
 *  that shell script picks whatever `node` PATH finds. Measured 2026-09-21: a run launched as
 *  `/opt/homebrew/opt/node@24/bin/node build-release.mjs` passed the version gate and then died
 *  90 s later inside the clone's own `preinstall`, "Please use Node.js v24.18.0 or newer …
 *  Currently using v26.8.1". A gate that passes and then fails on the same condition is worse
 *  than no gate, so the check is made TRUE for the children instead of merely asserted here. */
const CHILD_ENV = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env['PATH'] ?? ''}` };

function step(command, commandArgs, options = {}) {
	console.log(`+ ${command} ${commandArgs.join(' ')}${options.cwd ? `   (in ${options.cwd})` : ''}`);
	if (args.dryRun) { return; }
	const result = spawnSync(command, commandArgs, { stdio: 'inherit', env: CHILD_ENV, ...options });
	if (result.status !== 0) { fail(`${command} exited ${result.status}`); }
}

const ram = ramGib();
console.log(`machine: ${ram} GiB RAM, ${process.platform} ${process.arch}, node ${process.version}`);
if (ram < MIN_RAM_GIB) {
	const line = `this build needs at least ${MIN_RAM_GIB} GiB of RAM and this machine has ${ram}. The out-build emit alone wants a 9 GB heap; it is a machine boundary, not a code defect. Build it where there is RAM, with the box quiet.`;
	if (args.dryRun) { console.log(`machine: below the floor — a real run would REFUSE here (dry run continues)`); }
	else { fail(line); }
}
const nvmrc = join(checkout, '.nvmrc');
if (existsSync(nvmrc)) {
	const wanted = readFileSync(nvmrc, 'utf8').trim().replace(/^v/, '').split('.')[0];
	if (wanted !== process.versions.node.split('.')[0]) {
		fail(`this fork builds with node ${wanted} (its .nvmrc) and this is node ${process.versions.node}.\n  export PATH=/opt/homebrew/opt/node@${wanted}/bin:$PATH`);
	}
}
if (!process.env['npm_config_python']) {
	console.log("toolchain: npm_config_python is unset — if `npm ci` fails in node-gyp, point it at a python 3.12 (Homebrew's 3.14 is broken for it: pyexpat).");
}

// ---- 1. a CLEAN clone at the pin. Never the checkout you develop in: the package task rimrafs
//         ../vscode-reh-web-<platform> and the compile tasks rimraf out-build, so a build
//         pointed at a live tree eats a working directory's neighbours.
step('rm', ['-rf', work]);
if (!args.dryRun) { mkdirSync(work, { recursive: true }); mkdirSync(out, { recursive: true }); }
step('git', ['clone', '--quiet', checkout, clone]);
step('git', ['-C', clone, 'checkout', '--quiet', '--detach', pin.commit]);

// ---- 2. the overlay — BEFORE `npm ci`, so the bundle's every input exists before anything
//         reads the tree. The clone carries none of it: `git clone` takes committed files only,
//         which is exactly why the overlay is re-applied here rather than assumed.
step(process.execPath, [join(REPO_ROOT, 'scripts/workbench/overlay.mjs'), '--checkout', clone, '--product', args.product, ...args.looks.flatMap((dir) => ['--look', dir])]);

// Code-OSS serves assets with a one-year cache under product.commit. The fork
// commit alone is NOT the build identity: a new editor overlay otherwise loads
// last release's JavaScript at the same URL. Use upstream's BUILD_SOURCEVERSION
// hook for a composition fingerprint; keep both actual source SHAs in BUILD.json.
const overlay = args.dryRun ? null : JSON.parse(readFileSync(join(clone, '.vgai-overlay.json'), 'utf8'));
const assetVersion = overlay ? createHash('sha1').update(JSON.stringify({
	product: args.product,
	codeOss: pin.commit,
	editor: overlay.editorSource,
	lookTiers: overlay.lookTiers,
	...(overlay.editorSource.dirty ? { overlaidAt: overlay.overlaidAt } : {}),
})).digest('hex') : 'dry-run-composition-fingerprint';
CHILD_ENV.BUILD_SOURCEVERSION = assetVersion;

// ---- 3. dependencies (the exclusive resource — see the header).
step('npm', ['ci'], { cwd: clone });

// ---- 4. out-build, WITHOUT the mangler. The one substitution the whole by-hand series exists
//         to make: the registered target would run compile-build-WITH-mangling and die.
const gulp = (task) => step(
	process.execPath,
	['--experimental-strip-types', '--max-old-space-size=9216', './node_modules/gulp/bin/gulp.js', ...task],
	{ cwd: clone },
);
gulp(['compile-build-without-mangling']);

// ---- 5. the extensions, exactly as `serverTask` composes them, in its order — MINUS
//         `compile-copilot-extension-build`. That task packages `extensions/copilot` alone
//         (272 MB, the vendored GitHub Copilot Chat) because `build/lib/extensions.ts` lists
//         `copilot` in `excludedExtensions` and the ordinary non-native task therefore skips
//         it. The overlay removed the directory and re-aimed `product.json#defaultChatAgent`
//         at ours (ARCHITECTURE-CORE §The core is Code-OSS, rule 7), so packaging it would
//         ship a second, signed-out chat agent nothing names.
step('rm', ['-rf', join(clone, '.build/extensions')]);
gulp(['compile-non-native-extensions-build', 'compile-extension-media-build']);

// ---- 6. the bundle and the package.
gulp(['minify-vscode-reh-web']);
if (!args.dryRun && !existsSync(join(clone, 'out-vscode-reh-web-min/server-main.js'))) {
	fail('minify-vscode-reh-web wrote no out-vscode-reh-web-min/server-main.js');
}
gulp([`vscode-reh-web-${args.platform}-min-ci`]);

// ---- 7. the tarball.
if (!args.dryRun && !existsSync(packageDir)) { fail(`the package task wrote no ${packageDir}`); }
step('tar', ['-czf', tarball, '-C', work, `vscode-reh-web-${args.platform}`]);

// ---- 8. BUILD.json — what the release IS. `platform` is what the locator refuses on,
//         `serverBin` is what the session spawns, and `product` is which workbench this is.
if (!args.dryRun) {
	writeFileSync(buildRecord, `${JSON.stringify({
		target: `vscode-reh-web-${args.platform}`,
		platform: args.platform,
		product: args.product,
		commit: pin.commit,
		assetVersion,
		editorSource: JSON.parse(readFileSync(join(clone, '.vgai-overlay.json'), 'utf8')).editorSource,
		lookTiers: JSON.parse(readFileSync(join(clone, '.vgai-overlay.json'), 'utf8')).lookTiers,
		codeOssVersion: JSON.parse(readFileSync(join(clone, 'package.json'), 'utf8')).version,
		node: process.version,
		builtAt: new Date().toISOString(),
		mangled: false,
		minified: true,
		serverBin: 'bin/code-server-oss',
		// WHAT ANSWERS THE CHAT VIEW, by version. The overlay bundles it and product.json names
		// it; this is where a person reading a release finds out which supercode frontend it
		// carries, without unpacking 200 MB to look.
		chatExtension: {
			id: CHAT_EXTENSION.id,
			version: JSON.parse(readFileSync(join(clone, 'extensions', CHAT_EXTENSION.directory, 'package.json'), 'utf8')).version,
		},
		tarball: tarball.split('/').pop(),
		tarballBytes: statSync(tarball).size,
		tarballSha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'),
		unpackedBytes: directoryBytes(packageDir),
		note: 'Built by scripts/workbench/build-release.mjs: upstream at the pin, with the editor kit and this product overlaid (scripts/workbench/overlay.mjs). mangled:false and minified:true are FACTS about these bytes, not settings — the mangler is dead at 1.138.0, so out-build comes from compile-build-without-mangling, while the minifier is green and these are the minified bytes.',
	}, null, 2)}\n`);
}

console.log(`
  ${tarball}
  ${buildRecord}

  Use it:  extract the tarball beside BUILD.json, then name that directory in
           <project>/.vgai/workbench.json — docs/CODE-OSS.md §Boot, WEB + SERVER.
           tar -xzf ${tarball} -C ${out}
`);

// ---- 9. the release, if this run is also publishing it. Same directory, same BUILD.json;
//         `--publish --out <dir>` alone does exactly this step on a release cut earlier.
if (args.publish && !args.dryRun) { publishRelease(out, false); }
