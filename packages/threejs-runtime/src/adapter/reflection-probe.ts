/**
 * Format-neutral live reflection-probe mark.
 *
 * A project-owned scene component writes this mark onto the Object3D it
 * returns. The renderer capability owns capture and material integration; the
 * editor only reads the mark to draw ordinary probe gizmos and expose the
 * capture command/status. Authored truth remains the component's JSX props —
 * this is a live adapter seam, not another document format.
 */
import type * as THREE from 'three';
import { deleteUserData, getUserData, setUserData } from '../ecs/user-data';

export type ReflectionProbeShape = 'box' | 'sphere';
export type ReflectionProbeCaptureMode = 'on-change' | 'manual' | 'realtime';
export type ReflectionProbeCaptureStatus = 'idle' | 'queued' | 'capturing' | 'ready' | 'error';

export interface ReflectionProbeConfig {
  readonly shape: ReflectionProbeShape;
  /** Full local-space box dimensions. */
  readonly size: readonly [number, number, number];
  /** Local-space sphere radius when `shape === 'sphere'`. */
  readonly radius: number;
  /** Local-space distance over which this probe fades at its boundary. */
  readonly blendDistance: number;
  /** Larger values win before equal-priority probes blend. */
  readonly priority: number;
  readonly intensity: number;
  readonly parallaxProjection: boolean;
  /** Full local-space projection-box dimensions. */
  readonly parallaxSize: readonly [number, number, number];
  readonly parallaxOffset: readonly [number, number, number];
  readonly captureOffset: readonly [number, number, number];
  readonly captureMode: ReflectionProbeCaptureMode;
  readonly resolution: number;
  readonly near: number;
  readonly far: number;
  readonly cullMask: number;
  readonly captureShadows: boolean;
}

export interface ReflectionProbeSnapshot {
  readonly status: ReflectionProbeCaptureStatus;
  /** Monotonic browser time from `performance.now()`, or null before capture. */
  readonly lastCapturedAt: number | null;
  readonly message?: string;
}

export interface ReflectionProbeMark {
  readonly config: ReflectionProbeConfig;
  readonly revision: number;
  recapture(): void;
  getSnapshot(): ReflectionProbeSnapshot;
  subscribe(listener: () => void): () => void;
}

export function reflectionProbeOf(
  object: THREE.Object3D | null | undefined,
): ReflectionProbeMark | null {
  const candidate = getUserData(object, 'reflectionProbe');
  if (!candidate || typeof candidate !== 'object') return null;
  const mark = candidate as Partial<ReflectionProbeMark>;
  return mark.config &&
    typeof mark.recapture === 'function' &&
    typeof mark.getSnapshot === 'function'
    ? (candidate as ReflectionProbeMark)
    : null;
}

export function setReflectionProbeMark(object: THREE.Object3D, mark: ReflectionProbeMark): void {
  setUserData(object, 'reflectionProbe', mark);
}

export function clearReflectionProbeMark(object: THREE.Object3D): void {
  deleteUserData(object, 'reflectionProbe');
}
