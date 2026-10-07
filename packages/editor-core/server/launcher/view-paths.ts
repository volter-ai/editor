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

/** Text files worth reading for paths; everything else is binary payload. */
const TEXT_FILE = /\.(?:m?js|cjs|json|html|css|txt|svg|md|ts|tsx|map|xml|webmanifest)$/i;

export interface LocalPathFinding {
  readonly file: string;
  readonly context: string;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every place under `dir` that still names the building machine: its home directory, its user's
 *  home path, or an absolute `/@fs/` URL. */
export function scanForLocalPaths(dir: string, limit = 12): LocalPathFinding[] {
  const home = forward(homedir());
  const user = userInfo().username;
  const homeForms = [home, home.split('/').join('\\\\'), home.split('/').join('\\')].map(escape);
  const userForms = user.length >= 2
    ? [`[A-Za-z]:(?:/|\\\\{1,2})Users(?:/|\\\\{1,2})${escape(user)}(?![A-Za-z0-9])`, `/(?:Users|home)/${escape(user)}(?![A-Za-z0-9])`]
    : [];
  const pattern = new RegExp([...homeForms, ...userForms, '/@fs/[A-Za-z]:/', '/@fs/(?:Users|home)/'].join('|'), 'i');
  const findings: LocalPathFinding[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (findings.length >= limit) return;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile() || !TEXT_FILE.test(entry.name)) continue;
      const text = readFileSync(path, 'utf8');
      const hit = pattern.exec(text);
      if (!hit) continue;
      const at = hit.index;
      findings.push({
        file: relative(dir, path),
        context: text.slice(Math.max(0, at - 30), at + hit[0].length + 30).replace(/\s+/g, ' '),
      });
    }
  };
  walk(dir);
  return findings;
}
