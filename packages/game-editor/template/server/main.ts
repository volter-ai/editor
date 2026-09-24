/**
 * `npm run server` entry point — boots the Colyseus multiplayer server
 * (rooms.ts's registry, on ws://localhost:2567).
 *
 * THIS IS DELIBERATELY NOT A `process` RUN CONFIGURATION, and `npm run server`
 * is the only door to it. Declaring it in `vgai.project.json.configurations`
 * is what a project does once it HAS multiplayer, and the template does not:
 * nothing under `src/` constructs a Colyseus client or joins a room, so there
 * is no connection for `SystemAdapters.NetworkingAdapter` to describe and the
 * editor's Network panel would be dark. Declaring the half we ship without the
 * half we do not made every fresh scaffold open on a standing
 * `system.networking` coverage warning it could not act on -- measured
 * 2026-09-20 on a `--template game` scaffold, in edit mode, before any play:
 * *"this project declares a `server` block, so the editor's Network panel is
 * dark for a game that IS networked"* -- which was simply not true of a
 * template that joins nothing. Without the declaration the same row reads
 * terminal off the project's own file, and the scaffold is quiet.
 *
 * So the rooms below stay (they are the bootstrap a multiplayer game starts
 * from, and the e2e/loopback harnesses import this registry), and the run
 * configuration arrives WITH the client half -- `vgai add colyseus` copies in
 * the connection and the adapter binding together. If you add that half, add
 * the configuration back in the same commit:
 *   { "id": "server", "kind": "process", "entry": "server/main.ts",
 *     "command": "npx tsx --tsconfig server/tsconfig.json server/main.ts",
 *     "port": 2567 }
 * Do not add it back on its own -- that is the warning, restored.
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
