/**
 * vite-plugin-game-static — THE dev-server route that serves a vendored game's own bytes
 * VERBATIM (no vite transform), for every vendored game under `vendor/games/`, whatever
 * library it uses (Wave 0.6, ONE INGEST HOME). It merges the two per-library plugins that
 * used to live here and in `vite-plugin-react-game-static.ts`.
 *
 * Verbatim matters because a transform would break the very properties that let an
 * UNMODIFIED game run: a game's bare `import 'pixi.js'` must survive to resolve to the
 * host's own instance in the editor's realm (not be rewritten to `/node_modules/.vite/deps`),
 * and an AssetPack `.json` spritesheet must stay raw JSON (not become an ESM module). This is pure
 * HOST wiring — it never touches vendored game source.
 *
 * Two id-generic routes, one plugin, zero per-game branches. Which routes a given game
 * uses follows from HOW it is vendored, never from what draws it:
 *
 *  1. `/vendor/games/<id>/<rest>` -> `vendor/games/<id>/public/<rest>`.
 *     The VENDORED-PUBLIC route: this is the shape a game's own `import.meta.url`-derived
 *     asset base produces when Vite serves its modules from the vendored tree (see the
 *     empirical finding below). Anything not under that game's `public/` falls through to
 *     Vite untouched, which is what keeps the game's real `src/` modules served normally.
 *
 *  2. A ROOT-relative path (`/logo-no-bg.png`, `/tiles/<rest>`, `/assets/<rest>`) resolved
 *     against each vendored game's `public/` in turn, first hit wins. Games that ship
 *     literal absolute-root asset URLs need this, and so does every Pixi/AssetPack game (its
 *     `Assets.init({ basePath: 'assets' })` is relative to the DOCUMENT, which inside the
 *     editor is the root). It is restricted to the extensions a game asks for with a plain
 *     URL, to files that genuinely exist, and — the guard that actually holds — to requests
 *     Vite itself already declined.
 *
 * Both routes scope themselves from the VENDORED TREE — every `vendor/games/<id>/` that
 * actually has a `public/` directory — so a second such game is a folder, not an edit here.
 *
 * ## EMPIRICAL FINDING, kept because it is not obvious
 *
 * react-rpg's `src/config/constants.js` builds its tile-asset BASE URL from its own
 * `import.meta.url`, slicing off everything from the literal substring `'src'` onward and
 * appending `'tiles/'`. Upstream serves that module at `/src/config/constants.js` (Vite root
 * = their repo root), so the slice keeps the ORIGIN and nothing else, yielding an
 * origin-rooted `/tiles/` URL there.
 *
 * The vendored folder here is therefore named `src/`, matching upstream EXACTLY — NOT
 * renamed (the pixi precedent's convention would suggest `game/`, but a renamed folder
 * actively BREAKS this game): this dev server's URL for `constants.js` would be
 * `http://<host>/vendor/games/react-rpg/game/config/constants.js` if renamed — which
 * contains NO `'src'` substring anywhere, so `indexOf('src')` returns `-1`;
 * `String.prototype.substring` clamps a negative end to `0`, so the slice degenerates to
 * `''`, and the computed "URL" is the bare string `'tiles/'` — NOT a valid absolute URL.
 * The game's own `features/map/map-padding.jsx` then does `new URL('./tile.png', REF_URL)`,
 * and `new URL()`'s base argument MUST itself be a valid absolute URL or the constructor
 * THROWS (`TypeError: Failed to construct 'URL': Invalid base URL`) — verified against the
 * real dev server; a hard runtime crash the moment the dungeon view renders one tile.
 * Keeping the folder named `src/` makes `indexOf('src')` find the REAL segment, so the slice
 * yields a genuine origin-rooted prefix — `http://<host>/vendor/games/react-rpg/` +
 * `'tiles/'` — which is route 2 above. (`vendor/games/verify-unaltered.mjs`'s and
 * `react-rpg.UPSTREAM.md`'s records of the same finding come from the zero-diff side.)
 */
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { Plugin } from 'vite';

// Exported so `vite-plugin-project-game-static.ts` (D-X2, the external-folder
// verbatim-serving sibling of this plugin) reuses the SAME MIME table rather
// than drifting a second copy — both plugins serve the identical class of
// content (a game bundle + JSON spritesheets + image/audio/font assets), just
// rooted at a different directory.
export const MIME: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  // Video is media in the same sense as an image: a reference clip or a
  // generated motion study is served to a plain <video src>, and without these
  // two entries the request fell through to the SPA fallback and the element
  // reported an unsupported source while the bytes sat right there.
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  // 3D model bytes are the same class of content as an image or an audio clip —
  // a game asks for them with a plain URL and a loader parses the bytes. The
  // table lacked them only because the early vendored games all drew from
  // sprites: an R3F game's `useGLTF('/models/Court.glb')` is a ROOT-relative
  // model request, so it needs both this MIME entry and the
  // `ROOT_RELATIVE_MEDIA` membership below.
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  // A radiance/HDR environment map is media in exactly the same sense, and it
  // has no registered IANA type — `image/vnd.radiance` is the de-facto one, and
  // what it is called matters less than that the bytes arrive unmangled, since
  // three's `RGBELoader` parses them itself from an ArrayBuffer. Missing here,
  // a root-relative `textures/x.hdr` fell through to the editor's SPA fallback
  // and the loader reported `Bad File Format: bad initial token` — it was
  // parsing index.html. Measured on the R3F racing-game ingest, whose drei
  // `<Environment files="textures/dikhololo_night_1k.hdr" />` is the first HDR
  // request any vendored game has made.
  '.hdr': 'image/vnd.radiance',
};

/**
 * Extensions the ROOT-RELATIVE fallback is willing to claim: everything a game asks for
 * with a plain URL and parses itself. It is `MIME` minus the script types — a vendored
 * game's `public/` may answer for its own bytes, but it may never answer for a MODULE.
 *
 * ## Why `.json` is in this set, and what makes it safe
 *
 * It was not, and it had to be. Measured on the `bubbo-bubbo` ingest: an AssetPack game's
 * spritesheets ARE `.json` (its `Assets.init({ basePath: 'assets' })` asks for
 * `/assets/images/preload.webp.json`), so a media-only fallback served its atlas PNGs and
 * dropped every atlas that names their frames — `[Loader.load] Failed to load … SyntaxError:
 * Unexpected token '<'`, because the request fell through to the SPA fallback and Pixi was
 * handed `index.html`.
 *
 * What used to make `.json` unsafe was this route's POSITION, not its extension: it ran
 * ahead of Vite, with no id in the URL to scope it, so a vendored `public/` could shadow a
 * root-relative request the editor itself owns. That is now closed STRUCTURALLY — the
 * fallback is installed as a Vite POST middleware ({@link gameStaticPlugin}), so it only
 * ever sees a request Vite's own transform and static routes already declined. The editor
 * can no longer be shadowed because the editor already had its turn.
 *
 * Script types stay out anyway: at this position they are reachable only when Vite 404s
 * them, but a vendored `public/main.js` answering an unresolved editor import would turn a
 * loud missing-module error into a silently wrong one, and that trade is never worth it.
 */
const ROOT_RELATIVE_FALLBACK = new Set([
  '.json',
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.mp3',
  '.ogg',
  '.wav',
  '.woff2',
  '.woff',
  '.ttf',
  '.glb',
  '.gltf',
  '.hdr',
]);

export const VENDOR_PREFIX = '/vendor/games/';

/**
 * Every vendored game id that ships a `public/` directory (both routes' scope). Read once at
 * plugin construction (the vendored tree is checked-in source, not something that changes
 * while a dev server runs) and tolerant of the directory being absent entirely.
 */
export function discoverVendoredGameIds(vendorRoot: string): string[] {
  try {
    return readdirSync(vendorRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map((e) => e.name)
      .filter((id) => {
        try {
          return statSync(join(vendorRoot, id, 'public')).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

/** Path-traversal guard, applied to every candidate either resolver produces: stay inside
 *  the vendored tree, whatever `..` the URL contained. */
function insideVendorTree(vendorRoot: string, candidates: string[]): string[] {
  return candidates.map((c) => normalize(c)).filter((c) => c.startsWith(vendorRoot));
}

/**
 * THE ID-CARRYING route: `/vendor/games/<id>/<rest>` -> `vendor/games/<id>/public/<rest>`,
 * or `[]` for "not ours, fall through". Scoped by the id in the URL itself, so it is safe
 * ahead of Vite and is installed there.
 *
 * Pure (path math only, no I/O) and exported for direct unit testing — the traversal guard
 * in particular deserves a test that needs no dev server.
 */
export function resolveVendoredPublicPath(
  vendorRoot: string,
  gameIds: readonly string[],
  urlPath: string,
): string[] {
  if (!urlPath.startsWith(VENDOR_PREFIX)) return [];
  const rest = urlPath.slice(VENDOR_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return [];
  const id = rest.slice(0, slash);
  if (!gameIds.includes(id)) return [];
  return insideVendorTree(vendorRoot, [join(vendorRoot, id, 'public', rest.slice(slash + 1))]);
}

/**
 * THE ROOT-RELATIVE fallback: a bare `/logo-no-bg.png`, `/tiles/wall.png` or
 * `/assets/images/preload.webp.json`, resolved against each vendored game's `public/` in
 * turn — first hit wins at the middleware, so ORDER is the contract, not a single answer.
 *
 * Games that ship literal absolute-root asset URLs need this, and there are two shapes of
 * them: react-rpg derives an origin-rooted base from its own `import.meta.url`, and any
 * Pixi/AssetPack game asks for its bundle under a relative `basePath` that the editor
 * document resolves to the root. Neither can be given an id in the URL without editing the
 * game, which is the one thing an ingest may never do.
 *
 * There is no id here to scope it, so its safety is POSITIONAL: see
 * {@link ROOT_RELATIVE_FALLBACK} and {@link gameStaticPlugin}.
 */
export function resolveVendoredRootRelativePath(
  vendorRoot: string,
  gameIds: readonly string[],
  urlPath: string,
): string[] {
  if (urlPath.startsWith(VENDOR_PREFIX)) return [];
  if (!ROOT_RELATIVE_FALLBACK.has(extname(urlPath))) return [];
  return insideVendorTree(
    vendorRoot,
    gameIds.map((id) => join(vendorRoot, id, 'public', urlPath)),
  );
}

function send(res: import('node:http').ServerResponse, filePath: string, buf: Buffer): void {
  res.setHeader('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.statusCode = 200;
  res.end(buf);
}

/** Serve the first candidate that exists; `false` when none did (caller falls through). */
async function serveFirst(
  res: import('node:http').ServerResponse,
  candidates: readonly string[],
): Promise<boolean> {
  for (const filePath of candidates) {
    try {
      send(res, filePath, await readFile(filePath));
      return true;
    } catch {
      // try the next vendored game's public dir
    }
  }
  return false;
}

/**
 * ## Why the two routes sit on opposite sides of Vite
 *
 * `configureServer`'s BODY installs a middleware ahead of Vite's own; the function it
 * RETURNS installs one after them (and, load-bearing here, still ahead of
 * `indexHtmlMiddleware`). The id-carrying route is safe anywhere and stays in front. The
 * root-relative fallback goes behind, which is what lets it claim `.json` without being able
 * to shadow anything the editor owns: by the time it runs, Vite's transform, `/@fs/` and
 * static routes have all declined.
 *
 * MEASURED, and the reason this split exists: with the fallback in front and media-only,
 * bubbo-bubbo's atlas JSON fell past both routes to the SPA fallback and Pixi parsed
 * `index.html` (`SyntaxError: Unexpected token '<'`). With it behind and `.json` allowed,
 * the same request is answered from the game's own `public/`.
 *
 * The SPA fallback has already rewritten `req.url` to `/index.html` by then (Vite's
 * `htmlFallbackMiddleware` does that unconditionally for an `Accept: * / *` GET), so the
 * post route reads `req.originalUrl` — Express sets it before handing off, and it is the
 * only place the game's real request survives.
 */
export function gameStaticPlugin(repoRoot: string): Plugin {
  const vendorRoot = resolve(repoRoot, 'vendor/games');
  const gameIds = discoverVendoredGameIds(vendorRoot);
  return {
    name: 'vgai-game-static',
    configureServer(server) {
      // AHEAD of Vite: the id-carrying `/vendor/games/<id>/…` route.
      server.middlewares.use(async (req, res, next) => {
        if (gameIds.length === 0) return next();
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (await serveFirst(res, resolveVendoredPublicPath(vendorRoot, gameIds, url))) return;
        next();
      });

      // BEHIND Vite: the root-relative fallback.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (gameIds.length === 0) return next();
          const raw = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '';
          const url = raw.split('?')[0] ?? '';
          if (await serveFirst(res, resolveVendoredRootRelativePath(vendorRoot, gameIds, url)))
            return;
          next();
        });
      };
    },
  };
}
