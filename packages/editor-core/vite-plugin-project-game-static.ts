/**
 * vite-plugin-project-game-static — D-X2 (slice S1): the external-folder
 * sibling of `vite-plugin-game-static.ts`. Serves the CURRENTLY OPEN
 * project's own folder VERBATIM (no vite transform) at
 * `/project-game-static/<path>` -> `<projectRoot>/<path>`, so a game's own
 * data files reach it untransformed — an AssetPack `.json` spritesheet stays
 * raw JSON instead of becoming an ESM module, the same R-X1 rationale
 * `vite-plugin-game-static.ts`'s header records for the vendored route, just
 * rooted at an arbitrary user folder.
 *
 * `getProjectRoot` is a THUNK, not a captured string: `open-project` can
 * switch the current project live (`server/dev.ts`'s `onProjectOpened`
 * callback), and this route must follow the CURRENT project root, not a
 * boot-time snapshot — every request re-reads it. No project open (thunk
 * returns `undefined`) -> `next()`, never a 5xx.
 *
 * `configureServer`-only: it exists to serve an OPENED project's files, which
 * is a session's job and nothing else's.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { MIME } from './vite-plugin-game-static';

/**
 * Resolve `rel` against `projectRoot`, refusing anything that escapes it.
 * Plain `startsWith(root)` would wrongly admit a sibling folder that merely
 * shares `root` as a string prefix (e.g. root `/a/b` and filePath `/a/bc/evil`)
 * — the boundary must fall on a real path separator (or be an exact match).
 * Returns `null` for an escape attempt.
 */
function resolveInsideProjectRoot(projectRoot: string, rel: string): string | null {
  const root = resolve(projectRoot);
  const filePath = normalize(join(root, rel));
  if (filePath === root || filePath.startsWith(root + sep)) return filePath;
  return null;
}

/** `req.url`'s path portion (query stripped), project-root-relative (leading
 *  slash removed). Empty for the bare mount path (`/project-game-static`
 *  itself, with nothing after it). */
function requestRelPath(url: string | undefined): string {
  // `.split('?')` always yields at least one element — `noUncheckedIndexedAccess`
  // types index access as possibly-undefined regardless, so fall back to ''.
  const path = (url ?? '').split('?')[0] ?? '';
  return path.startsWith('/') ? path.slice(1) : path;
}

/**
 * One `Range: bytes=…` header against a known size. Returns the inclusive
 * range to send, `null` for "send the whole file" (absent, malformed, or a
 * form this route does not implement — a multi-range request is legal to
 * answer with the full body), or `'unsatisfiable'` for a start past the end,
 * which must be a 416 rather than a silently clamped success.
 */
export function parseByteRange(
  header: string | string[] | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  // A suffix range (`bytes=-500`) asks for the LAST n bytes.
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart);
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (size === 0 || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

export function projectGameStaticPlugin(getProjectRoot: () => string | undefined): Plugin {
  return {
    name: 'vgai-project-game-static',
    configureServer(server) {
      server.middlewares.use('/project-game-static', async (req, res, next) => {
        const projectRoot = getProjectRoot();
        if (!projectRoot) return next(); // no project open — nothing to serve

        const rel = requestRelPath(req.url);
        if (!rel) return next();

        const filePath = resolveInsideProjectRoot(projectRoot, rel);
        if (!filePath) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }

        try {
          const buf = await readFile(filePath);
          res.setHeader('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          // RANGE, and it is load-bearing for video. A `<video>` element seeks by
          // asking for a byte range, and a route that answers every request with
          // the whole file and no `Accept-Ranges` cannot be seeked at all: the
          // clip's own first frame never paints (measured — a reference tile and
          // its Asset Lab document both showed black over a bright opening
          // frame), and the scrubber does nothing. Everything else is unaffected:
          // a request with no `Range` still gets the ordinary 200 below.
          res.setHeader('Accept-Ranges', 'bytes');
          const range = parseByteRange(req.headers['range'], buf.byteLength);
          if (range === 'unsatisfiable') {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${buf.byteLength}`);
            res.end();
            return;
          }
          if (range) {
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${buf.byteLength}`);
            res.setHeader('Content-Length', range.end - range.start + 1);
            res.end(buf.subarray(range.start, range.end + 1));
            return;
          }
          res.statusCode = 200;
          res.end(buf);
        } catch {
          next();
        }
      });
    },
  };
}
