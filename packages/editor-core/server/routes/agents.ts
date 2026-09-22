/**
 * `/__editor/project-work/**` — the project's own work tracker.
 *
 * The coding-harness Chat's HTTP seam (`/__editor/harness-chat/**`) and its
 * optional tmux display lane (`/__editor/harness-terminal/**`) were removed with
 * the browser panel that was their only caller: the AI in the tab is the
 * workbench's own Chat view now, filled by the bundled supercode frontend, which
 * talks to the runtime directly over `frontend.v2` and needs no route of ours
 * (ARCHITECTURE-CORE §The core is Code-OSS, rule 7). The harness SERVICE stays —
 * a collaboration room's `@agent` dispatch and the worktree switch both drive it
 * (`routes/collaboration.ts`, `routes/worktrees.ts`), and the session's frontend
 * handoff starts the runtime it hands over.
 */

import type { Request, Response } from 'express';
import type { ProjectWorkAction } from '../../src/project-work-types';
import type { EditorServerRouter } from '../editor-server';
import type { RouteContext } from './context';

export function registerAgentRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const { projectWork } = ctx;

  // ---- Project Work (ztrack × the existing Supercode controller) ----
  router.get('/__editor/project-work', (_req: Request, res: Response) => {
    res.json(projectWork.snapshot());
  });

  router.post('/__editor/project-work/action', (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<ProjectWorkAction> | undefined;
      if (
        body?.type !== 'context' ||
        typeof body.issueId !== 'string' ||
        !body.issueId.trim() ||
        body.issueId.length > 200
      ) {
        throw new Error('Project Work action requires { type: "context", issueId }.');
      }
      res.json({ context: projectWork.contextForIssue(body.issueId) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/__editor/project-work/extension/:hash.js', (req: Request, res: Response) => {
    const hash = req.params['hash'];
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      res.status(404).end();
      return;
    }
    const code = projectWork.extension(hash);
    if (!code) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(code);
  });
}
