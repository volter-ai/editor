/**
 * `/__editor/served-modules` — the ONE door by which the Code-OSS frame finds
 * the editor.
 *
 * WHO ASKS. The fork's workbench contribution (docs/CODE-OSS.md). It boots into
 * a VS Code page, hands over its parts, and then needs the vgai editor's own
 * entry point to import — the PRODUCT's entry, which mounts the kit's bridge and
 * so swaps the SDK layout host that renders our panels into those parts. The
 * contribution reads `modules[].url` for the id `vscode-bridge`, imports exactly
 * that, and reads `mountVgai` off it.
 * `vgaiSessionOrigin.ts` also uses this route as its "is there a session here"
 * probe, so it answers 200 even when it has nothing to serve.
 *
 * WHAT IT SERVES: the PRODUCT's one source entry — `@vgai/game-editor`'s or
 * `@vgai/model-editor`'s `src/index.ts`, which composes the product and
 * re-exports `mountVgai` (`packages/editor/src/frame/product.ts`). Which
 * product that is comes from the project's own dependencies, resolved by the
 * CLI and handed over (`session-product.ts`); the kit's own mount,
 * `frame/bridge.tsx`'s `mountEditor`, is not served to anybody and names no
 * product.
 *
 * WHERE THE URL COMES FROM is the host's, not this route's, because the two
 * hosts serve the editor differently and only they know how:
 *
 *  - `dev.ts` runs Vite over the checkout, so the product entry is an ordinary
 *    module in the graph and the URL is its path, stamped with its own mtime.
 *  - `packaged.ts` serves the PRODUCT's production build, so the URL is the
 *    built entry's hashed chunk.
 *
 * A host with no bundler behind it supplies no answer at all, and a session
 * whose project declares no product supplies `null`; this route says either by
 * name, with the id the contribution was looking for — a frame that cannot find
 * the editor must read as a refusal, never as an empty list.
 *
 * THE QUERY KEY MAY NEVER BE `v` — see {@link ServedModuleAnswer.url}.
 */

import { PRODUCT_INSTALL_LINES } from '@volter/editor-sdk/session/product-locator';
import type { Request, Response } from 'express';
import type { EditorServerRouter } from '../editor-server';
import type { RouteContext } from './context';

/**
 * The one id this door serves, and the one the fork's contribution looks for
 * (`vgaiBlender.contribution.ts`). It is a wire constant shared by two
 * repositories: changing it here without changing it there is a frame that
 * mounts nothing.
 */
export const FRAME_BRIDGE_MODULE_ID = 'vscode-bridge';

export interface ServedModuleAnswer {
  readonly id: string;
  /**
   * The import URL, carrying the file's own mtime in dev and the build's hash
   * when packaged. A changed bridge is a changed URL and therefore a fresh
   * transform; an unchanged one reuses Vite's cache.
   *
   * THE QUERY KEY IS `mtime` AND MAY NEVER BE `v`, and that spelling is the
   * whole of walk 3's session-restart break (measured 2026-09-20). Vite's
   * transform middleware decides its cache header with
   * `DEP_VERSION_RE = /[?&](v=[\w.-]+)\b/` — any `?v=` at all — and answers a
   * match with `Cache-Control: max-age=31536000, immutable`, the header meant
   * for content-addressed dep chunks. So `?v=<mtime>` made the browser keep
   * this module's TRANSFORMED BODY for a year without revalidating, and that
   * body has Vite's rewritten imports baked into it:
   * `…/node_modules/.vite-editor/v2-<key>/deps/react.js?v=<browserHash>`.
   * Close the session, start another, and every ordinary editor module (served
   * `no-cache`) revalidates onto the new generation while the cached bridge
   * replays the old one — two React instances in one page, which the editor
   * reports as `Invalid hook call` / `Cannot read properties of null (reading
   * 'useState')` at `AppRoot`. That is why the documented recovery needed BOTH
   * a fresh browser profile (the poison is the HTTP cache) and
   * `rm -rf node_modules/.vite-editor` (so the stale generation stops
   * resolving). With `mtime` the response is `no-cache`, the browser
   * revalidates against the ETag, and an unchanged bridge still costs one 304.
   */
  readonly url: string;
}

export interface ServedModuleRefusal {
  readonly id: string | null;
  readonly message: string;
}

export function registerServedModuleRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  router.get('/__editor/served-modules', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const answer = ctx.options.frameBridgeUrl;
    if (answer === undefined) {
      res.json({
        modules: [],
        refusals: [
          {
            id: FRAME_BRIDGE_MODULE_ID,
            message:
              'This session serves no module graph, so it cannot serve the editor to the Code-OSS ' +
              'frame (no bundler behind it). `volter-editor edit` sessions — the dev checkout and the ' +
              "project's own installed @vgai/editor — both can.",
          },
        ],
      });
      return;
    }
    let url: string | null;
    try {
      url = answer();
    } catch (error) {
      res.json({
        modules: [],
        refusals: [
          {
            id: FRAME_BRIDGE_MODULE_ID,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
      return;
    }
    if (url === null) {
      res.json({
        modules: [],
        refusals: [
          {
            id: FRAME_BRIDGE_MODULE_ID,
            message:
              'This session is serving no vgai product, so there is no editor for the Code-OSS ' +
              'frame to import. A product is the running program — the editor IS ' +
              '@vgai/game-editor or @vgai/model-editor — and which one runs is what the project ' +
              'installed. Install one and run `volter-editor edit` again:\n' +
              `${PRODUCT_INSTALL_LINES.join('\n')}`,
          },
        ],
      });
      return;
    }
    res.json({ modules: [{ id: FRAME_BRIDGE_MODULE_ID, url }], refusals: [] });
  });
}
