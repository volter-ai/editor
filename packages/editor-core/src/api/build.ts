/**
 * Producing a build, and the two catalogues the New Project screen starts one
 * from: `/__editor/export`, `/__editor/examples`, `/__editor/templates`.
 */

import { editorServerJson } from '../editor-server-response';
import { BASE } from './base';
/** Start a build/export. Returns the raw Response for SSE streaming.
 *
 *  Deliberately NOT read through `editor-server-response.ts`: that reader's
 *  rule is "the editor server answers JSON", and a successful export answers
 *  `text/event-stream`, which it would reject. The stream's own consumer owns
 *  the question here. */

/** FT-5 learner-facing metadata — mirrors the manifest's `learn` block
 *  (`LearnMetadataSchema`, @volter/editor-project/manifest/schema); served merged into `GET
 *  /__editor/examples`. */
export interface ExampleLearnInfo {
  kind: 'starter' | 'feature' | 'sample-game' | 'lesson-companion';
  title: string;
  summary: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  features: string[];
  thumbnail?: string;
  preview?: string;
  lesson?: string;
}

export interface ExampleInfo {
  id: string;
  name: string;
  /** The example's FT-5 `learn` block. REQUIRED: every shipped example
   *  carries one and the server omits any example that doesn't (editor and
   *  server ship from one repo, so there is no older server to be compatible
   *  with). */
  learn: ExampleLearnInfo;
}

/** List `examples/<id>/` projects (Track E3, §1.F). Server mode reads the
 *  scaffold registry. Browser mode derives the list from what THIS build
 *  actually stages: the runtime bundle's per-root dispatch keys name every
 *  bundled example, and each one's manifest (with its FT-5 `learn` block) is
 *  served at `/examples/<id>/vgai.project.json` — so the gallery lists
 *  exactly the projects `?project=<id>` can open, never a curated id that
 *  drifted from the build (the dead `editor-tutorial` link, measured on
 *  production 2026-08-27, was exactly that drift). */
export async function listExamples(): Promise<ExampleInfo[]> {
  try {
    const res = await fetch(`${BASE}/examples`);
    const data = await editorServerJson<{ examples: ExampleInfo[] }>(
      res,
      `GET ${BASE}/examples failed`,
    );
    return data.examples;
  } catch {
    return [];
  }
}

/** One template-registry entry (G1, FT-3): mirrors `TemplateRegistryEntry` in
 *  create-vgai-project/templates, served by `GET /__editor/templates` from the
 *  same `templates.json` the CLI reads. */
export interface TemplateInfo {
  id: string;
  title: string;
  description: string;
  /** `template:<compositionId>` or `example:<exampleId>`. */
  source: string;
  thumbnail?: string;
  /** Curated preview bullets for composition templates. Promoted examples
   * derive their facts from the owning example's learn metadata. */
  whatsInside?: string[];
  /** A post-copy PRESENTATION of `source`'s tree. The gallery's
   * "Blank" card carries `'blank'` beside the SAME `template:default` source
   * the starter card uses — two cards, one template. */
  presentation?: string;
}

/** Map an engine-repo-relative registry/learn thumbnail path to its server
 * route without baking template or example directories into the client. */
export function learnThumbnailUrl(repoRelativePath: string): string {
  // Browser-mode example thumbnails are already staged ABSOLUTE paths
  // (`/examples/<id>/learn/…`) — there is no server route to proxy them.
  if (repoRelativePath.startsWith('/')) return repoRelativePath;
  return `${BASE}/learn-thumbnail?file=${encodeURIComponent(repoRelativePath)}`;
}

/** List the template registry. */
export async function listTemplates(): Promise<TemplateInfo[]> {
  // No silent empty-list fallback and no hardcoded fallback entry in the
  // wizard: editor and server ship from ONE repo, so an unreachable or
  // failing `/templates` is a real defect, not version skew. Surface it.
  const res = await fetch(`${BASE}/templates`);
  const data = await editorServerJson<{ templates: TemplateInfo[] }>(
    res,
    `GET ${BASE}/templates failed`,
  );
  return data.templates;
}
