/**
 * The `piecesFromModules` FINDER: every project module under the selection's `include` globs
 * that renders `@volter/dawproject` elements is a `piece` document, opened in the Piece document
 * (`piece.document.tsx`). Select it in `vgai.adapter.ts`:
 *
 *   documents: { find: [{ finder: 'piecesFromModules', include: ['src/music/**\/*.tsx'] }] }
 *
 * The module is the document; its default export is the piece. This plain object mounts no UI
 * and reads the project only through `input.sources`.
 */
import { z } from 'zod';

const IMPORTS_DAWPROJECT = /from\s+['"]@volter\/dawproject['"]/;
const DEFAULT_EXPORT = /\bexport\s+default\b/;

export const finder = {
  name: 'piecesFromModules',
  schema: z
    .object({
      finder: z.literal('piecesFromModules'),
      include: z
        .array(z.string().min(1))
        .min(1)
        .describe('Project-relative globs of the modules that may be pieces (`src/music/**/*.tsx`)'),
    })
    .strict(),
  run(
    _selection: { finder: 'piecesFromModules'; include: readonly string[] },
    input: { sources?: readonly { path: string; source: string }[] },
  ) {
    const entries = [];
    for (const file of input.sources ?? []) {
      if (!IMPORTS_DAWPROJECT.test(file.source) || !DEFAULT_EXPORT.test(file.source)) continue;
      const name = (file.path.split('/').pop() ?? file.path).replace(/\.[cm]?[jt]sx?$/, '');
      entries.push({
        id: `piece:${file.path}`,
        label: name,
        kind: 'piece',
        region: null,
        authorable: true,
        reach: { kind: 'root-mount' as const },
        source: { path: file.path },
      });
    }
    return { entries, notes: [] };
  },
} as const;
