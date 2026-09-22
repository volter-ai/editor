/**
 * `/__editor/worktrees/**` + `/__editor/repository-presence` — the worktree
 * board: what checkouts this repository has, which of them an editor is
 * serving, and the create / open / delegate / archive / stop verbs over them.
 *
 * Every route here is owner-local (`requireLocalOwner`): a worktree verb runs
 * git and spawns editors on the owner's machine, so a shared session's
 * participants never reach it.
 */

import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { EditorServerRouter } from '../editor-server';
import { createRepositoryPresenceReader } from '../repository-presence';
import { liveSessions } from '../session-registry';
import {
  archiveRepositoryWorktree,
  attachRepositoryPresence,
  createRepositoryWorktree,
  listRepositoryBranches,
  listRepositoryWorktrees,
  prepareRepositoryWorktree,
  publicWorktreeSessionRefs,
  vgaiCliLaunchCommand,
  type WorktreeView,
  worktreeEditorLaunchCommand,
} from '../worktree-management';
import type { RouteContext } from './context';

export function registerWorktreeRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const { currentSessionIdentity, engineRoot, harnessChat, requireLocalOwner } = ctx;
  /** Owned here: `/__editor/repository-presence` is its only reader. */
  const readRepositoryPresence = createRepositoryPresenceReader();

  const currentWorktrees = async (): Promise<WorktreeView[]> => {
    if (ctx.projectRoot === engineRoot) throw new Error('Open a Git-backed project first.');
    return listRepositoryWorktrees(ctx.projectRoot, publicWorktreeSessionRefs(liveSessions()));
  };

  /**
   * What the editor knows about one isolated worktree's editor.
   *
   * `unknown` and `stopped` used to be the same answer, and so did `starting`
   * and `crashed`:
   *
   * - a stopped Docker daemon made every record's state read `missing`, which
   *   `!== 'running'` mapped to `stopped` — a container the user must be told
   *   is UNINSPECTABLE was reported as a container we had looked at and found
   *   halted, which is exactly the reading a cleanup gesture must not act on.
   *   `docker-unavailable` is now its own health and every destructive
   *   affordance refuses on it.
   * - a running container whose editor never answered the compatibility probe
   *   read `starting` for as long as it existed. A boot has a duration; past
   *   {@link ISOLATED_EDITOR_BOOT_BUDGET_MS} of an unanswered probe against a
   *   container Docker says is RUNNING, the honest word is `unhealthy`.
   */
  type IsolatedWorktreeHealth =
    | 'healthy'
    | 'starting'
    | 'unhealthy'
    | 'stopped'
    | 'docker-unavailable';

  /** How long a running container's editor may go unprobeable before
   *  `starting` becomes `unhealthy`. A cold isolated editor installs and boots
   *  its own graph, so this is generous; what it must not be is unbounded. */
  const ISOLATED_EDITOR_BOOT_BUDGET_MS = 5 * 60_000;

  interface IsolatedWorktreeView {
    id: string;
    repositoryId: string;
    branch: string;
    from: string;
    editorPort: number;
    createdAt: string;
    exportedAt?: string;
    exportedHead?: string;
    state: string;
    /** `{{.State.StartedAt}}` from the same inspect, or `null` when the
     *  container could not be inspected. What BOUNDS `starting`. */
    startedAt: string | null;
    egressPolicy: 'allowlist';
    egressHosts: string[];
    health: IsolatedWorktreeHealth;
    limits: { cpus: number; memory: string; pids: number; workspace: string; assetCache: string };
  }

  const isolatedCli = (args: readonly string[]) =>
    vgaiCliLaunchCommand({
      engineRoot,
      cwd: ctx.projectRoot,
      args: ['isolate', ...args],
      inheritedCliEntry: process.env['VGAI_CLI_ENTRY'],
    });

  const runIsolatedCli = async (args: readonly string[]): Promise<string> => {
    const command = isolatedCli(args);
    return await new Promise<string>((resolveOutput, rejectOutput) => {
      execFile(
        command.command,
        command.args,
        { cwd: command.cwd, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            rejectOutput(new Error(stderr.trim() || stdout.trim() || error.message));
            return;
          }
          resolveOutput(stdout.trim());
        },
      );
    });
  };

  const currentIsolatedWorktrees = async (): Promise<IsolatedWorktreeView[]> => {
    const identity = currentSessionIdentity();
    if (!identity?.repositoryId) return [];
    const command = isolatedCli(['list', '--json']);
    const output = execFileSync(command.command, command.args, {
      cwd: command.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    });
    const rows = JSON.parse(output) as unknown;
    if (!Array.isArray(rows)) throw new Error('The isolated-worktree registry is malformed.');
    const safeRows = rows.flatMap((raw): Omit<IsolatedWorktreeView, 'health'>[] => {
      if (!raw || typeof raw !== 'object') return [];
      const row = raw as Record<string, unknown>;
      const limits = row['limits'];
      if (
        row['repositoryId'] !== identity.repositoryId ||
        typeof row['id'] !== 'string' ||
        typeof row['branch'] !== 'string' ||
        typeof row['from'] !== 'string' ||
        typeof row['editorPort'] !== 'number' ||
        typeof row['createdAt'] !== 'string' ||
        typeof row['state'] !== 'string' ||
        !Array.isArray(row['egressHosts']) ||
        !row['egressHosts'].every((host) => typeof host === 'string') ||
        !limits ||
        typeof limits !== 'object'
      ) {
        return [];
      }
      const limitRecord = limits as Record<string, unknown>;
      if (
        typeof limitRecord['cpus'] !== 'number' ||
        typeof limitRecord['memory'] !== 'string' ||
        typeof limitRecord['pids'] !== 'number' ||
        typeof limitRecord['workspace'] !== 'string' ||
        typeof limitRecord['assetCache'] !== 'string'
      ) {
        return [];
      }
      return [
        {
          id: row['id'],
          repositoryId: row['repositoryId'],
          branch: row['branch'],
          from: row['from'],
          editorPort: row['editorPort'],
          createdAt: row['createdAt'],
          state: row['state'],
          startedAt: typeof row['startedAt'] === 'string' ? row['startedAt'] : null,
          egressPolicy: 'allowlist',
          egressHosts: [...row['egressHosts']],
          ...(typeof row['exportedAt'] === 'string' ? { exportedAt: row['exportedAt'] } : {}),
          ...(typeof row['exportedHead'] === 'string' ? { exportedHead: row['exportedHead'] } : {}),
          limits: {
            cpus: limitRecord['cpus'],
            memory: limitRecord['memory'],
            pids: limitRecord['pids'],
            workspace: limitRecord['workspace'],
            assetCache: limitRecord['assetCache'],
          },
        },
      ];
    });
    return await Promise.all(
      safeRows.map(async (row): Promise<IsolatedWorktreeView> => {
        if (row.state === 'docker-unavailable') return { ...row, health: 'docker-unavailable' };
        if (row.state !== 'running') return { ...row, health: 'stopped' };
        // A running container whose editor does not answer is BOOTING until
        // its boot budget is spent, and broken after — never `starting`
        // forever. An unparseable/absent `startedAt` keeps the old benefit of
        // the doubt rather than inventing an age.
        const startedAtMs = row.startedAt ? Date.parse(row.startedAt) : Number.NaN;
        const unanswered: IsolatedWorktreeHealth =
          Number.isFinite(startedAtMs) && Date.now() - startedAtMs > ISOLATED_EDITOR_BOOT_BUDGET_MS
            ? 'unhealthy'
            : 'starting';
        try {
          const response = await fetch(
            `http://127.0.0.1:${row.editorPort}/__editor/compatibility`,
            { signal: AbortSignal.timeout(1_000) },
          );
          return { ...row, health: response.ok ? 'healthy' : unanswered };
        } catch {
          return { ...row, health: unanswered };
        }
      }),
    );
  };

  const currentWorktreeState = async () => {
    const worktrees = await currentWorktrees();
    const identity = currentSessionIdentity();
    const directory = identity
      ? await readRepositoryPresence(
          liveSessions(),
          identity.repositoryId,
          identity.projectRelativePath,
        )
      : [];
    const worktreesWithPresence = attachRepositoryPresence(worktrees, directory);
    return {
      worktrees: worktreesWithPresence,
      branches: listRepositoryBranches(ctx.projectRoot, worktreesWithPresence),
      isolatedWorktrees: await currentIsolatedWorktrees(),
    };
  };

  const launchWorktreeEditor = async (
    targetProject: string,
    targetWorktreeRoot: string,
  ): Promise<void> => {
    const launch = worktreeEditorLaunchCommand({
      targetProject,
      targetWorktreeRoot,
      inheritedCliEntry: process.env['VGAI_CLI_ENTRY'],
    });
    const env = { ...process.env };
    delete env['VGAI_PROJECT'];
    delete env['VGAI_EDITOR_PORT'];
    delete env['VGAI_NO_OPEN'];
    delete env['VGAI_RESTART_ON_SOURCE_CHANGE'];
    env['VGAI_DETACH_AFTER_READY'] = '1';
    await new Promise<void>((resolveLaunch, rejectLaunch) => {
      execFile(
        launch.command,
        launch.args,
        {
          cwd: launch.cwd,
          env,
          maxBuffer: 4 * 1024 * 1024,
        },
        (error, _stdout, stderr) => {
          if (error) {
            rejectLaunch(new Error(stderr.trim() || error.message));
            return;
          }
          resolveLaunch();
        },
      );
    });
  };

  const focusWorktree = async (target: WorktreeView): Promise<{ url: string; status: string }> => {
    if (!target.project) {
      throw new Error('This worktree does not contain the project at the same repository path.');
    }
    let session = liveSessions().find(
      (candidate) =>
        candidate.worktreeId === target.worktreeId && candidate.project === target.project,
    );
    if (!session) {
      await launchWorktreeEditor(target.project, target.root);
      session = liveSessions().find(
        (candidate) =>
          candidate.worktreeId === target.worktreeId && candidate.project === target.project,
      );
    }
    if (!session) throw new Error('The worktree editor did not register after launch.');
    const response = await fetch(`http://127.0.0.1:${session.port}/__editor/tab/ensure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${session.port}`,
        ...(session.controlSecret ? { 'x-vgai-editor-control': session.controlSecret } : {}),
      },
      body: JSON.stringify({ open: true }),
    });
    const result = (await response.json().catch(() => null)) as { status?: string } | null;
    if (!response.ok) throw new Error(`Could not focus the editor on port ${session.port}.`);
    return {
      url: `http://127.0.0.1:${session.port}/`,
      status: result?.status ?? 'focused',
    };
  };

  const createAndOpenWorktree = async (value: unknown) => {
    const body = value as { branch?: unknown; from?: unknown };
    if (typeof body.branch !== 'string' || !body.branch.trim()) {
      throw new Error('Enter a branch name.');
    }
    if (body.from !== undefined && typeof body.from !== 'string') {
      throw new Error('The starting revision must be a string.');
    }
    const from = typeof body.from === 'string' ? body.from.trim() : '';
    const created = createRepositoryWorktree(ctx.projectRoot, {
      branch: body.branch.trim(),
      ...(from ? { from } : {}),
    });
    if (!created.project) {
      throw new Error(`Created ${created.root}, but it has no matching project to open.`);
    }
    await prepareRepositoryWorktree(ctx.projectRoot, created.root, created.project);
    const target = (await currentWorktrees()).find((row) => row.branch === created.branch);
    if (!target) throw new Error('The created worktree could not be rediscovered.');
    return { created, worktreeId: target.worktreeId, ...(await focusWorktree(target)) };
  };

  const remoteHarnessIntent = async (
    session: { port: number; controlSecret?: string | null },
    intent: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(`http://127.0.0.1:${session.port}/__editor/harness-chat/intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session.controlSecret ? { 'x-vgai-editor-control': session.controlSecret } : {}),
      },
      body: JSON.stringify(intent),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new Error(
        typeof payload?.['error'] === 'string'
          ? payload['error']
          : `The delegated editor rejected the messenger intent (${response.status}).`,
      );
    }
    return payload ?? {};
  };

  router.get('/__editor/worktrees', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    try {
      res.json(await currentWorktreeState());
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Repository-wide presence is safe for shared participants even though the
  // worktree manager is not. This projection deliberately contains no local
  // paths, ports, PIDs, control credentials, dirty state, or Git remotes.
  router.get('/__editor/repository-presence', async (_req: Request, res: Response) => {
    try {
      if (ctx.projectRoot === engineRoot) {
        res.json({ currentWorktreeId: null, sessions: [] });
        return;
      }
      const identity = currentSessionIdentity();
      if (!identity) {
        res.json({ currentWorktreeId: null, sessions: [] });
        return;
      }
      const directory = await readRepositoryPresence(
        liveSessions(),
        identity.repositoryId,
        identity.projectRelativePath,
      );
      res.json({
        currentWorktreeId: identity.worktreeId,
        sessions: directory.map((entry) => ({
          sessionId: entry.sessionId,
          worktreeId: entry.worktreeId,
          branch: entry.branch,
          updatedAt: entry.updatedAt,
          participants: entry.participants.map((participant) => ({
            participantId: participant.participantId,
            displayName: participant.displayName,
            kind: participant.kind,
            color: participant.color,
            status: participant.status,
            lastSeenAt: participant.lastSeenAt,
            agent: participant.agent ? { harness: participant.agent.harness } : null,
            changeCount: participant.changeCount,
          })),
        })),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/worktrees/open', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    try {
      const worktreeId = (req.body as { worktreeId?: unknown })?.worktreeId;
      if (typeof worktreeId !== 'string') throw new Error('Expected a worktree identity.');
      const target = (await currentWorktrees()).find((row) => row.worktreeId === worktreeId);
      if (!target) throw new Error('That worktree no longer exists.');
      res.json(await focusWorktree(target));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/worktrees/create', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    try {
      res.json(await createAndOpenWorktree(req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/worktrees/delegate', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof body['task'] !== 'string' ||
      !body['task'].trim() ||
      body['task'].length > 20_000 ||
      typeof body['harness'] !== 'string' ||
      !body['harness'].trim() ||
      !['worktree', 'current', 'container'].includes(String(body['isolation']))
    ) {
      res.status(400).json({ error: 'Expected task, harness, and isolation.' });
      return;
    }
    try {
      const task = body['task'].trim();
      const harness = body['harness'].trim();
      const isolation = body['isolation'];
      if (isolation === 'current') {
        const snapshot = await harnessChat.actIntent({
          action: 'new',
          harness,
          text: task,
          context: [
            {
              id: `delegation:${randomUUID()}`,
              label: 'Delegated in the current worktree',
              detail: ctx.projectRoot,
            },
          ],
        });
        res.json({ isolation, snapshot });
        return;
      }
      if (typeof body['branch'] !== 'string' || !body['branch'].trim()) {
        throw new Error('A delegated worktree needs a branch name.');
      }
      if (isolation === 'container') {
        if (harness !== 'claude' && harness !== 'codex') {
          throw new Error('Isolated delegation supports the Claude and Codex harnesses.');
        }
        const branch = body['branch'].trim();
        const from =
          typeof body['from'] === 'string' && body['from'].trim() ? body['from'] : 'HEAD';
        await runIsolatedCli(['create', branch, '--from', from]);
        const isolated = (await currentIsolatedWorktrees()).find((row) => row.branch === branch);
        if (!isolated) throw new Error('The isolated worktree started but was not registered.');
        res.json({
          isolation,
          isolated,
          task,
          requiresAuthentication: true,
          command: `vgai isolate agent ${isolated.id} ${harness}`,
          message:
            'The credential-empty container is ready. Attach the harness and authenticate inside its temporary home, then send the task shown here.',
        });
        return;
      }
      const opened = await createAndOpenWorktree({
        branch: body['branch'],
        from: typeof body['from'] === 'string' ? body['from'] : 'HEAD',
      });
      const delegatedSession = liveSessions().find(
        (session) => session.worktreeId === opened.worktreeId,
      );
      if (!delegatedSession) throw new Error('The delegated editor session is not registered.');
      const snapshot = await remoteHarnessIntent(delegatedSession, {
        action: 'new',
        harness,
        text: task,
        context: [
          {
            id: `delegation:${randomUUID()}`,
            label: `Delegated from ${currentSessionIdentity()?.branch ?? 'detached HEAD'}`,
            detail: `Base ${typeof body['from'] === 'string' ? body['from'] : 'HEAD'}`,
          },
        ],
      });
      res.json({ isolation, ...opened, snapshot });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/__editor/worktrees/isolated/:id/logs', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    try {
      const parameter = req.params['id'];
      const id = Array.isArray(parameter) ? parameter[0] : parameter;
      const target = (await currentIsolatedWorktrees()).find((row) => row.id === id);
      if (!target) throw new Error('That isolated worktree does not exist in this repository.');
      res.json({ logs: await runIsolatedCli(['logs', target.id, '--lines', '120']) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/worktrees/isolated/export', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    try {
      const id = (req.body as { id?: unknown })?.id;
      if (typeof id !== 'string') throw new Error('Expected an isolated worktree identity.');
      const target = (await currentIsolatedWorktrees()).find((row) => row.id === id);
      if (!target) throw new Error('That isolated worktree does not exist in this repository.');
      const output = await runIsolatedCli(['export', target.id]);
      res.json({ ok: true, output, ...(await currentWorktreeState()) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/worktrees/isolated/stop', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body['id'] !== 'string' || typeof body['discard'] !== 'boolean') {
        throw new Error('Expected an isolated worktree identity and explicit discard choice.');
      }
      const target = (await currentIsolatedWorktrees()).find((row) => row.id === body['id']);
      if (!target) throw new Error('That isolated worktree does not exist in this repository.');
      await runIsolatedCli(['stop', target.id, ...(body['discard'] ? ['--discard'] : [])]);
      res.json({ ok: true, ...(await currentWorktreeState()) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/worktrees/archive', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    try {
      const worktreeId = (req.body as { worktreeId?: unknown })?.worktreeId;
      if (typeof worktreeId !== 'string') throw new Error('Expected a worktree identity.');
      const rows = await currentWorktrees();
      const target = rows.find((row) => row.worktreeId === worktreeId);
      if (!target) throw new Error('That worktree no longer exists.');
      archiveRepositoryWorktree(
        ctx.projectRoot,
        target.root,
        publicWorktreeSessionRefs(liveSessions()),
      );
      res.json({ ok: true, ...(await currentWorktreeState()) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/__editor/worktrees/stop', async (req: Request, res: Response) => {
    if (!requireLocalOwner(req, res)) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body['worktreeId'] !== 'string' || typeof body['sessionId'] !== 'string') {
        throw new Error('Expected worktree and session identities.');
      }
      const session = liveSessions().find(
        (candidate) =>
          candidate.worktreeId === body['worktreeId'] && candidate.sessionId === body['sessionId'],
      );
      if (!session?.sessionId || !session.pid || session.pid === process.pid) {
        throw new Error('That sibling editor session is not available to stop.');
      }
      const response = await fetch(`http://127.0.0.1:${session.port}/__editor/project`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(1_000),
        ...(session.controlSecret
          ? { headers: { 'x-vgai-editor-control': session.controlSecret } }
          : {}),
      });
      const identity = (await response.json().catch(() => null)) as {
        session?: { sessionId?: unknown; worktreeId?: unknown; ephemeral?: unknown };
      } | null;
      if (
        !response.ok ||
        identity?.session?.ephemeral === true ||
        identity?.session?.sessionId !== session.sessionId ||
        identity.session.worktreeId !== session.worktreeId
      ) {
        throw new Error('The registered process no longer owns that editor session.');
      }
      process.kill(session.pid, 'SIGTERM');
      res.json({ ok: true, sessionId: session.sessionId });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
