import { connect, unconnectedBindings, type LiveSession } from '@volter/editor-live';
import { EditorClient } from '@volter/editor-sdk/client';
import { verifiedSessions, terminateEditorSession } from './editor-sessions';
import { formatSurface } from './eval-surface';
import { CONTROLLER_DISCONNECTED_MESSAGE } from '../server-utils';

/** Extra `eval` bindings a product adds on the same session (the game
 *  product's `game` and `page`); a returned name replaces the kit's own. */
export type EvalScope = (live: LiveSession) => Record<string, unknown>;

export async function control(command: string, verb: string, argument?: string, reason?: string, scope?: EvalScope): Promise<void> {
  if (verb === 'eval' && argument === '--list') {
    // No session needed: the same bindings, built on port 0 and never contacted.
    const unconnected = { ...unconnectedBindings(), session: { port: 0, projectRoot: process.cwd() } };
    console.log(formatSurface(command, { ...unconnected, ...scope?.(unconnected) }));
    return;
  }
  const live = await connect();
  const client = new EditorClient({ url: `http://127.0.0.1:${live.session.port}` });
  if (verb === 'close') {
    const session = (await verifiedSessions(live.session.port)).find(s => s.port === live.session.port && s.project === live.session.projectRoot && s.registered);
    if (!session?.pid) throw new Error('Cannot close a session without verified process ownership.');
    const state = await client.getState();
    // A genuinely headless session has no document owner to flush. A present
    // but unresponsive tab is different: try its barrier and refuse on failure.
    if (state.connected || (state.tabs?.length ?? 0) > 0) {
      try {
        await client.prepareClose();
      } catch (error) {
        // A tab that went away while it was asked to flush (its browser closed) has nothing
        // left to flush, and refusing then left the session running with no tab at all, where
        // nothing else would ever stop it. The relay's own disconnect answer says so at once
        // (the tab list catches up seconds later); any other failure is a tab still there
        // that could not flush, and refuses the close.
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes(CONTROLLER_DISCONNECTED_MESSAGE)) throw error;
      }
    }
    console.log(await terminateEditorSession({ pid: session.pid }));
    return;
  }
  if (verb === 'console-ack') {
    if (!argument || !reason?.trim()) throw new Error('Acknowledgment requires a console entry id and a reason.');
    const result = await client.acknowledgeConsole({id: argument, reason, by: `${command} CLI`}) as {ok?: boolean; error?: string};
    if (result.ok !== true) throw new Error(result.error ?? 'Console acknowledgment failed.');
    console.log(JSON.stringify(result, null, 2));
  } else if (verb === 'status') console.log(JSON.stringify(await live.editor.status(), null, 2));
  else if (verb === 'eval') {
    if (!argument) throw new Error(`eval requires JavaScript; \`${command} eval --list\` shows what is in scope.`);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const bindings: Record<string, unknown> = { editor: live.editor, tools: live.tools, session: live.session, ...scope?.(live) };
    // Expression first, statements as the fallback (the Node REPL's rule), so
    // `eval 'editor.status()'` prints without the caller writing `return`.
    let body: (...values: unknown[]) => Promise<unknown>;
    try { body = new AsyncFunction(...Object.keys(bindings), `return (${argument}\n);`); }
    catch { body = new AsyncFunction(...Object.keys(bindings), argument); }
    const result: unknown = await body(...Object.values(bindings));
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  } else if (verb !== 'console') throw new Error(`Unknown command: ${verb}`);
  const consoleState = await client.getUnresolvedConsole() as { entries?: unknown[] };
  if (consoleState.entries?.length) {
    console.error(JSON.stringify(consoleState, null, 2));
    process.exitCode = 1;
  }
}
