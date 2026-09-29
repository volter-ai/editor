import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { EditorClient } from '@volter/editor-sdk/client';
import { LiveEditor, LiveTools } from '@volter/editor-live';
import { connectHostedAttachment, HOSTED_ATTACHMENT_FRAGMENT, HOSTED_ATTACHMENT_PATH, hostedSocketUrl, type HostedAttachment } from '@volter/editor-sdk/session/hosted-attachment';
import { openBrowserUrl } from '../open-browser';
import { control } from './control';

export const HOSTED_USAGE = 'hosted attach <https-url> | hosted status | hosted eval <JavaScript> | hosted screenshot <file.png> | hosted detach';

/** Hosted attachment state is private to this OS user and working directory.
 * It never replaces the local project registry or silently falls back to it. */
function stateFile(): string {
  const key = createHash('sha256').update(resolve(process.cwd())).digest('hex');
  return join(homedir(), '.local', 'state', 'volter-editor', 'hosted', `${key}.json`);
}
export async function hostedControl(command: string, args: string[]): Promise<void> {
  const [verb, argument] = args;
  if (args.length > (verb === 'attach' || verb === 'eval' || verb === 'screenshot' ? 2 : 1)) throw new Error(HOSTED_USAGE);
  const file = stateFile();
  if (verb === 'attach') {
    if (!argument) throw new Error(HOSTED_USAGE);
    if (existsSync(file)) throw new Error('This directory already has a hosted attachment. Use hosted status or hosted detach; attaching never opens a duplicate tab.');
    const page = new URL(argument);
    if (page.username || page.password || page.hash) throw new Error('Use the hosted page URL without credentials or a fragment.');
    hostedSocketUrl(page.href); // Refuse non-TLS remote addresses before sending.
    const response = await fetch(new URL(HOSTED_ATTACHMENT_PATH, page), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: page.href }), signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Hosted attachment refused (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const created = await response.json() as { id: string; endpoint: string; page: string; expiresAt: number; clientToken: string; workerToken: string };
    if (created.page !== page.href || new URL(created.endpoint).origin !== page.origin || !/^[a-f0-9]{64}$/.test(created.clientToken) || !/^[a-f0-9]{64}$/.test(created.workerToken)) throw new Error('Invalid hosted attachment response.');
    const common = { id: created.id, endpoint: created.endpoint, page: created.page, expiresAt: created.expiresAt };
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ ...common, token: created.clientToken }), { mode: 0o600, flag: 'wx' });
    page.hash = new URLSearchParams({ [HOSTED_ATTACHMENT_FRAGMENT]: JSON.stringify({ ...common, token: created.workerToken }) }).toString();
    openBrowserUrl(page.href, { background: true });
    console.log(`Opening hosted editor: ${created.page}\nUse ${command} hosted status from this directory. Attachment expires ${new Date(created.expiresAt).toISOString()}.`);
    return;
  }
  if (!['status', 'eval', 'screenshot', 'detach'].includes(verb ?? '')) throw new Error(HOSTED_USAGE);
  let attachment: HostedAttachment;
  try { attachment = JSON.parse(readFileSync(file, 'utf8')) as HostedAttachment; }
  catch { throw new Error(`No hosted attachment in this directory. Run ${command} hosted attach <https-url>.`); }
  if (verb === 'detach') {
    // Revoke without touching an unrelated local editor or killing a browser.
    const socket = new WebSocket(hostedSocketUrl(attachment.endpoint));
    await new Promise<void>((done) => {
      const timer = setTimeout(() => { socket.close(); done(); }, 5000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', role: 'client', token: attachment.token })));
      socket.addEventListener('message', event => { if (JSON.parse(String(event.data)).type === 'ready') socket.send(JSON.stringify({ type: 'revoke' })); });
      socket.addEventListener('close', () => { clearTimeout(timer); done(); });
      socket.addEventListener('error', () => { clearTimeout(timer); done(); });
    });
    rmSync(file); console.log('Hosted attachment removed. The browser document is preserved.'); return;
  }
  const remote = await connectHostedAttachment(attachment);
  try {
    if (verb === 'status' && remote.state['phase'] !== 'ready') { console.log(JSON.stringify(remote.state, null, 2)); return; }
    const client = new EditorClient({ url: 'http://127.0.0.1', fetch: remote.fetch });
    const live = { editor: new LiveEditor(client), tools: new LiveTools(client), session: { port: 0, projectRoot: attachment.page } };
    if (verb === 'screenshot') {
      if (!argument?.endsWith('.png')) throw new Error('hosted screenshot requires an output .png path.');
      const shot = await live.editor.screenshot();
      if (shot.mimeType !== 'image/png') throw new Error('Editor did not return a PNG viewport.');
      writeFileSync(resolve(argument), Buffer.from(shot.base64, 'base64')); console.log(resolve(argument));
    } else await control(command, verb!, argument, undefined, undefined, { live, client });
  } finally { remote.close(); }
}
