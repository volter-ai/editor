/**
 * `/__editor/configurations` — the RUNNER for a project's declared run configurations
 * (ARCHITECTURE-CORE §The project model: the `run[]` axis). The manifest
 * declares an entrypoint by registered kind; this is the host that starts
 * and stops the `process` kind beside the editor and reports it, and
 * expands a `compound` into its members (`play` is the browser's own mount,
 * never started here). The editor's transport, `vgai run <id>` and a
 * harness all come through this one door, so a process started by any of
 * them is the same process, listed the same way, and dies with the session.
 *
 *   GET  /__editor/configurations                 → { configurations: [{ id, kind, status, pid?, port?, entry? }] }
 *   POST /__editor/configurations/:id/start       → { ok, started: [id…], attached: [id…], ready }
 *   POST /__editor/configurations/:id/stop        → { ok, stopped: [id…] }
 *   GET  /__editor/configurations/:id/log         → { lines }
 *
 * A port already answering before a start is ATTACHED, not fought over: the
 * caller wanted "a server on that port", and one is there. A port nothing
 * answers on after the readiness timeout is reported as not ready, with the
 * process's own last lines, never as success.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import type { DeclaredConfiguration } from '@volter/editor-project/manifest/configuration-kinds';
import {
  configurationKind,
  PLAY_CONFIGURATION_ID,
} from '@volter/editor-project/manifest/configuration-kinds';
import { loadGameManifestDir } from '@volter/editor-project/manifest/load-file';
import { nodeRuntimeIssue } from '@volter/editor-project/manifest/runtime-environment';
import type { EditorServerRouter } from '../editor-server';
import { packageProjectWebBuild } from '../project-build-artifact';
import { ensureProjectConfigurationKinds, kindModuleLoader } from '../project-kinds';
import { executeProjectTool } from '../project-tools';
import type { RouteContext } from './context';

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 300;
const LOG_LINES = 200;

interface RunningProcess {
  readonly id: string;
  readonly child: ChildProcess;
  readonly port: number | null;
  readonly log: string[];
  startedAt: number;
}

const running = new Map<string, RunningProcess>();

function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

async function httpAnswers(port: number, path: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitReady(port: number | null, http: string | undefined): Promise<boolean> {
  if (port === null) return true;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const up = http ? await httpAnswers(port, http) : await portAnswers(port);
    if (up) return true;
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  return false;
}

function pushLog(entry: RunningProcess, chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line) continue;
    entry.log.push(line);
    if (entry.log.length > LOG_LINES) entry.log.splice(0, entry.log.length - LOG_LINES);
  }
}

async function declaredRun(ctx: RouteContext): Promise<readonly DeclaredConfiguration[]> {
  const kindErrors = await ensureProjectConfigurationKinds(ctx.projectRoot);
  if (kindErrors.length > 0) throw new Error(kindErrors.join('\n'));
  return loadGameManifestDir(ctx.projectRoot).configurations;
}

function processFields(configuration: DeclaredConfiguration): {
  entry: string;
  command: string | undefined;
  port: number | null;
  cwd: string | undefined;
  env: Record<string, string> | undefined;
  http: string | undefined;
} {
  return {
    entry: configuration['entry'] as string,
    command: configuration['command'] as string | undefined,
    port: typeof configuration['port'] === 'number' ? (configuration['port'] as number) : null,
    cwd: configuration['cwd'] as string | undefined,
    env: configuration['env'] as Record<string, string> | undefined,
    http: (configuration['ready'] as { http?: string } | undefined)?.http,
  };
}

async function startProcess(
  ctx: RouteContext,
  configuration: DeclaredConfiguration,
): Promise<{ started: boolean; attached: boolean; ready: boolean; log: string[] }> {
  const live = running.get(configuration.id);
  if (live && live.child.exitCode === null) {
    return { started: false, attached: true, ready: true, log: [...live.log] };
  }
  const fields = processFields(configuration);
  if (fields.port !== null && (await portAnswers(fields.port))) {
    // Something already serves the port. Attach: the caller asked for a
    // server there, and one is there — a foreign one is still one.
    return { started: false, attached: true, ready: true, log: [] };
  }
  const isWin = process.platform === 'win32';
  const cwd = fields.cwd ? join(ctx.projectRoot, fields.cwd) : ctx.projectRoot;
  const command = fields.command ?? `npx tsx ${fields.entry}`;
  const child = spawn(command, {
    cwd,
    env: { ...process.env, ...(fields.env ?? {}) },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !isWin,
  });
  const entry: RunningProcess = {
    id: configuration.id,
    child,
    port: fields.port,
    log: [],
    startedAt: Date.now(),
  };
  child.stdout?.on('data', (d: Buffer) => pushLog(entry, d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => pushLog(entry, d.toString('utf8')));
  child.once('exit', (code, signal) => {
    pushLog(entry, `[exited: code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}]`);
  });
  running.set(configuration.id, entry);
  const ready = await waitReady(fields.port, fields.http);
  return { started: true, attached: false, ready, log: [...entry.log] };
}

function stopProcess(id: string): boolean {
  const live = running.get(id);
  if (!live) return false;
  running.delete(id);
  if (live.child.exitCode !== null) return false;
  const pid = live.child.pid;
  try {
    if (process.platform !== 'win32' && pid !== undefined) process.kill(-pid, 'SIGTERM');
    else live.child.kill('SIGTERM');
  } catch {
    // already gone
  }
  return true;
}

/** Kill every process this runner started — the session is ending. */
export function stopAllConfigurations(): void {
  for (const id of [...running.keys()]) stopProcess(id);
}

function membersOf(
  configuration: DeclaredConfiguration,
  all: readonly DeclaredConfiguration[],
): DeclaredConfiguration[] {
  if (configuration.kind !== 'compound') return [configuration];
  const ids = (configuration['run'] as readonly string[]) ?? [];
  return ids
    .filter((id) => id !== PLAY_CONFIGURATION_ID)
    .flatMap((id) => {
      const member = all.find((c) => c.id === id);
      return member ? membersOf(member, all) : [];
    });
}

export function registerConfigurationRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  router.get('/__editor/configurations', async (_req: Request, res: Response) => {
    let declared: readonly DeclaredConfiguration[];
    try {
      declared = await declaredRun(ctx);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    res.json({
      configurations: declared.map((configuration) => {
        const live = running.get(configuration.id);
        const alive = live !== undefined && live.child.exitCode === null;
        return {
          id: configuration.id,
          kind: configuration.kind,
          role: configurationKind(configuration.kind)?.role ?? null,
          describe: configurationKind(configuration.kind)?.describe ?? null,
          status: alive ? 'running' : 'stopped',
          ...(alive ? { pid: live.child.pid, since: live.startedAt } : {}),
          ...(configuration.kind === 'process'
            ? { entry: configuration['entry'], port: configuration['port'] ?? null }
            : {}),
          ...(configuration.kind === 'compound'
            ? { run: configuration['run'], instances: configuration['instances'] ?? null }
            : {}),
        };
      }),
    });
  });

  router.post('/__editor/configurations/:id/start', async (req: Request, res: Response) => {
    const id = String(req.params['id']);
    let declared: readonly DeclaredConfiguration[];
    try {
      declared = await declaredRun(ctx);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const configuration = declared.find((c) => c.id === id);
    if (!configuration) {
      res.status(404).json({
        error: `No run configuration "${id}" — declared: ${declared.map((c) => `"${c.id}"`).join(', ') || 'none'}`,
      });
      return;
    }
    const members = membersOf(configuration, declared);
    const unrunnable = members.filter((m) => m.kind !== 'process');
    if (unrunnable.length > 0) {
      res.status(400).json({
        error: `No runner for kind ${unrunnable.map((m) => `"${m.kind}"`).join(', ')} — this host starts "process" (and "compound" of them)`,
      });
      return;
    }
    // The runtime a process needs is package.json `engines.node`, declared
    // once and read here (ARCHITECTURE-CORE §The project model, environment).
    const runtimeIssue = nodeRuntimeIssue(ctx.projectRoot);
    if (runtimeIssue) {
      res.status(400).json({ error: `Configuration "${id}" cannot start: ${runtimeIssue}` });
      return;
    }
    const started: string[] = [];
    const attached: string[] = [];
    let ready = true;
    const logs: Record<string, string[]> = {};
    for (const member of members) {
      const outcome = await startProcess(ctx, member);
      if (outcome.started) started.push(member.id);
      if (outcome.attached) attached.push(member.id);
      if (!outcome.ready) ready = false;
      logs[member.id] = outcome.log;
    }
    res.json({ ok: ready, started, attached, ready, logs });
  });

  // ---- build-role configurations: run to completion, stream the log, package
  let activeBuild: ChildProcess | null = null;
  let packaging = false;
  router.post('/__editor/configurations/:id/build', async (req: Request, res: Response) => {
    const id = String(req.params['id']);
    if (activeBuild || packaging) {
      res.status(409).json({ error: 'A build is already running.' });
      return;
    }
    let declared: readonly DeclaredConfiguration[];
    try {
      declared = await declaredRun(ctx);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const configuration = declared.find((c) => c.id === id);
    if (!configuration) {
      res.status(404).json({
        error: `No configuration "${id}" — declared: ${declared.map((c) => `"${c.id}"`).join(', ') || 'none'}`,
      });
      return;
    }
    const kind = configurationKind(configuration.kind);
    if (kind?.role !== 'build') {
      res.status(400).json({
        error: `Configuration "${id}" is ${kind ? `a ${kind.role}-role ${configuration.kind}` : 'of an unregistered kind'} — build starts a build-role configuration`,
      });
      return;
    }
    if (configuration.kind !== 'bundle') {
      // A contributed build kind runs as the project TOOL it names.
      const bridge = kind.build;
      if (!bridge) {
        res.status(400).json({
          error: `No runner for build kind "${configuration.kind}" — this host builds "bundle" and any kind whose contribution names a tool`,
        });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(':ok\n\n');
      const say = (line: string) => res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
      say(`Running tool ${bridge.tool} for configuration "${id}"…`);
      try {
        const outcome = await executeProjectTool({
          account: ctx.account,
          projectRoot: ctx.projectRoot,
          loadModule: kindModuleLoader() ?? undefined,
          name: bridge.tool,
          input: bridge.input(configuration),
          confirmed: true,
        });
        const ok = outcome.status === 200 && (outcome.body as { ok?: boolean }).ok !== false;
        if (!ok) {
          const detail = (outcome.body as { error?: { message?: string } }).error?.message;
          say(`Tool refused: ${detail ?? JSON.stringify(outcome.body).slice(0, 300)}`);
        }
        res.write(
          `event: done\ndata: ${JSON.stringify({ ok, code: ok ? 0 : 1, report: ok ? outcome.body : undefined })}\n\n`,
        );
      } catch (error) {
        say(`Error: ${error instanceof Error ? error.message : String(error)}`);
        res.write(`event: done\ndata: ${JSON.stringify({ ok: false, code: null })}\n\n`);
      } finally {
        res.end();
      }
      return;
    }
    const script = (configuration['script'] as string | undefined) ?? 'build';
    const args = (configuration['args'] as readonly string[] | undefined) ?? [];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(':ok\n\n');
    const child = spawn('npm', ['run', script, ...(args.length > 0 ? ['--', ...args] : [])], {
      cwd: ctx.projectRoot,
      // The editor runs in development mode. A bundled artifact must compile
      // production branches, including the exported-game boundary.
      env: { ...process.env, NODE_ENV: 'production' },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeBuild = child;
    const sendLine = (line: string) => {
      res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
    };
    let buffer = '';
    const flushLines = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) sendLine(line);
    };
    child.stdout?.on('data', flushLines);
    child.stderr?.on('data', flushLines);
    child.on('close', async (code) => {
      if (buffer) sendLine(buffer);
      buffer = '';
      activeBuild = null;
      if (code !== 0) {
        res.write(`event: done\ndata: ${JSON.stringify({ ok: false, code })}\n\n`);
        res.end();
        return;
      }
      packaging = true;
      try {
        const report = await packageProjectWebBuild(ctx.projectRoot);
        sendLine(
          `Packaged ${report.fileCount} files (${report.outputBytes} bytes) as ` +
            `${report.artifact} (${report.artifactBytes} bytes).`,
        );
        res.write(`event: done\ndata: ${JSON.stringify({ ok: true, code, report })}\n\n`);
      } catch (error) {
        sendLine(`Error: ${(error as Error).message}`);
        res.write(`event: done\ndata: ${JSON.stringify({ ok: false, code: null })}\n\n`);
      } finally {
        packaging = false;
        res.end();
      }
    });
    req.on('close', () => {
      if (activeBuild === child && child.exitCode === null) child.kill();
    });
  });

  router.post('/__editor/configurations/:id/stop', async (req: Request, res: Response) => {
    const id = String(req.params['id']);
    let declared: readonly DeclaredConfiguration[] = [];
    try {
      declared = await declaredRun(ctx);
    } catch {
      // a manifest that no longer parses still lets a running child be stopped by id
    }
    const configuration = declared.find((c) => c.id === id);
    const targets = configuration ? membersOf(configuration, declared).map((m) => m.id) : [id];
    const stopped = targets.filter((t) => stopProcess(t));
    res.json({ ok: true, stopped });
  });

  router.get('/__editor/configurations/:id/log', (req: Request, res: Response) => {
    const id = String(req.params['id']);
    const live = running.get(id);
    res.json({ lines: live ? [...live.log] : [] });
  });
}
