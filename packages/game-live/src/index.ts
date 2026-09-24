/**
 * `@volter/game-live` — `{ editor, game, page, tools, session }` over a game
 * project's editor session. `@volter/editor-live` owns the session and the
 * editor/tools half and stays game-free; this package adds the GAME half on
 * the same resolved session: the game client (`game`), the page step bound
 * to it (`page(step)`, plus `page.reload()`), and `editor.recording`.
 *
 * It never starts or stops a session. `connect()` and the lazy singletons
 * only ATTACH to a session `volter-game-editor edit` started.
 *
 *   import { connect } from '@volter/game-live';
 *   const { editor, game, page } = await connect();
 *   await game.waitFor((s) => s('score') >= 10, { simSeconds: 5 });
 *
 *   import { editor, game, page } from '@volter/game-live';
 *   await game.input.tap('jump');
 *
 * `page(step)` is `GameClient.page(step)`, rooted at the running GAME
 * container. `step` is shipped to the editor as `step.toString()`, so
 * closures over outer variables do not survive: write it as a literal
 * `async (page) => {...}` and inline every value it needs.
 */
import { join } from 'node:path';
import { connect as connectEditor, type LiveEditor, type LiveTools, type ResolvedSession, type SessionResolutionDeps } from '@volter/editor-live';
import { EditorClient } from '@volter/editor-sdk/client';
import { createLiveGame, type LiveGame } from './game.js';
import type { GameClient } from './game-client/index.js';
import { lazyChainProxy } from './lazy-proxy.js';
import { LiveGameplayRecording } from './recording.js';
import { createLazySession } from './singleton.js';

export { createGameClient, createLiveGame, type AddressedGameClient, type LiveGame } from './game.js';
export * from './game-client/index.js';
export type { GameplayRecordingResult } from './recording.js';
export { LiveGameplayRecording } from './recording.js';

/** The `page` binding: a `game.page(step)`-shaped call that also carries the
 *  one page verb no step can express — `page.reload()`, because a step that
 *  navigates destroys the channel its own result would return on. */
export type PageStep = GameClient['page'] & { reload: GameClient['reloadPage'] };

/** `@volter/editor-live`'s editor plus `recording`, the gameplay-recording door. */
export type GameLiveEditor = LiveEditor & { readonly recording: LiveGameplayRecording };

/** The game half, bound to one session. */
export interface GameBindings {
  game: LiveGame;
  page: PageStep;
  recording: LiveGameplayRecording;
}

export interface LiveSession {
  editor: GameLiveEditor;
  game: LiveGame;
  page: PageStep;
  tools: LiveTools;
  session: ResolvedSession;
}

/** Build the game half for a resolved session. Contacts nothing until a
 *  method is awaited. */
export function gameBindings(session: ResolvedSession): GameBindings {
  const game = createLiveGame(session.port, join(session.projectRoot, '.vgai', 'last-run'), session.projectRoot);
  const step: GameClient['page'] = (fn) => game.page(fn);
  const page: PageStep = Object.assign(step, { reload: () => game.reloadPage() });
  const recording = new LiveGameplayRecording(new EditorClient({ url: `http://127.0.0.1:${session.port}` }));
  return { game, page, recording };
}

/** Resolve `projectDir` (default cwd) to its live session and bind
 *  `{ editor, game, page, tools, session }` to it. */
export async function connect(projectDir?: string, deps?: SessionResolutionDeps): Promise<LiveSession> {
  const live = await connectEditor(projectDir, deps);
  const { game, page, recording } = gameBindings(live.session);
  const editor: GameLiveEditor = Object.assign(live.editor, { recording });
  return { editor, game, page, tools: live.tools, session: live.session };
}

// Lazy top-level singletons — first use connects against the cwd; every
// later use, across all four, reuses the same session.
const lazySession = createLazySession(() => connect());

export const editor: GameLiveEditor = lazyChainProxy<GameLiveEditor>(() => lazySession.ensure().then((s) => s.editor));
export const game: LiveGame = lazyChainProxy<LiveGame>(() => lazySession.ensure().then((s) => s.game));
export const page: PageStep = lazyChainProxy<PageStep>(() => lazySession.ensure().then((s) => s.page));
export const tools: LiveTools = lazyChainProxy<LiveTools>(() => lazySession.ensure().then((s) => s.tools));
