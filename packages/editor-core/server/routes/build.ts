/** New-project choices belong to the running product. */
import type { Request, Response } from 'express';
import type { EditorServerRouter } from '../editor-server';
import { sessionCreatePresets } from '../product-presets';
import type { RouteContext } from './context';
export function registerBuildRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  router.get('/__editor/templates', async (_req: Request, res: Response) => {
    try {
      const presets = await sessionCreatePresets(ctx.projectRoot);
      res.json({ templates: (presets?.declaration.templates ?? []).map(t => ({ id: t.id, title: t.name, description: t.description ?? '', source: `template:${t.id}` })) });
    } catch (error) { res.status(500).json({error: error instanceof Error ? error.message : String(error)}); }
  });
}
