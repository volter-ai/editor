import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Serialize the pinned fork's build work in the disposable release clone.
 * Keep every compilation and validation; change scheduling only. Exact matches
 * refuse a changed upstream implementation instead of silently losing the bound. */
export function serializeBuild(checkout) {
  const patch = (file, before, after) => {
    const path = join(checkout, file);
    const source = readFileSync(path, 'utf8');
    if (source.split(before).length !== 2) throw new Error(`Serial build: expected one match in ${file}: ${before.slice(0, 100)}`);
    writeFileSync(path, source.replace(before, after));
  };
  const compilation = 'build/lib/compilation.ts';
  patch(compilation,
    '\t\tconst compile = createCompile(src, { build, emitError: true, transpileOnly: build ? false : { esbuild: true }, preserveEnglish: !!options.preserveEnglish });',
    "\t\tawait spawnTsgo(path.join(import.meta.dirname, '../../', src, 'tsconfig.json'), { taskName: `compile-${path.basename(src)}`, noEmit: true });\n\n\t\tconst compile = createCompile(src, { build, emitError: true, transpileOnly: build ? false : { esbuild: true }, preserveEnglish: !!options.preserveEnglish });");
  patch(compilation,
    '\t\tconst typecheck = spawnTsgo(compile.projectPath, { taskName: `compile-${path.basename(src)}`, noEmit: true });\n\n\t\tawait Promise.all([emit, typecheck]);',
    '\t\tawait emit;');
  patch('build/npm/postinstall.ts', 'const concurrency = Math.min(os.cpus().length, 8);', 'const concurrency = 1;');

  const extensions = 'build/lib/extensions.ts';
  patch(extensions, 'function fromLocal(extensionPath:', `// Start the next stream only after the previous compiler has finished.
function serialStreams(factories: (() => Stream)[]): Stream {
	const output = es.through();
	let index = 0;
	const next = () => {
		if (index === factories.length) { output.end(); return; }
		try {
			const input = factories[index++]();
			input.once('error', error => output.emit('error', error));
			input.once('end', next);
			input.pipe(output, { end: false });
		} catch (error) { output.emit('error', error); }
	};
	process.nextTick(next);
	return output;
}

function fromLocal(extensionPath:`);
  patch(extensions, `? es.merge(
				fromLocalEsbuild(extensionPath, esbuildConfigFileName),
				// Standard esbuild extensions need a separate type check step
				...getBuildRootsForExtension(extensionPath).map(root => typeCheckExtensionStream(root, forWeb)),
			)`, `? serialStreams([
				() => fromLocalEsbuild(extensionPath, esbuildConfigFileName),
				...getBuildRootsForExtension(extensionPath).map(root => () => typeCheckExtensionStream(root, forWeb)),
			])`);
  patch(extensions, `es.merge(
			...localExtensionsDescriptions.map(extension => {
				return fromLocal(extension.path, forWeb, disableMangle)
					.pipe(rename(p => p.dirname = \`extensions/\${extension.name}/\${p.dirname}\`));
			})
		)`, `serialStreams(
			localExtensionsDescriptions.map(extension => () =>
				fromLocal(extension.path, forWeb, disableMangle)
					.pipe(rename(p => p.dirname = \`extensions/\${extension.name}/\${p.dirname}\`)))
		)`);
  patch(extensions,
    'export function buildExtensionMedia(isWatch: boolean, outputRoot?: string): Promise<void> {',
    `export function buildExtensionMedia(isWatch: boolean, outputRoot?: string): Promise<void> {
	if (!isWatch) {
		return (async () => {
			for (const { script, tsconfig } of esbuildMediaScripts) {
				await esbuildExtensions('esbuilding extension media', false, [{
					script: path.join(extensionsPath, script),
					outputRoot: outputRoot ? path.join(root, outputRoot, path.dirname(script)) : undefined,
				}]);
				await spawnTsgo(path.join(extensionsPath, tsconfig), { taskName: 'typechecking extension media (tsgo)', noEmit: true });
			}
		})();
	}`);

  const optimize = 'build/lib/optimize.ts';
  patch(optimize, "import es from 'event-stream';", "import es from 'event-stream';\nimport { Transform } from 'node:stream';");
  patch(optimize, '\t\tconst tasks: Promise<any>[] = [];', '');
  patch(optimize, '\t\t\ttasks.push(task);', '\t\t\tawait task;');
  patch(optimize, '\t\tawait Promise.all(tasks);', '');
  patch(optimize, 'es.map((f: any, cb) => {', 'new Transform({ objectMode: true, transform(f: any, _encoding, cb) {');
  patch(optimize, '\t\t\t}),\n\t\t\tesbuildFilter.restore,', '\t\t\t} }),\n\t\t\tesbuildFilter.restore,');
}
