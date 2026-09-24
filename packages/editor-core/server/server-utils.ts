/**
 * Pure, dependency-light helpers for the editor server.
 *
 * Everything here is side-effect free and unit-testable (see
 * packages/editor/test/server-security.test.ts). The route handlers in
 * editor-server.ts / asset-library-routes.ts delegate their security and
 * correctness checks to these functions so the logic can be verified in
 * isolation.
 */

import { commandLine } from '../src/product-command';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { type CommandResult, relayCommandTimeoutMs } from '@volter/editor-sdk/session/command-table';
import type { UnresolvedConsoleSummary } from './console-ledger';

// ---------------------------------------------------------------------------
// Path containment (S1 / S5 / S6)
// ---------------------------------------------------------------------------

/**
 * True if `child` resolves to the same path as `parent`, or to a path strictly
 * inside it. Defends against `..` traversal and sibling-prefix attacks where a
 * naive `startsWith` would accept `/a/public-secrets` as inside `/a/public`.
 */
export function isPathInside(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  if (resolvedChild === resolvedParent) return true;
  const parentWithSep = resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep;
  return resolvedChild.startsWith(parentWithSep);
}

/** Resolve both sides through the filesystem before accepting containment.
 * Lexical containment alone lets an in-root symlink reach another worktree or
 * an arbitrary host directory. Existing read targets must pass this check
 * immediately before bytes are read. */
export async function isCanonicalPathInside(parent: string, child: string): Promise<boolean> {
  if (!isPathInside(parent, child)) return false;
  try {
    const [canonicalParent, canonicalChild] = await Promise.all([
      realpath(parent),
      realpath(child),
    ]);
    return isPathInside(canonicalParent, canonicalChild);
  } catch {
    return false;
  }
}

/** Validate the directory chain used to create or replace a file. The final
 * leaf may not exist yet, so the nearest existing ancestor is canonicalized.
 * This rejects an intermediate symlink that would carry an atomic temp-file
 * write outside the project root. */
export async function isCanonicalWritePathInside(parent: string, child: string): Promise<boolean> {
  if (!isPathInside(parent, child)) return false;
  let ancestor = dirname(child);
  for (;;) {
    try {
      const [canonicalParent, canonicalAncestor] = await Promise.all([
        realpath(parent),
        realpath(ancestor),
      ]);
      return isPathInside(canonicalParent, canonicalAncestor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      const next = dirname(ancestor);
      if (next === ancestor) return false;
      ancestor = next;
    }
  }
}

// ---------------------------------------------------------------------------
// Asset source + host allowlists (S1 / S2)
// ---------------------------------------------------------------------------

export const ALLOWED_ASSET_SOURCES = ['polyhaven', 'ambientcg', 'local'] as const;
export type AllowedAssetSource = (typeof ALLOWED_ASSET_SOURCES)[number];

/** Allowlist the `source` segment so it can never escape the library directory. */
export function isAllowedAssetSource(source: unknown): source is AllowedAssetSource {
  return (
    typeof source === 'string' && (ALLOWED_ASSET_SOURCES as readonly string[]).includes(source)
  );
}

/** Known CDN / API domains the server is permitted to fetch from. */
export const ASSET_HOST_ALLOWLIST = [
  'polyhaven.com',
  'polyhaven.org',
  'ambientcg.com',
  'struffelproduction.com', // ambientCG's download CDN
];

/**
 * True if `host` is an IPv4/IPv6 literal inside a private, loopback,
 * link-local, or otherwise non-routable range. Used to block SSRF to metadata
 * endpoints (e.g. 169.254.169.254) and internal services.
 */
export function isPrivateOrLinkLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();

  if (h === 'localhost' || h.endsWith('.localhost')) return true;

  // IPv6 loopback / link-local / unique-local.
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv4-mapped IPv6, e.g. ::ffff:169.254.169.254
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrLinkLocalHost(mapped[1]!);

  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true; // 0.x, private, loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Validate a body-supplied download URL: must be HTTPS, point at an allowlisted
 * CDN host, and not resolve to a private / link-local literal IP. (S2)
 */
export function isAllowedAssetHost(urlString: string): boolean {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (isPrivateOrLinkLocalHost(host)) return false;
  return ASSET_HOST_ALLOWLIST.some((d) => host === d || host.endsWith(`.${d}`));
}

// ---------------------------------------------------------------------------
// AppleScript escaping (S4)
// ---------------------------------------------------------------------------

// Matches ASCII control characters (U+0000–U+001F).
// biome-ignore lint/suspicious/noControlCharactersInRegex: this security boundary intentionally strips the full ASCII control range.
const CONTROL_CHARS = /[\u0000-\u001f]/g;

/**
 * Escape a string for safe inclusion inside a double-quoted AppleScript literal.
 * Backslashes must be doubled BEFORE quotes are escaped, otherwise an injected
 * trailing backslash neutralises the closing quote. Control characters are
 * stripped so they can't break out of the `-e` argument.
 */
export function escapeAppleScriptString(s: string): string {
  return s.replace(CONTROL_CHARS, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Content-Disposition filename sanitization (S7)
// ---------------------------------------------------------------------------

// Control chars, double-quote, and backslash are unsafe in a quoted filename.
// biome-ignore lint/suspicious/noControlCharactersInRegex: content-disposition must reject the full ASCII control range.
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f"\\]/g;

/**
 * Reduce an arbitrary name to a safe `filename="..."` value: basename only, no
 * path separators, quotes, backslashes, or control characters.
 */
export function sanitizeContentDispositionFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(UNSAFE_FILENAME_CHARS, '').trim();
  return cleaned || 'download';
}

// ---------------------------------------------------------------------------
// /@fs served-extension allowlist (S5)
// ---------------------------------------------------------------------------

export const SERVABLE_FS_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'wasm',
  'css',
  'glsl',
  'vert',
  'frag',
]);

/** Restrict /@fs serving to source/asset file types (never .env, keys, etc.). */
export function isServableFsExtension(ext: string): boolean {
  return SERVABLE_FS_EXTENSIONS.has(ext.toLowerCase());
}

/** `/@fs` is a module transport, not a general project-file browser. Keep the
 * private editor/Git estates and dotenv variants out even when their final
 * suffix (for example `.vgai/session.json` or `.env.production.json`) would
 * otherwise pass the source-extension allowlist. */
export function isServableFsPath(path: string): boolean {
  return !path.split(/[\\/]+/).some((segment) => {
    const normalized = segment.toLowerCase();
    return normalized === '.vgai' || normalized === '.git' || normalized.startsWith('.env');
  });
}

/** A path inside a Vite CACHE DIRECTORY (`node_modules/.vite`,
 * `node_modules/.vite-editor/v2-<key>`, …), which holds the dependency
 * optimizer's OUTPUT.
 *
 * Those files are written asynchronously: on a cold boot the browser requests
 * `deps/react-dom_client.js?v=<hash>` while the optimizer is still bundling it,
 * and Vite's own middleware is the owner that WAITS for the run to finish (and
 * answers `504 Outdated Optimize Dep`, which makes the client reload, when the
 * hash went stale). A `stat`-based "this module is missing" answer is therefore
 * wrong here even though the file genuinely is not on disk yet — it races the
 * optimizer and reports a transient absence as a permanent one.
 *
 * Measured 2026-08-20: the missing-module 404 below fired on
 * `react_jsx-dev-runtime.js` and `react-dom_client.js` mid-optimization, so the
 * editor shell never got React, the page sat on "Opening project…" forever, and
 * `vgai doctor` waited out its whole budget for a play control that could never
 * mount. */
export function isViteDepCachePath(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => segment.toLowerCase().startsWith('.vite'));
}

/** WRITABLE project-root `.vgai` paths — the provenance ledger only.
 * Session ownership, collaboration persistence, catalogs and future private
 * metadata must never become reachable merely because they share a directory.
 *
 * Deliberately NARROWER than {@link isReadableVgaiPath}: run evidence below is
 * readable and not writable, because its project-owned Node helper files real
 * invocations and letting the panel write would let it invent a run nothing
 * ran. */
export function isPublicVgaiLedgerPath(path: string): boolean {
  return path === '.vgai/provenance.json';
}

/** Project-root editor metadata/cache paths the browser may regenerate. */
export function isWritableVgaiEditorPath(path: string): boolean {
  return (
    isPublicVgaiLedgerPath(path) ||
    path === '.vgai/thumbnails.json' ||
    /^\.vgai\/cache\/document-previews\/[a-f0-9]{64}\.png$/.test(path)
  );
}

/** READABLE project-root `.vgai` paths — the public ledger only.
 *
 * Every other `.vgai/` file stays unreachable, which is why this is an
 * allowlist of literals rather than a prefix. */
export function isReadableVgaiPath(path: string): boolean {
  return isWritableVgaiEditorPath(path);
}

export const PROJECT_RESOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  'avif',
  'bin',
  'bmp',
  'csv',
  'cube',
  'dds',
  'exr',
  'fbx',
  'flac',
  'frag',
  'gif',
  'glb',
  'gltf',
  'glsl',
  'hdr',
  'jpeg',
  'jpg',
  'json',
  'ktx2',
  'm4a',
  'mp3',
  'mp4',
  'mtl',
  'obj',
  'ogg',
  'ply',
  'spv',
  'stl',
  'svg',
  'tga',
  'tmj',
  'txt',
  'vert',
  'wasm',
  'wav',
  'webm',
  'webp',
  'yaml',
  'yml',
]);

/**
 * Project-owned Asset Lab documents may span ordinary authored resources, but
 * they may not turn the document serializer into a second source-code or
 * project-control writer. Keep this route below the two estates where authored
 * resources live and leave executable source to the checksum-guarded
 * `/__ui-source/*` seam.
 */
export function isWritableProjectResourcePath(path: string): boolean {
  if (path === '.vgai/thumbnails.json') return true;
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const segments = path.split('/');
  if (
    segments.some((segment) => {
      const normalized = segment.toLowerCase();
      return (
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.') ||
        normalized === 'node_modules' ||
        normalized === 'vendor'
      );
    })
  ) {
    return false;
  }
  if (segments[0] !== 'src' && segments[0] !== 'public') return false;
  const filename = segments.at(-1) ?? '';
  const extension = filename.includes('.') ? (filename.split('.').at(-1) ?? '').toLowerCase() : '';
  return PROJECT_RESOURCE_EXTENSIONS.has(extension);
}

// ---------------------------------------------------------------------------
// Origin allowlist for mutating editor routes (S3)
// ---------------------------------------------------------------------------

/**
 * The origin of the Code-OSS DESKTOP workbench page — Electron's privileged
 * `vscode-file` scheme with the fixed authority it mints for the app root. It is
 * the ONE origin other than this server's own that ever hosts the editor
 * (docs/CODE-OSS.md §Desktop): on desktop the workbench is loaded off disk by
 * Electron and the session stays on loopback http, so the two cannot be made one
 * the way the web shape's proxy makes them one.
 *
 * Allowing it where a loopback origin is allowed is not a widening of the
 * drive-by surface this guard exists for: no web page can be served from
 * `vscode-file://vscode-app` — the scheme is registered by the Electron main
 * process and its handler reads the app's own files — so an attacker's page can
 * never carry this Origin.
 */
export const DESKTOP_FRAME_ORIGIN = 'vscode-file://vscode-app';

/**
 * THE SCRIPTS A CROSS-ORIGIN-ISOLATED FRAME LOADS **NO-CORS** FROM THIS
 * SESSION, and the one header that lets it: `Cross-Origin-Resource-Policy`.
 *
 * The Code-OSS desktop frame runs cross-origin-isolated (`--enable-coi`, which
 * the Blender worker needs for `SharedArrayBuffer`), and such a realm refuses
 * every cross-origin subresource fetched in `no-cors` mode unless the response
 * says out loud that it may be embedded. CORS does not cover these: `fetch`
 * and a module `import` are cors-mode and already pass, but `importScripts`
 * inside a worker is not, and that is exactly how two of this session's
 * scripts are loaded on that page:
 *
 *  - `/__editor/tab-heartbeat.js` — the tab's heartbeat worker, loaded through
 *    the frame's `blob:` doorway (docs/CODE-OSS.md §Boot, DESKTOP), and
 *  - `/__editor/blender-wasm/blender_browser.js` — the Emscripten glue, which
 *    Blender's own pthreads load as a CLASSIC worker from this same URL.
 *
 * Both were measured failing on 2026-09-19: the heartbeat worker died on
 * `net::ERR_BLOCKED_BY_RESPONSE` before its first line (the VS Code window sat
 * blessed, answering commands, and never beating), and the pthread that runs
 * Blender's `main()` never started, so the first bpy call never answered and
 * nothing anywhere reported an error.
 *
 * `cross-origin` and not `same-site`: `vscode-file://vscode-app` is a scheme of
 * its own, so nothing narrower can name it. It is safe on exactly these
 * responses — plain, secret-free program text this session serves a frame on
 * purpose — and is set nowhere else.
 */
export function allowCrossOriginFrameEmbedding(res: {
  setHeader(name: string, value: string): void;
}): void {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

/** True for loopback hostnames (localhost / 127.0.0.0/8 / ::1). */
export function isLoopbackHostname(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * CSRF / drive-by defense for mutating `/__editor/*` routes. A browser always
 * sends an `Origin` on cross-site POSTs; if present it must be a loopback origin,
 * the Code-OSS desktop frame ({@link DESKTOP_FRAME_ORIGIN}), or an
 * explicitly-allowed host. Non-browser clients (the CLI/SDK using Node `fetch`)
 * send no `Origin` and are allowed.
 */
export function isAllowedEditorOrigin(
  origin: string | undefined,
  extraAllowedHosts: string[] = [],
): boolean {
  if (!origin) return true;
  if (origin === DESKTOP_FRAME_ORIGIN) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (isLoopbackHostname(host)) return true;
  return extraAllowedHosts.some((h) => h.toLowerCase() === host);
}

// ---------------------------------------------------------------------------
// Installed-package source resolution (B1b, packaging plan §3(b)1)
// ---------------------------------------------------------------------------

/**
 * Resolve `packageName`'s own `src/` directory as INSTALLED in `fromDir`'s
 * `node_modules` — Node's own resolution algorithm, rooted at `fromDir` (a
 * project directory), not at wherever this server process's own code lives.
 *
 * Why: a project that pins `@vgai/game-runtime@0.3.0` must be served ITS 0.3.0
 * source, never a copy baked into whatever package happens to be running the
 * editor server — otherwise the exact version-skew class the pin exists to
 * kill (an editor silently serving a different engine version than the one
 * the project declares) reappears one layer down, inside script-serving.
 * `packageName`'s `exports` map must publish a `./package.json` entry for
 * `require.resolve` to find it.
 *
 * Returns `null` (never throws) when `packageName` isn't resolvable from
 * `fromDir` — no project open, a pre-Phase-B project with no such
 * dependency, or a project that hasn't `npm install`ed yet. Callers fall back
 * to a checkout-relative default in that case.
 */
export function resolveInstalledPackageSrcDir(fromDir: string, packageName: string): string | null {
  try {
    const req = createRequire(join(fromDir, 'package.json'));
    const pkgJsonPath = req.resolve(`${packageName}/package.json`);
    return join(dirname(pkgJsonPath), 'src');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bind host + listen-error helpers (S3 / SC5)
// ---------------------------------------------------------------------------

/**
 * Resolve the interface to bind to. Native hosts default to loopback. WSL is
 * the exception: the editor process runs in WSL while the browser runs on
 * Windows, and Windows cannot reach a listener bound only to WSL's loopback
 * interface. Binding the WSL listener on all of its interfaces lets Windows'
 * localhost forwarding reach it; the editor's origin checks still protect
 * mutating routes. An explicit host always wins.
 */
export function resolveBindHost(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicitHost = env['VGAI_EDITOR_HOST'] || env['EDITOR_HOST'];
  if (explicitHost) return explicitHost;

  const isWsl = platform === 'linux' && Boolean(env['WSL_INTEROP'] || env['WSL_DISTRO_NAME']);
  return isWsl ? '0.0.0.0' : '127.0.0.1';
}

/**
 * Format a friendly message for a server `listen` error (notably EADDRINUSE).
 *
 * `portEnvVar` is REQUIRED because the editor servers do not read the
 * same variable, and the message used to hardcode the wrong one. `dev.ts` (what
 * `npm run dev` runs) honours only `VGAI_EDITOR_PORT`;
 * `packaged.ts` honours `PORT` then `VGAI_EDITOR_PORT`. The old text
 * said "set PORT / VGAI_EDITOR_HOST" for both — so on the most common path
 * it named a variable `dev.ts` ignores, and offered a HOST variable as the way
 * out of a PORT conflict. Following it verbatim reproduces the exact error it
 * was printed to resolve (confirmed 2026-07-30: `PORT=5311 npm run dev` bound
 * the built-in default again and died the same way).
 */
export function friendlyListenError(
  err: NodeJS.ErrnoException,
  port: number,
  host: string,
  portEnvVar: string,
): string {
  if (err.code === 'EADDRINUSE') {
    return (
      `Port ${port} is already in use on ${host}. ` +
      `Another editor instance may already be running — stop it, or set ${portEnvVar} ` +
      `to a free port (or VGAI_EDITOR_HOST to a different address) and try again.`
    );
  }
  if (err.code === 'EACCES') {
    return `Permission denied binding to ${host}:${port}. Try a port above 1024.`;
  }
  return `Failed to start server on ${host}:${port}: ${err.message}`;
}

// ---------------------------------------------------------------------------
// File-move disambiguation (SC2)
// ---------------------------------------------------------------------------

export interface MoveCandidate {
  hash: string;
  size: number;
  timestamp: number;
}

/**
 * A delete+create pair is treated as a move (and triggers scene-ref rewriting)
 * only when it is unambiguous: the added file must match a pending unlink by
 * BOTH content hash AND byte size, that match must be unique, and it must fall
 * within the move window. Hash-only matching risks rewriting scene files on an
 * unrelated delete+create that happens to collide. (SC2)
 */
export function findUniqueMoveMatch<T extends MoveCandidate>(
  candidates: readonly T[],
  addedHash: string,
  addedSize: number,
  now: number,
  windowMs: number,
): T | null {
  const matches = candidates.filter(
    (c) => c.hash === addedHash && c.size === addedSize && now - c.timestamp < windowMs,
  );
  return matches.length === 1 ? matches[0]! : null;
}

// ---------------------------------------------------------------------------
// Manifest write validation (A4, D8) — POST /__editor/manifest
// ---------------------------------------------------------------------------

export interface ManifestWriteBody {
  path?: unknown;
  content?: unknown;
}

export type ManifestWriteValidation =
  | { ok: true; content: string }
  | { ok: false; status: number; error: string };

/**
 * Validate a `POST /__editor/manifest` request body. The route HARD-CODES the
 * write destination (`join(projectRoot, 'vgai.project.json')`) — this function
 * never returns a path, only a green light + the (already-string, already-
 * valid-JSON) content to write, so there is no way for a caller to derive the
 * destination from user input even by accident. Rejects: no project open,
 * any `path` other than the literal `'vgai.project.json'` (traversal, a
 * different filename, an absolute path — all rejected identically), a
 * non-string `content`, and content that fails to `JSON.parse`.
 */
export function validateManifestWrite(
  projectRoot: string,
  engineRoot: string,
  body: ManifestWriteBody,
): ManifestWriteValidation {
  if (projectRoot === engineRoot) {
    return { ok: false, status: 400, error: 'No project open.' };
  }
  if (body.path !== undefined && body.path !== 'vgai.project.json') {
    return {
      ok: false,
      status: 400,
      error: "Invalid path — only 'vgai.project.json' may be written.",
    };
  }
  if (typeof body.content !== 'string') {
    return { ok: false, status: 400, error: 'Invalid content — expected a JSON string.' };
  }
  try {
    JSON.parse(body.content);
  } catch {
    return { ok: false, status: 400, error: 'Content is not valid JSON.' };
  }
  return { ok: true, content: body.content };
}

// ---------------------------------------------------------------------------
// Project src/ watcher classification (W6a)
// ---------------------------------------------------------------------------

/**
 * The naming convention that MAKES a module an editor contribution.
 *
 * Nothing enumerates contribution modules any more, so the filename is the
 * whole declaration that a file is one. Each suffix names its contribution
 * point (`workspace.document`, `selection.inspector`, `asset.inspector`,
 * `generation.result`, `workspace.utility`, `workspace.analytics`) — the module still exports the
 * authoritative `point`; this only decides what gets looked at.
 *
 * The convention has to be exact, because a file that matches but exports no
 * component is a LOUD error, not a silent skip. `builder-document.tsx` (the
 * shared `createBuilderDocument` helper that ships beside real documents) is
 * the live proof: a `-document` suffix would sweep it in. Only the dotted form
 * counts.
 */
// The convention itself lives in `@volter/editor-sdk/session/
// tool-contribution-convention` so every program that asks shares the ONE
// definition; re-exported here so server importers keep their import site.
export {
  isToolContributionModule,
  TOOL_CONTRIBUTION_SUFFIXES,
} from '@volter/editor-sdk/session/tool-contribution-convention';

import {
  isEditorLanePath,
  isToolContributionModule,
} from '@volter/editor-sdk/session/tool-contribution-convention';

/**
 * Which editor list a `src/**` add/unlink invalidates, or `null` if it's
 * irrelevant. Feeds the editor-server's second `src/`-scoped chokidar
 * watcher (`startWatcher()` in editor-server.ts) so a NEW registered tool
 * module shows up in the dock without a full editor reload (spec §7 W4 field
 * note c). `stories` (C3, spec §9) is the same physics for a new/removed
 * `*.stories.tsx`/`*.stories.ts` anywhere under `src/` — the Stories tab.
 *
 * Data assets are deliberately NOT classified here: the data capability
 * rescans on mount, on activation and on focus, which is the same rescan a
 * watcher event would have triggered.
 *
 * `relPath` is project-root-relative with forward slashes (same convention
 * `/__editor/data-files` already uses).
 */
export function classifyProjectSrcPath(relPath: string): 'tools' | 'stories' | null {
  if (
    isEditorLanePath(relPath) &&
    (relPath.endsWith('.tool.ts') ||
      relPath.endsWith('.tool.js') ||
      isToolContributionModule(relPath))
  )
    return 'tools';
  // C3 (spec §9) — conventional CSF story files, colocated anywhere under one
  // of the project's STORY SOURCE DIRS ({@link projectStorySourceDirs}), not
  // confined to one subfolder like tools/data. `src/…` is the in-project form;
  // a leading `../` is the out-of-project one, which arises only for a project
  // whose manifest declares a root entry outside its own folder (a
  // repo-vendored game). The caller's watcher is rooted at exactly those dirs,
  // so a `../`-prefixed path here is under one by construction.
  if (
    (relPath.startsWith('src/') || relPath.startsWith('../')) &&
    (relPath.endsWith('.stories.tsx') || relPath.endsWith('.stories.ts'))
  ) {
    return 'stories';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Where a project's authored source actually lives
// ---------------------------------------------------------------------------

/**
 * Every directory tree that holds the open project's own authored source —
 * what `/__editor/story-files` scans for `*.stories.tsx`/`*.stories.ts`.
 *
 * `<projectRoot>/src` is the answer for every project whose roots live inside
 * its own folder, which is every scaffolded project and every `examples/<id>`.
 * It is NOT the answer in general, and assuming it was is what left a whole
 * class of project storyless by construction: a manifest may declare a root
 * whose `entry` resolves OUTSIDE the project folder — a repo-vendored game is
 * exactly this shape (`packages/editor/src/ingest/games/<id>/` holds the
 * manifest and the host shim; the game's source is
 * `vendor/games/<id>/src/`). Stories colocated with those components sat on
 * disk and no scan ever looked at them.
 *
 * So the scan set is DERIVED FROM THE MANIFEST: `<projectRoot>/src`, plus, for
 * every `entry` any root declares that lands outside `projectRoot`, that
 * entry's own source tree — its nearest ancestor named `src` when it has one
 * (so the whole game's source is covered, not just the folder its entry file
 * happens to sit in), else the entry's own directory. Entries INSIDE the
 * project add nothing: `<projectRoot>/src` already covers them.
 *
 * Pure over an already-parsed manifest so it is unit-testable with no disk;
 * the caller reads and parses `vgai.project.json` itself. Every returned path
 * is absolute and de-duplicated, and a nested directory is dropped when an
 * ancestor is already in the set so nothing is scanned twice.
 */
export function projectStorySourceDirs(projectRoot: string, manifest: unknown): string[] {
  const root = resolve(projectRoot);
  const dirs = [join(root, 'src')];

  for (const entry of declaredRootEntries(manifest)) {
    const absolute = resolve(root, entry);
    if (isPathInside(root, absolute)) continue;
    dirs.push(sourceTreeOf(absolute));
  }

  const unique: string[] = [];
  for (const dir of dirs) {
    if (unique.some((kept) => kept === dir || isPathInside(kept, dir))) continue;
    unique.push(dir);
  }
  return unique;
}

/** Every `entry` string declared anywhere under the manifest's `roots` — a
 *  root's own `entry`, and the nested ones an adapter descriptor carries (an
 *  root's `world.entry`). Walked generically rather than
 *  by a fixed path list: `entry` means the same thing at every depth, and a
 *  hard-coded shape here would go stale the next time the adapter descriptor
 *  grows a level. */
function declaredRootEntries(manifest: unknown): string[] {
  const out: string[] = [];
  const roots = (manifest as { roots?: unknown } | null)?.roots;
  if (!Array.isArray(roots)) return out;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'entry' && typeof value === 'string' && value.length > 0) out.push(value);
      else visit(value);
    }
  };
  visit(roots);
  return out;
}

/** The source TREE an out-of-project entry belongs to: its nearest ancestor
 *  directory named `src`, else the directory the entry file sits in. */
function sourceTreeOf(entryPath: string): string {
  let dir = dirname(entryPath);
  let parent = dirname(dir);
  while (parent !== dir) {
    if (dir.endsWith(`${sep}src`)) return dir;
    dir = parent;
    parent = dirname(dir);
  }
  return dirname(entryPath);
}

// ---------------------------------------------------------------------------
// Watcher polling resolution (#131)
// ---------------------------------------------------------------------------

/**
 * Chokidar options fragment deciding whether an editor-server watcher polls.
 *
 * #131: on WSL drvfs mounts (`/mnt/<drive>/…`) inotify never fires, so every
 * SSE broadcast the editor UI lives on (`assets-changed`, `asset-moved`,
 * `tool/data/story-files-changed`, manifest validation) was structurally dead
 * there — the owner watched an agent author a scene and the open editor never
 * repainted until a manual browser refresh. dev.ts already auto-polls VITE's
 * watcher on drvfs (`startProjectPollWatcher`) but deliberately never feeds
 * these watchers (see the decoupling note at the srcWatcher construction), so
 * they need their own decision. Chokidar's scoped `usePolling` is safe here
 * where Vite-wide polling was not: these watchers cover only a game project's
 * `public/`+`src/` trees and one manifest file, not the whole engine tree
 * that made drvfs stat-flood starve the event loop (dev.ts field note
 * 2026-07-10).
 *
 * Same env contract as dev.ts's poller: `VGAI_WATCH_POLL=0` forces off
 * anywhere, `=1` forces on (default 1000ms interval), `=<ms>` forces on with
 * that interval. Unset: auto-enable iff `root` sits on a drvfs mount
 * (linux + `/mnt/<drive>/`). Pass `root: null` to opt out of auto-detection
 * (engine-repo-rooted watchers, where `public/` includes the vendored-game
 * trees and polling would be needlessly broad).
 */
export function resolveWatcherPollOptions(
  root: string | null,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): { usePolling: true; interval: number } | Record<string, never> {
  const raw = env['VGAI_WATCH_POLL'];
  if (raw !== undefined && raw !== '') {
    if (raw === '0') return {};
    const ms = Number(raw);
    return { usePolling: true, interval: Number.isFinite(ms) && ms > 1 ? ms : 1000 };
  }
  const onDrvfs = root !== null && platform === 'linux' && /^\/mnt\/[a-z]\//i.test(root);
  return onDrvfs ? { usePolling: true, interval: 1000 } : {};
}

// ---------------------------------------------------------------------------
// Command-relay response shaping (SC1)
// ---------------------------------------------------------------------------

/**
 * A relay command's SETTLED result: the tab's own answer
 * ({@link CommandResult}, declared once in `src/command-table.ts` and imported
 * by both ends of the wire), or the server's verdict for a command no tab
 * answered.
 *
 * `timedOut` is the one field the server adds, because the server is the only
 * thing that can produce it — no browser handler has a concept of "nobody
 * answered". Every site that sets it (`control-plane.ts`) pairs it with
 * `ok: false`, and {@link commandResponseFor} reads it only after `ok` is
 * false, which is why it can be an optional marker on top of a REQUIRED `ok`
 * rather than a second half-truth beside an optional one.
 */
export interface RelayedCommandResult extends CommandResult {
  timedOut?: boolean;
}

/**
 * The relay's per-command WORK budget and the ANSWER SHAPE both live in
 * `src/command-table.ts`, beside the vocabulary they are columns of —
 * re-exported here because the server's relay is their only reader and this is
 * where that reader looks. The delivery budget below is a different clock and
 * stays here.
 */
export { type CommandResult, relayCommandTimeoutMs };

/**
 * How long the relay waits for the editor tab to say it RECEIVED a command,
 * as opposed to finishing it.
 *
 * The long budgets above are for the WORK — a game's async `setup()`, a
 * teardown chain, a sheet of rasterized stories. They were also, silently,
 * the budget for DELIVERY: a tab that stopped answering the SSE command
 * channel altogether made `vgai play` sit for the full 120 seconds and then
 * report "Command timed out — editor connected but did not respond", a
 * sentence that names no cause and no remedy (this file's own note above
 * records the same message sending a real investigation looking for a dead
 * editor). Measured on a hidden tab: a healthy play acks in ~350 ms with
 * `requestAnimationFrame` fully parked and timers clamped to a minute, so a
 * play still silent after this window is not a slow boot — it is a tab that
 * is not running its command listener.
 *
 * The receipt (`command-listener.ts` posts it the instant the SSE event
 * arrives, BEFORE it starts the work) separates the two: acknowledged, and
 * the command's full budget stands untouched; unacknowledged, and the caller
 * learns in seconds with the facts the server already holds.
 *
 * The "not a slow boot" inference above holds only when the tab's SSE
 * socket is GONE. Measured 2026-08-09 on a loaded box (load ~19, cold
 * editor graph): a live tab's main thread blocked for 60-100s mid-boot, the
 * SSE command event sat queued the whole time, and every command executed
 * the moment the thread freed — receipts included. So a live socket EXTENDS
 * the wait (up to {@link RELAY_DELIVERY_MAX_WAIT_MS}) instead of failing at
 * this first window; only a dead socket or the max wait ends it.
 */
export const RELAY_DELIVERY_ACK_MS = 8000;

/**
 * Ceiling for the receipt wait while the controller tab's SSE socket stays
 * open. A blocked-but-alive main thread (a cold editor boot under machine
 * load) holds its socket and runs the queued command when it unblocks —
 * measured at 60-100s on 2026-08-09, when five consecutive 8s windows
 * false-failed a play that then executed anyway (and the caller's blind
 * resends, queued behind it, stopped the game it had just started). 45s
 * outlasts an ordinary cold-boot stall while still naming a genuine zombie
 * tab (socket open, listener never installed) in under a minute instead of
 * the command's 120s budget.
 *
 * A CEILING, not a fixed wait: the caller clamps it to the type's own
 * {@link relayCommandTimeoutMs}, because `stop` (30s),
 * `capture-asset-preview` (30s) and `bridge-screenshot` (15s) are all
 * shorter. Unclamped, their own timer would always win and those callers
 * would get the generic "editor connected but did not respond" — the very
 * message the receipt exists to replace.
 */
export const RELAY_DELIVERY_MAX_WAIT_MS = 45_000;

/**
 * The delivery-acknowledgement window for one command type, or `null` when
 * the type has none.
 *
 * Only types whose own budget EXCEEDS {@link RELAY_DELIVERY_ACK_MS} get one:
 * an ordinary 5s command already fails faster than any ack timer could, so
 * arming one would add a second timer that can never be the informative one —
 * the same "keep the informative timer the one that fires" rule
 * {@link relayCommandTimeoutMs} states for its client-side counterparts.
 */
export function relayCommandAckDeadlineMs(type: unknown): number | null {
  return relayCommandTimeoutMs(type) > RELAY_DELIVERY_ACK_MS ? RELAY_DELIVERY_ACK_MS : null;
}

/**
 * The refusal for a command whose controlling tab went away before answering.
 *
 * ONE constant because two different paths emit it — the SSE `close`
 * handler's `failCommandsOwnedBy`, and the receipt window when it finds the
 * socket already gone — and because a THIRD place, in another package, reads
 * it: the CLI decides a play is safe to resend by matching a fragment of this
 * sentence (`vgai-cli/src/play-retry.ts`, `TRANSIENT_RELAY_ERRORS`). Drift
 * between copies would not fail a build or a type check; it would silently
 * turn a retryable disconnect into a dead end. `play-retry.test.ts` pins the
 * cross-package half by running this exact string through that matcher.
 */
export const CONTROLLER_DISCONNECTED_MESSAGE =
  'The editor tab controlling this command disconnected before reporting a result.';

/** What the server knows about the tab it handed a command to. Every field is
 *  already in the `/__editor/state` snapshot that tab POSTs. */
export interface UnacknowledgedCommandContext {
  /** The command type that went unacknowledged. */
  readonly type: unknown;
  /** Page visibility last reported by that tab, or `null` if it never reported. */
  readonly visibility: 'visible' | 'hidden' | null;
  /** Whether that tab last reported window focus; `null` if it never reported. */
  readonly focused: boolean | null;
  /** Milliseconds since that tab last POSTed anything, or `null` if never. */
  readonly silentForMs: number | null;
  /** How long the relay actually waited for the receipt before giving up —
   *  the type's clamped ceiling, so it varies by command. */
  readonly waitedMs: number;
  /**
   * Age of the last protocol pong on that tab's control socket, or `null`
   * when the transport has none (the SSE stream and the share tunnel's
   * bridge). A pong is answered by the browser's NETWORK stack, so a fresh
   * one alongside app-level silence is positive evidence of the blocked-main-
   * thread case rather than an inference from it.
   */
  readonly lastPongAgeMs?: number | null;
  /**
   * What the main-thread echo said. `'unanswered'` means the page's inline
   * bootstrap responder — attached before any module loads — did not reply,
   * so the thread really is blocked. `'answered'` is the opposite and much
   * worse news: the thread is free and still did not pick the command up, so
   * the tab's command listener is not running. `'unavailable'` is the SSE /
   * tunnel transport, which cannot ask.
   */
  readonly mainThreadEcho?: 'answered' | 'unanswered' | 'unavailable';
}

/**
 * The refusal for a command the controlling tab never acknowledged.
 *
 * Names the condition (how long that tab has been silent, what it was
 * showing) and the remedy, because the generic timeout named neither. It
 * deliberately does NOT blame page visibility: a hidden tab runs commands
 * fine (measured — see {@link RELAY_DELIVERY_ACK_MS}), so "your tab is
 * hidden" would send the reader to foreground a tab that was never the
 * problem. Visibility is reported as one observation beside the others.
 *
 * What it must NOT claim is that nothing was started. The old wording did,
 * and it was false: a main thread blocked by a cold boot under load holds
 * its socket, keeps the SSE event queued, and runs the command when it
 * unblocks (measured 2026-08-09 — five refusals in a row, each of whose
 * plays later executed, and the caller's blind resends then stopped the
 * game). So this says the command is queued and warns AGAINST resending.
 *
 * There is deliberately no second, tab-is-gone ending here: a controller
 * whose socket dies is settled by `failCommandsOwnedBy` on the `close`
 * handler, with its own message, before this window can expire. "Its
 * connection is still open" is therefore provable rather than assumed.
 *
 * On the duplex control socket the diagnosis stops being an inference. The
 * pong age proves the transport is live, and the main-thread echo separates
 * the two endings the old single sentence had to merge: `'unanswered'` is a
 * genuinely blocked thread (queued, will run, do not resend), `'answered'` is
 * a responsive tab whose command listener is not running (queued behind
 * nothing — a reload is the actual remedy). Both stay NON-transient for
 * `vgai-cli`'s resend matcher: neither is a lost command.
 */
export function unacknowledgedCommandMessage(context: UnacknowledgedCommandContext): string {
  const waited = (context.waitedMs / 1000).toFixed(0);
  const silence =
    context.silentForMs === null
      ? 'has never reported any state'
      : `last reported state ${(context.silentForMs / 1000).toFixed(1)}s ago`;
  const presence =
    context.visibility === null
      ? 'presence unknown'
      : `page ${context.visibility}, ${context.focused ? 'focused' : 'unfocused'}`;
  const pong =
    typeof context.lastPongAgeMs === 'number'
      ? `, socket pong ${(context.lastPongAgeMs / 1000).toFixed(1)}s ago`
      : '';
  const opening =
    `The editor tab did not pick up "${String(context.type)}" within ${waited}s. Its connection ` +
    `is still open (${presence}${pong}) and it ${silence}`;
  if (context.mainThreadEcho === 'answered') {
    return (
      `${opening} — but its main thread ANSWERED a liveness echo, so the thread is not blocked ` +
      `and the tab simply is not running a command listener. The command stays queued there and ` +
      `will not run by itself, so do NOT resend it blindly: reload the tab, or re-run ` +
      `${commandLine('edit')} (which reuses the session and self-heals the tab).`
    );
  }
  const evidence =
    context.mainThreadEcho === 'unanswered'
      ? ` — its main thread did not answer a liveness echo either; the cause has not been established`
      : ` — main-thread liveness was not measured`;
  return (
    `${opening}${evidence}. The command is queued in that tab and may still run when it ` +
    `unblocks, so do NOT resend it blindly. Watch ${commandLine('status')} for fresh state; if the tab ` +
    `stays silent, reload it or re-run ${commandLine('edit')} (which reuses the session and self-heals ` +
    `the tab).`
  );
}

// ---------------------------------------------------------------------------
// Command-listener health (P36)
// ---------------------------------------------------------------------------

/**
 * What the server has MEASURED about one page-load's command listener.
 *
 * The gap this closes: presence is owned by the tiny pre-React entry
 * (`src/early-editor-presence.ts`), which opens the control channel before any
 * module loads, while the listener that actually executes commands attaches
 * much later (`connectCommandListener`, once the whole React graph is up). So a
 * page can beat, hold a live socket, count as PRESENT and BLESSED — and be
 * unable to run anything. During the incident this comes from, `vgai status`
 * answered happily for eight minutes about a session in exactly that state; the
 * only way to learn the truth was to issue a command and watch it hang.
 *
 * Every field is a timestamp the server already stamps for its own reasons. No
 * field is inferred, and nothing here guesses when one is absent.
 */
export interface CommandListenerFacts {
  /** When this page-load reported its listener ATTACHED, or `null` if it never
   *  has. Cleared when the page reports it detaching. */
  readonly attachedAt: number | null;
  /** When the relay last handed this page a command, or `null`. */
  readonly lastRelayAt: number | null;
  /** When this page last acknowledged RECEIPT of a relayed command, or `null`. */
  readonly lastReceiptAt: number | null;
}

/** The standing health verdict `vgai status` prints per tab. */
export type CommandListenerHealth = 'ready' | 'not attached' | `silent since ${string}`;

/**
 * The verdict, from those facts alone.
 *
 * `not attached` is the zombie page — the one the incident hid. `silent since`
 * is the other half: a listener that DID attach and has since stopped taking
 * commands, which the receipt path proves without asking the page anything (a
 * relay went out, the ack window passed, no receipt came back). `ready` is the
 * only remaining case, and it is a positive report rather than the absence of
 * evidence.
 *
 * The grace before "silent" is {@link RELAY_DELIVERY_ACK_MS}, deliberately the
 * same window the relay itself waits for a receipt: a command relayed 50ms ago
 * has not had time to be acknowledged, and calling that silence would make the
 * field cry wolf on every healthy `vgai play`.
 */
export function commandListenerHealth(
  facts: CommandListenerFacts,
  now: number,
): CommandListenerHealth {
  if (facts.attachedAt === null) return 'not attached';
  const { lastRelayAt, lastReceiptAt } = facts;
  const unanswered =
    lastRelayAt !== null &&
    (lastReceiptAt === null || lastReceiptAt < lastRelayAt) &&
    now - lastRelayAt >= RELAY_DELIVERY_ACK_MS;
  if (!unanswered) return 'ready';
  return `silent since ${((now - lastRelayAt) / 1000).toFixed(1)}s ago`;
}

/** Map a relayed-command result to an HTTP status + body. A timeout (no editor
 *  connected) is a distinct 504 error rather than a fake success. (SC1)
 *  `data` is spread into the response body at the top level — alongside
 *  `ok: true` on success (so `HttpEditorTransport.sendCommand` sees it
 *  without a second field of indirection) and alongside `ok: false`/`error`
 *  on the refusal path.
 *
 *  A REFUSAL travels as HTTP 200. It is a first-class ANSWER from the game —
 *  a steer verb racing its run's end, a poll of a run-scoped provider that is
 *  legitimately absent — and every first-party caller reads `body.ok`, never
 *  the status. Encoding it as 400 had a real cost: Chromium prints an
 *  unsuppressable "Failed to load resource: 400" console error for every
 *  non-2xx subresource, so an editor panel's 700 ms `bot.status` poll flooded
 *  the editor console (~1.4 lines/s, all play long) — the exact channel the
 *  dev-tools warning backstop and `vgai status` report from — and no
 *  try/catch on the caller can silence the browser's own network log. The
 *  timeout stays 504: no-editor/no-answer is a genuine gateway condition,
 *  and rare enough that its console line is signal. */
export function commandResponseFor(
  result: RelayedCommandResult,
  unresolvedConsole?: UnresolvedConsoleSummary,
): {
  status: number;
  body: Record<string, unknown>;
} {
  // THE CHOKE POINT for console loudness. Every relayed command — `play`,
  // `eval`, `screenshot`, every debug-plane read, everything the CLI and the
  // editor SDK ever ask a tab to do — comes back through this one function, so
  // the unresolved-console counts are attached here ONCE instead of in each of
  // the CLI's ~35 output sites. It is the FIRST key of every envelope by
  // deliberate choice: a structured reader slicing the first field, and a human
  // eyeballing a pretty-printed body, both hit it before the answer they came
  // for. Omitted entirely (not zero-filled) when the caller has no ledger, so
  // "this server predates the contract" and "this session is clean" stay
  // distinguishable.
  const head = unresolvedConsole === undefined ? {} : { unresolvedConsole };
  if (result.ok) return { status: 200, body: { ...head, ok: true, ...(result.data ?? {}) } };
  if (result.timedOut) {
    return {
      status: 504,
      body: {
        ...head,
        ok: false,
        error: result.error ?? 'Command timed out — no editor connected.',
      },
    };
  }
  return {
    status: 200,
    body: { ...head, ok: false, error: result.error, ...(result.data ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Runtime/scaffold distribution classification
// ---------------------------------------------------------------------------

/**
 * True iff a root is a monorepo checkout rather than an installed package
 * distribution. The result selects link-vs-registry scaffold dependencies and
 * the packaged React runtime path; both distributions can create projects.
 *
 * A packaged (`node_modules`-installed) `@vgai/editor`'s `engineRoot` is the
 * EDITOR PACKAGE's own root instead of a monorepo checkout root (see
 * `packaged.ts` is constructed with `engineRoot: editorPackageRoot`; its
 * separate `scaffoldRoot` points at the npm installation that contains the
 * shipped template and release train.
 */
export function isMonorepoScaffoldRoot(engineRoot: string): boolean {
  return existsSync(join(engineRoot, 'packages', 'editor', 'template'));
}

// ---------------------------------------------------------------------------
// Asset listing (S-8 — ingest-boot 404 noise)
// ---------------------------------------------------------------------------

/**
 * What `GET /__editor/assets` should answer when `readdir` failed.
 *
 * S-8 (the SimCity ingest ledger): the asset browser lists the project's asset
 * ROOT (`<project>/public`) at boot, three times. A project that simply has no
 * such folder — every source-mounted foreign game, and micropolisJS keeps its
 * own assets at `src/public` — answered 404 three times before the editor had
 * finished booting, which is exactly the noise that makes a real failure hard
 * to see.
 *
 * The rule, and it is a correctness fix rather than a suppression: "list the
 * asset root of a project that has no asset root" has a true answer, and it is
 * the EMPTY LISTING, not an error. Nothing is being fabricated — an absent
 * directory contains no assets. A named SUBdirectory is the opposite case: the
 * caller asserted a path that does not exist, and 404 is the honest reply.
 */
/**
 * Where Content lists media. A first-party project owns `<project>/public`.
 * A source-mounted ingest fixture often has no such folder — its bytes live
 * in `vendor/games/<id>/public`. Listing that tree is not fabrication: those
 * are the game's images and audio. Writes still target the project public/.
 */
/**
 * Where Content lists one named root. `public` keeps the rule below verbatim;
 * `references` is the project's own reference-material folder — ordinary files
 * beside `public/`, never vendored and never substituted, because reference
 * material belongs to the project someone opened and nothing else.
 *
 * An unknown root name resolves to the public root rather than anywhere else:
 * the listing routes validate names, and a silent fallback to the safest root
 * is the only wrong answer that cannot read a directory nobody asked for.
 */
export function resolveListedAssetRoot(
  projectRoot: string,
  engineRoot: string,
  root: string,
): string {
  if (root === 'references') return resolve(projectRoot, 'references');
  return resolveListedPublicRoot(projectRoot, engineRoot);
}

export function resolveListedPublicRoot(projectRoot: string, engineRoot: string): string {
  const projectPublic = resolve(projectRoot, 'public');
  if (existsSync(projectPublic)) return projectPublic;
  const id = projectRoot.split(sep).filter(Boolean).at(-1);
  if (!id) return projectPublic;
  const vendorPublic = resolve(engineRoot, 'vendor', 'games', id, 'public');
  return existsSync(vendorPublic) ? vendorPublic : projectPublic;
}

export function assetListingErrorResponse(
  dir: string,
  errorCode: string | undefined,
): { kind: 'empty' } | { kind: 'error'; status: 404 | 500; message: string } {
  const missing = errorCode === 'ENOENT' || errorCode === 'ENOTDIR';
  if (!missing) return { kind: 'error', status: 500, message: 'Internal server error.' };
  if (dir === '') return { kind: 'empty' };
  return { kind: 'error', status: 404, message: 'Directory not found.' };
}
