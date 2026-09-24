/**
 * `project.bake.preview` — the module LOOK.
 *
 * The read-only sibling of `project.bake.module`. Same front half exactly
 * (`module-source.ts`: the path-escape guard, the dynamic import,
 * the builder call, the typed refusals), then it stops where the bake begins:
 * the exported GLB stays IN MEMORY and is handed to the live editor session,
 * which rasterizes it into the standard four-view contact sheet. Nothing is
 * written under `public/`, no provenance record is created, and the project's
 * asset namespace is untouched — a look is not an export
 * (ARCHITECTURE-CORE §Agent surface, the look-verb decision).
 *
 * The PNGs land under `<project>/.vgai/screenshots/` — the same
 * machine-written-evidence namespace `vgai screenshot` already writes to,
 * beside the run artifacts and the session file, and gitignored like the rest of
 * it.
 *
 * A live session is REQUIRED and cannot be worked around: Node has no GPU, so
 * "build the model here, photograph it there" is the whole shape of this
 * tool. With no session it refuses by name and points at `vgai edit`, rather
 * than building an Object3D nobody will ever see.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { defineTool, ToolError, type ToolErrorDefinition } from '@vgai/sdk/tools';
import * as THREE from 'three';
import { z } from 'zod';
import {
  assertRenderableGeometry,
  buildFromModule,
  computeMeshStats,
  countMeshes,
  EMPTY_GEOMETRY_ERROR,
  EXPORT_NOT_CALLABLE_ERROR,
  MODULE_NOT_FOUND_ERROR,
  NOT_AN_OBJECT3D_ERROR,
  PATH_ESCAPES_PROJECT_ERROR,
} from '../contributions/module-source';
import { exportObject3DToGlb, installNodeThreePolyfills } from '../lib/bake/gltf-bake';
import { disposeObject3D } from '../lib/bake/object3d-lifecycle';

const LIVE_MODULE = '@volter/editor-live';

export const NO_EDITOR_SESSION_ERROR: ToolErrorDefinition = {
  code: 'NO_EDITOR_SESSION',
  summary:
    'No live editor session for this project — rasterization happens in the editor, so a look ' +
    'is impossible without one. Run `vgai edit <project>`.',
  data: z.object({ projectRoot: z.string(), reason: z.string() }),
};

export const INVALID_LOOK_PARAMS_ERROR: ToolErrorDefinition = {
  code: 'INVALID_LOOK_PARAMS',
  summary:
    'The look parameters contradict each other: `time` requires `clip`, and `orbit` stages ' +
    'its own cameras so it cannot combine with azimuth/elevation/distance/clip/time.',
  data: z.object({ orbit: z.number().optional(), time: z.number().optional() }),
};

export const BakePreviewInputSchema = z.object({
  modulePath: z
    .string()
    .min(1)
    .describe(
      'Project-relative (or absolute, inside the project) path to a TypeScript module that ' +
        'exports a builder function returning a native THREE.Object3D — the same module ' +
        'reference `project.bake.module` takes.',
    ),
  exportName: z
    .string()
    .min(1)
    .default('default')
    .describe("Name of the module export to call. Defaults to the module's default export."),
  size: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Square pixel size of each view (editor default when omitted).'),
  background: z
    .enum(['neutral', 'transparent'])
    .optional()
    .describe("Asset Lab backdrop for every view (editor default 'neutral' when omitted)."),
  orbit: z
    .number()
    .int()
    .min(2)
    .max(24)
    .optional()
    .describe(
      'Walk around the model instead of taking the four fixed views: this many frames at ' +
        'evenly spaced headings, written as orbit-01.png… with a contact sheet. Every frame ' +
        'shares one framing scale, so the subject holds still while the camera moves.',
    ),
  azimuth: z
    .number()
    .finite()
    .optional()
    .describe(
      'Free capture camera: ONE view from this heading in degrees (0 = the model\u2019s ' +
        'declared front, same convention as the turntable yaw) instead of the four fixed ' +
        'views. Combines with elevation/distance; cannot combine with orbit.',
    ),
  elevation: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe('Free capture camera elevation in degrees above level (defaults to 0).'),
  distance: z
    .number()
    .positive()
    .optional()
    .describe(
      'Free capture camera distance in meters from the framing center (auto-fit when omitted).',
    ),
  clip: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Pose the model with this named animation clip (from the builder\u2019s own ' +
        '`root.animations`) before capturing. Fails loudly naming the clips that exist.',
    ),
  time: z
    .number()
    .min(0)
    .optional()
    .describe('Clip time in seconds to sample the pose at (defaults to 0; requires clip).'),
});

/**
 * The `--orbit <n>` shot set: n turntable headings, evenly spaced, starting at
 * the front. Zero-padded labels because they are also FILENAMES, and
 * `orbit-10` sorting before `orbit-2` is how a contact sheet's reading order
 * stops matching the camera's.
 */
export function orbitShotSet(frames: number): {
  name: string;
  shots: Array<{ label: string; view: 'turntable'; yaw: number }>;
} {
  const width = String(frames).length;
  return {
    name: 'orbit',
    shots: Array.from({ length: frames }, (_, index) => ({
      label: `orbit-${String(index + 1).padStart(Math.max(2, width), '0')}`,
      view: 'turntable' as const,
      yaw: (index * Math.PI * 2) / frames,
    })),
  };
}

export const BakePreviewResultSchema = z.object({
  directory: z
    .string()
    .describe('Project-relative directory the PNGs were written to, under .vgai/screenshots/.'),
  files: z
    .array(z.string())
    .describe(
      'Project-relative paths of every PNG written — the four views (or the orbit frames) ' +
        'plus the contact sheet.',
    ),
  contactSheet: z.string().describe('Project-relative path of the contact sheet PNG.'),
  emptyFrames: z
    .array(z.object({ label: z.string(), message: z.string() }))
    .optional()
    .describe(
      'Orbit frames that framed no geometry. Written anyway — a background-only PNG reads as ' +
        'coverage on a contact sheet unless something says otherwise — and never fatal.',
    ),
  width: z.number().describe('Pixel width of each view, as the editor rendered it.'),
  height: z.number().describe('Pixel height of each view, as the editor rendered it.'),
  vertexCount: z.number().describe('Vertices in the built Object3D, counted on the source graph.'),
  triangleCount: z
    .number()
    .describe('Triangles in the built Object3D, counted on the source graph.'),
  meshCount: z.number().describe('Meshes in the built Object3D, counted on the source graph.'),
  boundaryEdgeCount: z
    .number()
    .describe(
      'Edges with one triangle after welding by position: holes, unclosed caps, parts never ' +
        'joined. A closed game asset has zero; the bench shipped 343 unnoticed.',
    ),
  boundaryEdgeSamples: z
    .array(z.tuple([z.number(), z.number(), z.number()]))
    .describe('World-space midpoints of up to six open edges — where to look, not just how many.'),
  nonFiniteVertexCount: z
    .number()
    .describe(
      'Vertices whose position is NaN or infinite — a normalize() of a zero vector, a division by ' +
        'zero in build(), a degenerate face through a kit op. Three.js only says "computeBoundingBox: ' +
        'NaN values"; this is the count, so the look can name it.',
    ),
  bounds: z
    .object({
      min: z.tuple([z.number(), z.number(), z.number()]),
      max: z.tuple([z.number(), z.number(), z.number()]),
    })
    .describe(
      'World-space bounding box of the built Object3D, metres, Y up — the facts a brief states ' +
        '("0.9 m tall, base at y = 0") answered by the look itself instead of a second door.',
    ),
  invertedTriangleCount: z
    .number()
    .describe(
      'Triangles facing INWARD: inside-out closed shells plus non-contiguous winding pairs — what ' +
        "Blender's Face Orientation overlay paints red. The stage lights both sides, so the PNGs " +
        'cannot show these; a non-zero count is a defect the picture hides.',
    ),
  glbBytes: z
    .number()
    .describe('Size of the in-memory GLB that was photographed. It was never written to disk.'),
});

/** A `@volter/editor-live` session, narrowed to the one call this tool makes. Declared
 *  structurally so the capability takes no build-time dependency on the
 *  session client. */
interface LivePreviewCapture {
  width: number;
  height: number;
  views: Array<{ view: string; base64: string }>;
  contactSheet: { base64: string };
}

interface LivePreviewShotSetCapture {
  width: number;
  height: number;
  shots: Array<{ label: string; base64: string }>;
  warnings?: Array<{ label: string; message: string }>;
  contactSheet: { base64: string };
}

interface LivePreviewSession {
  editor: {
    assetPreview(
      source: { glbBase64: string },
      options?: { width?: number; height?: number; background?: 'neutral' | 'transparent' },
    ): Promise<LivePreviewCapture>;
    assetPreviewShots(
      source: { glbBase64: string },
      definition: { name: string; shots: Array<{ label: string; view: 'turntable'; yaw: number }> },
      options?: { width?: number; height?: number; background?: 'neutral' | 'transparent' },
    ): Promise<LivePreviewShotSetCapture>;
  };
}

/** `src/models/goblin.ts` + `buildGoblin` -> `goblin-buildgoblin`; the default
 *  export contributes no suffix. Lowercased and stripped to the same character
 *  class an asset name uses, so the directory is always a plain path segment. */
export function bakePreviewSlug(modulePath: string, exportName: string): string {
  const stem = basename(modulePath).replace(/\.[^.]+$/, '');
  const raw = exportName === 'default' ? stem : `${stem}-${exportName}`;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'module' : slug.slice(0, 64);
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Build the module's Object3D and export it to an in-memory GLB. Exported for
 * the headless acceptance test: this is the whole Node half, and it is the
 * half that can be proven without a GPU.
 */
export async function buildModuleGlbBytes(
  projectRoot: string,
  modulePath: string,
  exportName: string,
  loadModule?: (absolutePath: string) => Promise<unknown>,
): Promise<{
  glb: Uint8Array;
  vertexCount: number;
  triangleCount: number;
  invertedTriangleCount: number;
  boundaryEdgeCount: number;
  boundaryEdgeSamples: [number, number, number][];
  nonFiniteVertexCount: number;
  meshCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}> {
  const restoreGlobals = installNodeThreePolyfills();
  let build: Awaited<ReturnType<typeof buildFromModule>> | undefined;
  try {
    build = await buildFromModule(projectRoot, modulePath, exportName, loadModule);
    const root = build.root;
    const stats = computeMeshStats(root);
    assertRenderableGeometry(stats, modulePath, exportName);
    const meshCount = countMeshes(root);
    // Same carrier as the bake lane: the module's own `Object3D.animations`.
    // The preview GLB reaches the Asset Lab's animation transport, so a look
    // at a builder with actions has to be a look at those actions too — an
    // empty list here made every model module read as un-animated.
    const glb = await exportObject3DToGlb(root, root.animations);
    const box = new THREE.Box3().setFromObject(root);
    const bounds = {
      min: [box.min.x, box.min.y, box.min.z] as [number, number, number],
      max: [box.max.x, box.max.y, box.max.z] as [number, number, number],
    };
    return { glb, ...stats, meshCount, bounds };
  } finally {
    // The builder's OWN teardown when it returned one (a rig's mixers/actions
    // are invisible to a graph walk); otherwise the generic dispose.
    if (build) {
      if (build.dispose) build.dispose();
      else disposeObject3D(build.root);
    }
    restoreGlobals();
  }
}

export const tool = defineTool({
  name: 'project.bake.preview',
  summary: 'Look at a project Object3D module — build it headlessly and photograph it, no bake.',
  description:
    'Imports a project TypeScript module (`modulePath` + `exportName`), calls its exported ' +
    'builder to get a native THREE.Object3D, exports it to an IN-MEMORY GLB, and hands those ' +
    "bytes to the live editor session's Asset Lab for the standard four-view contact sheet — " +
    'or, with `orbit`, for that many evenly spaced headings around the subject. ' +
    'The PNGs are written under <project>/.vgai/screenshots/. Nothing is written under ' +
    'public/, no provenance record is created, and no GLB reaches disk — this is the read-only ' +
    'sibling of project.bake.module, for looking at a builder while iterating on it.',
  input: BakePreviewInputSchema,
  result: BakePreviewResultSchema,
  errors: [
    MODULE_NOT_FOUND_ERROR,
    EXPORT_NOT_CALLABLE_ERROR,
    NOT_AN_OBJECT3D_ERROR,
    EMPTY_GEOMETRY_ERROR,
    PATH_ESCAPES_PROJECT_ERROR,
    NO_EDITOR_SESSION_ERROR,
    INVALID_LOOK_PARAMS_ERROR,
  ],
  requires: { project: true, editor: true },
  host: 'node',
  mutates: false,
  supportsDryRun: false,
  longRunning: true,
  permission: {
    risk: 'read',
    summary:
      'Imports and runs a project module, then writes look-only PNGs under .vgai/screenshots/. ' +
      'Never touches the project asset namespace.',
  },
  async impl(input, ctx) {
    const projectRoot = ctx.projectRoot;
    if (!projectRoot) throw new Error('project.bake.preview requires a project root.');

    // Node-hosted editor extension: load the session client only on
    // invocation so the game's browser bundle never acquires a tooling edge.
    // Resolve the session BEFORE building
    // — a builder that takes seconds should not run just to discover there is
    // nowhere to render it.
    let session: LivePreviewSession;
    try {
      const { connect } = (await import(/* @vite-ignore */ LIVE_MODULE)) as {
        connect(projectDir: string): Promise<LivePreviewSession>;
      };
      session = await connect(projectRoot);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ToolError(
        NO_EDITOR_SESSION_ERROR.code,
        'project.bake.preview renders through the live editor session (Node has no GPU), and ' +
          `none is open for this project. Run \`vgai edit ${projectRoot}\` first. (${reason})`,
        { projectRoot, reason },
      );
    }

    if (input.time !== undefined && input.clip === undefined) {
      throw new ToolError(
        INVALID_LOOK_PARAMS_ERROR.code,
        'project.bake.preview: `time` poses a clip — pass `clip` with it.',
        { time: input.time },
      );
    }
    const wantsCamera =
      input.azimuth !== undefined || input.elevation !== undefined || input.distance !== undefined;
    if (input.orbit !== undefined && (wantsCamera || input.clip !== undefined)) {
      throw new ToolError(
        INVALID_LOOK_PARAMS_ERROR.code,
        'project.bake.preview: `orbit` stages its own cameras — it cannot combine with ' +
          'azimuth/elevation/distance/clip/time.',
        { orbit: input.orbit },
      );
    }
    const built = await buildModuleGlbBytes(
      projectRoot,
      input.modulePath,
      input.exportName,
      ctx.loadProjectModule,
    );
    const source = { glbBase64: base64FromBytes(built.glb) };
    const options = {
      ...(input.size !== undefined ? { width: input.size, height: input.size } : {}),
      ...(input.background !== undefined ? { background: input.background } : {}),
      ...(wantsCamera
        ? {
            camera: {
              azimuthDegrees: input.azimuth ?? 0,
              elevationDegrees: input.elevation ?? 0,
              ...(input.distance === undefined ? {} : { distance: input.distance }),
            },
          }
        : {}),
      ...(input.clip === undefined
        ? {}
        : { pose: { clip: input.clip, timeSeconds: input.time ?? 0 } }),
    };
    // One capture call either way; only which frames get named differs.
    const orbit =
      input.orbit === undefined
        ? null
        : await session.editor.assetPreviewShots(source, orbitShotSet(input.orbit), options);
    const capture = orbit ?? (await session.editor.assetPreview(source, options));

    const directory = join(
      '.vgai',
      'screenshots',
      `${bakePreviewSlug(input.modulePath, input.exportName)}-${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}`,
    );
    await mkdir(join(projectRoot, directory), { recursive: true });
    const files: string[] = [];
    const frames = orbit
      ? orbit.shots.map((shot) => ({ name: shot.label, base64: shot.base64 }))
      : (capture as LivePreviewCapture).views.map((view) => ({
          name: view.view,
          base64: view.base64,
        }));
    for (const frame of frames) {
      const relative = join(directory, `${frame.name}.png`);
      await writeFile(join(projectRoot, relative), Buffer.from(frame.base64, 'base64'));
      files.push(relative);
    }
    // The default look photographs the UNDERSIDE too — the lab stage renders
    // it as the sheet's fifth tile and as its own `below.png` frame (both in
    // `views` above), so gills under a cap and a barrel's floor are on the one
    // sheet an agent reads, not in a second image it has to open.
    const contactSheet = join(directory, 'contact-sheet.png');
    await writeFile(
      join(projectRoot, contactSheet),
      Buffer.from(capture.contactSheet.base64, 'base64'),
    );
    files.push(contactSheet);

    return {
      directory,
      files,
      contactSheet,
      ...(orbit?.warnings?.length ? { emptyFrames: orbit.warnings } : {}),
      width: capture.width,
      height: capture.height,
      vertexCount: built.vertexCount,
      triangleCount: built.triangleCount,
      meshCount: built.meshCount,
      invertedTriangleCount: built.invertedTriangleCount,
      boundaryEdgeCount: built.boundaryEdgeCount,
      boundaryEdgeSamples: built.boundaryEdgeSamples,
      nonFiniteVertexCount: built.nonFiniteVertexCount,
      bounds: built.bounds,
      glbBytes: built.glb.byteLength,
    };
  },
});
