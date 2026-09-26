/**
 * `project.sprites.bake` — turn this project's SVG rigs into the committed
 * sprite atlas the game loads. NODE-SIDE AND HEADLESS.
 *
 * THE SHAPE, and why it matches the 3D examples' bakes. A bake is three things:
 * author natively, render, and hand the ACCEPTED bytes to the host's
 * generated-output door — which is the only thing allowed to write under
 * `public/` and the only thing that writes `.vgai/provenance.json`. This tool
 * is the 2D instance of that. Nothing here opens a file, and there is
 * deliberately no way to write the PNG without also writing its provenance
 * record: they are one atomic batch.
 *
 * NO SESSION, NO GPU, NO TAB. The rigs are SVG documents and the renderer is
 * resvg, so this runs anywhere Node runs. The donor bake had to ship its render
 * step into a live editor tab because rasterizing Pixi `Graphics` needs a GPU
 * (`examples/top-down-survivor/src/tools/sprite-bake.tool.ts:15-20` as it was),
 * which meant the bake could not run without an editor, a window and a
 * connected game. That whole dependency is gone.
 *
 * THE CONVENTION IT LOADS. The capability owns the machinery; the PROJECT owns
 * the art. This tool imports `src/tools/sprite-bake/rigs.ts` from the project it
 * is running in and expects one export:
 *
 *     export function spriteBakeSpec(): SpriteBakeSpec
 *
 * (`SpriteBakeSpec` is `src/lib/sprite/svg-rig.ts`'s: where the atlas pair is
 * written, and every animation's name, frame count, cell and rig.) A PIXEL
 * project's plans come out of `pixelAnimation(...)` (`src/lib/pixel-atlas.ts`)
 * instead of a posed rig, and nothing here can tell the difference: both crafts
 * exit through the same packer, the same sheet and the same guards. The
 * specifier is held in a constant rather than written inline because this file
 * ships in the capability DISTRIBUTION, where that project file does not exist:
 * a static import would fail the distribution's own typecheck. At run time the
 * editor's Vite server resolves it relative to this module, which is exactly the
 * project file above.
 *
 * WHAT IT REFUSES. A frame that reaches its cell border fails the bake outright
 * (it would bleed into a neighbouring frame) — that guard lives in the raster
 * step and throws. A tile whose wrap-around join stands out against its own
 * interior fails here. A bake that cannot make both claims writes nothing.
 */

import { defineTool } from '@vgai/sdk/tools';
import { z } from 'zod';
import type { SeamReport } from '../lib/sprite/atlas';
import type { SpriteBakeSpec, SpriteRigModule } from '../lib/sprite/svg-rig';

/** The project's own rig module, by convention. See the header. */
const RIG_MODULE = './sprite-bake/rigs';

const OutputFileSchema = z.object({
  path: z.string(),
  bytes: z.number(),
  mediaType: z.string().optional(),
  role: z.enum(['asset', 'provenance', 'other']).optional(),
});

export const SpriteBakeInputSchema = z.object({
  dryRun: z
    .boolean()
    .default(false)
    .describe('Render and check the atlas without writing the project files.'),
  preview: z
    .boolean()
    .default(false)
    .describe(
      'Also write a contact sheet per animation (all phases × game-scale/4× × dark/light) ' +
        'beside the atlas, under public/sprites/preview/. The vector sight loop.',
    ),
});

const SeamSchema = z.object({
  animation: z.string(),
  wrapColumn: z.number(),
  wrapRow: z.number(),
  interiorColumnMax: z.number(),
  interiorRowMax: z.number(),
  seamless: z.boolean(),
});

export const SpriteBakeResultSchema = z.object({
  image: z.string(),
  sheet: z.string(),
  width: z.number(),
  height: z.number(),
  frames: z.array(z.string()),
  animations: z.array(z.string()),
  /** Every tiling animation's measured join to a copy of itself. */
  seams: z.array(SeamSchema),
  previews: z.array(z.string()),
  files: z.array(OutputFileSchema),
  totalBytes: z.number(),
  dryRun: z.boolean(),
  provenanceOperationId: z.string().optional(),
});

function seamFailure(seam: SeamReport): string {
  return (
    `"${seam.animation}" does not join to itself — its wrap-around difference ` +
    `(${seam.wrapColumn.toFixed(2)} column / ${seam.wrapRow.toFixed(2)} row) exceeds the tile's ` +
    `own interior maximum (${seam.interiorColumnMax.toFixed(2)} / ${seam.interiorRowMax.toFixed(2)})`
  );
}

/** `public/sprites/survivor.png` → `public/sprites/preview`. */
function previewDirectory(imagePath: string): string {
  const parts = imagePath.split('/');
  parts.pop();
  return [...parts, 'preview'].join('/');
}

export const tool = defineTool({
  name: 'project.sprites.bake',
  summary: 'Bake this game’s SVG rigs into the committed sprite atlas.',
  description:
    'Poses every rig declared by src/tools/sprite-bake/rigs.ts at each frame of its cycle, ' +
    'composes them into one atlas, rasterizes it headlessly with resvg, and atomically writes ' +
    'the atlas PNG + spritesheet JSON with a provenance record. No GPU, no editor session, no ' +
    'browser. The art is project source: nothing is downloaded and nothing is model-generated. ' +
    'Re-run it after editing a rig, the palette, or the frame catalogue.',
  input: SpriteBakeInputSchema,
  result: SpriteBakeResultSchema,
  errors: [],
  requires: { project: true },
  host: 'node',
  mutates: true,
  supportsDryRun: true,
  longRunning: true,
  permission: { risk: 'write', summary: 'Writes the sprite atlas pair under public/.' },
  async impl(input, ctx) {
    const projectRoot = ctx.projectRoot;
    if (!projectRoot) throw new Error('project.sprites.bake requires a project root.');
    const projectOutputs = ctx.projectOutputs;
    if (!projectOutputs) throw new Error('project.sprites.bake requires a project output writer.');

    const rigs = (await import(RIG_MODULE)) as Partial<SpriteRigModule>;
    if (typeof rigs.spriteBakeSpec !== 'function') {
      throw new Error(
        `project.sprites.bake: ${RIG_MODULE.replace('./', 'src/tools/')}.ts must export ` +
          '`spriteBakeSpec(): SpriteBakeSpec` — see src/lib/sprite/svg-rig.ts.',
      );
    }
    const spec: SpriteBakeSpec = rigs.spriteBakeSpec();
    // Atlas / preview pull maxrects + resvg; keep them off the catalog-load path
    // so this module can still declare `project.sprites.bake`.
    const { bakeAtlas } = await import('../lib/sprite/atlas');
    const baked = bakeAtlas(spec);

    const broken = baked.seams.filter((seam) => !seam.seamless);
    if (broken.length > 0) {
      throw new Error(
        `project.sprites.bake: ${broken.map(seamFailure).join('; ')}. Every mark in a tiling rig ` +
          'must be drawn wrapped — a mark that crosses an edge is drawn again shifted by a whole tile.',
      );
    }

    const files: Array<{
      path: string;
      content: Buffer | string;
      mediaType: string;
      role: 'asset';
    }> = [
      {
        path: spec.image,
        content: Buffer.from(baked.png),
        mediaType: 'image/png',
        role: 'asset',
      },
      {
        path: spec.sheet,
        content: `${JSON.stringify(baked.sheet, null, 2)}\n`,
        mediaType: 'application/json',
        role: 'asset',
      },
    ];

    const previews: string[] = [];
    if (input.preview) {
      const directory = previewDirectory(spec.image);
      // A project that declares its own sight loop gets exactly that; anything
      // else gets the posed-rig contact sheet (see `SpriteBakeSpec.previews`).
      const { contactSheet } = await import('../lib/sprite/preview');
      const images = spec.previews
        ? spec.previews()
        : spec.animations.map((animation) => ({
            name: animation.name,
            png: contactSheet(animation.rig, {
              cell: animation.cell,
              frames: animation.frames,
            }).png,
          }));
      for (const image of images) {
        const path = `${directory}/${image.name}.png`;
        previews.push(path);
        files.push({
          path,
          content: Buffer.from(image.png),
          mediaType: 'image/png',
          role: 'asset',
        });
      }
    }

    const output = await projectOutputs.write(files, { dryRun: input.dryRun });

    return {
      image: spec.image,
      sheet: spec.sheet,
      width: baked.width,
      height: baked.height,
      frames: [...baked.frameKeys],
      animations: Object.keys(baked.sheet.animations),
      seams: baked.seams.map((seam) => ({
        animation: seam.animation,
        wrapColumn: seam.wrapColumn,
        wrapRow: seam.wrapRow,
        interiorColumnMax: seam.interiorColumnMax,
        interiorRowMax: seam.interiorRowMax,
        seamless: seam.seamless,
      })),
      previews,
      ...output,
    };
  },
});
