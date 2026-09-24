/**
 * The `machinesFromModules` FINDER: every project module under the selection's `include` globs
 * that declares an XState machine (`createMachine(...)`, `setup(...).createMachine(...)`) is a
 * `machine` document, opened in the Machine document (`machine.document.tsx`). Select it in
 * `vgai.adapter.ts`:
 *
 *   documents: { find: [{ finder: 'machinesFromModules', include: ['src/**\/*.ts'] }] }
 *
 * The module is the document: a module declaring two machines opens as one document holding
 * both. This plain object mounts no UI and reads the project only through `input.sources`; the
 * full read (states, transitions, spans) is the serving half's, over the module's syntax tree.
 */
import { z } from 'zod';

const DECLARES_MACHINE = /\bcreateMachine\s*\(/;

export const finder = {
  name: 'machinesFromModules',
  schema: z
    .object({
      finder: z.literal('machinesFromModules'),
      include: z
        .array(z.string().min(1))
        .min(1)
        .describe('Project-relative globs of the modules that may declare machines (`src/**/*.ts`)'),
    })
    .strict(),
  run(
    _selection: { finder: 'machinesFromModules'; include: readonly string[] },
    input: { sources?: readonly { path: string; source: string }[] },
  ) {
    const entries = [];
    for (const file of input.sources ?? []) {
      if (!DECLARES_MACHINE.test(file.source)) continue;
      const name = (file.path.split('/').pop() ?? file.path).replace(/\.[cm]?[jt]sx?$/, '');
      entries.push({
        id: `machine:${file.path}`,
        label: name,
        kind: 'machine',
        region: null,
        authorable: true,
        reach: { kind: 'root-mount' as const },
        source: { path: file.path },
      });
    }
    return { entries, notes: [] };
  },
} as const;
