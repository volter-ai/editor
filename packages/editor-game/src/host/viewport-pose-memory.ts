/**
 * The Scene viewport camera pose a reader left behind, remembered per project.
 *
 * WHY. A reload auto-framed from scratch, so the view someone had carefully
 * settled on was gone after every F5 and they had to hunt for their objects
 * again (runhuman pass 56). The auto-frame design's own outranking rule
 * (auto-frame-window.ts: "the reader's first camera gesture ends the window")
 * already says what a remembered pose is — a gesture that has ALREADY
 * happened — so restoring one replaces the whole window: no measured framing,
 * no game-camera seed. A project with no remembered pose (first ever open)
 * keeps the designed first-look framing untouched.
 *
 * Storage: the `viewportPose` section of the project-local document
 * (`project-local-state.ts`) — per checkout, keyed by the folder itself.
 */

import type * as THREE from 'three';
import { projectLocalSection, writeProjectLocalSection } from '@volter/editor-core/project-local-state';

/** The section of the project-local document this module owns. */
const SECTION = 'viewportPose';

export interface ViewportPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

/** The remembered pose for the OPEN project, or null (first ever open). */
export function savedViewportPose(): ViewportPose | null {
  const pose = projectLocalSection<ViewportPose>(SECTION);
  return pose &&
    Array.isArray(pose.position) &&
    pose.position.length === 3 &&
    pose.position.every(Number.isFinite) &&
    Array.isArray(pose.target) &&
    pose.target.length === 3 &&
    pose.target.every(Number.isFinite)
    ? pose
    : null;
}

/** Remember where the reader's gesture left the camera. */
export function saveViewportPose(camera: THREE.PerspectiveCamera, target: THREE.Vector3): void {
  writeProjectLocalSection(SECTION, {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
  } satisfies ViewportPose);
}
