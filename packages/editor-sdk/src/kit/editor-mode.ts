/**
 * The project root the session injected, for the code that must spell an
 * ABSOLUTE path.
 *
 * The editor is served by its session (`vgai edit`) and runs inside the
 * Code-OSS frame (ARCHITECTURE-CORE §The target shape rule 5), so a file read
 * is a request to that session and `__VGAI_PROJECT_PATH__` is the folder it
 * opened.
 *
 * Vite replaces the define at build time; `typeof` guards the one case where
 * nothing injected it (a module loaded outside the session's own bundle).
 */

declare const __VGAI_PROJECT_PATH__: string;

/** Absolute project root injected by the session's dev/prod server. */
export function getProjectDefinePath(): string {
  return typeof __VGAI_PROJECT_PATH__ !== 'undefined' ? __VGAI_PROJECT_PATH__ : '';
}
