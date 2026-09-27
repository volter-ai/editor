/**
 * The entry both of this project's run configurations start:
 * `npx tsx scripts/play-perspective.ts first|third`.
 *
 * ── Why a script and not a manifest field ─────────────────────────────────
 * MEASURED before it was written (2026-09-20). A run configuration is one of
 * the project's ENTRYPOINTS and the registry has exactly two run-role kinds,
 * `process` and `compound` (`@volter/editor-project/manifest/configuration-kinds`); the
 * host starts `process` and nothing else, and there is NO seam anywhere from a
 * configuration id to the game the host then mounts — `build`-role kinds can
 * name a project TOOL, `run`-role kinds have no equivalent. So a configuration
 * cannot hand the game a parameter. What it CAN do is run a process beside the
 * editor, and a process beside the editor can reach the game through the same
 * door a person at a terminal uses. That is this file: a `process`
 * configuration whose process is one call into the live session.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 * Resolves this project's own `vgai edit` session, waits for a game to be
 * mounted (the transport starts a configuration and THEN enters Play, so on
 * that path there is nothing to talk to for a moment), and calls the game's
 * own `setPerspective`. It exits 0 the moment the camera has changed. It is
 * deliberately short-lived: the configuration declares no `port`, so the host
 * treats it as ready as soon as it is spawned and never waits on a listener
 * that is not coming.
 *
 * Starting `third-person` against an already-playing arena switches it on the
 * next frame. Starting it before Play arms it for the mount that follows.
 *
 * ── The other way in, which needs no process at all ───────────────────────
 * `?perspective=third` on the page the game is mounted in. `src/perspective.ts`
 * reads it at module load, so a link, a hosted deep-link or a `vgai edit` URL
 * opens the arena in that camera with nothing running beside it. The two doors
 * are the same store.
 */

import { connect } from '@volter/game-live';

const PERSPECTIVES = ['first', 'third'] as const;
type Perspective = (typeof PERSPECTIVES)[number];

/** How long to wait for a game to be mounted before giving up, ms. Generous:
 *  on the transport's path this process is racing an editor that is loading a
 *  world, an arena of hostiles and a baked character. */
const MOUNT_TIMEOUT_MS = 45_000;
const MOUNT_POLL_MS = 250;

function requestedPerspective(): Perspective {
  const argument = process.argv[2];
  if (argument === 'first' || argument === 'third') return argument;
  throw new Error(
    `play-perspective: expected one of ${PERSPECTIVES.map((p) => `'${p}'`).join(', ')}, ` +
      `got ${argument === undefined ? 'no argument' : JSON.stringify(argument)}. ` +
      'Usage: npx tsx scripts/play-perspective.ts first|third',
  );
}

async function main(): Promise<void> {
  const perspective = requestedPerspective();
  const { game } = await connect();
  const deadline = Date.now() + MOUNT_TIMEOUT_MS;

  // The arena's own function, in the running mount's own module instance.
  // There is no CLI verb for this and there should not be one: a game's
  // surface is its own code.
  //
  // ONE CALLBACK PER VALUE, and it is not a style choice. A `game.run`
  // callback is SERIALIZED and evaluated in the page: it closes over NOTHING
  // from this process, so `setPerspective(perspective)` — reading the local
  // above — does not fail to compile, it fails at runtime in the tab with
  // `ReferenceError: perspective is not defined`, 45 seconds later, wearing
  // this function's own "no game answered" message. Every value a `game.run`
  // body needs must be a LITERAL inside it.
  const apply = () =>
    perspective === 'third'
      ? game.run(async ({ modules }) => {
          const m = (await modules('src/perspective.ts')) as {
            setPerspective(next: Perspective): Perspective;
          };
          return m.setPerspective('third');
        })
      : game.run(async ({ modules }) => {
          const m = (await modules('src/perspective.ts')) as {
            setPerspective(next: Perspective): Perspective;
          };
          return m.setPerspective('first');
        });

  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const applied = await apply();
      console.log(`arena: playing from ${String(applied)} person`);
      return;
    } catch (error) {
      // No game mounted yet is the expected case on the transport's path, and
      // it is indistinguishable here from any other refusal — so keep the last
      // one and report it if the budget runs out, rather than swallowing it.
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, MOUNT_POLL_MS));
    }
  }
  throw new Error(
    `play-perspective: no game answered within ${MOUNT_TIMEOUT_MS / 1000}s — ` +
      'is this project playing? Enter Play in the editor, or start this ' +
      `configuration again once it is. Last refusal: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
