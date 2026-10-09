import * as THREE from 'three';

function pose(camera: THREE.Camera) {
  camera.updateWorldMatrix(true, false);
  return {
    position: camera.getWorldPosition(new THREE.Vector3()),
    quaternion: camera.getWorldQuaternion(new THREE.Quaternion()),
    projection: camera.projectionMatrix.clone(),
    fov: (camera as THREE.PerspectiveCamera).fov,
  };
}
type Pose = ReturnType<typeof pose>;

/** The tool blends AFTER the script has stated its complete camera pose.
 * Projection matrices also interpolate, preserving an orthographic editing
 * view exactly at the handoff to a perspective game. Neither editing camera
 * nor its orbit target is ever written.
 *
 * `instant` enters already arrived: a Restart replaces a game that was on screen a frame ago,
 * and flying in again from the editing pose would show the model between two games. The return
 * on Stop still blends. */
export function cameraTransition(editingCamera: THREE.Camera, options?: { readonly instant?: boolean; readonly duration?: number }) {
  const editing = pose(editingCamera);
  let phase: 'entering' | 'playing' | 'leaving' = options?.instant ? 'playing' : 'entering';
  let elapsed = 0;
  let last = editing;
  let leavingFrom = editing;
  // A cutscene's hand-back blends for its own (shorter) time; a zero blend arrives at once.
  const duration = Math.max(1e-3, options?.duration ?? 0.8);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  function blend(camera: THREE.Camera, from: Pose, to: Pose, t: number): void {
    const eased = t * t * (3 - 2 * t);
    position.lerpVectors(from.position, to.position, eased);
    quaternion.slerpQuaternions(from.quaternion, to.quaternion, eased);
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    if (camera.parent) {
      camera.parent.worldToLocal(camera.position);
      const parentRotation = camera.parent.getWorldQuaternion(new THREE.Quaternion());
      camera.quaternion.premultiply(parentRotation.invert());
    }
    if (Number.isFinite(from.fov) && Number.isFinite(to.fov)) {
      (camera as THREE.PerspectiveCamera).fov = THREE.MathUtils.lerp(from.fov, to.fov, eased);
    }
    for (let i = 0; i < 16; i++) {
      camera.projectionMatrix.elements[i] = THREE.MathUtils.lerp(from.projection.elements[i]!, to.projection.elements[i]!, eased);
    }
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld(true);
    last = pose(camera);
  }
  return {
    acceptingKeys: () => phase === 'playing',
    leaving: () => phase === 'leaving',
    hudOpacity: () => phase === 'playing' ? 1 : phase === 'entering'
      ? Math.min(1, elapsed / duration)
      : Math.max(0, 1 - elapsed / (duration - 0.16)),
    approachingEdit: () => phase === 'leaving' && elapsed >= duration - 0.16,
    /** A PAUSED frame: put the camera back where the last drawn frame had it. Nothing else
     *  states the pose while the game's update is held, and the stage's navigation runs before
     *  this hook each frame; the blend's own clock stands still with the game's. */
    hold(camera: THREE.Camera): void {
      blend(camera, last, last, 1);
    },
    /** Escape completes an existing blend; otherwise begin the return. */
    stop(escape: boolean): boolean {
      if (escape && phase === 'entering') { phase = 'playing'; return false; }
      if (escape && phase === 'leaving') return true;
      if (phase !== 'leaving') {
        leavingFrom = last;
        elapsed = 0;
        phase = 'leaving';
      }
      return false;
    },
    frame(camera: THREE.Camera, dt: number): boolean {
      if (phase === 'playing') { last = pose(camera); return false; }
      const t = Math.min(1, elapsed / duration);
      blend(camera, phase === 'entering' ? editing : leavingFrom, phase === 'entering' ? pose(camera) : editing, t);
      elapsed += dt;
      if (t < 1) return false;
      if (phase === 'leaving') return true;
      phase = 'playing';
      return false;
    },
  };
}
