// The project manifest's FILENAME. There is exactly ONE.
//
// The manifest is `vgai.project.json`, and NOTHING reads a second spelling
// (the legacy-removal doctrine, `docs/ARCHITECTURE-CORE.md` §Vocabulary). Two
// accepted names is the defect, not the convenience: both get written, and
// copies of the "try both" probe spread into modules that agree with the real
// resolver only by coincidence.
//
// The removed name REJECTS LOUDLY, naming the exact one-line fix — never
// silently ignored, never redirected. A directory
// carrying only `vgai.game.json` is an error with a `git mv` in the message,
// not a project that quietly fails to open.
//
// This module is the ONE place either literal is spelled out, and it is
// dependency-free (no `node:fs`) so browser bundles can import it. The
// filesystem side lives in `./locate` (`resolveManifestPath`, `hasManifest`,
// `assertNoRemovedManifestFilename`).

/** The manifest filename. Every reader reads it; every writer writes it. */
export const MANIFEST_FILENAME = 'vgai.project.json';

/** The removed filename. Read by nothing — its only job is the error message. */
export const REMOVED_MANIFEST_FILENAME = 'vgai.game.json';

/** True for the manifest filename (basename comparison). */
export function isManifestFilename(name: string): boolean {
  return name === MANIFEST_FILENAME;
}

/**
 * The verbatim rejection an on-disk `vgai.game.json` earns — the one-line fix
 * spelled out, per the removed-format contract. Shared by the Node
 * (`./locate`) and browser (storage-backend) halves so a project author sees
 * the same sentence wherever the stale name is found.
 */
export function removedManifestFilenameMessage(where: string): string {
  return (
    `${where}: found \`${REMOVED_MANIFEST_FILENAME}\` and no \`${MANIFEST_FILENAME}\`. ` +
    `\`${REMOVED_MANIFEST_FILENAME}\` was REMOVED (the legacy-removal doctrine, ` +
    'docs/ARCHITECTURE-CORE.md §Vocabulary) — nothing reads it any more, and it is ' +
    'deliberately NOT read as a fallback, because a second accepted name is the defect.\n' +
    `Fix: rename it — \`git mv ${REMOVED_MANIFEST_FILENAME} ${MANIFEST_FILENAME}\`. ` +
    'The contents are unchanged; only the filename moved.'
  );
}
