/** Private extension-host control channel. Prompts and approvals still use frontend.v2. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { harnessModelChoices } from './harness-models';

export interface ChatSelection {
  harness: string;
  model: string;
  effort: string;
}
export interface ChatChoice { id: string; name: string; description?: string; efforts?: string[] }
/** No harness chosen: the Chat view runs whichever harness supercode reports available. */
export const DEFAULT_CHAT_SELECTION: ChatSelection = { harness: '', model: '', effort: '' };

/** The models and efforts the harness itself names (harness-models.ts); exact model IDs can also be entered. */
export function chatModels(harness: string, env?: NodeJS.ProcessEnv): ChatChoice[] {
  return harnessModelChoices(harness, env);
}

export function validateChatSelection(value: unknown): ChatSelection {
  const s = value as Partial<ChatSelection> | null;
  if (!s || typeof s.harness !== 'string' || !/^[a-z0-9-]{1,60}$/.test(s.harness) ||
      typeof s.model !== 'string' || s.model.length > 160 || /[\x00-\x1f]/.test(s.model) ||
      // The effort is one word the harness itself lists (harness-models.ts); the harness refuses one it does not take.
      typeof s.effort !== 'string' || !/^(?:[a-z]{1,16})?$/.test(s.effort)) throw new Error('Invalid chat selection.');
  if ((s.model || s.effort) && !['claude-code', 'codex'].includes(s.harness)) throw new Error('This harness does not expose model or reasoning configuration in this editor yet.');
  return { harness: s.harness, model: s.model, effort: s.effort };
}

/** Preserve the SDK-published protocol/permission flags and add only explicit session choices. */
export function selectedChatLaunch(selection: ChatSelection, launch: { program: string; arguments: string[]; env?: Record<string, string> }) {
  const args = [...launch.arguments];
  if (selection.harness === 'claude-code') {
    if (selection.model) args.push('--model', selection.model);
    if (selection.effort) args.push('--effort', selection.effort);
  } else if (selection.harness === 'codex') {
    if (selection.model) args.push('-c', `model=${JSON.stringify(selection.model)}`);
    if (selection.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(selection.effort)}`);
  }
  return { ...launch, arguments: args };
}

/**
 * "ASK FOR APPROVAL" ASKS (t_8ea14bad). The Chat's own setting decides whether it answers the runtime's approval
 * requests itself (Auto approve) or shows them to the person (Ask), but it can answer only the requests the runtime
 * raises. A Claude Code launched with no mode keeps its own default, and from Claude Code 2.1.285 an SDK session can
 * start in `auto`, where it approves its own calls and raises nothing: read on Windows, a Bash call accepted with
 * source config, reasonType classifier, and Ask never asked. So a Claude Code launch names its manual mode,
 * `--permission-mode default`, where a call that needs approval raises a request; Auto approve answers it as before.
 * The flag rides the launch the editor already shapes (`selectedChatLaunch`), so it needs nothing newer than the
 * pinned supercode. A launch that already names a mode, or skips permissions, is left as it is.
 */
export function withManualApproval(launch: { program: string; arguments: string[]; env?: Record<string, string> }) {
  if (launch.arguments.some((arg) => arg === '--permission-mode' || arg.startsWith('--permission-mode=') || arg === '--dangerously-skip-permissions')) return launch;
  return { ...launch, arguments: [...launch.arguments, '--permission-mode', 'default'] };
}

export class FrontendControls {
  private server: Server | undefined;
  private readonly secret = randomBytes(32).toString('hex');
  private readonly directory = join(homedir(), '.volter', 'runtime', `chat-controls-${process.pid}-${randomBytes(6).toString('hex')}`);
  private readonly state: () => Promise<unknown>;
  private readonly select: (s: ChatSelection) => Promise<unknown>;
  constructor(state: () => Promise<unknown>, select: (s: ChatSelection) => Promise<unknown>, private readonly open?: (id: string) => Promise<unknown>, private readonly remember?: (id:string, nativeId:string) => Promise<unknown>, private readonly setup?: (kind: string, harness: string) => Promise<unknown>) { this.state = state; this.select = select; }
  private starting: Promise<Record<string, string>> | undefined;
  /** Starts the channel once; callers that arrive while it binds share that start. */
  start(): Promise<Record<string, string>> {
    this.starting ??= this.bind().catch((error) => { this.starting = undefined; throw error; });
    return this.starting;
  }
  private async bind(): Promise<Record<string, string>> {
    if (!this.server) {
      this.server = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        const supplied = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        if (req.headers.origin || supplied.length !== this.secret.length || !timingSafeEqual(supplied, Buffer.from(this.secret))) {
          res.writeHead(403).end(JSON.stringify({ error: 'Forbidden' })); return;
        }
        try {
          if (req.method === 'GET' && req.url === '/state') { res.end(JSON.stringify(await this.state())); return; }
          if (req.method !== 'POST' || !['/select', '/open', '/remember', '/setup'].includes(req.url ?? '')) { res.writeHead(404).end('{}'); return; }
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 4096) throw new Error('Chat selection is too large.');
          }
          const value = JSON.parse(body);
          if (req.url === '/setup') {
            if (!this.setup || !['login', 'install'].includes(value.kind) || typeof value.harness !== 'string' || !/^[a-z0-9-]{1,60}$/.test(value.harness)) throw new Error('Invalid chat setup action.');
            res.end(JSON.stringify(await this.setup(value.kind, value.harness)));
          } else if (req.url === '/remember') {
            if (!this.remember || typeof value.id !== 'string' || typeof value.nativeId !== 'string' || value.nativeId.length > 200) throw new Error('Invalid chat identity.');
            res.end(JSON.stringify(await this.remember(value.id, value.nativeId)));
          } else if (req.url === '/open') {
            if (!this.open || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)) throw new Error('Invalid chat session.');
            res.end(JSON.stringify(await this.open(value.id)));
          } else res.end(JSON.stringify(await this.select(validateChatSelection(value))));
        } catch (error) { res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
      });
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(0, '127.0.0.1', () => { this.server!.off('error', reject); resolve(); });
      });
      this.server.unref();
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      writeFileSync(join(this.directory, 'credential'), this.secret, { mode: 0o600 });
    }
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Chat controls did not bind.');
    return { SUPERCODE_FRONTEND_HOST_URL: `http://127.0.0.1:${address.port}`, SUPERCODE_FRONTEND_HOST_CREDENTIAL_FILE: join(this.directory, 'credential') };
  }
  close(): void { this.server?.close(); this.server?.closeAllConnections(); rmSync(this.directory, { recursive: true, force: true }); }
}
