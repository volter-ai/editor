import { connect } from '@volter/editor-live';
import { EditorClient } from '@volter/editor-sdk/client';
import { verifiedSessions, terminateEditorSession } from './editor-sessions';

export async function control(verb: string, argument?: string, reason?: string): Promise<void> {
  const live = await connect();
  const client = new EditorClient({ url: `http://127.0.0.1:${live.session.port}` });
  if (verb === 'close') {
    const session = (await verifiedSessions(live.session.port)).find(s => s.port === live.session.port && s.project === live.session.projectRoot && s.registered);
    if (!session?.pid) throw new Error('Cannot close a session without verified process ownership.');
    console.log(await terminateEditorSession({ pid: session.pid }));
    return;
  }
  if (verb === 'console-ack') {
    if (!argument || !reason?.trim()) throw new Error('Acknowledgment requires a console entry id and a reason.');
    const result = await client.acknowledgeConsole({id: argument, reason, by: 'volter-editor CLI'}) as {ok?: boolean; error?: string};
    if (result.ok !== true) throw new Error(result.error ?? 'Console acknowledgment failed.');
    console.log(JSON.stringify(result, null, 2));
  } else if (verb === 'status') console.log(JSON.stringify(await live.editor.status(), null, 2));
  else if (verb === 'eval') {
    if (!argument) throw new Error('eval requires a JavaScript function body; use return to print a result.');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const result: unknown = await new AsyncFunction('editor', 'tools', 'session', argument)(live.editor, live.tools, live.session);
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  } else if (verb !== 'console') throw new Error(`Unknown command: ${verb}`);
  const consoleState = await client.getUnresolvedConsole() as { entries?: unknown[] };
  if (consoleState.entries?.length) {
    console.error(JSON.stringify(consoleState, null, 2));
    process.exitCode = 1;
  }
}
