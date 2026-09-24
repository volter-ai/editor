import {
  faCamera,
  faEllipsis,
  faGripLines,
  faThumbtack,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  EditorBadge,
  EditorIcon,
  EditorPopover,
  EditorSurface,
  IconButton,
  Inline,
  Text,
  Tooltip,
} from '@volter/editor-sdk/widgets';
import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type * as THREE from 'three';
import {
  alignCameraToViewport,
  cameraAuthoringPresentation,
  cameraAuthoringVersion,
  leaveCameraView,
  pilotCamera,
  subscribeCameraAuthoring,
  toggleCameraCompositionGuides,
  toggleCameraPreviewPin,
  viewThroughCamera,
} from '@volter/editor-core/camera-authoring';

export interface CameraAuthoringOverlayProps {
  readonly previewRef: RefObject<HTMLDivElement | null>;
}

function CameraPreview({ previewRef }: CameraAuthoringOverlayProps) {
  const { preview, previewPinned } = cameraAuthoringPresentation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);

  if (!preview) return null;
  const aspect =
    (preview.camera as THREE.PerspectiveCamera).isPerspectiveCamera &&
    Number.isFinite((preview.camera as THREE.PerspectiveCamera).aspect)
      ? (preview.camera as THREE.PerspectiveCamera).aspect
      : 16 / 9;

  return (
    <div className="vgai-camera-preview" data-testid="camera-preview">
      <Inline className="vgai-camera-preview-header" gap={4} align="center">
        <EditorIcon icon={faCamera} size="sm" />
        <Text
          variant="label"
          truncate
          className="vgai-camera-preview-title"
          title={`${preview.name} · ${preview.lens}`}
        >
          {preview.name}
        </Text>
        <Tooltip text={previewPinned ? 'Unpin camera preview' : 'Pin camera preview'}>
          <IconButton
            aria-label={previewPinned ? 'Unpin camera preview' : 'Pin camera preview'}
            aria-pressed={previewPinned}
            size="compact"
            onClick={toggleCameraPreviewPin}
          >
            <EditorIcon icon={faThumbtack} size="sm" />
          </IconButton>
        </Tooltip>
        <div ref={menuRef} className="vgai-camera-preview-menu-anchor">
          <Tooltip text="Camera actions">
            <IconButton
              aria-label="Camera actions"
              aria-expanded={menuOpen}
              size="compact"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <EditorIcon icon={faEllipsis} size="sm" />
            </IconButton>
          </Tooltip>
          {menuOpen ? (
            <EditorPopover className="vgai-camera-preview-menu">
              <Button
                variant="ghost"
                size="compact"
                disabled={!preview.canAuthorPose}
                title={preview.poseRefusal}
                onClick={() => {
                  setMenuOpen(false);
                  pilotCamera(preview);
                }}
              >
                Pilot Camera
              </Button>
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  setMenuOpen(false);
                  viewThroughCamera(preview);
                }}
              >
                View Through Camera
              </Button>
              <Button
                variant="ghost"
                size="compact"
                disabled={!preview.canAuthorPose}
                title={preview.poseRefusal}
                onClick={() => {
                  setMenuOpen(false);
                  alignCameraToViewport(preview);
                }}
              >
                Align Camera to Current View
              </Button>
            </EditorPopover>
          ) : null}
        </div>
      </Inline>
      <div
        ref={previewRef}
        className="vgai-camera-preview-image"
        style={{ aspectRatio: String(Math.max(0.5, Math.min(3, aspect))) }}
        role="img"
        aria-label={`Live view through ${preview.name}`}
        onDoubleClick={() => viewThroughCamera(preview)}
      />
    </div>
  );
}

function CompositionGuides() {
  return (
    <div className="vgai-camera-guides" aria-hidden="true">
      <div className="vgai-camera-guide vgai-camera-guide-v1" />
      <div className="vgai-camera-guide vgai-camera-guide-v2" />
      <div className="vgai-camera-guide vgai-camera-guide-h1" />
      <div className="vgai-camera-guide vgai-camera-guide-h2" />
      <div className="vgai-camera-safe-frame" />
      <div className="vgai-camera-center-mark" />
    </div>
  );
}

function CameraViewBanner() {
  const { view, guidesVisible } = cameraAuthoringPresentation();
  if (!view) return null;
  const piloting = view.mode === 'pilot';
  return (
    <>
      {guidesVisible ? <CompositionGuides /> : null}
      <EditorSurface
        variant="overlay"
        border
        className="vgai-camera-view-banner vgai-chrome-island vgai-glass-island"
        data-testid="camera-view-banner"
      >
        <Inline gap={6} align="center">
          <EditorBadge>{piloting ? 'PILOTING' : 'CAMERA VIEW'}</EditorBadge>
          <Text variant="label">{view.subject.name}</Text>
          <Text variant="caption" tone="muted">
            Exact camera view
          </Text>
          <Tooltip text={guidesVisible ? 'Hide composition guides' : 'Show composition guides'}>
            <IconButton
              aria-label={guidesVisible ? 'Hide composition guides' : 'Show composition guides'}
              aria-pressed={guidesVisible}
              size="compact"
              onClick={toggleCameraCompositionGuides}
            >
              <EditorIcon icon={faGripLines} size="sm" />
            </IconButton>
          </Tooltip>
          {!piloting ? (
            <Button
              size="compact"
              variant="primary"
              disabled={!view.subject.canAuthorPose}
              title={view.subject.poseRefusal}
              onClick={() => pilotCamera(view.subject)}
            >
              Pilot
            </Button>
          ) : null}
          <Tooltip text="Exit camera view">
            <IconButton aria-label="Exit camera view" size="compact" onClick={leaveCameraView}>
              <EditorIcon icon={faXmark} size="sm" />
            </IconButton>
          </Tooltip>
        </Inline>
      </EditorSurface>
    </>
  );
}

/** Selected-camera preview and view/pilot presentation for the Scene viewport. */
export function CameraAuthoringOverlay({ previewRef }: CameraAuthoringOverlayProps) {
  useSyncExternalStore(subscribeCameraAuthoring, cameraAuthoringVersion, cameraAuthoringVersion);
  return (
    <>
      <CameraPreview previewRef={previewRef} />
      <CameraViewBanner />
    </>
  );
}
