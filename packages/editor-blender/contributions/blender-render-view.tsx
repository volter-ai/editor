/**
 * THE RENDER VIEW — the area a person splits beside the modeling viewport (View ▸ Area ▸ Vertical
 * Split) to watch the render while they model: Blender's standard always-on render preview, a 3D
 * viewport in Rendered shading looking through the scene camera.
 *
 * In Blender that area runs the scene's render engine live. Here three.js IS the render engine,
 * so the area shows the render's own photograph (`renderSceneCamera`, which takes it where
 * `bpy.ops.render.render` does), re-taken whenever the engine presents a new frame and whenever
 * the area changes size. It is the render, not a viewport lit like one: what this area shows is
 * what F12 would write, at this area's size.
 *
 * It re-renders on FRAMES, not on every presenter change: a snapshot's own texture decodes and
 * program links announce themselves on the same global signal (`blender-presenter-change.ts`),
 * so listening there would have each render request the next one forever, and the snapshot
 * already waits for its own work before it is photographed.
 */
import { blenderModelView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import { useEffect, useRef, useState } from 'react';
import { renderSceneCamera, type SceneCameraRender } from '../host/blender-runtime-host';

const view = blenderModelView;

/** Blender 5.2's default theme: the 3D View's `back`, and its overlay text. */
const BACKGROUND = '#3d3d3d';
const TEXT = '#ffffff';

export function BlenderRenderView() {
  const areaRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<SceneCameraRender | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let disposed = false;
    let dirty = false;
    let running = false;
    // ONE RENDER AT A TIME, and the latest request wins: a frame that lands mid-render marks the
    // area dirty and is rendered next, so a drag shows its end state rather than a queue.
    const run = async (): Promise<void> => {
      if (running) return;
      running = true;
      setRendering(true);
      try {
        while (dirty && !disposed) {
          dirty = false;
          const scale = globalThis.devicePixelRatio || 1;
          const region = {
            width: Math.max(1, Math.round(area.clientWidth * scale)),
            height: Math.max(1, Math.round(area.clientHeight * scale)),
          };
          let result: SceneCameraRender;
          try {
            result = await renderSceneCamera(view, region);
          } catch (error) {
            result = { kind: 'refused', reason: error instanceof Error ? error.message : String(error) };
          }
          if (!disposed) setShown(result);
        }
      } finally {
        running = false;
        if (!disposed) setRendering(false);
      }
    };
    const invalidate = (): void => {
      dirty = true;
      void run();
    };
    const stopFrames = view.subscribeFrames(invalidate);
    const resize = new ResizeObserver(invalidate);
    resize.observe(area);
    invalidate();
    return () => {
      disposed = true;
      stopFrames();
      resize.disconnect();
    };
  }, []);

  return (
    <div
      ref={areaRef}
      data-testid="blender-render-view"
      aria-label="Render view"
      style={{
        position: 'relative',
        flex: '1 1 0',
        minWidth: 0,
        // The split's wrapper bleeds 12 px past the slot as the stage does; the top 12 sit under
        // the header strip, so this area starts where the stage's own corner text does.
        marginTop: 12,
        background: BACKGROUND,
        overflow: 'hidden',
      }}
    >
      {shown?.kind === 'image' && (
        <img
          src={shown.url}
          alt="The scene camera's render"
          data-testid="blender-render-view-image"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
      )}
      {shown?.kind === 'refused' && (
        <div
          role="status"
          data-testid="blender-render-view-refusal"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            textAlign: 'center',
            color: TEXT,
            opacity: 0.8,
            fontSize: 12,
          }}
        >
          {shown.reason}
        </div>
      )}
      {/* THE VIEW'S NAME, Blender's own for a camera view (`view3d_get_name`: Camera Perspective or
          Camera Orthographic), and while a render is running, that it is. */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 8,
          color: TEXT,
          fontSize: 11,
          lineHeight: '14px',
          textShadow: '0 0 2px #000, 0 0 2px #000',
          pointerEvents: 'none',
        }}
      >
        {shown?.kind === 'image' && (
          <div>{shown.projection === 'orthographic' ? 'Camera Orthographic' : 'Camera Perspective'}</div>
        )}
        {rendering && <div data-testid="blender-render-view-rendering">Rendering…</div>}
      </div>
    </div>
  );
}
