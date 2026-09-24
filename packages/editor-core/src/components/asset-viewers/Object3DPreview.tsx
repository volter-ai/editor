import type {
  ToolObject3DPreviewContext,
  ToolObject3DPreviewExtension,
} from '@volter/editor-sdk/contributions';
import { themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createOwnedObjectPreviewSnapshot,
  createPerspectiveAssetPreviewCamera,
  disposeProjectAssetModel,
  loadProjectAssetModel,
  measureAssetPreview,
  type NativeObjectPreviewSource,
  type OwnedObjectPreviewSnapshot,
} from '../../asset-preview';
import { registerPreviewResource } from '../../asset-workflow/preview-resource-lifetime';
import { registerDesignTimeSurface } from '../../coverage/design-time-surfaces';
import {
  isEditorPresentationActive,
  subscribeEditorPresentationActivity,
} from '@volter/editor-sdk/kit/editor-presentation-activity';
import {
  createModelPreviewSource,
  loadModelThumbnailObject,
  modelThumbnailFormat,
} from '../../model-thumbnail';

export interface Object3DPreviewProps {
  readonly assetPath?: string | undefined;
  readonly materialPath?: string | undefined;
  readonly displayName?: string | undefined;
  readonly active?: boolean | undefined;
  readonly sourceFactory?: (() => NativeObjectPreviewSource) | undefined;
  readonly showSkeleton?: boolean | undefined;
  readonly background?: THREE.ColorRepresentation | undefined;
  readonly cameraDirection?: readonly [number, number, number] | undefined;
  readonly showGrid?: boolean | undefined;
  readonly useDefaultLighting?: boolean | undefined;
  readonly exposure?: number | undefined;
  readonly setupPreview?:
    | ((context: ToolObject3DPreviewContext) => ToolObject3DPreviewExtension | undefined)
    | undefined;
}

/**
 * Pose the model at its first clip's frame ZERO and HOLD it there. A preview
 * card is a design-time surface: presentation (orbit damping, a project
 * `setupPreview` extension's own chrome) keeps running, content time does not
 * (`coverage/design-time-surfaces.ts`). There is no option to play it — the one
 * place a clip runs on a design-time surface is the animation workspace's
 * transport, on the document surface, under a human's hand.
 */
function poseAtFirstFrame(loaded: THREE.Object3D): THREE.AnimationMixer | null {
  const clip = loaded.animations[0];
  if (!clip) return null;
  const mixer = new THREE.AnimationMixer(loaded);
  const action = mixer.clipAction(clip).play();
  action.paused = true;
  mixer.update(0);
  return mixer;
}

/** Preview cards are anonymous (several can show the same asset at once), so the
 *  Edit-static row needs a per-MOUNT identity to name one by. */
let previewCardSequence = 0;

/** Compact, non-authoring Object3D preview for cards, catalogs, and thumbnails. */
export function Object3DPreview({
  assetPath,
  materialPath,
  displayName = 'Object3D preview',
  active = true,
  sourceFactory,
  showSkeleton = false,
  background,
  cameraDirection,
  showGrid = true,
  useDefaultLighting = true,
  exposure = 1,
  setupPreview,
}: Object3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const controller = new AbortController();
    // This card holds its content time at zero for its whole life — nothing
    // below advances a mixer or a source tick — and says so out loud, so
    // Edit-static speaks for preview cards too instead of skipping them
    // (`coverage/design-time-surfaces.ts`).
    const unregisterDesignTimeSurface = registerDesignTimeSurface({
      id: `preview-card:${++previewCardSequence}`,
      label: `${displayName} (preview card)`,
      contentClock: () => 0,
    });
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const releaseContext = registerPreviewResource('webglContext');
    const releaseAnimationFrame = registerPreviewResource('animationFrame');
    const releaseResizeObserver = registerPreviewResource('resizeObserver');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const clock = new THREE.Clock();
    let mixer: THREE.AnimationMixer | null = null;
    let ownedModel: THREE.Object3D | null = null;
    let ownedFactory: OwnedObjectPreviewSnapshot | null = null;
    let extension: ToolObject3DPreviewExtension | undefined;
    let sparkRenderer: SparkRenderer | null = null;
    let framing: ReturnType<typeof measureAssetPreview> | null = null;
    const previewHelpers: THREE.Object3D[] = [];
    let frame = 0;
    let disposed = false;

    setError(null);
    setLoading(true);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(background ?? 0x20242a, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // The backing buffer scales with DPR, but layout must remain exactly the
    // size of the preview surface. Without an explicit CSS footprint a DPR 2
    // canvas lays out at twice the intended dimensions and overflow clips it
    // to the top-left quadrant.
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    if (useDefaultLighting) {
      scene.add(new THREE.HemisphereLight(0xffffff, 0x354052, 1.8));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(3, 5, 4);
      scene.add(key);
    }
    if (showGrid) {
      const grid = new THREE.GridHelper(10, 20, 0x51606f, 0x343b44);
      scene.add(grid);
      previewHelpers.push(grid);
    }

    const fitCamera = (width: number, height: number) => {
      if (!framing) return;
      const requestedDirection = cameraDirection
        ? new THREE.Vector3(...cameraDirection)
        : undefined;
      const fitted = createPerspectiveAssetPreviewCamera(
        framing,
        Math.max(width, 1) / Math.max(height, 1),
        requestedDirection,
      );
      camera.copy(fitted, false);
      controls.target.copy(framing.center);
      controls.update();
    };

    const install = async (loaded: THREE.Object3D) => {
      if (disposed) return;
      scene.add(loaded);
      let containsSplat = false;
      loaded.traverse((object) => {
        if (hasUserData(object, 'gaussianSplat')) containsSplat = true;
      });
      if (containsSplat) {
        const { SparkRenderer } = await import('@sparkjsdev/spark');
        if (disposed) return;
        sparkRenderer = new SparkRenderer({ renderer, enableLod: false });
      }
      framing = measureAssetPreview(loaded, 'perspective');
      fitCamera(container.clientWidth, container.clientHeight);
      mixer = poseAtFirstFrame(loaded);
      if (showSkeleton) {
        const helper = new THREE.SkeletonHelper(loaded);
        helper.name = '__compact_preview_skeleton';
        scene.add(helper);
        previewHelpers.push(helper);
      }
      extension = setupPreview?.({ scene, camera, renderer, model: loaded });
      extension?.resize?.(
        Math.max(container.clientWidth, 1),
        Math.max(container.clientHeight, 1),
        renderer.getPixelRatio(),
      );
      setLoading(false);
    };

    const load = async () => {
      try {
        if (sourceFactory) {
          ownedFactory = createOwnedObjectPreviewSnapshot(sourceFactory);
          await install(ownedFactory.root);
          return;
        }
        if (!assetPath) throw new Error('Compact Object3D preview has no source.');
        const format = modelThumbnailFormat(assetPath);
        if (!format) throw new Error(`No native Three.js loader supports ${assetPath}.`);
        const loaded =
          format === 'glb' || format === 'gltf' || format === 'spz'
            ? await loadProjectAssetModel(assetPath, controller.signal)
            : await loadModelThumbnailObject({
                url: assetPath,
                format,
                ...(materialPath ? { materialUrl: materialPath } : {}),
              });
        ownedModel = createModelPreviewSource(loaded);
        if (controller.signal.aborted || disposed) {
          disposeProjectAssetModel(ownedModel);
          ownedModel = null;
          return;
        }
        await install(ownedModel);
      } catch (caught) {
        if (!controller.signal.aborted && !disposed) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setLoading(false);
        }
      }
    };
    void load();

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      if (framing && !extension) fitCamera(width, height);
      else {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      extension?.resize?.(width, height, renderer.getPixelRatio());
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const render = () => {
      frame = 0;
      if (disposed || !isEditorPresentationActive()) return;
      // PRESENTATION ONLY. The mixer is never advanced here — see
      // `poseAtFirstFrame`; `delta` drives the project's own presentation
      // extension and the orbit damping, both editor-owned.
      const delta = Math.min(clock.getDelta(), 0.1);
      controls.update();
      if (sparkRenderer) scene.add(sparkRenderer);
      try {
        if (extension?.render) extension.render(delta);
        else renderer.render(scene, camera);
      } finally {
        sparkRenderer?.removeFromParent();
      }
      frame = requestAnimationFrame(render);
    };
    const unsubscribeActivity = subscribeEditorPresentationActivity(() => {
      if (!isEditorPresentationActive()) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!disposed && frame === 0) {
        clock.getDelta();
        render();
      }
    });
    if (isEditorPresentationActive()) frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      unsubscribeActivity();
      unregisterDesignTimeSurface();
      controller.abort(new Error('Compact Object3D preview closed.'));
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mixer?.stopAllAction();
      extension?.dispose();
      controls.dispose();
      if (sparkRenderer) {
        sparkRenderer.removeFromParent();
        disposeSparkRendererWhenIdle(sparkRenderer);
        sparkRenderer = null;
      }
      renderer.dispose();
      renderer.forceContextLoss();
      for (const helper of previewHelpers) {
        const drawable = helper as THREE.Line;
        drawable.geometry?.dispose();
        const material = drawable.material;
        if (Array.isArray(material)) {
          for (const entry of material) entry.dispose();
        } else material?.dispose();
      }
      if (ownedFactory) ownedFactory.dispose();
      if (ownedModel) disposeProjectAssetModel(ownedModel);
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      releaseResizeObserver();
      releaseAnimationFrame();
      releaseContext();
    };
  }, [
    active,
    assetPath,
    background,
    cameraDirection,
    exposure,
    materialPath,
    setupPreview,
    showGrid,
    showSkeleton,
    sourceFactory,
    useDefaultLighting,
  ]);

  return (
    <div
      ref={containerRef}
      data-testid="object3d-compact-preview"
      role="region"
      aria-label={`Interactive 3D preview: ${displayName}`}
      aria-busy={loading}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 220,
        overflow: 'hidden',
        position: 'relative',
        background: themeVars.surface.inset,
      }}
    >
      {loading && !error ? (
        <span style={{ position: 'absolute', padding: 10, color: themeVars.content.muted }}>
          Loading…
        </span>
      ) : null}
      {!active ? (
        <span style={{ position: 'absolute', padding: 10, color: themeVars.content.muted }}>
          Preview suspended while inactive.
        </span>
      ) : null}
      {error ? (
        <div
          role="alert"
          style={{ position: 'absolute', padding: 10, color: themeVars.semantic.danger }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

import type { SparkRenderer } from '@sparkjsdev/spark';
import { hasUserData } from '@volter/editor-threejs/ecs/user-data';
import { disposeSparkRendererWhenIdle } from '@volter/editor-threejs/render/spark-renderer-lifecycle';
