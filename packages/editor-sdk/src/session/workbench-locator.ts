/**
 * WHICH CODE-OSS WORKBENCH A PROJECT OPENS IN — one declaration, one resolver.
 *
 * `vgai edit` is the workbench. The workbench itself is not in this repository
 * and is not published to a registry yet, so the one thing a project must state
 * is WHERE the bytes are:
 *
 * ```json
 * { "workbench": "/Users/me/volter/code-oss-releases/393f0b98ade1" }
 * ```
 *
 * in `<project>/.vgai/workbench.json`. `--workbench <dir>` overrides it for one
 * invocation. There is deliberately NO env var, NO setting and NO search path:
 * a machine-local path that decides which editor a person gets belongs in the
 * project's own machine-local file, where `vgai status` can report it and a
 * second person can read it, not in whichever shell happened to start the
 * session.
 *
 * AND A PRODUCT THAT IS INSTALLED CARRIES ITS OWN (B2, 2026-09-21). A person
 * who has just run `npx @vgai/model-editor create my-models` has no release on
 * their machine and no reason to have one, so the third step of the resolution
 * is the PRODUCT'S declaration — `package.json#vgai.product.workbench`, the
 * published release those bytes are (ARCHITECTURE-CORE §The target shape: one
 * product number per release, pinning the fork, the kit, the API and its
 * media). It is fetched once into `~/.vgai/workbenches/<tag>/` and then
 * DECLARED in this project's own file like any other, so the sentence above
 * still holds where it matters: the record of which workbench this machine
 * opens this project in is the project's file, always, and `~/.vgai/workbenches`
 * is a byte cache keyed by a release tag that decides nothing.
 *
 * ONE DIRECTORY, TWO KINDS, and the marker file decides:
 *  - a RELEASE — `BUILD.json` beside an extracted `vscode-reh-web-*` tree, the
 *    pair `scripts/workbench/build-release.mjs` cuts. Its `commit` is what this
 *    reports.
 *  - a fork CHECKOUT — `scripts/code-server.sh`. `git rev-parse HEAD` is the
 *    commit, because a checkout's commit is a fact about the working tree and
 *    not about any file in it.
 *
 * AND A WORKBENCH IS ONE PRODUCT'S (P3, 2026-09-21). Our tier is not in the
 * fork any more: it is OVERLAID on a checkout at a pin, the kit's half and ONE
 * product's half together (ARCHITECTURE-CORE §The target shape, rule 6). So a
 * workbench carries a product the way it carries a commit — a release states it
 * in `BUILD.json`, a checkout in the `.vgai-overlay.json` the overlay writes —
 * and opening a project in a workbench built for the OTHER product is refused
 * by name. It has to be: the mismatch is invisible otherwise. The page mounts,
 * the session serves this project's product entry into it, and what the person
 * gets is the other product's title, its look and its commands around it.
 *
 * WHO CALLS THIS, and why twice. The CLI resolves to REFUSE EARLY — a bad
 * declaration must be named before a session is started, not after. The session
 * resolves to SPAWN and to REPORT (`EditorState.workbench`), because the REH is
 * the session's child and a process reports its own children. One function, one
 * set of refusal texts; calling it twice costs two file reads.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  PRODUCT_DECLARATION_KEY,
  type ProductIdentity,
  workbenchProductId,
} from './product-locator';

/** Where a project declares its workbench, relative to the project root. */
export const WORKBENCH_LOCATOR_PATH = '.vgai/workbench.json';

/** The release's own record, written beside the tarball by
 *  `scripts/workbench/build-release.mjs`. */
const RELEASE_RECORD = 'BUILD.json';
/** The REH launcher inside a fork checkout — the marker that says "sources". */
const SOURCES_LAUNCHER = join('scripts', 'code-server.sh');
/** What `scripts/workbench/overlay.mjs` leaves in a checkout it has overlaid. */
const OVERLAY_RECORD = '.vgai-overlay.json';

/** What the session reports about the workbench it is running. */
export interface WorkbenchIdentity {
  readonly kind: 'release' | 'sources';
  /** The directory named by the declaration or the flag, resolved absolute. */
  readonly dir: string;
  /** The Code-OSS fork commit these bytes are. */
  readonly commit: string;
  /** The product whose workbench half is overlaid on them — `model-editor`,
   *  `game-editor`. Reported beside the commit by `vgai status`. */
  readonly product: string;
}

/** Everything the session needs to run it, identity included. */
export interface ResolvedWorkbench extends WorkbenchIdentity {
  /** The executable to spawn, already known to exist. */
  readonly serverBin: string;
  /** Its working directory — the package root, or the checkout. */
  readonly cwd: string;
}

/** The exact file to write, quoted in every refusal that wants one. */
export function workbenchDeclarationExample(projectRoot: string): string {
  return (
    `${join(projectRoot, WORKBENCH_LOCATOR_PATH)}:\n` +
    '  { "workbench": "<path to an extracted Code-OSS release, or to a fork checkout>" }'
  );
}

/**
 * The workbench directory this project declares, or `null` when it declares
 * none. Throws when the file exists and is not exactly `{ "workbench": <path> }`
 * — an unrecognized key is an error, never a silent pass-through, for the same
 * reason every on-disk document this repo reads is strict.
 */
export function readWorkbenchDeclaration(projectRoot: string): string | null {
  const file = join(projectRoot, WORKBENCH_LOCATOR_PATH);
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}). It says ` +
        `which Code-OSS workbench this project opens in, and nothing else:\n${workbenchDeclarationExample(projectRoot)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${file} must be a JSON object naming one workbench:\n${workbenchDeclarationExample(projectRoot)}`,
    );
  }
  const record = parsed as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => key !== 'workbench');
  if (extra.length > 0) {
    throw new Error(
      `${file} carries ${extra.map((key) => `"${key}"`).join(', ')}, which this document has no meaning for. ` +
        `It names ONE key:\n${workbenchDeclarationExample(projectRoot)}`,
    );
  }
  const declared = record['workbench'];
  if (typeof declared !== 'string' || declared.trim() === '') {
    throw new Error(
      `${file} names no workbench directory:\n${workbenchDeclarationExample(projectRoot)}`,
    );
  }
  return isAbsolute(declared) ? resolve(declared) : resolve(projectRoot, declared);
}

/**
 * WRITE THE DECLARATION — the one record of which workbench THIS machine opens
 * this project in. Written by `<product> create --workbench <dir>`, and written
 * by the fetch below, so the two paths cannot leave two different shapes of
 * file behind.
 */
export function writeWorkbenchDeclaration(projectRoot: string, workbenchDir: string): void {
  mkdirSync(join(projectRoot, '.vgai'), { recursive: true });
  writeFileSync(
    join(projectRoot, WORKBENCH_LOCATOR_PATH),
    `${JSON.stringify({ workbench: resolve(workbenchDir) }, null, 2)}\n`,
  );
}

/**
 * The url the workbench answers on — the ONE url a person opens under the
 * frame. Spelled here so the CLI's launch line and the session's tab bijection
 * cannot disagree about it.
 *
 * `?project=<id>` is the one boot param the vgai editor carries; the session's
 * one-origin proxy redirects it to the workbench's own `?folder=`, and
 * `frame-proxy.ts` says why it must be a redirect.
 */
export function workbenchUrl(proxyPort: number, projectRoot: string): string {
  const id = projectRoot.split('/').filter(Boolean).pop() ?? '';
  return `http://127.0.0.1:${proxyPort}/?project=${encodeURIComponent(id)}`;
}

/** This machine in the build script's own platform vocabulary. */
function machinePlatform(): string {
  return `${process.platform}-${process.arch}`;
}

/**
 * Read one workbench directory and check this machine can run it, or throw with
 * the exact fix. Both kinds are refused by NAME rather than fallen back from: a
 * boot that silently was not the workbench you named measures nothing.
 *
 * `expectedProduct` is the product the PROJECT resolves to (`@vgai/game-editor`
 * → `game-editor`). Passing it is how a caller asks "is this workbench this
 * project's?"; omitting it reads the workbench without judging it, which is what
 * `<product> create --workbench <dir>` does, having no installed project yet.
 */
export function resolveWorkbench(dir: string, expectedProduct?: string): ResolvedWorkbench {
  const root = resolve(dir);
  const resolved = existsSync(join(root, RELEASE_RECORD))
    ? resolveRelease(root)
    : existsSync(join(root, SOURCES_LAUNCHER))
      ? resolveSources(root)
      : null;
  if (resolved === null) {
    throw new Error(
      `${root} is neither a Code-OSS release nor a fork checkout: it carries no ${RELEASE_RECORD} (the record ` +
        `scripts/workbench/build-release.mjs writes beside its tarball) and no ${SOURCES_LAUNCHER}. Name the ` +
        'directory the release was extracted into, or the fork checkout itself.',
    );
  }
  if (expectedProduct !== undefined && resolved.product !== expectedProduct) {
    throw new Error(
      `${root} is a ${resolved.product} workbench and this project opens in ${expectedProduct}. A workbench is ` +
        "built for ONE product — the editor kit and that product's workbench half are overlaid on the fork " +
        "together — so its title, its look and its commands are the other product's, whatever this session " +
        `serves into it. ${
          resolved.kind === 'sources'
            ? `Re-overlay the checkout:\n  node scripts/workbench/dev.mjs --checkout ${root} --product ${expectedProduct}`
            : `Name a ${expectedProduct} release in .vgai/workbench.json, or cut one:\n  node scripts/workbench/build-release.mjs --product ${expectedProduct} --platform ${machinePlatform()} --checkout <fork dir>`
        }`,
    );
  }
  return resolved;
}

/**
 * The five fields the launch depends on — `target`, `platform`, `commit`,
 * `serverBin` and `product`. The rest of `BUILD.json` is the build's own
 * provenance (sizes, sha256, the node it was built with) and is read by a
 * person, not by this.
 */
function resolveRelease(dir: string): ResolvedWorkbench {
  const record = join(dir, RELEASE_RECORD);
  const cut = `node scripts/workbench/build-release.mjs --product <id> --platform ${machinePlatform()} --checkout <fork dir> --out ${dir}`;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(record, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${record} could not be read: ${String(error)}`);
  }
  const needed = ['target', 'platform', 'commit', 'serverBin', 'product'] as const;
  const missing = needed.filter((key) => typeof parsed[key] !== 'string');
  if (missing.length > 0) {
    throw new Error(
      `${record} is not a release record this understands: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} missing or not a string. A release names ${needed.join(', ')} — ` +
        'the five fields scripts/workbench/build-release.mjs writes and this one spawns from. A release cut ' +
        'before the tier left the fork names no product, and there is no way to infer one from the bytes: the ' +
        'kit and one product were compiled into them together. Re-cut it:\n  ' +
        cut,
    );
  }
  const target = parsed['target'] as string;
  const platform = parsed['platform'] as string;
  const commit = parsed['commit'] as string;
  const serverBin = parsed['serverBin'] as string;
  const product = parsed['product'] as string;

  const machine = machinePlatform();
  if (platform !== machine) {
    throw new Error(
      `${dir} was built for ${platform} and this machine is ${machine}. A Code-OSS server package carries its ` +
        "own platform's node binary and native modules, so it cannot run here — and this never falls back to a " +
        `source checkout, because a boot that silently was not the release measures nothing. Cut the ${machine} ` +
        `release:\n  node scripts/workbench/build-release.mjs --product ${product} --platform ${machine} --checkout <fork dir>`,
    );
  }

  const packageRoot = join(dir, target);
  const serverBinPath = join(packageRoot, serverBin);
  if (!existsSync(serverBinPath)) {
    const tarball =
      typeof parsed['tarball'] === 'string'
        ? (parsed['tarball'] as string)
        : `${target}-<commit>.tar.gz`;
    throw new Error(
      `${dir} records ${target}, but ${serverBinPath} is not there — the tarball has not been extracted beside ` +
        `${RELEASE_RECORD}. Run:\n  tar -xzf ${join(dir, tarball)} -C ${dir}`,
    );
  }
  return { kind: 'release', dir, commit, product, serverBin: serverBinPath, cwd: packageRoot };
}

/**
 * A fork checkout. The commit is the working tree's, read with git: a checkout
 * has no file that states it, and a stale one would name bytes nobody is
 * running. The PRODUCT is the overlay's own record — a checkout with none has
 * no vgai tier in it at all, and that is refused here rather than left to
 * surface as a workbench where `VGAI: Open Workspace` does not exist.
 */
function resolveSources(dir: string): ResolvedWorkbench {
  let commit: string;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(
      `${dir} carries ${SOURCES_LAUNCHER}, so it reads as a Code-OSS fork checkout, but \`git rev-parse HEAD\` ` +
        `there failed (${error instanceof Error ? error.message : String(error)}). A checkout's commit is the ` +
        'only record of which fork this workbench is.',
    );
  }
  const marker = join(dir, OVERLAY_RECORD);
  if (!existsSync(marker)) {
    throw new Error(
      `${dir} is a Code-OSS checkout with no vgai overlay: ${OVERLAY_RECORD} is not there, so nothing of the ` +
        'editor is compiled into it and the workbench would come up as plain Code-OSS. Overlay and compile it:\n' +
        `  node scripts/workbench/dev.mjs --checkout ${dir} --product <model-editor|game-editor>`,
    );
  }
  let product: unknown;
  try {
    product = (JSON.parse(readFileSync(marker, 'utf8')) as Record<string, unknown>)['product'];
  } catch (error) {
    throw new Error(`${marker} could not be read: ${String(error)}`);
  }
  if (typeof product !== 'string' || product === '') {
    throw new Error(
      `${marker} names no product. It is written by scripts/workbench/overlay.mjs and says which product's ` +
        'workbench half is in this checkout; re-run the overlay rather than editing it.',
    );
  }
  return {
    kind: 'sources',
    dir,
    commit,
    product,
    serverBin: join(dir, SOURCES_LAUNCHER),
    cwd: dir,
  };
}

// ---------------------------------------------------------------------------
// THE PRODUCT'S OWN WORKBENCH — the third resolution step, and the only one
// that needs nothing on the machine but the product.
// ---------------------------------------------------------------------------

/** The fork's own repository, where a cut release is published. Private today;
 *  the fetch below is the same call either way, with a token or without one. */
const RELEASE_REPO = 'volter-ai/code-oss';

/**
 * WHERE FETCHED BYTES LIVE — one directory per release tag, per machine.
 *
 * Keyed by the TAG and nothing else, because that is what makes it a cache and
 * not a decision: two projects on the same release share one 723 MB directory,
 * a second `create` consults no network, and a release is immutable, so a tag
 * that is here is the tag that was published. Which workbench a project opens
 * in is still recorded in the PROJECT (`.vgai/workbench.json`, written the
 * moment this resolves) — nothing ever searches this directory.
 */
export const WORKBENCH_CACHE_ROOT = join(homedir(), '.vgai', 'workbenches');

/** Which of the three steps answered. */
export type WorkbenchSource = 'flag' | 'declaration' | 'release';

/** The resolution, and how it got there — the launch line says both. */
export interface ProjectWorkbench extends ResolvedWorkbench {
  readonly source: WorkbenchSource;
  /** The release tag these bytes are, when the product's declaration found them. */
  readonly tag: string | null;
  /** True when THIS call downloaded them — the launch line says `fetched from
   *  <tag>` exactly once per machine per release, and never again. */
  readonly fetched: boolean;
}

/** Where the fetch talks. `log` is a line; `progress` is ONE line rewritten in
 *  place (216 MB is a wait, and a wait with no number is a hang). */
export interface WorkbenchFetchIO {
  readonly log: (line: string) => void;
  readonly progress?: (line: string) => void;
}

/**
 * THE WORKBENCH THIS PROJECT OPENS IN, resolved in three steps and saying which
 * one answered:
 *
 *   1. `--workbench <dir>` — one launch, writes nothing.
 *   2. `<project>/.vgai/workbench.json` — this machine's record for this project.
 *   3. the PRODUCT's declared release — fetched once, then written into (2).
 *
 * Step 3 is what makes `npx @vgai/model-editor create my-models` open something
 * on a machine that has never built anything, and it is why the CLI resolves
 * the product BEFORE the workbench.
 */
export async function resolveWorkbenchForProject(options: {
  projectRoot: string;
  product: ProductIdentity;
  /** `--workbench <dir>`, when the person passed one. */
  override?: string | undefined;
  io: WorkbenchFetchIO;
}): Promise<ProjectWorkbench> {
  const { projectRoot, product, override, io } = options;
  const productId = workbenchProductId(product.name);
  if (override !== undefined)
    return {
      ...resolveWorkbench(resolve(override), productId),
      source: 'flag',
      tag: null,
      fetched: false,
    };
  const declared = readWorkbenchDeclaration(projectRoot);
  if (declared !== null)
    return {
      ...resolveWorkbench(declared, productId),
      source: 'declaration',
      tag: null,
      fetched: false,
    };

  if (product.workbench === null) throw new Error(
    `${product.name} is a private source product with no released workbench. ` +
    `Pass --workbench <compiled checkout> or declare it in ${WORKBENCH_LOCATOR_PATH}. ` +
    'Public distribution requires a pinned workbench release and checksum.',
  );
  const tag = product.workbench.release;
  const dir = join(WORKBENCH_CACHE_ROOT, tag);
  // A CACHED TAG IS NEVER RE-FETCHED. The marker is the release's own record,
  // so a directory that lost its extraction reads as absent and is fetched
  // again rather than resolving into a refusal a person cannot act on.
  const fetched = !existsSync(join(dir, RELEASE_RECORD));
  if (fetched) await fetchDeclaredRelease(product, tag, dir, io);
  else io.log(`Workbench ${tag} is already installed (${dir}).`);
  const workbench = resolveWorkbench(dir, productId);
  writeWorkbenchDeclaration(projectRoot, dir);
  io.log(`Declared in ${WORKBENCH_LOCATOR_PATH}: ${dir}`);
  return { ...workbench, source: 'release', tag, fetched };
}

/** A GitHub release asset, as much of one as this reads. */
interface ReleaseAsset {
  readonly id: number;
  readonly name: string;
  readonly size: number;
}

/**
 * The token, from the two doors a person has: the environment, or the `gh` they
 * are already logged into. Deliberately not a file of ours, not a setting and
 * not a prompt — a credential this reads is one somebody else's tool already
 * owns.
 */
function githubToken(): string | null {
  const fromEnv = process.env['GITHUB_TOKEN'];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  try {
    const out = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

function apiHeaders(token: string | null): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'vgai-workbench-locator',
    ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
  };
}

function megabytes(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(0);
}

/** The line a refusal prints when the release is not reachable — both doors,
 *  named, because "no credentials" with no names is the same as no message. */
function tokenDoors(): string {
  return (
    '  GITHUB_TOKEN=<a token with repo scope>   — in this shell, or\n' +
    '  gh auth login                            — so `gh auth token` answers'
  );
}

/**
 * FETCH ONE PUBLISHED RELEASE into `dir`, atomically: everything lands in a
 * sibling `.partial` directory and is renamed into place at the end, so a
 * directory under `~/.vgai/workbenches` either is a whole workbench or is not
 * there. Any failure — a refused download, a sha that does not match the
 * product's pin, a tar that dies — deletes the partial and refuses.
 */
async function fetchDeclaredRelease(
  product: ProductIdentity,
  tag: string,
  dir: string,
  io: WorkbenchFetchIO,
): Promise<void> {
  if (product.workbench === null) throw new Error('Cannot download an unpinned workbench.');
  const productId = workbenchProductId(product.name);
  const machine = machinePlatform();
  const token = githubToken();
  const partial = join(WORKBENCH_CACHE_ROOT, `.${tag}.${process.pid}.partial`);
  const cutLine =
    `  node scripts/workbench/build-release.mjs --product ${productId} --platform ${machine} ` +
    '--checkout <fork dir> --publish';

  const response = await fetch(
    `https://api.github.com/repos/${RELEASE_REPO}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: apiHeaders(token) },
  );
  if (response.status === 404 && token === null)
    throw new Error(
      `${product.name} opens in the Code-OSS workbench published as ${tag} on ${RELEASE_REPO}, and ` +
        'that repository answers 404 to this machine — it is private, and nothing here has a ' +
        'GitHub token to read it with. Two doors, either one:\n' +
        `${tokenDoors()}\n` +
        'Or name a workbench you already have, which needs no network at all:\n' +
        `  ${product.command} edit --workbench <dir>`,
    );
  if (response.status === 404)
    throw new Error(
      `${RELEASE_REPO} has no release tagged ${tag}, and that is the workbench ${product.name} ` +
        `declares (package.json#${PRODUCT_DECLARATION_KEY}.workbench). Either the declaration names ` +
        'a tag that was never published, or this token cannot see the repository. Cut and publish ' +
        `it:\n${cutLine}`,
    );
  if (!response.ok)
    throw new Error(
      `${RELEASE_REPO}'s release ${tag} answered ${response.status} ${response.statusText}. That is ` +
        `the workbench ${product.name} declares; ` +
        `${token === null ? 'no token was found' : 'the token this machine has was used'}.` +
        (token === null ? `\n${tokenDoors()}` : ''),
    );
  const assets = ((await response.json()) as { assets?: ReleaseAsset[] }).assets ?? [];
  const record = assets.find((asset) => asset.name === RELEASE_RECORD);
  const tarball = assets.find((asset) => asset.name.endsWith('.tar.gz'));
  if (record === undefined || tarball === undefined)
    throw new Error(
      `Release ${tag} on ${RELEASE_REPO} carries ` +
        `${assets.length === 0 ? 'no assets' : assets.map((asset) => asset.name).join(', ')}. ` +
        `A workbench release is a tarball and its ${RELEASE_RECORD}, both uploaded by ` +
        `\`build-release.mjs --publish\`; re-publish it:\n${cutLine}`,
    );

  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  try {
    // THE RECORD FIRST — it is under a kilobyte, and it says whether these bytes
    // can run on this machine at all. Downloading 216 MB and refusing afterwards
    // would be a refusal that cost a person ten minutes.
    const recordText = await downloadAssetText(record, token);
    const built = JSON.parse(recordText) as Record<string, unknown>;
    if (built['platform'] !== machine)
      throw new Error(
        `Release ${tag} was built for ${String(built['platform'])} and this machine is ${machine}. A ` +
          "Code-OSS server package carries its own platform's node binary and native modules, so it " +
          `cannot run here, and nothing falls back. Cut and publish the ${machine} release:\n${cutLine}`,
      );
    if (built['tarballSha256'] !== product.workbench.tarballSha256)
      throw new Error(
        `Release ${tag}'s own ${RELEASE_RECORD} records tarballSha256 ${String(built['tarballSha256'])} ` +
          `and ${product.name} pins ${product.workbench.tarballSha256}. A release is immutable, so these ` +
          'two cannot disagree about one tag: either the product declares the wrong release, or the ' +
          'release was replaced. Nothing was downloaded.',
      );
    writeFileSync(join(partial, RELEASE_RECORD), recordText);

    io.log(
      `Fetching the ${productId} workbench ${tag} from ${RELEASE_REPO} — ` +
        `${megabytes(tarball.size)} MB, once per machine.`,
    );
    const tarballPath = join(partial, tarball.name);
    let announced = 0;
    const sha = await downloadAsset(tarball, token, tarballPath, (received) => {
      if (received - announced < 4 * 1024 ** 2 && received !== tarball.size) return;
      announced = received;
      io.progress?.(
        `  ${megabytes(received)} / ${megabytes(tarball.size)} MB  ` +
          `(${Math.floor((received / tarball.size) * 100)}%)`,
      );
    });
    if (sha !== product.workbench.tarballSha256)
      throw new Error(
        `The download of ${tag} hashes to ${sha} and ${product.name} pins ` +
          `${product.workbench.tarballSha256}. These are not the bytes this product runs in; the ` +
          'partial download was deleted and nothing was extracted.',
      );
    io.log(`  sha256 ${sha.slice(0, 12)}… matches the pin. Extracting…`);
    execFileSync('tar', ['-xzf', tarballPath, '-C', partial], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // The tarball has done its job and is 216 MB; the extraction is what runs.
    rmSync(tarballPath, { force: true });
    if (existsSync(join(dir, RELEASE_RECORD))) {
      // Another process won the same race. A release is immutable, so its
      // directory is ours too — take it and drop this copy.
      rmSync(partial, { recursive: true, force: true });
    } else {
      rmSync(dir, { recursive: true, force: true });
      renameSync(partial, dir);
    }
    io.log(`Workbench installed at ${dir}.`);
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw error;
  }
}

/** One asset's bytes as text — for `BUILD.json`, which is a kilobyte. */
async function downloadAssetText(asset: ReleaseAsset, token: string | null): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${RELEASE_REPO}/releases/assets/${asset.id}`,
    { headers: { ...apiHeaders(token), Accept: 'application/octet-stream' } },
  );
  if (!response.ok)
    throw new Error(
      `${asset.name} of ${RELEASE_REPO} answered ${response.status} ${response.statusText}.`,
    );
  return await response.text();
}

/**
 * One asset's bytes to a file, hashing them ON THE WAY THROUGH — a 216 MB
 * tarball is not read twice, and it is never held in memory.
 */
async function downloadAsset(
  asset: ReleaseAsset,
  token: string | null,
  destination: string,
  onProgress: (received: number) => void,
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${RELEASE_REPO}/releases/assets/${asset.id}`,
    { headers: { ...apiHeaders(token), Accept: 'application/octet-stream' } },
  );
  if (!response.ok || response.body === null)
    throw new Error(
      `${asset.name} of ${RELEASE_REPO} answered ${response.status} ${response.statusText}.`,
    );
  const hash = createHash('sha256');
  let received = 0;
  await pipeline(
    Readable.fromWeb(response.body as never),
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        hash.update(chunk);
        received += chunk.length;
        onProgress(received);
        yield chunk;
      }
    },
    createWriteStream(destination),
  );
  return hash.digest('hex');
}
