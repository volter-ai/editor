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
 * `@volter/editor-project` is the kit version the lockstep kit packages (`editor-model-play`,
 * `editor-ui`, …) install at. The running product answers for its own version with no network;
 * any other version, and `latest`, is asked of the registry (`npm view`).
 *
 * IT EDITS TWO FILES AND NOTHING ELSE — `package.json` and `volter.project.json` — and in each
 * only the rows it moves, in the file's own layout (add-play's rule, #133). It does not install:
 * like `add-play`, it says `npm install` when a version changed, because the install is the
 * person's and a checkout-linked project has nothing to install at all.
 */
import { spawn } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { hasManifest } from '@volter/editor-project/manifest/locate';

export const UPGRADE_USAGE = "upgrade [version]    # move this project's @volter packages and its engine pin to one release (default: latest)";

/** Who is upgrading: the product package a project declares, its command, and where it is installed. */
export interface UpgradingProduct {
  readonly packageName: string;
  readonly command: string;
  /** The running product's package root — it answers for its own version without the registry. */
  readonly dir: string;
}

interface Release {
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/** An exact release — a range would leave the pin and the install free to disagree again. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * A JSON file's own layout, so a rewrite changes the rows it moves and nothing else. The same rule
 * as `add-play`'s `jsonLayout` (packages/model-editor/node/add-play.ts, #133); kept beside the
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
  const kit = release.dependencies['@volter/editor-project'];
  if (!engine || !kit)
    throw new Error(`${product.packageName}@${release.version} declares no @volter/editor-core and @volter/editor-project, so there is no engine to pin.`);

  // PLAN BOTH FILES, THEN WRITE: a refusal below leaves the project as it was.
  const changed: string[] = [];
  const kept: string[] = [];

  // 1. THE PACKAGES. The product moves to the release; a package the release depends on moves
  // to that version; a lockstep kit package (declared at the project's old kit version) moves to
  // the new kit version. Any other @volter package is the author's choice and is named, not moved.
  const packageRaw = await readFile(packagePath, 'utf8');
  const pkg = JSON.parse(packageRaw) as PackageJson;
  const previousKit = pkg.devDependencies?.['@volter/editor-project'] ?? pkg.dependencies?.['@volter/editor-project'];
  let packagesChanged = false;
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const declared = pkg[section];
    if (!declared) continue;
    for (const [name, current] of Object.entries(declared)) {
      if (!name.startsWith('@volter/')) continue;
      const target = name === product.packageName ? release.version : release.dependencies[name] ?? (current === previousKit ? kit : undefined);
      if (target === undefined) {
        kept.push(`package.json keeps ${name}@${current}: ${product.packageName}@${release.version} does not name it`);
        continue;
      }
      if (current === target) continue;
      declared[name] = target;
      packagesChanged = true;
      changed.push(`package.json ${section}: ${name} ${current} -> ${target}`);
    }
  }

  // 2. THE ENGINE PIN — the row the refusal names. Only `engine.version` moves.
  const manifestPath = join(project, MANIFEST_FILENAME);
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as { engine?: Record<string, unknown>; [key: string]: unknown };
  const pinned = manifest.engine?.['version'];
  const pinChanged = pinned !== engine;
  if (pinChanged) {
    manifest.engine = { ...manifest.engine, version: engine };
    changed.push(`${MANIFEST_FILENAME} engine.version: ${typeof pinned === 'string' ? pinned : '(none)'} -> ${engine}`);
  }

  if (packagesChanged) await writeFile(packagePath, jsonLayout(packageRaw)(pkg));
  if (pinChanged) await writeFile(manifestPath, jsonLayout(manifestRaw)(manifest));

  console.log(changed.length > 0
    ? `Upgraded ${project} to ${product.packageName}@${release.version} (engine ${engine}):`
    : `${project} is already on ${product.packageName}@${release.version} (engine ${engine}).`);
  for (const line of changed) console.log(`  + ${line}`);
  if (kept.length > 0) console.log('Left as it was:');
  for (const line of kept) console.log(`  = ${line}`);
  if (changed.length === 0) return;
  console.log('Next:');
  // A checkout's project links the checkout's own install, which already holds every kit
  // package; `npm install` there would write into the checkout (`add-play`'s same rule).
  const linked = (() => { try { return lstatSync(join(project, 'node_modules')).isSymbolicLink(); } catch { return false; } })();
  if (packagesChanged && !linked) console.log(`  npm install    # in ${project}; installs the versions above`);
  // A running session keeps the editor it started with: new packages need a new session, while a
  // pin that moved alone is read again by the page's Retry.
  console.log(packagesChanged
    ? `  ${product.command} close && ${product.command} edit .    # restart the session on the new install`
    : `  Press Retry on the editor page that refused the project, or run ${product.command} edit .`);
}
