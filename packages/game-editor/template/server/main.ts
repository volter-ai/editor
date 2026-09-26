/**
 * `npm run server` entry point — boots the Colyseus multiplayer server
 * (rooms.ts's registry, on ws://localhost:2567).
 *
 * The project runs it as its `server` configuration (`vgai.project.json`), and Play starts it
 * through `play + server`, before the game's client half (`src/net/`) joins `game_room`. Both
 * arrive with the `server` addition; a project without it keeps these rooms and has neither.
 *
 * This is the standalone counterpart to the two existing harnesses that already start
 * `startColyseus` (colyseus-setup.ts): the e2e showcase's
 * `startColyseusServer` (packages/editor/e2e/helpers/colyseus.ts) and the
 * unit-test in-process loopback (packages/editor/test/helpers/colyseus-loopback.ts).
 *
 * Run via `npm run server`, which invokes tsx against `server/tsconfig.json`
 * (not the app `tsconfig.json` at the project root) — `@colyseus/schema`'s
 * `@type(...)` decorators are legacy (TC39 stage-2) decorators, which need
 * `experimentalDecorators: true` + `useDefineForClassFields: false`;
 * `server/tsconfig.json` already carries those settings (pre-existing, for
 * editor/IDE typechecking of this directory) while the app tsconfig targets
 * ES2022 without them — which is why the e2e harness instead has to
 * esbuild-bundle with a forced tsconfig-raw override to run through node
 * directly rather than through tsx against the app tsconfig.
 */

// The manifest arrives as a STATIC import, the same way `src/main.ts` reads
// it. That is deliberate: no path is assembled here, so the filename stays
// spelled in exactly one place per module graph, and the file is resolved by
// the toolchain rather than probed at runtime.
import { startColyseus } from './colyseus-setup.js';
import { rooms } from './rooms.js';

const handle = await startColyseus({ rooms }).catch((err: NodeJS.ErrnoException) => {
  // The refusal below already says everything a reader needs; a raw stack
  // around it would be noise.
  if (err?.code !== 'EADDRINUSE') throw err;
  // The port is a constant (a game's ws:// origin lives in its own client
  // source), so two servers can never coexist on it. Name the likely holder
  // instead of leaving a raw bind stack: the editor session boots this
  // project's own room registry for the duration of a run when nothing is
  // already serving it, so a run in another terminal is the usual answer.
  console.error(
    'Colyseus: the server port is already in use — this server did not start.\n' +
      '  Another `npm run server` in a second terminal is the likely holder. Stop\n' +
      '  whatever holds the port and re-run (`vgai sessions` lists live editors).',
  );
  process.exit(1);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  handle.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
