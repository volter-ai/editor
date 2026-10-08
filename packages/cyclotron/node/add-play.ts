/**
 * `add-play [folder]` — MAKE A `models` PROJECT PLAYABLE, in place.
 *
 * Why this exists (measured 2026-10, an agent building an obby from the
 * editor's Chat): the default project is `models`, and turning it into one
 * that plays took the agent about seven minutes of reading the `playable`
 * template and re-typing its dependencies, manifest root and adapter line by
 * hand. Every row it needed is already declared once, as {@link PLAY_SCAFFOLD} in
 * `create.ts`; this verb merges those rows into the project that exists rather
 * than scaffolding a new one.
 *
 * IT BRINGS A FIRST PLAY SCRIPT, NOT A GAME. The `playable` template's Canyon
 * Comet is a whole kart race with its own scene; dropped into someone's model
 * project it would be a second project to delete. So beside the rows, this
 * writes three small files from `starter/add-play/` that drive the project's
 * OWN model (see `playModel`): `<model>.play.ts` moves its first object with
 * the arrow keys and offers Autoplay a behaviour, `game-state.ts` beside it
 * holds what that publishes, and `src/ui/game.tsx`, the UI root's entry, draws it.
 *
 * NOTHING THE AUTHOR WROTE IS REPLACED. Files that hold a list (`package.json`,
 * the manifest, the adapter) gain only the rows they lack; a dependency the
 * project already declares keeps its version. The first Play script's files are
 * written with an exclusive flag, and they are a set: when the project already
 * has a Play script, or any of their paths is taken, none of it is written, and
 * each reason is printed. A step it cannot do safely by text (an adapter whose
 * shape it does not recognise) is printed as the line to add, never guessed at.
 */
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { GameManifestSchema } from '@volter/project/manifest/schema';
import { MANIFEST_FILENAME } from '@volter/project/manifest/filename';
import { PLAY_SCAFFOLD, PROJECT_TSCONFIG, productRoot, productVersions } from './create';

export const ADD_PLAY_USAGE = 'add-play [folder]    # make a models project playable: Play deps, UI root, a first Play script for its model';

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

/**
 * Whether anything at all sits at `path` — a dangling symlink included. `existsSync`
 * follows links and answers false for a dangling one, and the exclusive copy onto it
 * then failed partway through the example, after `package.json` was already rewritten.
 */
function occupied(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether `path` (already real) is `root` or inside it. */
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Why `path` cannot be written as a new file, or null when it can: the path itself is
 * taken, one of its folders under `project` is something other than a folder, or the
 * write would land OUTSIDE the project.
 *
 * That last one is about links. A folder on the way (`src/ui`, say) that is a symlink
 * or junction to a real folder elsewhere passes every "is it a folder" check, and the
 * copy then writes into whatever it points at — another project, a shared checkout.
 * So the deepest folder that already exists is resolved to its real path (`realpath`
 * follows every link above it too) and must sit inside the project's own real path;
 * the folders below it do not exist yet, and `mkdir` creates them as plain folders.
 */
function blocked(project: string, realProject: string, path: string): string | null {
  if (occupied(path)) return 'exists';
  let deepest = project;
  for (let dir = dirname(path); dir.length > project.length; dir = dirname(dir)) {
    if (!occupied(dir)) continue;
    if (deepest === project) deepest = dir;
    try {
      if (!statSync(dir).isDirectory()) return `${relative(project, dir)} is not a folder`;
    } catch {
      return `${relative(project, dir)} is a dangling link`;
    }
  }
  const real = realpathSync(deepest);
  if (!inside(realProject, real)) return `${relative(project, deepest) || '.'} resolves outside the project, to ${real}`;
  return null;
}

/** The folders `mkdir -p` would create for `file`, deepest first: the ones that do not exist yet. */
function missingFolders(project: string, file: string): string[] {
  const missing: string[] = [];
  for (let dir = dirname(file); dir.length > project.length && !occupied(dir); dir = dirname(dir)) missing.push(dir);
  return missing;
}

/**
 * The model a first play script drives, project-relative: the adapter's default
 * document when it is a `.blend` under `src/models/` that exists (the models
 * template's `cube.blend`), otherwise the project's only `.blend` there. Between
 * several, the author chooses; the reason is returned instead.
 */
async function playModel(project: string, adapter: string | null): Promise<string | { why: string }> {
  const declared = adapter === null ? undefined : /default:\s*'model:(src\/models\/[^']+\.blend)'/.exec(adapter)?.[1];
  if (declared !== undefined && existsSync(join(project, declared))) return declared;
  const models = join(project, 'src', 'models');
  const blends = existsSync(models)
    ? (await readdir(models, { recursive: true })).map(entry => `src/models/${entry.replace(/\\/g, '/')}`).filter(path => path.endsWith('.blend'))
    : [];
  if (blends.length === 1) return blends[0]!;
  return { why: blends.length === 0
    ? 'the project has no src/models/*.blend for it to drive'
    : `the project has ${blends.length} models (${blends.join(', ')}) and its adapter's default document is none of them` };
}

/**
 * The first Play script's files for `model`, from `starter/add-play/`: `<model>.play.ts`
 * and the `game-state.ts` it publishes, beside the model, and the UI root's entry, which
 * imports that state from wherever the model sits.
 */
async function firstPlaySet(model: string): Promise<{ to: string; content: string }[]> {
  const starter = (name: string) => readFile(join(productRoot, 'starter', 'add-play', name), 'utf8');
  const folder = posix.dirname(model);
  const state = posix.relative(posix.dirname(PLAY_SCAFFOLD.uiRoot.entry), posix.join(folder, 'game-state'));
  return [
    { to: model.replace(/\.blend$/, '.play.ts'), content: await starter('model.play.ts') },
    { to: posix.join(folder, 'game-state.ts'), content: await starter('game-state.ts') },
    { to: PLAY_SCAFFOLD.uiRoot.entry, content: (await starter('game.tsx')).replace("'../models/game-state'", `'${state.startsWith('.') ? state : `./${state}`}'`) },
  ];
}

/**
 * A JSON file's own layout — its indent and line ending, and whether it ends in
 * one — so a merge rewrites the rows it adds and nothing else. `JSON.stringify(…, 2)`
 * re-indented a tab- or four-space-indented `package.json` whole, turning a
 * two-line change into a diff of every line.
 */
function jsonLayout(raw: string): (value: unknown) => string {
  const indent = /^[{[]\r?\n([ \t]+)\S/.exec(raw)?.[1] ?? '  ';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(raw) ? eol : '';
  return value => JSON.stringify(value, null, indent).replace(/\n/g, eol) + trailing;
}

export async function addPlay(folder: string): Promise<void> {
  const project = resolve(folder);
  const manifestPath = join(project, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) throw new Error(`${project} is not a Cyclotron project: it has no ${MANIFEST_FILENAME}.`);
  // Links are judged against where the project REALLY is (see `blocked`).
  const realProject = realpathSync(project);
  const packagePath = join(project, 'package.json');
  if (!existsSync(packagePath)) throw new Error(`${project} has no package.json to declare the Play dependencies in.`);
  const { kit } = await productVersions();
  const added: string[] = [];
  const kept: string[] = [];

  // PLAN EVERYTHING, THEN WRITE. Every check below runs before the first byte is
  // written, so a refusal leaves the project exactly as it was: the first Play
  // script is a whole set or nothing, and so is the command's edit as a whole.

  // 1. DEPENDENCIES — the playable template's, merged. A name the project
  // already declares in any section keeps the author's range: a project that
  // pinned React differently chose that, and a silent bump could break it.
  const packageRaw = await readFile(packagePath, 'utf8');
  const pkg = JSON.parse(packageRaw) as PackageJson;
  let dependenciesChanged = false;
  for (const [section, wanted] of [['dependencies', PLAY_SCAFFOLD.dependencies], ['devDependencies', PLAY_SCAFFOLD.devDependencies(kit)]] as const) {
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

  // 2. A FIRST PLAY SCRIPT, ITS STATE AND UI, for the project's own model — only
  // into a project with no Play script yet, and only whole (see the header). Every
  // target is checked with `lstat` (see `occupied`), its folders too, before any
  // of it is written.
  const adapterPath = join(project, 'volter.adapter.ts');
  const adapterSource = existsSync(adapterPath) ? await readFile(adapterPath, 'utf8') : null;
  let model: string | null = null;
  let example: { to: string; content: string }[] | null = null;
  const scripts = await playScripts(project);
  if (scripts.length > 0) {
    kept.push(`no first Play script added: the project already plays ${scripts.join(', ')}`);
  } else {
    const chosen = await playModel(project, adapterSource);
    if (typeof chosen !== 'string') {
      kept.push(`no first Play script added: ${chosen.why}`);
    } else {
      const set = await firstPlaySet(chosen);
      const refusals = set.flatMap(({ to }) => {
        const reason = blocked(project, realProject, join(project, to));
        return reason === null ? [] : [`${to}: ${reason}`];
      });
      if (refusals.length > 0) {
        for (const refusal of refusals)
          kept.push(`${refusal}, so the first Play script (${set.map(({ to }) => to).join(' + ')}) was not added; it is one set and would not run in part`);
      } else {
        model = chosen;
        example = set;
      }
    }
  }

  // 3. THE MANIFEST — the DOM root and the Play resolution. The root is
  // declared only when its entry exists (or the first Play script above brings
  // it): a root naming a missing file is an error on every load, not a step towards one.
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as { roots?: { id?: unknown }[]; resolution?: unknown; [key: string]: unknown };
  let manifestChanged = false;
  const roots = manifest.roots ?? [];
  if (roots.some(root => root.id === PLAY_SCAFFOLD.uiRoot.id)) {
    kept.push(`${MANIFEST_FILENAME} already has a "${PLAY_SCAFFOLD.uiRoot.id}" root`);
  } else if (example !== null || existsSync(join(project, PLAY_SCAFFOLD.uiRoot.entry))) {
    manifest.roots = [...roots, { ...PLAY_SCAFFOLD.uiRoot }];
    manifestChanged = true;
    added.push(`${MANIFEST_FILENAME} root: ${JSON.stringify(PLAY_SCAFFOLD.uiRoot)}`);
  } else {
    kept.push(`${MANIFEST_FILENAME}: no UI root added, because ${PLAY_SCAFFOLD.uiRoot.entry} does not exist. Write that React component (default export), then add the root ${JSON.stringify(PLAY_SCAFFOLD.uiRoot)}`);
  }
  if (manifest.resolution === undefined) {
    manifest.resolution = { ...PLAY_SCAFFOLD.resolution };
    manifestChanged = true;
    added.push(`${MANIFEST_FILENAME} resolution: ${PLAY_SCAFFOLD.resolution.width}x${PLAY_SCAFFOLD.resolution.height}`);
  }
  // Validate what will be written, then write the author's own object, not the parse:
  // parsing fills defaults, and the file should gain only the rows above.
  if (manifestChanged) GameManifestSchema.parse(manifest);

  // 4. THE ADAPTER — TypeScript source, so it is edited only where its shape is
  // the one `writeProject` wrote. Anything else gets the line to add, by hand.
  // Its default document stays the author's: the first Play script plays it.
  let adapter: { original: string; next: string } | null = null;
  if (adapterSource === null) {
    kept.push(`volter.adapter.ts not found; a playable adapter declares ${PLAY_SCAFFOLD.regionIncludes.trim()}`);
  } else {
    let next = adapterSource;
    if (next.includes('regionIncludes')) {
      kept.push(`volter.adapter.ts already declares regionIncludes; it needs ui: { include: ['src/ui/**/*.tsx'] } for UI stories`);
    } else if (/defineAdapter\(\{\r?\n/.test(next)) {
      next = next.replace(/defineAdapter\(\{\r?\n/, match => match + PLAY_SCAFFOLD.regionIncludes);
      added.push(`volter.adapter.ts: ${PLAY_SCAFFOLD.regionIncludes.trim()}`);
    } else {
      kept.push(`volter.adapter.ts has a shape this command does not edit; add ${PLAY_SCAFFOLD.regionIncludes.trim()} to its defineAdapter({ … })`);
    }
    adapter = { original: adapterSource, next };
  }

  // 5. A project from before `writeProject` wrote tsconfig.json needs one for TSX.
  const tsconfigPath = join(project, 'tsconfig.json');
  const writeTsconfig = !occupied(tsconfigPath);
  if (writeTsconfig) added.push('tsconfig.json');
  // A link with nothing behind it is occupied (nothing is written over it) but is no
  // tsconfig either: say so, rather than leaving the project without one in silence.
  else if (!existsSync(tsconfigPath))
    kept.push('tsconfig.json is a dangling link, so none was written; point it at a real tsconfig, or remove it and run add-play again');

  // WRITE. The first Play script goes first: its exclusive writes are the ones that can
  // still be refused (a file appearing since the check above), and if one is, the files
  // written so far — and the folders made for them — are removed, and nothing else has
  // been touched yet.
  if (example !== null) {
    const written: string[] = [];
    const created = new Set<string>();
    try {
      for (const { to, content } of example) {
        const target = join(project, to);
        for (const dir of missingFolders(project, target)) created.add(dir);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, { flag: 'wx' });
        written.push(target);
      }
    } catch (error) {
      await Promise.all(written.map(path => rm(path, { force: true })));
      // Deepest first, and only when empty: `rmdir` refuses a folder something else has
      // written into since, and that folder is then named rather than claimed gone.
      const remaining: string[] = [];
      for (const dir of [...created].sort((a, b) => b.length - a.length)) {
        try { await rmdir(dir); } catch { if (occupied(dir)) remaining.push(relative(project, dir)); }
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(remaining.length === 0
        ? `add-play changed nothing: writing the first Play script failed (${reason}).`
        : `add-play wrote nothing, but could not remove the folder${remaining.length === 1 ? '' : 's'} it made: ${remaining.join(', ')}. Writing the first Play script failed (${reason}).`);
    }
    added.push(...example.map(({ to }) => to));
  }
  if (dependenciesChanged) await writeFile(packagePath, jsonLayout(packageRaw)(pkg));
  if (manifestChanged) await writeFile(manifestPath, jsonLayout(manifestRaw)(manifest));
  if (adapter !== null && adapter.next !== adapter.original) await writeFile(adapterPath, adapter.next);
  if (writeTsconfig) await writeFile(tsconfigPath, PROJECT_TSCONFIG, { flag: 'wx' });


  console.log(added.length > 0 ? `Made ${project} playable:` : `${project} already had everything add-play adds.`);
  for (const line of added) console.log(`  + ${line}`);
  if (kept.length > 0) console.log('Left as it was:');
  for (const line of kept) console.log(`  = ${line}`);
  console.log('Next:');
  // A checkout's project links the checkout's own install (`create.ts`), which already holds
  // every kit package; `npm install` there would write into the checkout.
  const linked = (() => { try { return lstatSync(join(project, 'node_modules')).isSymbolicLink(); } catch { return false; } })();
  if (dependenciesChanged && !linked) console.log(`  npm install    # in ${project}; installs the dependencies added above`);
  if (dependenciesChanged) console.log('  Reload the editor (eval "await editor.reloadPage()", or reopen the project) so it loads @volter/play.');
  const play = model ?? scripts[0]?.replace(/\.play\.ts$/, '.blend');
  if (play) console.log(`  Open model:${play} and press Play (Play runs <model>.play.ts beside its .blend).`);
  else console.log('  Write src/models/<name>.play.ts beside src/models/<name>.blend; Play runs it on that model.');
}
