/**
 * THE RUNTIME IMAGE — one installation of this product per version, carrying
 * the full runtime set a game needs (the product's own dependencies are the
 * union of what the template and the catalog's capabilities declare). A game
 * is its own code: its `node_modules` is a link to the image of the version it
 * was made with, so creating or opening a game installs nothing, and every
 * tool that reads `node_modules` — the session's Vite, TypeScript, the web
 * export, a game's own server — resolves through that one path.
 *
 * The image lives outside any package manager's cache, so evicting a cache
 * never breaks a game: `~/.volter/images/game-editor-<version>` (or
 * `$VOLTER_HOME/images/...`). A checkout's image is its own root install.
 */
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const PRODUCT = '@volter/game-editor';

/** Where this product's packages resolve from: a checkout's root, or an install's. */
function installRootOf(productRoot: string): string {
  for (let dir = productRoot; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', '@volter', 'project', 'package.json'))) return dir;
    if (dirname(dir) === dir) throw new Error(`@volter/project is not installed above ${productRoot}.`);
  }
}

function isCheckout(root: string): boolean {
  return existsSync(join(root, 'packages', 'game-editor', 'package.json'));
}

/** The image directory for `version`, in the person's own Volter home. */
export function imageDirFor(version: string): string {
  const home = process.env['VOLTER_HOME'] ?? join(homedir(), '.volter');
  return join(home, 'images', `game-editor-${version}`);
}

function imageVersion(nodeModules: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(nodeModules, '@volter', 'game-editor', 'package.json'), 'utf8')) as {
      version?: string;
    }).version ?? null;
  } catch {
    return null;
  }
}

/**
 * The `node_modules` a game of this product's version links to, installing the
 * image once when this machine has none. A checkout answers with its own root.
 */
export async function ensureRuntimeImage(productRoot: string, version: string): Promise<string> {
  const root = installRootOf(productRoot);
  if (isCheckout(root)) return join(root, 'node_modules');
  const dir = imageDirFor(version);
  const nodeModules = join(dir, 'node_modules');
  if (imageVersion(nodeModules) === version) return nodeModules;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: `game-editor-image-${version}`, private: true, dependencies: { [PRODUCT]: version } }, null, 2)}\n`,
  );
  console.error(`Installing the Volter Game Editor ${version} runtime image (once per version) into ${dir}`);
  await new Promise<void>((done, fail) => {
    // Windows starts a .cmd only through a shell: without one, current Node refuses it with EINVAL, and create
    // stopped there on every Windows machine (read on volter-desktop with the released 0.5.202).
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], {
      windowsHide: true,
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', fail);
    child.once('exit', (code) => (code === 0 ? done() : fail(new Error(`The runtime image did not install (${code}); retry creating the project.`))));
  });
  if (imageVersion(nodeModules) !== version) throw new Error(`The runtime image at ${dir} does not carry ${PRODUCT}@${version}.`);
  return nodeModules;
}

/** Point `projectDir/node_modules` at `imageNodeModules`. A real directory — a
 *  game installed on its own — is left alone and named. */
export function linkRuntimeImage(projectDir: string, imageNodeModules: string): void {
  const link = join(projectDir, 'node_modules');
  if (existsSync(link) || isDanglingLink(link)) {
    if (!lstatSync(link).isSymbolicLink())
      throw new Error(`${link} is a real directory: this game installs its own dependencies, so it is not linked to the runtime image.`);
    if (resolve(projectDir, readlinkSync(link)) === resolve(imageNodeModules)) return;
    throw new Error(`${link} already links ${readlinkSync(link)}; remove it to link the runtime image.`);
  }
  // A directory symlink on Windows needs Developer Mode or an administrator (EPERM otherwise); a junction needs
  // neither, and Node reads it back as a symbolic link to the same absolute path, so the checks above hold for it.
  symlinkSync(imageNodeModules, link, process.platform === 'win32' ? 'junction' : 'dir');
}

/**
 * After `upgrade`: point a game's `node_modules` at `imageNodeModules` when it links another version's image. A real
 * directory is left alone (`linkRuntimeImage` names it); a link already there is replaced, never its target touched.
 * Whether the link moved.
 */
export function relinkRuntimeImage(projectDir: string, imageNodeModules: string): boolean {
  const link = join(projectDir, 'node_modules');
  if (isDanglingLink(link) || (existsSync(link) && lstatSync(link).isSymbolicLink())) {
    if (existsSync(link) && resolve(projectDir, readlinkSync(link)) === resolve(imageNodeModules)) return false;
    // Only the link goes: unlink removes a symlink, and rmdir a Windows junction, without reading into its target.
    try { unlinkSync(link); } catch { rmdirSync(link); }
  }
  linkRuntimeImage(projectDir, imageNodeModules);
  return true;
}

function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Whether a game's dependencies are the runtime image (a link), not its own. */
export function usesRuntimeImage(projectDir: string): boolean {
  try {
    return lstatSync(join(projectDir, 'node_modules')).isSymbolicLink();
  } catch {
    return false;
  }
}
