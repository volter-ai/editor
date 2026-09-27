/**
 * The `pagesFromUiModules` FINDER (ARCHITECTURE-CORE §The project model,
 * "Documents, not scenes"): every project module under the selection's
 * `include` globs that exports a React component is a `page` document —
 * what a website is made of, the way a game is made of scenes. Select it
 * in `vgai.adapter.ts`:
 *
 *   documents: { find: [{ finder: 'pagesFromUiModules', include: ['src/ui/**\/*page.tsx'] }] }
 *
 * The glob IS the page rule: a project names its pages by where it keeps
 * them. This module is a plain object the HOST registers; it mounts no UI
 * and reads the project only through `input.sources`.
 */
import { z } from 'zod';

const COMPONENT_EXPORT =
  /export\s+(?:default\s+)?(?:function\s+[A-Z]\w*\s*\(|const\s+[A-Z]\w*\s*[:=])/;

export const finder = {
  name: 'pagesFromUiModules',
  schema: z
    .object({
      finder: z.literal('pagesFromUiModules'),
      include: z
        .array(z.string().min(1))
        .min(1)
        .describe('Project-relative globs of the page modules (`src/ui/**/*page.tsx`)'),
    })
    .strict(),
  run(
    _selection: { finder: 'pagesFromUiModules'; include: readonly string[] },
    input: { sources?: readonly { path: string; source: string }[] },
  ) {
    const entries = [];
    const notes: string[] = [];
    for (const file of input.sources ?? []) {
      if (!COMPONENT_EXPORT.test(file.source)) {
        notes.push(`${file.path}: exports no component — not a page`);
        continue;
      }
      const name = (file.path.split('/').pop() ?? file.path)
        .replace(/\.[cm]?[jt]sx?$/, '')
        .replace(/[-_.]?page$/i, '');
      entries.push({
        id: `page:${file.path}`,
        label: name || 'page',
        kind: 'page',
        region: null,
        authorable: true,
        reach: { kind: 'root-mount' as const },
        source: { path: file.path },
      });
    }
    return {
      entries,
      notes,
      // One page is the page; two is a choice the site's author states.
      ...(entries.length === 1 ? { default: entries[0]!.id } : {}),
    };
  },
} as const;
