import * as THREE from 'three';

type UpdateMatrixWorld = (force?: boolean) => void;
type PoseReporter = (type: string) => void;
interface AudioNode3D {
  matrixWorld: THREE.Matrix4;
  type: string;
  context: { readonly state: AudioContextState };
  // Three's AudioListener owns this private clock; PositionalAudio reads its
  // listener's public timeDelta. Only the verified getDelta method is needed.
  _clock?: Pick<THREE.Clock, 'getDelta'>;
  timeDelta?: number;
}

interface GuardState {
  dropped: number;
  report?: PoseReporter;
}

// The editor bundle and source-served runtime can load this helper separately
// while sharing Three. Installation belongs to the actual prototype identity.
const GUARD_STATE = Symbol.for('vgai.audio-pose-guard');
type AudioPrototype = {
  updateMatrixWorld: UpdateMatrixWorld;
  [GUARD_STATE]?: GuardState;
};

function poseIsFinite(matrixWorld: THREE.Matrix4): boolean {
  return matrixWorld.elements.every(Number.isFinite);
}

function guard(prototype: AudioPrototype, report?: PoseReporter): void {
  const existing = prototype[GUARD_STATE];
  if (existing) {
    if (report) existing.report = report;
    return;
  }
  const state: GuardState = { dropped: 0, ...(report ? { report } : {}) };
  Object.defineProperty(prototype, GUARD_STATE, { value: state });
  const suspendedListeners = new WeakSet<AudioNode3D>();
  const original = prototype.updateMatrixWorld;
  prototype.updateMatrixWorld = function guardedUpdateMatrixWorld(
    this: AudioNode3D,
    force?: boolean,
  ): void {
    // Keep the scene graph current even when Web Audio cannot consume a pose.
    THREE.Object3D.prototype.updateMatrixWorld.call(this as unknown as THREE.Object3D, force);
    if (this.context.state !== 'running') {
      if (this._clock) {
        this.timeDelta = 0;
        suspendedListeners.add(this);
      }
      return;
    }
    if (poseIsFinite(this.matrixWorld)) {
      // A hidden tab may have rendered no frames while suspended. Discard
      // that wall-time gap before Three computes its next short pose ramp.
      if (suspendedListeners.delete(this)) this._clock?.getDelta();
      original.call(this, force);
      return;
    }
    state.dropped++;
    state.report?.(this.type);
  };
}

/** Install once per Three prototype. Later editor installation can add its
 * diagnostic without replacing the runtime wrapper or losing its count. */
export function installAudioPoseGuard(report?: PoseReporter): void {
  guard(THREE.AudioListener.prototype as unknown as AudioPrototype, report);
  guard(THREE.PositionalAudio.prototype as unknown as AudioPrototype, report);
}

/** Non-finite pose updates dropped by this Three instance's guard. */
export function audioPoseUpdatesDropped(): number {
  return (
    ((THREE.AudioListener.prototype as unknown as AudioPrototype)[GUARD_STATE]?.dropped ?? 0) +
    ((THREE.PositionalAudio.prototype as unknown as AudioPrototype)[GUARD_STATE]?.dropped ?? 0)
  );
}
