/**
 * `add-play [folder]` — MAKE A `models` PROJECT PLAYABLE, in place.
 *
 * Why this exists (measured 2026-10, an agent building an obby from the
 * editor's Chat): the default project is `models`, and turning it into one
 * that plays took the agent about seven minutes of reading the `playable`
 * template and re-typing its dependencies, manifest root and adapter line by
 * hand. Every row it needed is already declared once, as {@link PLAYABLE} in
 * `create.ts`; this verb merges those rows into the project that exists rather
 * than scaffolding a new one.
 *
 * NOTHING THE AUTHOR WROTE IS REPLACED. Files that hold a list (`package.json`,
 * the manifest, the adapter) gain only the rows they lack; a dependency the
 * project already declares keeps its version. Example files are written with
 * an exclusive flag, and the example is a set (see {@link PLAYABLE}): when the
 * project already has a Play script, or any example path is taken, none of it
 * is written, and each reason is printed. A step it cannot do safely by text
 * (an adapter whose shape it does not recognise) is printed as the line to add,
 * never guessed at.
 */
import { constants, existsSync, lstatSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { GameManifestSchema } from '@volter/editor-project/manifest/schema';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { PLAYABLE, PROJECT_TSCONFIG, productRoot, productVersions } from './create';

export const ADD_PLAY_USAGE = 'add-play [folder]    # make a models project playable: Play deps, UI root, example Play script';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/** `*.play.ts` under `src/`, project-relative, `/`-separated. */
async function playScripts(project: string): Promise<string[]> {
  const src = join(project, 'src');
  if (!existsSync(src)) return [];
  const entries = await readdir(src, { recursive: true });
  return entries
    .map(entry => `src/${entry.replace(/\\/g, '/')}`)
    .filter(path => path.endsWith('.play.ts') && !path.includes('/node_modules/'));
}

export async function addPlay(folder: string): Promise<void> {
  const project = resolve(folder);
  const manifestPath = join(project, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) throw new Error(`${project} is not a Model Editor project: it has no ${MANIFEST_FILENAME}.`);
  const packagePath = join(project, 'package.json');
  if (!existsSync(packagePath)) throw new Error(`${project} has no package.json to declare the Play dependencies in.`);
  const { kit } = await productVersions();
  const added: string[] = [];
  const kept: string[] = [];

  // 1. DEPENDENCIES — the playable template's, merged. A name the project
  // already declares in any section keeps the author's range: a project that
  // pinned React differently chose that, and a silent bump could break it.
  const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as PackageJson;
  let dependenciesChanged = false;
  for (const [section, wanted] of [['dependencies', PLAYABLE.dependencies], ['devDependencies', PLAYABLE.devDependencies(kit)]] as const) {
    for (const [name, version] of Object.entries(wanted)) {
      const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name];
      if (declared !== undefined) {
        if (declared !== version) kept.push(`package.json keeps ${name}@${declared} (the playable template declares ${version})`);
        continue;
      }
      pkg[section] = { ...pkg[section], [name]: version };
      dependenciesChanged = true;
      added.push(`package.json ${section}: ${name}@${version}`);
    }
  }
  if (dependenciesChanged) await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');

  // 2. THE EXAMPLE PLAY SCRIPT, STATE AND UI — only into a project with no Play
  // script yet, and only whole (see the header).
  let exampleAdded = false;
  const scripts = await playScripts(project);
  if (scripts.length > 0) {
    kept.push(`example Play script not added: the project already plays ${scripts.join(', ')}`);
  } else {
    const taken = PLAYABLE.example.filter(([, to]) => existsSync(join(project, to)));
    if (taken.length > 0) {
      for (const [, to] of taken)
        kept.push(`${to} exists, so the example (track.blend + track.play.ts + race-state.ts + src/ui) was not added; it is one set and would not run in part`);
    } else {
      for (const [from, to] of PLAYABLE.example) {
        await mkdir(dirname(join(project, to)), { recursive: true });
        await copyFile(join(productRoot, 'starter', from), join(project, to), constants.COPYFILE_EXCL);
        added.push(to);
      }
      exampleAdded = true;
    }
  }

  // 3. THE MANIFEST — the DOM root and the Play resolution. The root is
  // declared only when its entry exists: a root naming a missing file is an
  // error on every load, not a step towards one.
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { roots?: { id?: unknown }[]; resolution?: unknown; [key: string]: unknown };
  let manifestChanged = false;
  const roots = manifest.roots ?? [];
  if (roots.some(root => root.id === PLAYABLE.uiRoot.id)) {
    kept.push(`${MANIFEST_FILENAME} already has a "${PLAYABLE.uiRoot.id}" root`);
  } else if (existsSync(join(project, PLAYABLE.uiRoot.entry))) {
    manifest.roots = [...roots, { ...PLAYABLE.uiRoot }];
    manifestChanged = true;
    added.push(`${MANIFEST_FILENAME} root: ${JSON.stringify(PLAYABLE.uiRoot)}`);
  } else {
    kept.push(`${MANIFEST_FILENAME}: no UI root added, because ${PLAYABLE.uiRoot.entry} does not exist. Write that React component (default export), then add the root ${JSON.stringify(PLAYABLE.uiRoot)}`);
  }
  if (manifest.resolution === undefined) {
    manifest.resolution = { ...PLAYABLE.resolution };
    manifestChanged = true;
    added.push(`${MANIFEST_FILENAME} resolution: ${PLAYABLE.resolution.width}x${PLAYABLE.resolution.height}`);
  }
  if (manifestChanged) {
    // Validate what will be written, then write the author's own object, not the parse:
    // parsing fills defaults, and the file should gain only the rows above.
    GameManifestSchema.parse(manifest);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  // 4. THE ADAPTER — TypeScript source, so it is edited only where its shape is
  // the one `writeProject` wrote. Anything else gets the line to add, by hand.
  const adapterPath = join(project, 'volter.adapter.ts');
  if (!existsSync(adapterPath)) {
    kept.push(`volter.adapter.ts not found; a playable adapter declares ${PLAYABLE.regionIncludes.trim()}`);
  } else {
    let adapter = await readFile(adapterPath, 'utf8');
    const original = adapter;
    if (adapter.includes('regionIncludes')) {
      kept.push(`volter.adapter.ts already declares regionIncludes; it needs ui: { include: ['src/ui/**/*.tsx'] } for UI stories`);
    } else if (/defineAdapter\(\{\r?\n/.test(adapter)) {
      adapter = adapter.replace(/defineAdapter\(\{\r?\n/, match => match + PLAYABLE.regionIncludes);
      added.push(`volter.adapter.ts: ${PLAYABLE.regionIncludes.trim()}`);
    } else {
      kept.push(`volter.adapter.ts has a shape this command does not edit; add ${PLAYABLE.regionIncludes.trim()} to its defineAdapter({ … })`);
    }
    // The starter cube was only ever a placeholder default. Move the default to the
    // example track this command just added — never off a model the author chose.
    const starterDefault = "default: 'model:src/models/cube.blend'";
    if (exampleAdded && adapter.includes(starterDefault)) {
      adapter = adapter.replace(starterDefault, `default: '${PLAYABLE.defaultDocument}'`);
      added.push(`volter.adapter.ts: default document ${PLAYABLE.defaultDocument}`);
    }
    if (adapter !== original) await writeFile(adapterPath, adapter);
  }

  // 5. A project from before `writeProject` wrote tsconfig.json needs one for TSX.
  if (!existsSync(join(project, 'tsconfig.json'))) {
    await writeFile(join(project, 'tsconfig.json'), PROJECT_TSCONFIG, { flag: 'wx' });
    added.push('tsconfig.json');
  }

  console.log(added.length > 0 ? `Made ${project} playable:` : `${project} already had everything add-play adds.`);
  for (const line of added) console.log(`  + ${line}`);
  if (kept.length > 0) console.log('Left as it was:');
  for (const line of kept) console.log(`  = ${line}`);
  console.log('Next:');
  // A checkout's project links the checkout's own install (`create.ts`), which already holds
  // every kit package; `npm install` there would write into the checkout.
  const linked = (() => { try { return lstatSync(join(project, 'node_modules')).isSymbolicLink(); } catch { return false; } })();
  if (dependenciesChanged && !linked) console.log(`  npm install    # in ${project}; installs the dependencies added above`);
  if (dependenciesChanged) console.log('  Reload the editor (eval "await editor.reloadPage()", or reopen the project) so it loads @volter/editor-model-play.');
  const play = exampleAdded ? 'src/models/track.blend' : scripts[0]?.replace(/\.play\.ts$/, '.blend');
  if (play) console.log(`  Open model:${play} and press Play (Play runs <model>.play.ts beside its .blend).`);
  else console.log('  Write src/models/<name>.play.ts beside src/models/<name>.blend; Play runs it on that model.');
}
