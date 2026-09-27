import type { ToolObject3DPreviewProps } from '../../object3d-contributions';
import { Object3DPreview } from './asset-viewers/Object3DPreview';

/**
 * Editor-owned preview chrome for project-authored native Three.js sources.
 * Object3DPreview owns renderer, camera, controls, animation, and
 * teardown; the project owns only the raw build function and its resources.
 */
export function ToolObject3DPreview({
  build,
  displayName = 'Object3D preview',
  height = 360,
  background,
  showSkeleton = false,
  cameraDirection,
  showGrid,
  useDefaultLighting,
  exposure,
  setupPreview,
  active = true,
}: ToolObject3DPreviewProps) {
  const customPresentation = setupPreview !== undefined;
  return (
    <div style={{ width: '100%', height, minHeight: 240 }}>
      <Object3DPreview
        sourceFactory={build}
        displayName={displayName}
        active={active}
        showSkeleton={showSkeleton}
        background={background}
        cameraDirection={cameraDirection}
        showGrid={showGrid ?? !customPresentation}
        useDefaultLighting={useDefaultLighting ?? !customPresentation}
        exposure={exposure}
        setupPreview={setupPreview}
      />
    </div>
  );
}
