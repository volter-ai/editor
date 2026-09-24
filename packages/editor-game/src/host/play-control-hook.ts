/**
 * The ONE stable hook on the editor's play control.
 *
 * `PlayBar` renders two different transports — the native one (title "Play
 * (run game)") and the ingest one (label "Run ingested game") — and anything
 * outside the component that needs to find "the play control" was matching a
 * LABEL. `vgai doctor` polled for the native string as its editor-readiness
 * boundary and therefore waited out its whole timeout budget on every ingest
 * project, which renders the other one (SimCity ingest dogfood, S-6).
 *
 * A label is a product decision that moves; this hook is not. Both transports
 * carry it, so a caller asking "is the play control up?" gets one selector
 * that is true on every surface — and adding a THIRD transport means adding
 * the hook, not teaching every caller a third string.
 *
 * Deliberately a dependency-free leaf module: `packages/editor/scripts/
 * run-doctor.ts` runs under plain `tsx` (no Vite, no DOM, and it imports by
 * RELATIVE path because tsx resolves the package/`@editor/*` aliases from
 * the process CWD — only a repo-root cwd has them) and imports this directly,
 * so it must never pull React or the design system in.
 */

export const PLAY_CONTROL_TEST_ID = 'play-control';

/** CSS selector form — what Playwright/`querySelector` callers want. */
export const PLAY_CONTROL_SELECTOR = `[data-testid="${PLAY_CONTROL_TEST_ID}"]`;
