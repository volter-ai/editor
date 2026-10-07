import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), 'runtime-notices');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = text => text.replace(/\s+/g, ' ').trim();
const refuse = message => { throw new Error(`Runtime notices: ${message}`); };

/** Close the actual packaged npm inventory and bundled Node before tar runs.
 * This is a reviewed inventory, not a license inference from SPDX or a package name.
 * New packages/versions need an archive/source notice audit before they can ship.
 * Existing notices are never replaced; supplements come only from the pinned bundle. */
export function preserveRuntimeNotices(packageDir, checkout, platform) {
	const manifestBytes = readFileSync(join(BUNDLE, 'manifest.json'));
	const manifest = JSON.parse(manifestBytes);
	const reviewed = new Map(manifest.packages.map(p => [`${p.name}@${p.version}`, p]));
	const roots = [];
	const walk = dir => {
		const local = relative(packageDir, dir).split(sep).join('/');
		if (/(?:^|\/)node_modules\/(?:@[^/]+\/[^/]+|[^@/][^/]*)$/.test(local)) {
			const path = join(dir, 'package.json');
			if (!existsSync(path)) { refuse(`${local} has no package.json; cannot identify its notice owner`); }
			const pkg = JSON.parse(readFileSync(path, 'utf8'));
			const key = `${pkg.name}@${pkg.version}`;
			if (!reviewed.has(key)) { refuse(`${local}: unreviewed ${key}; audit its exact published archive and source notices and update runtime-notices/manifest.json`); }
			roots.push({ dir, local, owner: reviewed.get(key) });
		}
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) { refuse(`${local}/${entry.name}: cannot audit a symlink in the packaged runtime`); }
			if (entry.isDirectory() && !(dir === packageDir && entry.name === 'licenses')) { walk(join(dir, entry.name)); }
		}
	};
	walk(packageDir);
	if (roots.length === 0) { refuse('packaged runtime has no npm packages'); }

	const rootNotices = normalized(readFileSync(join(packageDir, 'ThirdPartyNotices.txt'), 'utf8'));
	const copies = new Map();
	const cover = (ownerDir, owner, notice) => {
		const packaged = join(ownerDir, notice.path);
		const packagePath = relative(packageDir, packaged).split(sep).join('/');
		if (existsSync(packaged)) {
			if (digest(readFileSync(packaged)) !== notice.sha256) { refuse(`${owner}: ${packagePath} differs from the reviewed notice hash ${notice.sha256}`); }
			return { ...notice, coverage: packagePath, added: false };
		}
		if (!notice.bundle) { refuse(`${owner}: missing ${packagePath}; no pinned source notice supplement is recorded`); }
		const bytes = readFileSync(join(BUNDLE, notice.bundle));
		if (digest(bytes) !== notice.sha256) { refuse(`${owner}: corrupt source notice bundle ${notice.bundle}`); }
		// TypeScript's Apache license is already complete in the root notices. Its
		// separate third-party text is not. Record exact content coverage, not a name hit.
		if (rootNotices.includes(normalized(bytes.toString('utf8')))) {
			return { ...notice, coverage: 'ThirdPartyNotices.txt', added: false };
		}
		const destination = `licenses/runtime/${owner}/${notice.path}`;
		const existing = join(packageDir, destination);
		if (existsSync(existing) && digest(readFileSync(existing)) !== notice.sha256) { refuse(`${owner}: conflicting supplement ${destination}`); }
		copies.set(destination, bytes);
		return { ...notice, coverage: destination, added: !existsSync(existing) };
	};
	const packages = roots.sort((a, b) => a.local.localeCompare(b.local)).map(({ dir, local, owner }) => ({
		path: local,
		name: owner.name,
		version: owner.version,
		distribution: owner.distribution,
		notices: owner.notices.filter(n => !n.whenDirectory || existsSync(join(dir, n.whenDirectory)))
			.map(n => cover(dir, `${owner.name}/${owner.version}`, n)),
	}));

	// The runtime version is remote/.npmrc's target, not the Node running this build.
	const nodeVersion = /^target="(.*)"$/m.exec(readFileSync(join(checkout, 'remote/.npmrc'), 'utf8'))?.[1];
	const nodeSource = JSON.parse(readFileSync(join(checkout, 'cgmanifest.json'), 'utf8')).registrations
		.find(r => r.component?.git?.name === 'nodejs');
	const expectedNode = manifest.node;
	if (nodeVersion !== expectedNode.version || nodeSource?.version !== expectedNode.version ||
		nodeSource?.component?.git?.commitHash !== expectedNode.notice.source.revision ||
		nodeSource?.component?.git?.repositoryUrl !== expectedNode.notice.source.repository) {
		refuse(`bundled Node ${nodeVersion}: source/version differs from reviewed Node ${expectedNode.version} at ${expectedNode.notice.source.revision}`);
	}
	// The server package's runtime is `node`, and `node.exe` in a win32 one.
	const nodeBinary = platform.startsWith('win32') ? 'node.exe' : 'node';
	const nodeBytes = readFileSync(join(packageDir, nodeBinary));
	const nodeSha256 = digest(nodeBytes);
	if (nodeSha256 !== digest(readFileSync(join(checkout, '.build/node', `v${nodeVersion}`, platform, nodeBinary)))) {
		refuse(`bundled Node ${nodeVersion}: packaged binary differs from the canonical downloaded runtime`);
	}
	const node = { version: nodeVersion, binary: nodeBinary, binarySha256: nodeSha256,
		notice: cover(packageDir, `node/${nodeVersion}`, expectedNode.notice) };
	// Node's LICENSE must not be confused with a distribution-root LICENSE belonging
	// to another component. The canonical package currently has LICENSE.txt only.

	// Validate the entire closure before writing anything. Unknown cases cannot reach tar.
	for (const [path, bytes] of copies) {
		mkdirSync(dirname(join(packageDir, path)), { recursive: true });
		writeFileSync(join(packageDir, path), bytes);
	}
	const index = 'licenses/runtime/NOTICE-PROVENANCE.json';
	const record = Buffer.from(`${JSON.stringify({ schemaVersion: 1,
		manifestSha256: digest(manifestBytes), packages, node }, null, 2)}\n`);
	mkdirSync(dirname(join(packageDir, index)), { recursive: true });
	writeFileSync(join(packageDir, index), record);
	return { index, sha256: digest(record), manifestSha256: digest(manifestBytes),
		packageInstances: packages.length, supplementFiles: copies.size, nodeVersion };
}
