/**
 * NO BUILD-MACHINE PATH IN A LIMITED VIEW — every absolute path the session's answers carry is
 * rewritten to a neutral prefix, and the finished output is scanned for any that is left.
 *
 * What the session records names files by their absolute path: Vite's `/@fs/<path>` URLs, the
 * creation-site index's `file:line`, `/__editor/project`'s root, an engine's status. A view is made
 * to be shared, so none of that may survive:
 *
 *  - the project root becomes `/volter-view/<name>` (what the page tells the editor it opened);
 *  - every other root becomes `/volter-fs/<n>/`: a path's prefix up to its first `node_modules` or
 *    `packages` segment (a workspace's hoisted install, an editor checkout), or else its folder.
 *    Each root keeps its own prefix, so two files never collapse into one URL.
 *
 * The rewrite covers each root as Vite spells it (`/@fs/C:/…`, `/@fs/home/…`), with `/`, with JSON's
 * escaped `\\`, and with a plain `\`, in either case of drive letter.
 *
 * Then {@link scanForLocalPaths} reads every text file of the output for the builder's home
 * directory, their user name inside a home path, and any `/@fs/` URL that is still absolute. Any
 * hit FAILS the build: a view that names a person's machine is not written as publishable.
 */

import { homedir, userInfo } from 'node:os';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const forward = (path: string): string => path.split('\\').join('/').replace(/\/+$/, '');

/** Every spelling of one absolute path in recorded text, Vite's URL form first. */
function spellings(path: string): { fsUrl: string[]; plain: string[] } {
  const base = forward(path);
  const cases = new Set([base, base.replace(/^[a-z]:/, (d) => d.toUpperCase()), base.replace(/^[A-Z]:/, (d) => d.toLowerCase())]);
  const fsUrl: string[] = [];
  const plain: string[] = [];
  for (const variant of cases) {
    fsUrl.push(variant.startsWith('/') ? `/@fs${variant}` : `/@fs/${variant}`);
    plain.push(variant, variant.split('/').join('\\\\'), variant.split('/').join('\\'));
  }
  return { fsUrl, plain };
}

/** Where a foreign absolute path's root ends: before its first `node_modules` or `packages`
 *  segment, else its folder. */
function rootOf(path: string): string {
  const segments = forward(path).split('/');
  const cut = segments.findIndex((segment, index) => index > 0 && (segment === 'node_modules' || segment === 'packages'));
  return cut > 0 ? segments.slice(0, cut).join('/') : segments.slice(0, -1).join('/');
}

/** Absolute paths inside `/@fs/` URLs: `C:/…` or `/…`. */
const FS_URL_PATH = /\/@fs\/((?:[A-Za-z]:\/|\/?)(?:[^\s"'`?#)\\<>]+))/g;

export class PathNeutralizer {
  /** [absolute root (forward slashes), neutral prefix], longest first when rewriting. */
  private readonly roots: [string, string][] = [];

  constructor(projectRoots: readonly string[], projectNeutral: string, knownDirs: readonly string[] = []) {
    for (const root of projectRoots) this.add(forward(root), projectNeutral);
    for (const dir of knownDirs) this.cover(dir);
  }

  private add(root: string, neutral: string): void {
    if (root.length < 3 || this.roots.some(([known]) => known.toLowerCase() === root.toLowerCase())) return;
    this.roots.push([root, neutral]);
  }

  private covered(path: string): boolean {
    const lower = forward(path).toLowerCase();
    return this.roots.some(([root]) => lower === root.toLowerCase() || lower.startsWith(`${root.toLowerCase()}/`));
  }

  /** Give `path`'s root a neutral prefix unless one already covers it. */
  cover(path: string): void {
    if (this.covered(path)) return;
    this.add(rootOf(path), `/volter-fs/${this.roots.length}`);
  }

  /** Learn the roots of every absolute `/@fs/` path in `text` (a recorded URL or body). */
  learn(text: string): void {
    for (const [, path] of text.matchAll(FS_URL_PATH)) {
      if (!path) continue;
      const absolute = /^[A-Za-z]:\//.test(path) ? path : `/${path.replace(/^\/+/, '')}`;
      if (/^\/(?:volter-view|volter-fs)\//.test(absolute)) continue;
      // Only a path that names a real file is a root to learn: compiled code also carries
      // `/@fs/${…}` templates, and rewriting one of those would break the module.
      let onDisk = absolute;
      try {
        onDisk = decodeURIComponent(absolute);
      } catch {
        /* not URL-encoded */
      }
      if (!existsSync(onDisk)) continue;
      this.cover(onDisk);
    }
  }

  rewrite(text: string): string {
    let out = text;
    const ordered = [...this.roots].sort((a, b) => b[0].length - a[0].length);
    // URL forms first, so a root never becomes `/@fs//neutral`.
    for (const [root, neutral] of ordered) for (const from of spellings(root).fsUrl) out = out.split(from).join(`/@fs${neutral}`);
    for (const [root, neutral] of ordered) for (const from of spellings(root).plain) out = out.split(from).join(neutral);
    return out;
  }
}

/** Payloads that are binary by kind; every other file is read, unless its first bytes hold a NUL. */
const BINARY_FILE = /\.(?:wasm|data|bin|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|glb|gltf\.bin|exr|hdr|ktx2|basis|mp3|ogg|wav|flac|mp4|webm|mov|gz|br|zip|tgz|7z|blend|fbx|pdf)$/i;

export interface LocalPathFinding {
  readonly file: string;
  readonly context: string;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The text as a reader would see it: as written, with `%XX` decoded, and with JSON's escapes
 *  (`\\` and `\/`) undone — a path hides in any of the three. */
function readings(text: string): string[] {
  const decoded = text.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const unescaped = text.replace(/\\\\/g, '\\').replace(/\\\//g, '/');
  return [text, decoded, unescaped];
}

/** Every place under `dir` that still names the building machine: its home directory, its user's
 *  home path, any `/@fs/` URL that is still a real path (anything but `/volter-view/` and
 *  `/volter-fs/`), or an inline source map. */
export function scanForLocalPaths(dir: string, limit = 12): LocalPathFinding[] {
  const home = forward(homedir());
  const user = userInfo().username;
  const homeForms = [home, home.split('/').join('\\\\'), home.split('/').join('\\')].map(escape);
  const userForms = user.length >= 2
    ? [`[A-Za-z]:(?:/|\\\\{1,2})Users(?:/|\\\\{1,2})${escape(user)}(?![A-Za-z0-9])`, `/(?:Users|home)/${escape(user)}(?![A-Za-z0-9])`]
    : [];
  // A real path after `/@fs/` starts like one; code that builds such URLs (`/@fs/${…}`, `"/@fs/" +`)
  // does not.
  const absoluteFs = '/@fs/(?!volter-view/|volter-fs/)[A-Za-z0-9._~%-]';
  const pattern = new RegExp([...homeForms, ...userForms, absoluteFs, 'sourceMappingURL=data:'].join('|'), 'i');
  const findings: LocalPathFinding[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (findings.length >= limit) return;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile() || BINARY_FILE.test(entry.name)) continue;
      const bytes = readFileSync(path);
      if (bytes.subarray(0, 512).includes(0)) continue;
      const text = bytes.toString('utf8');
      for (const reading of readings(text)) {
        const hit = pattern.exec(reading);
        if (!hit) continue;
        findings.push({
          file: relative(dir, path),
          context: reading.slice(Math.max(0, hit.index - 30), hit.index + hit[0].length + 30).replace(/\s+/g, ' '),
        });
        break;
      }
    }
  };
  walk(dir);
  return findings;
}
