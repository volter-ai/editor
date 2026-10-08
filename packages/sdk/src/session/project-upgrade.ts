/**
 * `upgrade [version]` — MOVE A PROJECT TO ONE RELEASE: its @volter packages AND its engine pin,
 * together. Any product's CLI exposes it by passing who it is (`UpgradingProduct`) and declaring
 * `volter.product.upgrade: true`, which is what lets the pinned-engine refusal name this verb
 * (`./editor-compatibility`). It lives in the SDK's session half, beside the product and
 * workbench locators, because a product CLI may import that and not editor-core's internals
 * (`scripts/check-boundaries.mjs`).
 *
 * Why this exists (owner's stream, 2026-10-06): a project pinned to 0.5.185 had its packages
 * upgraded to 0.5.189 and then would not open — the editor refuses a project whose
 * `engine.version` differs from the engine it runs, and nothing that upgrades packages moves that
 * pin. So every upgrade ended at the same refusal, and there was no command that did both.
 *
 * WHAT A RELEASE IS: the product package at `version`, and the versions it depends on. Its
 * `@volter/editor-core` is the engine a project pins (`create.ts` stamps the same one), its
 * `@volter/project` is the kit version the lockstep kit packages (`play`,
 * `editor-ui`, …) install at. The running product answers for its own version with no network;
 * any other version, and `latest`, is asked of the registry (`npm view`).
 *
 * IT EDITS TWO FILES AND NOTHING ELSE — `package.json` and `volter.project.json` — and in each
 * only the rows it moves, in the file's own layout (add-play's rule, #133). It does not install:
 * like `add-play`, it says `npm install` when a version changed, because the install is the
 * person's and a checkout-linked project has nothing to install at all.
 *
 * A PRODUCT THAT WAS RENAMED (`UpgradingProduct.replaces`) is the one exception, because a
 * project on the old name has no other way across: the old package is no longer published, and
 * its own `upgrade` only knows its own name. So the NEW package's `upgrade` is the door — run as
 * `npx <new package> upgrade` from inside the old project (`upgradeLine`) — and it moves the
 * dependency to the new name, the `package.json` scripts that call the old command, and the
 * files `create` wrote that name the old package or command (`.mcp.json`, `.codex/config.toml`,
 * `AGENTS.md`, `CLAUDE.md`), so the project's agent servers and instructions keep working.
 */
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { MANIFEST_FILENAME } from '@volter/project/manifest/filename';
import { hasManifest } from '@volter/project/manifest/locate';
import { compareSemver } from './editor-compatibility';

export const UPGRADE_USAGE = "upgrade [version]    # move this project's @volter packages and its engine pin to one release (default: latest); from a project made before 0.5.203, run the newest release's own: npx <package>@latest upgrade";

/** A product name that is no longer published, as a project still spells it. */
export interface RetiredProduct {
  readonly packageName: string;
  readonly command: string;
  /** The names a project's own files use for the retired product, longest first, each with the
   *  name that replaces it. Each is replaced only as a whole word. */
  readonly names: readonly (readonly [retired: string, current: string])[];
}

/** Who is upgrading: the product package a project declares, its command, and where it is installed. */
export interface UpgradingProduct {
  readonly packageName: string;
  readonly command: string;
  /** The running product's package root — it answers for its own version without the registry. */
  readonly dir: string;
  /** The names this product replaced: a project declaring one is moved onto this product. */
  readonly replaces?: readonly RetiredProduct[];
}

/** The ONE line that moves a project onto `product`, from any version — including a project on a
 *  name `product` replaced, whose own installed command does not know `product` exists. */
export function upgradeLine(product: Pick<UpgradingProduct, 'packageName'>): string {
  return `npx ${product.packageName}@latest upgrade`;
}

/** The retired product a project's `package.json` still declares, or null. */
export function declaredRetiredProduct(product: Pick<UpgradingProduct, 'replaces'>, project: string): RetiredProduct | null {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
  return product.replaces?.find(retired =>
    pkg.dependencies?.[retired.packageName] !== undefined || pkg.devDependencies?.[retired.packageName] !== undefined) ?? null;
}

/** The refusal every verb but `upgrade` gives a project still on a retired name. */
export function retiredProjectError(product: Pick<UpgradingProduct, 'packageName' | 'command'>, retired: RetiredProduct, project: string): Error {
  return new Error(
    `${project} is a ${retired.packageName} project, and ${retired.packageName} is now ${product.packageName} (command: ${product.command}). ` +
      `Move the project onto it from the project folder, then run ${product.command} again:\n  ${upgradeLine(product)}`,
  );
}

/** The files `create` writes that name the product's package or command, project-relative. */
const RENAMED_PRODUCT_FILES = ['.mcp.json', '.codex/config.toml', 'AGENTS.md', 'CLAUDE.md'] as const;

/** The kit packages 0.5.203 renamed (#284), old name first. */
const RENAMED_KIT_PACKAGES = [
  ['@volter/editor-project', '@volter/project'],
  ['@volter/editor-sdk', '@volter/sdk'],
  ['@volter/editor-live', '@volter/live'],
  ['@volter/editor-model-play', '@volter/play'],
] as const;

/**
 * What 0.5.203 (#286) moved from where a project kept it to `editor/`: the adapter from the project's root, and the
 * project's contributions and tools from `src/` (`tool-contribution-convention` read `src/contributions` and
 * `src/tools` until then). Project-relative, from and to.
 */
const MOVED_TO_EDITOR = [
  ['volter.adapter.ts', 'editor/volter.adapter.ts'],
  ['src/contributions', 'editor/contributions'],
  ['src/tools', 'editor/tools'],
] as const;

/** Every file under `path` (or `path` itself, a file); none when it is gone. */
async function allFiles(path: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(path, { withFileTypes: true }); } catch { return existsSync(path) ? [path] : []; }
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await allFiles(child));
    else files.push(child);
  }
  return files;
}

/** Every script file under `dir`, skipping `node_modules` and dot-folders. */
async function scriptFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await scriptFiles(path));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** A project's own source that may import the kit: its root script files (the adapter, `vite.config.ts`),
 *  and everything under `editor/`, `src/` and `scripts/`. */
async function projectSourceFiles(project: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for (const entry of await readdir(project, { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name)) files.push(join(project, entry.name));
    }
  } catch { /* an unreadable project root is refused before this */ }
  for (const folder of ['editor', 'src', 'scripts']) files.push(...await scriptFiles(join(project, folder)));
  return files;
}

/** `text` with every import of a renamed kit package (the package itself or a subpath) under its current name. */
function renameKitSpecifiers(text: string): string {
  let out = text;
  for (const [from, to] of RENAMED_KIT_PACKAGES) {
    out = out.replace(new RegExp(`(['"\`])${from.replace('/', '\\/')}(?=[/'"\`])`, 'g'), `$1${to}`);
  }
  return out;
}

/**
 * `text`, a module moving from `fromDir` to `toDir` while the files in `moved` (old path to new) move too, with each
 * relative specifier still naming the same file: `from`, `import`, `import()`, `require()`, `new URL()` and
 * `import.meta.glob()`, and a bare `.` or `..`.
 */
function rebaseRelativeSpecifiers(text: string, fromDir: string, toDir: string, moved: (path: string) => string): string {
  return text.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*|\bimport\.meta\.glob\s*\(\s*)(['"`])(\.{1,2}(?:\/[^'"`]*)?)\2/g,
    (_whole, lead: string, quote: string, spec: string) => {
      let next = relative(toDir, moved(resolve(fromDir, spec))).split('\\').join('/');
      if (next === '') next = '.';
      if (!next.startsWith('.')) next = `./${next}`;
      if (spec.endsWith('/') && !next.endsWith('/')) next = `${next}/`;
      return `${lead}${quote}${next}${quote}`;
    },
  );
}

/** `text` as a whole word — not part of a longer command, package or name it is the start or the
 *  end of (`<command>-x`, a name's plural). A path after it (`<package>/package.json`) or
 *  punctuation (a name's `'s`) still ends the word. */
function wholeWord(text: string): RegExp {
  return new RegExp(`(?<![\\w-])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
}

/** `entries` with the key `from` renamed to `to` where it stands, so a rewrite keeps its order. */
function renameKey<T>(entries: Record<string, T>, from: string, to: string, value: T): Record<string, T> {
  return Object.fromEntries(Object.entries(entries).map(([key, current]) => key === from ? [to, value] : [key, current]));
}

interface Release {
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: unknown;
  [key: string]: unknown;
}

/** The exact version a declared spec names (`0.5.185`, `^0.5.185`, `=0.5.185`), or null for a
 *  range, a tag, a path or a link — nothing a direction can be read from. */
function declaredVersion(spec: string | undefined): string | null {
  const bare = spec?.replace(/^[\^~=v]+/, '');
  return bare !== undefined && EXACT_VERSION.test(bare) ? bare : null;
}

/** The version a kit package is declared at, for telling which packages move together: an exact spec's, or a
 *  local tarball's (`file:…/volter-play-0.5.202.tgz`, how a project built from a checkout declares the kit). */
function kitVersion(spec: string | undefined): string | null {
  return declaredVersion(spec) ?? spec?.match(/^file:.*-(\d+\.\d+\.\d+)\.tgz$/)?.[1] ?? null;
}

/**
 * Write every planned file, or none: each to a temp file beside it first, then all renamed into
 * place. A failure while writing leaves the project as it was; a failure between the renames
 * puts back what was already moved. Until 2026-10-06 (#146 review) the two files were written
 * one after the other, so a failure on the second left a project with new packages and the old
 * pin — exactly the mismatch this verb exists to end.
 */
async function writeAll(files: readonly { readonly path: string; readonly content: string; readonly original: string; readonly created?: boolean }[]): Promise<void> {
  const temp = (path: string) => `${path}.upgrade-${process.pid}.tmp`;
  try {
    for (const file of files) await writeFile(temp(file.path), file.content);
  } catch (error) {
    await Promise.all(files.map(file => rm(temp(file.path), { force: true })));
    throw new Error(`The upgrade was not written (nothing changed): ${error instanceof Error ? error.message : String(error)}`);
  }
  const moved: typeof files[number][] = [];
  try {
    for (const file of files) { await rename(temp(file.path), file.path); moved.push(file); }
  } catch (error) {
    // A file this upgrade made is removed again; any other gets its old content back.
    for (const file of moved) await (file.created ? rm(file.path, { force: true }) : writeFile(file.path, file.original)).catch(() => {});
    await Promise.all(files.map(file => rm(temp(file.path), { force: true })));
    throw new Error(`The upgrade could not be put in place, and what had moved was put back: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * THE LOCK FORGETS THE OLD @volter FAMILY (2026-10-08). Its packages pin one another exactly
 * (`editor-blender` has a peer `@volter/sdk@<its release>`), and npm checks a new member's pins
 * against the old members the lock still holds before it replaces them, so the `npm install`
 * this verb prints refused every installed project with ERESOLVE. Dropping the `@volter/` rows
 * from `package-lock.json` and npm's hidden `node_modules/.package-lock.json` lets npm resolve
 * the family again from package.json; every other package keeps its locked version.
 */
async function lockWithoutVolter(path: string): Promise<{ path: string; content: string; original: string } | null> {
  let raw: string;
  let lock: { packages?: Record<string, unknown>; dependencies?: Record<string, unknown> };
  try { raw = await readFile(path, 'utf8'); lock = JSON.parse(raw); } catch { return null; }
  let dropped = 0;
  for (const key of Object.keys(lock.packages ?? {}))
    if (/(^|\/)node_modules\/@volter\//.test(key)) { delete lock.packages![key]; dropped++; }
  for (const key of Object.keys(lock.dependencies ?? {}))
    if (key.startsWith('@volter/')) { delete lock.dependencies![key]; dropped++; }
  return dropped > 0 ? { path, content: jsonLayout(raw)(lock), original: raw } : null;
}

/** An exact release — a range would leave the pin and the install free to disagree again. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * A JSON file's own layout, so a rewrite changes the rows it moves and nothing else. The same rule
 * as `add-play`'s `jsonLayout` (packages/cyclotron/node/add-play.ts, #133); kept beside the
 * verb that shares it across products rather than reaching into one product's CLI.
 */
function jsonLayout(raw: string): (value: unknown) => string {
  const indent = /^[{[]\r?\n([ \t]+)\S/.exec(raw)?.[1] ?? '  ';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(raw) ? eol : '';
  return value => JSON.stringify(value, null, indent).replace(/\n/g, eol) + trailing;
}

/** `npm view <spec> version dependencies --json`, parsed. */
function npmView(spec: string): Promise<Release> {
  return new Promise((done, fail) => {
    // npm is npm.cmd on Windows, and node refuses to spawn a .cmd without a shell (EINVAL).
    const child = spawn('npm', ['view', spec, 'version', 'dependencies', '--json'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
    child.once('error', fail);
    child.once('exit', code => {
      try {
        const answer = JSON.parse(out) as { version?: unknown; dependencies?: unknown; error?: { summary?: unknown } };
        if (code === 0 && typeof answer.version === 'string') {
          done({ version: answer.version, dependencies: (answer.dependencies ?? {}) as Record<string, string> });
          return;
        }
        fail(new Error(typeof answer.error?.summary === 'string' ? answer.error.summary : `npm view exited ${code}`));
      } catch {
        fail(new Error(err.trim().split('\n').at(-1) || `npm view exited ${code}`));
      }
    });
  });
}

async function readRelease(product: UpgradingProduct, requested: string | undefined): Promise<Release> {
  const running = JSON.parse(await readFile(join(product.dir, 'package.json'), 'utf8')) as { version: string; dependencies?: Record<string, string> };
  if (requested === running.version) return { version: running.version, dependencies: running.dependencies ?? {} };
  const spec = `${product.packageName}@${requested ?? 'latest'}`;
  try {
    return await npmView(spec);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${spec} from the registry (${reason}). Name a published version: ${product.command} upgrade <version>.`);
  }
}

export async function upgradeProject(product: UpgradingProduct, requested?: string, cwd = process.cwd()): Promise<void> {
  if (requested !== undefined && !EXACT_VERSION.test(requested))
    throw new Error(`${product.command} upgrade takes an exact version (e.g. 0.5.189), not "${requested}".`);
  // The project around the working directory, as `edit` with no folder finds it.
  let project = resolve(cwd);
  while (!hasManifest(project)) {
    const parent = dirname(project);
    if (parent === project) throw new Error(`Run ${product.command} upgrade inside a project: there is no ${MANIFEST_FILENAME} here or above.`);
    project = parent;
  }
  const packagePath = join(project, 'package.json');
  if (!existsSync(packagePath)) throw new Error(`${project} has no package.json to upgrade.`);

  const release = await readRelease(product, requested);
  const engine = release.dependencies['@volter/editor-core'];
  const kit = release.dependencies['@volter/project'];
  if (!engine || !kit)
    throw new Error(`${product.packageName}@${release.version} declares no @volter/editor-core and @volter/project, so there is no engine to pin.`);

  // PLAN BOTH FILES, THEN WRITE: a refusal below leaves the project as it was.
  const changed: string[] = [];
  const kept: string[] = [];
  const warnings: string[] = [];

  // 1. THE PACKAGES. The product moves to the release; a package the release depends on moves
  // to that version; a lockstep kit package (declared at the project's old kit version) moves to
  // the new kit version. Any other @volter package is the author's choice and is named, not moved.
  const packageRaw = await readFile(packagePath, 'utf8');
  const pkg = JSON.parse(packageRaw) as PackageJson;
  const previousKit = pkg.devDependencies?.['@volter/project'] ?? pkg.dependencies?.['@volter/project']
    ?? pkg.devDependencies?.['@volter/editor-project'] ?? pkg.dependencies?.['@volter/editor-project'];
  // Read before a retired name is moved below: a project on a retired name declares none of
  // this product, and its direction is then read by its engine pin.
  const currentProduct = declaredVersion(pkg.dependencies?.[product.packageName] ?? pkg.devDependencies?.[product.packageName]);

  // NAMED, NOT MOVED: what this verb deliberately leaves to the author is listed, never skipped
  // silently (#146 review) — peer and optional ranges are a package author's contract, and a
  // workspace's members are projects of their own.
  for (const section of ['peerDependencies', 'optionalDependencies'] as const) {
    for (const [name, current] of Object.entries(pkg[section] ?? {})) {
      if (name.startsWith('@volter/')) kept.push(`package.json ${section} keeps ${name}@${current}: ${section} are not moved by upgrade; edit them by hand if they should follow`);
    }
  }
  if (pkg.workspaces !== undefined) {
    const members = Array.isArray(pkg.workspaces) ? pkg.workspaces
      : Array.isArray((pkg.workspaces as { packages?: unknown }).packages) ? (pkg.workspaces as { packages: unknown[] }).packages : [];
    kept.push(`workspace members${members.length > 0 ? ` (${members.map(String).join(', ')})` : ''} are not upgraded: run ${product.command} upgrade in each member that is a project`);
  }

  let packagesChanged = false;
  // 0. A RETIRED NAME becomes this product, where it stood and at the release — a project that
  // already declares this product as well just loses the old row.
  const retired = declaredRetiredProduct(product, project);
  const textFiles: { path: string; content: string; original: string; created?: boolean }[] = [];
  if (retired !== null) {
    const declaresProduct = pkg.dependencies?.[product.packageName] !== undefined || pkg.devDependencies?.[product.packageName] !== undefined;
    for (const section of ['dependencies', 'devDependencies'] as const) {
      const declared = pkg[section];
      const current = declared?.[retired.packageName];
      if (declared === undefined || current === undefined) continue;
      if (declaresProduct) {
        delete declared[retired.packageName];
        changed.push(`package.json ${section}: ${retired.packageName} ${current} removed (${product.packageName} is already declared)`);
      } else {
        pkg[section] = renameKey(declared, retired.packageName, product.packageName, release.version);
        changed.push(`package.json ${section}: ${retired.packageName} ${current} -> ${product.packageName} ${release.version}`);
      }
      packagesChanged = true;
    }
    // The scripts that call the old command (`create` wrote `dev` and one named for the command).
    const scripts = pkg['scripts'];
    if (scripts !== null && typeof scripts === 'object' && !Array.isArray(scripts)) {
      let rewritten = scripts as Record<string, unknown>;
      for (const [name, body] of Object.entries(rewritten)) {
        const nextBody = typeof body === 'string' ? body.replace(wholeWord(retired.command), product.command) : body;
        const nextName = name === retired.command && !(product.command in rewritten) ? product.command : name;
        if (nextBody === body && nextName === name) continue;
        rewritten = renameKey(rewritten, name, nextName, nextBody);
        changed.push(`package.json scripts: ${name === nextName ? name : `${name} -> ${nextName}`}${nextBody === body ? '' : ` runs "${String(nextBody)}"`}`);
      }
      pkg['scripts'] = rewritten;
    }
    // The files that name the package or the command: the agent servers resolve the product's
    // `bin` by package name, and the instructions tell the agent which command to run.
    for (const file of RENAMED_PRODUCT_FILES) {
      const path = join(project, file);
      if (!existsSync(path)) continue;
      const original = await readFile(path, 'utf8');
      // Only exact references to the product move — its package, its command and its names, each
      // as a whole word; any other phrase that happens to contain them is the author's and stays.
      let content = original.replace(wholeWord(retired.packageName), product.packageName).replace(wholeWord(retired.command), product.command);
      for (const [from, to] of retired.names) content = content.replace(wholeWord(from), to);
      if (content === original) continue;
      textFiles.push({ path, content, original });
      changed.push(`${file}: names ${product.packageName} and \`${product.command}\``);
    }
  }
  // 0b. THE KIT'S OLD NAMES AND THE EDITOR FOLDER (0.5.203: #284 renamed the runtime packages, #286 moved a
  // project's editor side into `editor/`). A project made before 0.5.203 declares the kit under its old names and
  // keeps its editor side where #286 moved it from (the adapter at its root, contributions and tools in `src/`),
  // and the release names neither; left alone, the upgraded project was refused on its next open, or opened
  // without its tools. The names move where they stand, in package.json and in the project's own source, and what
  // #286 moved moves into `editor/`, each file with its relative imports rebased.
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const declared = pkg[section];
    if (declared === undefined) continue;
    for (const [from, to] of RENAMED_KIT_PACKAGES) {
      const current = declared[from];
      if (current === undefined) continue;
      if (declared[to] !== undefined) {
        delete declared[from];
        changed.push(`package.json ${section}: ${from} removed (${to} is already declared)`);
      } else {
        pkg[section] = renameKey(pkg[section]!, from, to, current);
        changed.push(`package.json ${section}: ${from} -> ${to}`);
      }
      packagesChanged = true;
    }
  }
  const projectPath = (path: string) => relative(project, path).split('\\').join('/');
  // Each move is taken only where its destination is free; a destination already there is said, and its source left.
  const moves: { from: string; to: string }[] = [];
  for (const [from, to] of MOVED_TO_EDITOR) {
    const source = join(project, from);
    if (!existsSync(source)) continue;
    if (existsSync(join(project, to))) {
      kept.push(`${from} stays where it is and is not read: this editor reads ${to}, which this project already has`);
      continue;
    }
    moves.push({ from: source, to: join(project, to) });
  }
  const movedPath = (path: string): string => {
    for (const move of moves) {
      if (path === move.from) return move.to;
      if (path.startsWith(move.from + sep)) return move.to + path.slice(move.from.length);
    }
    return path;
  };
  const leftBehind: string[] = [];
  for (const path of await projectSourceFiles(project)) {
    const original = await readFile(path, 'utf8');
    const destination = movedPath(path);
    const content = rebaseRelativeSpecifiers(renameKitSpecifiers(original), dirname(path), dirname(destination), movedPath);
    if (destination !== path) {
      textFiles.push({ path: destination, content, original: '', created: true });
      leftBehind.push(path);
    } else if (content !== original) {
      textFiles.push({ path, content, original });
      changed.push(`${projectPath(path)}: its imports name the kit's current packages and the moved files where they now are`);
    }
  }
  for (const move of moves) changed.push(`${projectPath(move.from)} -> ${projectPath(move.to)} (a project's editor side lives in editor/ from 0.5.203)`);
  // A tool is registered in package.json by its path (`volter.tools`); a registration into a moved folder follows it.
  const volter = pkg['volter'];
  const tools = volter !== null && typeof volter === 'object' && !Array.isArray(volter) ? (volter as { tools?: unknown }).tools : undefined;
  if (Array.isArray(tools)) {
    const rewritten = tools.map((registration: unknown) => {
      const entry = typeof registration === 'string' ? registration : (registration as { entry?: unknown } | null)?.entry;
      if (typeof entry !== 'string' || !entry.startsWith('./')) return registration;
      const next = `./${projectPath(movedPath(join(project, entry.slice(2))))}`;
      if (next === entry) return registration;
      changed.push(`package.json volter.tools: ${entry} -> ${next}`);
      packagesChanged = true;
      return typeof registration === 'string' ? next : { ...(registration as object), entry: next };
    });
    (volter as { tools: unknown[] }).tools = rewritten;
  }

  for (const section of ['dependencies', 'devDependencies'] as const) {
    const declared = pkg[section];
    if (!declared) continue;
    for (const [name, current] of Object.entries(declared)) {
      if (!name.startsWith('@volter/')) continue;
      const target = name === product.packageName ? release.version : release.dependencies[name]
        ?? (current === previousKit || (kitVersion(current) !== null && kitVersion(current) === kitVersion(previousKit)) ? kit : undefined);
      if (target === undefined) {
        kept.push(`package.json keeps ${name}@${current}: ${product.packageName}@${release.version} does not name it`);
        continue;
      }
      if (current === target) continue;
      declared[name] = target;
      packagesChanged = true;
      changed.push(current.startsWith('file:')
        ? `package.json ${section}: ${name} was the local tarball ${current}; it is now ${target} from the registry`
        : `package.json ${section}: ${name} ${current} -> ${target}`);
    }
  }

  // 2. THE ENGINE PIN — the row the refusal names. Only `engine.version` moves.
  const manifestPath = join(project, MANIFEST_FILENAME);
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as { engine?: Record<string, unknown>; [key: string]: unknown };
  const pinned = manifest.engine?.['version'];
  const pinChanged = pinned !== engine;

  // NEVER BACKWARDS BY ACCIDENT (#146 review). `latest` can be older than what a project is on (a
  // prerelease, a version published from a branch), and moving a project back silently downgrades
  // its engine under it. So a backwards move happens only when the version was named, and is said.
  // The product's own declared version decides; a project that declares it as a range or a link
  // is read by its engine pin instead.
  const backwards = currentProduct !== null
    ? (compareSemver(release.version, currentProduct) === -1 ? `${product.packageName}@${currentProduct}` : null)
    : typeof pinned === 'string' && compareSemver(engine, pinned) === -1 ? `engine ${pinned}` : null;
  if (backwards !== null) {
    if (requested === undefined)
      throw new Error(
        `${product.packageName}@latest is ${release.version} (engine ${engine}), older than the ${backwards} this project is on, so upgrading to it would move the project backwards. ` +
          `Nothing was changed. To go back on purpose, name the version: ${product.command} upgrade ${release.version}.`,
      );
    warnings.push(`This moves the project BACKWARDS, from ${backwards} to ${product.packageName}@${release.version} (engine ${engine}), because that version was named.`);
  }
  if (pinChanged) {
    manifest.engine = { ...manifest.engine, version: engine };
    changed.push(`${MANIFEST_FILENAME} engine.version: ${typeof pinned === 'string' ? pinned : '(none)'} -> ${engine}`);
  }

  // A checkout's project links the checkout's own install, which already holds every kit
  // package; `npm install` there would write into the checkout (`add-play`'s same rule).
  const linked = (() => { try { return lstatSync(join(project, 'node_modules')).isSymbolicLink(); } catch { return false; } })();
  const locks = packagesChanged && !linked
    ? (await Promise.all([join(project, 'package-lock.json'), join(project, 'node_modules', '.package-lock.json')]
      .map(lockWithoutVolter))).filter((lock): lock is NonNullable<typeof lock> => lock !== null)
    : [];
  if (locks.length > 0) changed.push('package-lock.json: the old @volter rows dropped, so npm install resolves the new ones');

  for (const file of textFiles) if (file.created) await mkdir(dirname(file.path), { recursive: true });
  await writeAll([
    ...(packagesChanged ? [{ path: packagePath, content: jsonLayout(packageRaw)(pkg), original: packageRaw }] : []),
    ...(pinChanged ? [{ path: manifestPath, content: jsonLayout(manifestRaw)(manifest), original: manifestRaw }] : []),
    ...textFiles,
    ...locks,
  ]);
  // The moved scripts' new copies are in place; only then do the old ones go, and a moved folder's other files
  // (data, a capability stamp) follow as they are. The project is upgraded by now, so a file that cannot be moved or
  // removed (open in another program) is said, not thrown.
  const failed: string[] = [];
  const leftover = (path: string, error: unknown) => (failed.push(path),
    kept.push(`${projectPath(path)} could not be removed (${error instanceof Error ? error.message : String(error)}); the editor does not read it, so delete it by hand`));
  for (const path of leftBehind) await rm(path).catch((error: unknown) => leftover(path, error));
  for (const move of moves) {
    for (const path of await allFiles(move.from)) {
      if (leftBehind.includes(path)) continue;
      const to = movedPath(path);
      await mkdir(dirname(to), { recursive: true });
      await rename(path, to).catch((error: unknown) => leftover(path, error));
    }
    if (!move.from.endsWith('.ts') && !failed.some(path => path.startsWith(move.from + sep))) await rm(move.from, { recursive: true, force: true }).catch(() => undefined);
  }
  for (const line of warnings) console.warn(`! ${line}`);

  console.log(changed.length > 0
    ? `Upgraded ${project} to ${product.packageName}@${release.version} (engine ${engine}):`
    : `${project} is already on ${product.packageName}@${release.version} (engine ${engine}).`);
  for (const line of changed) console.log(`  + ${line}`);
  if (kept.length > 0) console.log('Left as it was:');
  for (const line of kept) console.log(`  = ${line}`);
  if (changed.length === 0) {
    // NOTHING TO MOVE, YET AN EDITOR REFUSED: then the editor that refused is not this project's
    // own installation (an older global install, another checkout), and saying "already on"
    // alone left the person with no next step (#146 review).
    console.log(`If an editor still refuses this project, it is running from another installation: open it with this project's own, \`npx --no-install ${product.command} edit .\` in ${project}.`);
    return;
  }
  if (retired !== null)
    console.log(`This project now opens in ${product.packageName}. Its command is ${product.command}: from the project folder, \`npx --no-install ${product.command} <command>\`.`);
  console.log('Next:');
  if (packagesChanged && !linked) console.log(`  npm install    # in ${project}; installs the versions above`);
  // A running session keeps the editor it started with: new packages need a new session, while a
  // pin that moved alone is read again by the page's Retry.
  console.log(packagesChanged
    ? `  ${product.command} close && ${product.command} edit .    # restart the session on the new install`
    : `  Press Retry on the editor page that refused the project, or run ${product.command} edit .`);
}
