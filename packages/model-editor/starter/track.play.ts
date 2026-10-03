// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.

/** Drive `track.py`'s car on the detached Model copy. Local +Y is forward, Z is up. */
import * as THREE from 'three';

export default function play(context: {
  readonly root: THREE.Object3D;
  find(name: string): THREE.Object3D | null;
  readonly camera: THREE.Camera;
  readonly keys: ReadonlySet<string>;
}) {
  const { root, find, keys } = context;
  const car = find('Car');
  const track = find('Track');
  if (!car || !track) throw new Error('Run track.py in the session\'s Blender to make Car and Track.');
  const wheels = ['Wheel.FL', 'Wheel.FR', 'Wheel.RL', 'Wheel.RR'].map((name) => {
    const wheel = find(name);
    if (!wheel) throw new Error(`The track model has no ${name}.`);
    wheel.rotation.reorder('ZXY');
    return wheel;
  });
  let speed = 0;
  let heading = car.rotation.z;
  let steering = 0;
  let cameraStarted = false;
  const ray = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3();
  const up = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const target = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const held = (arrow: string, letter: string): boolean => keys.has(arrow) || keys.has(letter);
  const approach = (value: number, goal: number, step: number): number =>
    value < goal ? Math.min(value + step, goal) : Math.max(value - step, goal);
  const onTrack = (): boolean => {
    root.updateMatrixWorld(true);
    car.getWorldPosition(origin);
    up.set(0, 0, 1).transformDirection(root.matrixWorld);
    origin.addScaledVector(up, 2);
    down.copy(up).negate();
    ray.set(origin, down);
    ray.far = 4;
    return ray.intersectObject(track, true).length > 0;
  };

  return {
    update(dt: number) {
      const throttle = held('ArrowUp', 'KeyW');
      const brake = held('ArrowDown', 'KeyS');
      const turn = Number(held('ArrowLeft', 'KeyA')) - Number(held('ArrowRight', 'KeyD'));
      car.position.z = 0;
      const road = onTrack();
      if (throttle && !brake) speed = approach(speed, 26, (speed < 0 ? 18 : 9) * dt);
      else if (brake && !throttle) speed = approach(speed, -8, (speed > 0 ? 18 : 6) * dt);
      else speed = approach(speed, 0, (throttle && brake ? 18 : 3) * dt);
      if (!road) {
        speed *= Math.exp(-8 * dt);
        speed = THREE.MathUtils.clamp(speed, -3, 3);
      }
      steering = approach(steering, turn * 0.5, 3 * dt);
      // A bicycle turn fades to zero at rest and reverses with the car.
      heading += speed / 2.6 * Math.tan(steering) / (1 + Math.abs(speed) / 10) * dt;
      car.rotation.set(0, 0, heading);
      const distance = speed * dt;
      car.position.x -= Math.sin(heading) * distance;
      car.position.y += Math.cos(heading) * distance;
      // Check the new position too, so crossing a kerb slows this frame's speed.
      if (road && !onTrack()) speed = THREE.MathUtils.clamp(speed * Math.exp(-8 * dt), -3, 3);
      for (const [index, wheel] of wheels.entries()) {
        wheel.rotation.z = index < 2 ? steering : 0;
        wheel.rotation.x = (wheel.rotation.x - distance / 0.42) % (2 * Math.PI);
      }

      // Smooth our own world-space pose: stage navigation re-poses its camera each frame.
      root.updateMatrixWorld(true);
      car.localToWorld(eye.set(0, -10, 6));
      car.localToWorld(target.set(0, 2, 0.8));
      if (!cameraStarted) {
        cameraPosition.copy(eye);
        cameraTarget.copy(target);
        cameraStarted = true;
      }
      const blend = 1 - Math.exp(-6 * dt);
      cameraPosition.lerp(eye, blend);
      cameraTarget.lerp(target, blend);
      const camera = context.camera;
      camera.position.copy(cameraPosition);
      if (camera.parent) camera.parent.worldToLocal(camera.position);
      camera.up.copy(up);
      camera.lookAt(cameraTarget);
      camera.updateMatrixWorld(true);
    },
  };
}
