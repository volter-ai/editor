/**
 * `capture-asset-preview` — the Asset Lab's photographs of a model or an entity:
 * the plain four views, a project shot set, the source review set, a compare
 * against a reference GLB and the live scene stage. Registered with the
 * viewport's relay verbs (`viewport-commands.ts`).
 */
import type { EditorCommandMessage, EditorCommandResult } from '@volter/editor-sdk/commands';
import { parseForwardVector } from '@volter/editor-sdk/kit/asset-compare-core';
import { captureEntityComparePreview, captureModelComparePreview } from './asset-compare';
import {
  type AssetPreviewBackground,
  captureGlbBytesAssetPreview,
  captureModelAssetPreview,
  captureObjectAssetPreview,
  captureSceneStageAssetPreview,
  captureShotSetAssetPreview,
  captureShotSetGlbBytesPreview,
  captureShotSetModelPreview,
  captureSourceReviewShotSetAssetPreview,
  captureSourceReviewShotSetModelPreview,
  parseShotSetDefinition,
} from './asset-preview';
import { activeDocumentAuthoring } from './authoring/shell-document-ops';
import { parseCameraChoice, parsePoseChoice } from '@volter/editor-sdk/kit/capture-camera-pose';
import type { EditorShellStore } from './editor-shell-store';
import { entityObject3D } from './entity-object';

export async function handleAssetPreviewCommand(
  store: EditorShellStore,
  cmd: EditorCommandMessage,
): Promise<EditorCommandResult> {
  const assetPath = cmd['assetPath'];
  const entityId = cmd['entityId'];
  // The THIRD source: a GLB that travels IN the command rather than being
  // fetched or looked up — the module-look lane (`project.bake.preview`)
  // builds an Object3D in Node, where there is no GPU, and hands the editor
  // the exported bytes. Counted rather than XOR-ed because there are now more
  // than two sources and "exactly one" has to stay exactly one.
  const glbBase64 = cmd['glbBase64'];
  const sourceCount =
    Number(typeof assetPath === 'string') +
    Number(typeof entityId === 'string') +
    Number(typeof glbBase64 === 'string');
  if (sourceCount !== 1) {
    return {
      ok: false,
      error: 'capture-asset-preview requires exactly one of assetPath, entityId or glbBase64.',
    };
  }
  const width = cmd['width'];
  const height = cmd['height'];
  const background = cmd['background'];
  const shots = cmd['shots'];
  const shotSet = cmd['shotSet'];
  const forward = cmd['forward'];
  const compare = cmd['compare'];
  const stage = cmd['stage'];
  const camera = cmd['camera'];
  const pose = cmd['pose'];
  if (
    (width !== undefined && typeof width !== 'number') ||
    (height !== undefined && typeof height !== 'number') ||
    (background !== undefined && background !== 'neutral' && background !== 'transparent') ||
    (shots !== undefined && shots !== 'source')
  ) {
    return { ok: false, error: 'Invalid asset preview dimensions, background, or shots mode.' };
  }
  if (stage !== undefined && stage !== 'lab' && stage !== 'scene') {
    return {
      ok: false,
      error: `capture-asset-preview stage must be "lab" or "scene", got ${String(stage)}.`,
    };
  }
  if (shotSet !== undefined && shots !== undefined) {
    return {
      ok: false,
      error: 'capture-asset-preview cannot combine a shotSet definition with a shots mode.',
    };
  }
  // The free capture camera and clip pose (`--azimuth/--elevation/--distance`,
  // `--clip/--time`) belong to the plain Asset Lab legs: a shot set / source
  // review / compare each stage their own cameras and poses, and the scene
  // stage photographs an entity where it stands. Refused by name, never
  // silently ignored.
  const cameraChoice = parseCameraChoice('capture-asset-preview', camera);
  if (typeof cameraChoice === 'string') return { ok: false, error: cameraChoice };
  const posedClip = parsePoseChoice('capture-asset-preview', pose);
  if (typeof posedClip === 'string') return { ok: false, error: posedClip };
  if (
    (cameraChoice || posedClip) &&
    (shots !== undefined || shotSet !== undefined || compare !== undefined || stage === 'scene')
  ) {
    return {
      ok: false,
      error:
        'capture-asset-preview cannot combine camera/pose with a shots mode, a shotSet ' +
        'definition, compare, or stage "scene" — those legs stage their own cameras and poses.',
    };
  }
  // A project-defined labeled shot set travels WITH the command (the CLI
  // resolves `--shots <set>` through the registered
  // `project.<set>.previewShots` tool); validate the untrusted
  // definition at the relay boundary so a malformed contribution fails with
  // a named reason instead of a deep three.js error.
  let shotSetDefinition: ReturnType<typeof parseShotSetDefinition> | undefined;
  if (shotSet !== undefined) {
    try {
      shotSetDefinition = parseShotSetDefinition(shotSet);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const parsedForward = parseForwardVector(forward);
  if (shots === 'source' && parsedForward === null) {
    return {
      ok: false,
      error: 'capture-asset-preview --shots source requires a non-degenerate forward [x,y,z].',
    };
  }
  if (compare !== undefined) {
    // B8.4 — the compare mode (`vgai screenshot <model.glb> --compare <ref.glb>`).
    // Validated here at the relay boundary so a malformed payload fails with
    // a named reason instead of a deep three.js error.
    if (shots !== undefined || shotSetDefinition !== undefined) {
      return { ok: false, error: 'capture-asset-preview cannot combine compare with shots.' };
    }
    if (
      typeof compare !== 'object' ||
      compare === null ||
      typeof (compare as Record<string, unknown>)['glbBase64'] !== 'string' ||
      ((compare as Record<string, unknown>)['forward'] !== undefined &&
        parseForwardVector((compare as Record<string, unknown>)['forward']) === null)
    ) {
      return {
        ok: false,
        error:
          'capture-asset-preview compare requires { glbBase64: string, forward?: [x, y, z] } ' +
          'with a non-degenerate ground-plane forward.',
      };
    }
  }
  // Wire-carried GLB bytes stand NOWHERE, so they take no scene stage and no
  // compare (whose reference is named some other way). An explicit `shotSet`
  // definition is a different matter and is served: a shot set stages the
  // subject itself, which is what lets `vgai screenshot <module> --orbit <n>`
  // circle a model that only ever existed as bytes. `shots: 'source'` stays
  // out — it is the asset-path review set, keyed to a stored forward vector.
  if (typeof glbBase64 === 'string') {
    if (shots !== undefined || compare !== undefined) {
      return {
        ok: false,
        error: 'capture-asset-preview cannot combine glbBase64 with a named shots mode or compare.',
      };
    }
    if (stage === 'scene') {
      return {
        ok: false,
        error:
          'capture-asset-preview stage "scene" photographs a live scene entity — glbBase64 bytes stand nowhere in the scene.',
      };
    }
  }
  // `stage: 'scene'` photographs a LIVE entity in the live scene (see
  // `captureSceneStageAssetPreview`), so it is meaningful only for the plain
  // four-view entity capture: a model loaded from `assetPath` stands nowhere,
  // and the shot-set/source/compare modes each stage their own subject.
  // Refused by name at this boundary rather than silently downgraded to the
  // lab stage — a caller who asked for the scene and got the studio would
  // never know.
  const liveScene = stage === 'scene' ? store.scene : null;
  if (stage === 'scene') {
    if (typeof entityId !== 'string') {
      return {
        ok: false,
        error:
          'capture-asset-preview stage "scene" photographs a live scene entity — pass entityId, not assetPath.',
      };
    }
    if (shots !== undefined || shotSetDefinition !== undefined || compare !== undefined) {
      return {
        ok: false,
        error:
          'capture-asset-preview cannot combine stage "scene" with a shots mode, a shotSet definition or compare.',
      };
    }
    if (!liveScene) {
      return {
        ok: false,
        error:
          'capture-asset-preview stage "scene" requires a bound viewport scene; none is bound yet.',
      };
    }
  }
  // Resolve the screenshot subject through the SAME active-document adapter
  // that produced `status.entities`, drives Hierarchy/Inspector selection and
  // answers `frame-entity`. An adopted Play scene can own a stable OID in its
  // projection without publishing that object through the shell's edit-mode
  // `objectMap`; checking the map alone made the final door reject an id every
  // preceding door had just accepted.
  const entityObject =
    typeof entityId === 'string'
      ? entityObject3D(activeDocumentAuthoring(store.shell), store.objectMap, entityId)
      : null;
  if (typeof entityId === 'string' && !entityObject) {
    return { ok: false, error: `Entity not found: ${entityId}` };
  }
  try {
    const options = {
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
      ...(background ? { background: background as AssetPreviewBackground } : {}),
      ...(cameraChoice ? { camera: cameraChoice } : {}),
      ...(posedClip ? { pose: posedClip } : {}),
    };
    if (compare !== undefined) {
      const compareRecord = compare as { glbBase64: string; forward?: unknown };
      const refForward = parseForwardVector(compareRecord.forward);
      const compareOptions = {
        ...(typeof width === 'number' ? { width } : {}),
        ...(typeof height === 'number' ? { height } : {}),
        ...(refForward ? { refForward } : {}),
      };
      const capture =
        typeof assetPath === 'string'
          ? await captureModelComparePreview(assetPath, compareRecord.glbBase64, compareOptions)
          : await captureEntityComparePreview(
              entityObject!,
              compareRecord.glbBase64,
              compareOptions,
            );
      return { ok: true, data: { ...capture } };
    }
    if (shotSetDefinition !== undefined) {
      const capture =
        typeof glbBase64 === 'string'
          ? await captureShotSetGlbBytesPreview(glbBase64, shotSetDefinition, options)
          : typeof assetPath === 'string'
            ? await captureShotSetModelPreview(assetPath, shotSetDefinition, options)
            : captureShotSetAssetPreview(entityObject!, shotSetDefinition, options);
      return { ok: true, data: { ...capture } };
    }
    if (shots === 'source') {
      const capture =
        typeof assetPath === 'string'
          ? await captureSourceReviewShotSetModelPreview(assetPath, parsedForward!, options)
          : captureSourceReviewShotSetAssetPreview(entityObject!, parsedForward!, options);
      return { ok: true, data: { ...capture } };
    }
    if (liveScene) {
      const capture = captureSceneStageAssetPreview(entityObject!, liveScene, options);
      return { ok: true, data: { ...capture } };
    }
    if (typeof glbBase64 === 'string') {
      const capture = await captureGlbBytesAssetPreview(glbBase64, options);
      return { ok: true, data: { ...capture } };
    }
    const capture =
      typeof assetPath === 'string'
        ? await captureModelAssetPreview(assetPath, options)
        : captureObjectAssetPreview(entityObject!, options);
    return { ok: true, data: { ...capture } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
