import { basename, posix } from 'node:path';
import { renderPiece } from '@volter/editor-dawproject/render-piece';
import { defineTool } from '@volter/editor-sdk/tools/registry';
import { z } from 'zod';

const relativePath = (path: string): boolean =>
  !path.includes('\\') && !path.includes('\0') &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

export const MusicRenderInputSchema = z.object({
  piece: z.string().startsWith('src/music/').endsWith('.tsx').refine(relativePath)
    .describe('Project-relative TSX piece under src/music/ with a default component export.'),
  out: z.string().startsWith('public/').refine(relativePath).optional()
    .describe('Project-relative render folder under public/. Defaults to public/music/<piece name>.'),
  target: z.union([z.enum(['console', 'portable']), z.number()]).default('portable')
    .describe('Loudness target: console (-24 LUFS), portable (-18 LUFS), or a numeric LUFS value.'),
  sections: z.boolean().default(false)
    .describe('Also render marker sections as loops at the full mix gain; incompatible with oneShot.'),
  oneShot: z.boolean().default(false)
    .describe('Render one pass plus a four-second tail without a loop chunk; incompatible with sections.'),
  dryRun: z.boolean().default(false)
    .describe('Render and validate the output batch without writing project files or provenance.'),
}).refine((input) => !(input.sections && input.oneShot), {
  message: 'sections and oneShot cannot be used together.',
});

export const MusicRenderResultSchema = z.object({
  out: z.string(),
  files: z.array(z.object({ path: z.string(), bytes: z.number() })),
  report: z.object({}).passthrough(),
  provenanceOperationId: z.string().optional(),
});

export const tool = defineTool({
  name: 'project.music.render',
  summary: 'Render a project music piece into mastered audio and record its provenance.',
  description: 'Renders WAV, OGG, MIDI, stems, optional section loops and a measurement report. ' +
    'Writes the complete batch through the project output writer.',
  input: MusicRenderInputSchema,
  result: MusicRenderResultSchema,
  errors: [],
  requires: { project: true },
  host: 'node',
  mutates: true,
  supportsDryRun: true,
  longRunning: true,
  permission: { risk: 'write', summary: 'Writes rendered music under public/ unless dryRun is set.' },
  async impl(input, ctx) {
    if (!ctx.projectRoot) throw new Error('project.music.render requires a project root.');
    if (!ctx.projectOutputs) throw new Error('Music rendering requires a project output writer.');
    const out = input.out ?? `public/music/${basename(input.piece, '.tsx')}`;
    const rendered = await renderPiece({
      projectRoot: ctx.projectRoot,
      piecePath: input.piece,
      ...(ctx.loadProjectModule ? { loadModule: ctx.loadProjectModule } : {}),
      target: input.target,
      sections: input.sections,
      oneShot: input.oneShot,
    });
    const output = await ctx.projectOutputs.write(rendered.files.map((file) => ({
      path: posix.join(out, file.path),
      content: file.bytes,
      mediaType: file.mediaType,
      role: 'asset' as const,
    })), { dryRun: input.dryRun });
    return {
      out,
      files: output.files.map(({ path, bytes }) => ({ path, bytes })),
      report: rendered.report,
      ...(output.provenanceOperationId ? { provenanceOperationId: output.provenanceOperationId } : {}),
    };
  },
});
