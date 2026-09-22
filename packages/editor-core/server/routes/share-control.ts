/**
 * `/__editor/share-control/**` + `/__editor/git/status` — the OWNER's controls
 * over a shared session: start/stop the tunnel, mint and revoke invitations,
 * set participant roles, and run the git verbs (checkpoint, publish, stage,
 * fetch, pull-request, update, rebase, readiness) that turn a session's work
 * into commits.
 *
 * Authorization here is `validControlSecret`, not the share-claim gate the
 * participants' routes use: these are the host's own doors, reached from the
 * local tab or the CLI, and `declaredShareCapability` refuses the whole
 * `/__editor/share-control` prefix to every remote role.
 */

import { timingSafeEqual } from 'node:crypto';
import type { CollaborationRole } from '@volter/editor-sdk/session/collaboration-types';
import type { Request, Response } from 'express';
import { type EditorServerRouter, setGatewayParticipantRole } from '../editor-server';
import {
  checkpointGitChanges,
  createGitPullRequest,
  fetchGitRemotesAsync,
  gitPullRequestStatus,
  gitWorkflowStatus,
  mergeGitPullRequestAsync,
  publishGitBranchAsync,
  resolveGitRebase,
  stageGitSelection,
  updateGitBranchAsync,
  validateGitMergeReadiness,
} from '../git-workflow';
import { processControlSecret } from '../session-registry';
import type { ShareHost } from '../share-host';
import type { ShareRole } from '../share-session-gateway';
import type { RouteContext } from './context';
import { requestOperationSignal, shareControlError } from './route-helpers';

export function registerShareControlRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const {
    account,
    browserShareControlSecret,
    collaborationOr400,
    currentCollaboration,
    currentCollaborationLocation,
    engineRoot,
    localParticipantIds,
    options,
    trustedShareIdentity,
  } = ctx;

  const validControlSecret = (req: Request): boolean => {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim().split('='))
      .find(([name]) => name === 'vgai_share_control')?.[1];
    const supplied = req.header('x-vgai-editor-control') ?? cookie;
    if (!supplied) return false;
    const actual = Buffer.from(supplied);
    return [processControlSecret(), browserShareControlSecret].some((secret) => {
      const expected = Buffer.from(secret);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
  };

  const requireShareControl = (req: Request, res: Response): ShareHost | null => {
    if (!validControlSecret(req)) {
      res.status(403).json({ error: 'Editor session control authorization required.' });
      return null;
    }
    if (!ctx.shareHost) {
      res.status(503).json({ error: 'This editor host does not expose a share session.' });
      return null;
    }
    return ctx.shareHost;
  };

  router.post('/__editor/share-control/browser', (req: Request, res: Response) => {
    const address = req.socket.remoteAddress ?? '';
    const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    if (!loopback || trustedShareIdentity(req)) {
      res.status(403).json({ error: 'Share-host controls are local to the editor owner.' });
      return;
    }
    res.setHeader(
      'Set-Cookie',
      `vgai_share_control=${browserShareControlSecret}; Path=/__editor/share-control; HttpOnly; SameSite=Strict`,
    );
    res.status(204).end();
  });

  const bindVerifiedLocalShareHost = async (): Promise<{ participantId: string }> => {
    const collaboration = currentCollaboration();
    if (!collaboration) throw new Error('No project is open.');
    const verified = await (options.collaborationAccountSession?.() ??
      account.collaborationAccountSession());
    const candidates = collaboration
      .snapshot()
      .participants.filter(
        (participant) =>
          localParticipantIds.has(participant.participantId) && participant.kind !== 'agent',
      );
    const current =
      candidates.find((participant) => participant.account?.id === verified.user.id) ??
      candidates.find((participant) => participant.role === 'maintainer') ??
      candidates[0];
    if (!current) {
      throw new Error(
        'Open the local editor tab before sharing so its host identity can be bound.',
      );
    }
    const verifiedAccount = verified.user;
    ctx.localShareHost = { participantId: current.participantId, account: verifiedAccount };
    collaboration.join({
      participantId: current.participantId,
      account: verifiedAccount,
      displayName: verifiedAccount.name ?? verifiedAccount.email,
      kind: 'human',
      role: 'maintainer',
      location: currentCollaborationLocation(),
    });
    return { participantId: current.participantId };
  };

  router.post('/__editor/share-control/host', async (req: Request, res: Response) => {
    if (!validControlSecret(req)) {
      res.status(403).json({ error: 'Editor session control authorization required.' });
      return;
    }
    try {
      res.json(await bindVerifiedLocalShareHost());
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post('/__editor/share-control/start', async (req: Request, res: Response) => {
    const host = requireShareControl(req, res);
    if (!host) return;
    const provider = (req.body as Record<string, unknown> | undefined)?.['tunnelProvider'];
    if (provider !== undefined && provider !== 'cloudflared' && provider !== 'ngrok') {
      res.status(400).json({ error: 'tunnelProvider must be cloudflared or ngrok.' });
      return;
    }
    try {
      await bindVerifiedLocalShareHost();
      res.json(await host.start(provider));
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.get('/__editor/share-control/status', (req: Request, res: Response) => {
    const host = requireShareControl(req, res);
    if (host) res.json(host.status());
  });

  router.post('/__editor/share-control/invitations', async (req: Request, res: Response) => {
    const host = requireShareControl(req, res);
    if (!host) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const role = body['role'];
    const ttlMinutes = body['ttlMinutes'];
    const usePolicy = body['usePolicy'];
    const tunnelProvider = body['tunnelProvider'];
    if (
      !['viewer', 'commenter', 'tester', 'editor', 'terminal'].includes(String(role)) ||
      !Number.isInteger(ttlMinutes) ||
      Number(ttlMinutes) < 1 ||
      Number(ttlMinutes) > 1_440 ||
      (usePolicy !== 'person' && usePolicy !== 'team') ||
      (tunnelProvider !== 'cloudflared' && tunnelProvider !== 'ngrok') ||
      (body['recipientAccountId'] !== undefined &&
        typeof body['recipientAccountId'] !== 'string') ||
      (body['recipientEmail'] !== undefined && typeof body['recipientEmail'] !== 'string') ||
      (body['recipientOrganizationId'] !== undefined &&
        typeof body['recipientOrganizationId'] !== 'string') ||
      (body['recipientOrganizationDomain'] !== undefined &&
        typeof body['recipientOrganizationDomain'] !== 'string')
    ) {
      res.status(400).json({
        error:
          'Expected role, ttlMinutes (1–1440), usePolicy, tunnelProvider, and optional recipient account/email/organization.',
      });
      return;
    }
    try {
      await bindVerifiedLocalShareHost();
      res.status(201).json(
        await host.createInvitation({
          role: role as ShareRole,
          ttlMs: Number(ttlMinutes) * 60_000,
          usePolicy,
          tunnelProvider,
          ...(typeof body['recipientAccountId'] === 'string' && body['recipientAccountId'].trim()
            ? { recipientAccountId: body['recipientAccountId'].trim() }
            : {}),
          ...(typeof body['recipientEmail'] === 'string' && body['recipientEmail'].trim()
            ? { recipientEmail: body['recipientEmail'].trim().toLowerCase() }
            : {}),
          ...(typeof body['recipientOrganizationId'] === 'string' &&
          body['recipientOrganizationId'].trim()
            ? { recipientOrganizationId: body['recipientOrganizationId'].trim() }
            : {}),
          ...(typeof body['recipientOrganizationDomain'] === 'string' &&
          body['recipientOrganizationDomain'].trim()
            ? { recipientOrganizationDomain: body['recipientOrganizationDomain'].trim() }
            : {}),
        }),
      );
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post(
    '/__editor/share-control/invitations/:id/revoke',
    async (req: Request, res: Response) => {
      const host = requireShareControl(req, res);
      if (!host) return;
      const id = String(req.params['id'] ?? '');
      res.json({ revoked: await host.revokeInvitation(id), status: host.status() });
    },
  );

  router.post('/__editor/share-control/participants/:id/kick', (req: Request, res: Response) => {
    const host = requireShareControl(req, res);
    if (!host) return;
    const participantId = String(req.params['id'] ?? '');
    const revokedCredentials = host.kickParticipant(participantId);
    currentCollaboration()?.leave(participantId);
    res.json({ participantId, revokedCredentials });
  });

  router.post('/__editor/share-control/participants/:id/role', (req: Request, res: Response) => {
    const host = requireShareControl(req, res);
    if (!host) return;
    const participantId = String(req.params['id'] ?? '');
    const role = (req.body as { role?: unknown } | undefined)?.role;
    if (!['viewer', 'commenter', 'tester', 'editor', 'terminal'].includes(String(role))) {
      res.status(400).json({ error: 'Expected a share role.' });
      return;
    }
    try {
      const { warning } = setGatewayParticipantRole({
        shareHost: host,
        collaboration: currentCollaboration(),
        actorId: ctx.localShareHost?.participantId ?? null,
        participantId,
        role: role as CollaborationRole,
      });
      res.json(warning ? { ...host.status(), warning } : host.status());
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post('/__editor/share-control/stop', async (req: Request, res: Response) => {
    const host = requireShareControl(req, res);
    if (!host) return;
    await host.stop();
    res.json(host.status());
  });

  router.post('/__editor/share-control/restart', async (req: Request, res: Response) => {
    const host = requireShareControl(req, res);
    if (!host) return;
    const provider = (req.body as Record<string, unknown> | undefined)?.['tunnelProvider'];
    if (provider !== 'cloudflared' && provider !== 'ngrok') {
      res.status(400).json({ error: 'tunnelProvider must be cloudflared or ngrok.' });
      return;
    }
    try {
      await bindVerifiedLocalShareHost();
      res.json(await host.restart(provider));
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.get('/__editor/share-control/history/export', (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    const collaboration = collaborationOr400(res);
    if (collaboration) res.json(collaboration.snapshot());
  });

  router.delete('/__editor/share-control/history', (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    collaboration.clearHistory();
    res.status(204).end();
  });

  router.get('/__editor/git/status', (_req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(400).json({ error: 'No project is open.' });
      return;
    }
    try {
      res.json(gitWorkflowStatus(ctx.projectRoot));
    } catch (error) {
      shareControlError(res, error);
    }
  });
  router.post('/__editor/share-control/git/checkpoint', async (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    const body = (req.body ?? {}) as { paths?: unknown; message?: unknown };
    if (
      !Array.isArray(body.paths) ||
      !body.paths.every((path) => typeof path === 'string') ||
      typeof body.message !== 'string'
    ) {
      res.status(400).json({ error: 'Expected selected paths and a commit message.' });
      return;
    }
    try {
      const verified = await (options.collaborationAccountSession?.() ??
        account.collaborationAccountSession());
      const bound = await bindVerifiedLocalShareHost();
      const result = checkpointGitChanges(ctx.projectRoot, {
        paths: body.paths,
        message: body.message,
        author: {
          participantId: bound.participantId,
          accountId: verified.user.id,
          email: verified.user.email,
          name: verified.user.name ?? verified.user.email,
        },
      });
      currentCollaboration()?.recordGitAction(bound.participantId, {
        action: 'checkpoint',
        headCommit: result.headCommit,
        paths: body.paths,
      });
      res.json(result);
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post('/__editor/share-control/git/publish', async (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    try {
      const bound = await bindVerifiedLocalShareHost();
      const result = await publishGitBranchAsync(ctx.projectRoot, requestOperationSignal(req));
      currentCollaboration()?.recordGitAction(bound.participantId, {
        action: 'publish',
        branch: result.branch,
        headCommit: result.headCommit,
      });
      res.json(result);
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post('/__editor/share-control/git/stage', async (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof body['path'] !== 'string' ||
      typeof body['staged'] !== 'boolean' ||
      (body['hunkId'] !== undefined && typeof body['hunkId'] !== 'string')
    ) {
      res.status(400).json({ error: 'Expected a changed path, stage state, and optional hunk.' });
      return;
    }
    try {
      res.json(
        stageGitSelection(ctx.projectRoot, {
          path: body['path'],
          staged: body['staged'],
          ...(typeof body['hunkId'] === 'string' ? { hunkId: body['hunkId'] } : {}),
        }),
      );
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post('/__editor/share-control/git/fetch', async (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    try {
      const bound = await bindVerifiedLocalShareHost();
      const result = await fetchGitRemotesAsync(ctx.projectRoot, requestOperationSignal(req));
      currentCollaboration()?.recordGitAction(bound.participantId, { action: 'fetch' });
      res.json(result);
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post('/__editor/share-control/git/pull-request', async (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    const body = (req.body ?? {}) as { title?: unknown; body?: unknown };
    if (
      typeof body.title !== 'string' ||
      (body.body !== undefined && typeof body.body !== 'string')
    ) {
      res.status(400).json({ error: 'Expected a pull-request title and optional body.' });
      return;
    }
    try {
      const bound = await bindVerifiedLocalShareHost();
      const result = createGitPullRequest(ctx.projectRoot, {
        title: body.title,
        ...(typeof body.body === 'string' ? { body: body.body } : {}),
      });
      currentCollaboration()?.recordGitAction(bound.participantId, {
        action: 'pull-request',
        url: result.url,
        headCommit: result.status.headCommit,
      });
      res.json(result);
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.get('/__editor/share-control/git/pull-request/status', (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    res.json(gitPullRequestStatus(ctx.projectRoot));
  });

  router.post(
    '/__editor/share-control/git/pull-request/merge',
    async (req: Request, res: Response) => {
      if (!requireShareControl(req, res)) return;
      try {
        const bound = await bindVerifiedLocalShareHost();
        const result = await mergeGitPullRequestAsync(ctx.projectRoot, requestOperationSignal(req));
        currentCollaboration()?.recordGitAction(bound.participantId, {
          action: 'merge',
          url: result.url,
        });
        res.json(result);
      } catch (error) {
        shareControlError(res, error);
      }
    },
  );

  router.post('/__editor/share-control/git/update', async (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    try {
      const bound = await bindVerifiedLocalShareHost();
      const result = await updateGitBranchAsync(ctx.projectRoot, requestOperationSignal(req));
      currentCollaboration()?.recordGitAction(bound.participantId, {
        action: 'rebase',
        baseRef: result.baseRef,
        headCommit: result.headCommit,
      });
      res.json(result);
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post('/__editor/share-control/git/rebase', async (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    const action = (req.body as { action?: unknown })?.action;
    if (action !== 'continue' && action !== 'abort') {
      res.status(400).json({ error: 'Expected continue or abort.' });
      return;
    }
    try {
      const bound = await bindVerifiedLocalShareHost();
      const result = resolveGitRebase(ctx.projectRoot, action);
      currentCollaboration()?.recordGitAction(bound.participantId, {
        action: `rebase-${action}`,
        headCommit: result.headCommit,
      });
      res.json(result);
    } catch (error) {
      shareControlError(res, error);
    }
  });

  router.post('/__editor/share-control/git/readiness', (req: Request, res: Response) => {
    if (!requireShareControl(req, res)) return;
    try {
      res.json(validateGitMergeReadiness(ctx.projectRoot));
    } catch (error) {
      shareControlError(res, error);
    }
  });
}
