/**
 * THE LIMITED VIEW'S DOORS — what an integration declares so a project it serves can also be
 * compiled into a static page (`<product> view build`, docs/LIMITED-VIEW.md).
 *
 * A limited view is a separate product surface, the roadmap's static authoring peer: the same
 * workbench, the same product bundle and the same project modules, compiled once and served by
 * any static host. Nothing in the editor asks which surface it runs in. What differs is the
 * transport behind `/__editor/*`: in a session the session answers, in a limited view a service
 * worker hands each request to the page, whose router answers it against the project's files in
 * memory. An integration whose browser half calls routes of its own server half therefore
 * declares two things:
 *
 *  - `ProjectServingModule.viewSnapshotRoutes` (its `volter.serving` module): the GET routes
 *    whose answers are fixed for a build — an engine's WebAssembly, a status document. The view
 *    build asks a headless session for exactly these and ships the bytes it answered with.
 *  - `package.json#volter.viewServing`: a BROWSER module exporting `viewRoutes(services)`, the
 *    routes that read or write the project (`services.files`), answered in the page.
 *
 * Anything a limited view does not answer reads as {@link limitedViewUnavailable}: a 503 whose
 * body names the feature, says it needs the person's own machine, and quotes the product's
 * install command.
 */

import type { StorageBackend } from '@volter/sdk/kit/storage-types';

/** The manifest key naming an integration's browser-side limited-view routes. */
export const VIEW_SERVING_DECLARATION_KEY = 'volter.viewServing';

/** The response header every limited-view refusal carries, so a reader can tell it from a
 *  failing route without parsing a sentence. */
export const LIMITED_VIEW_HEADER = 'x-volter-limited-view';

/** The body of a refusal: the editor's usual `{ error }`, plus what the view knows. */
export interface LimitedViewUnavailableBody {
  readonly error: string;
  readonly limitedView: {
    /** The feature that needs the local editor, in a person's words. */
    readonly unavailable: string;
    /** The command that installs the local editor, from the product's declaration. */
    readonly installCommand: string;
  };
}

export function limitedViewUnavailableBody(
  feature: string,
  installCommand: string,
  reason = 'it needs the editor running on your own machine',
): LimitedViewUnavailableBody {
  return {
    error:
      `${feature} is not available in the limited view: ${reason}. ` +
      `Install the editor to use it: ${installCommand}`,
    limitedView: { unavailable: feature, installCommand },
  };
}

/** What the page hands an integration's view routes. */
export interface ViewServingServices {
  /** The project root the editor was told it opened (`/__editor/project`'s `project.path`). */
  readonly projectRoot: string;
  /** The project's files, project-root relative, in memory: seeded from the view, written by
   *  every edit, gone on reload. */
  readonly files: StorageBackend;
  /** A JSON response with the headers a limited view adds to everything it answers. */
  json(body: unknown, status?: number): Response;
  /** The refusal for a feature this view cannot carry. */
  unavailable(feature: string, reason?: string): Response;
}

export type ViewRouteMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One route answered in the page. `match` is tested against the URL's pathname. */
export interface ViewRoute {
  readonly method: ViewRouteMethod;
  readonly match: RegExp;
  handle(request: Request, url: URL): Promise<Response> | Response;
}

/** What a `volter.viewServing` module exports. */
export interface ViewServingModule {
  viewRoutes(services: ViewServingServices): readonly ViewRoute[];
}
