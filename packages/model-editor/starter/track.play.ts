// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.

/** Drive the detached Cube. All positions under root are Blender's metres, Z up. */
import * as THREE from 'three';

export default function play(context: {
  readonly root: THREE.Object3D;
  find(name: string): THREE.Object3D | null;
  readonly camera: THREE.Camera;
  readonly keys: ReadonlySet<string>;
}) {
  const { root, find, keys } = context;
  const car = find('Cube');
  if (!car || !find('Track')) throw new Error('Open track.blend and run track.py first.');
  const wheels = ['Wheel.FL', 'Wheel.FR', 'Wheel.RL', 'Wheel.RR'].map((name) => {
    const wheel = find(name);
    if (!wheel) throw new Error(`The track model has no ${name}.`);
    wheel.rotation.reorder('ZXY');
    return wheel;
  });
  const surfaces: THREE.Object3D[] = [];
  const obstacles: {
    object: THREE.Object3D; velocity: THREE.Vector3; spin: THREE.Vector3; floor: number; hit: boolean;
  }[] = [];
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    if (object.name === 'Track' || object.name.startsWith('Ramp')) surfaces.push(object);
    if (/^(Cone|Crate)\./.test(object.name)) {
      find(object.name);
      obstacles.push({ object, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), floor: object.position.z, hit: false });
    }
  });
  let speed = 0;
  let heading = car.rotation.z;
  let steering = 0;
  let verticalSpeed = 0;
  let grounded = true;
  let pitch = 0;
  let cameraStarted = false;
  const ray = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3();
  const up = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const target = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const held = (arrow: string, letter: string): boolean => keys.has(arrow) || keys.has(letter);
  const approach = (value: number, goal: number, step: number): number =>
    value < goal ? Math.min(value + step, goal) : Math.max(value - step, goal);
  const surfaceAt = (x: number, y: number): number | null => {
    root.localToWorld(origin.set(x, y, 40));
    ray.set(origin, down);
    ray.far = 100;
    const hit = ray.intersectObjects(surfaces, false)[0];
    return hit ? root.worldToLocal(hitPoint.copy(hit.point)).z : null;
  };

  return {
    update(dt: number) {
      if (dt <= 0) return;
      root.updateMatrixWorld(true);
      up.set(0, 0, 1).transformDirection(root.matrixWorld);
      down.copy(up).negate();
      const throttle = held('ArrowUp', 'KeyW');
      const brake = held('ArrowDown', 'KeyS');
      const turn = Number(held('ArrowLeft', 'KeyA')) - Number(held('ArrowRight', 'KeyD'));
      const steps = Math.ceil(dt / (1 / 60));
      const h = dt / steps;
      let travelled = 0;
      for (let step = 0; step < steps; step++) {
        if (throttle && !brake) speed = approach(speed, 30, (speed < 0 ? 20 : 10) * h);
        else if (brake && !throttle) speed = approach(speed, -8, (speed > 0 ? 20 : 7) * h);
        else speed = approach(speed, 0, (throttle && brake ? 20 : 3) * h);
        steering = approach(steering, turn * 0.5, 3 * h);
        if (grounded) heading += speed / 1.8 * Math.tan(steering) / (1 + Math.abs(speed) / 8) * h;
        const distance = speed * h;
        travelled += distance;
        car.position.x -= Math.sin(heading) * distance;
        car.position.y += Math.cos(heading) * distance;
        const road = surfaceAt(car.position.x, car.position.y);
        const floor = road ?? 0;
        if (road === null && grounded) {
          speed *= Math.exp(-8 * h);
          speed = THREE.MathUtils.clamp(speed, -4, 4);
        }
        // Follow a rising surface; retain its launch velocity when the surface drops away.
        if (grounded && floor >= car.position.z - 0.15) {
          verticalSpeed = (floor - car.position.z) / h;
          car.position.z = floor;
          const ahead = surfaceAt(car.position.x - Math.sin(heading), car.position.y + Math.cos(heading));
          const behind = surfaceAt(car.position.x + Math.sin(heading), car.position.y - Math.cos(heading));
          const slope = ahead === null || behind === null ? 0 : Math.atan2(ahead - behind, 2);
          pitch = THREE.MathUtils.lerp(pitch, slope, 1 - Math.exp(-10 * h));
        } else {
          grounded = false;
          verticalSpeed -= 18 * h;
          car.position.z += verticalSpeed * h;
          if (car.position.z <= floor && verticalSpeed <= 0) {
            car.position.z = floor;
            verticalSpeed = 0;
            grounded = true;
          }
          pitch = THREE.MathUtils.lerp(pitch, Math.atan2(verticalSpeed, Math.max(10, Math.abs(speed))), 1 - Math.exp(-3 * h));
        }
        for (const obstacle of obstacles) {
          const { object, velocity, spin } = obstacle;
          const dx = object.position.x - car.position.x;
          const dy = object.position.y - car.position.y;
          if (!obstacle.hit && Math.hypot(dx, dy) < 1.7 && Math.abs(object.position.z - car.position.z) < 2 && Math.abs(speed) > 1) {
            obstacle.hit = true;
            velocity.set(-Math.sin(heading) * speed * 0.8 + dx * 2, Math.cos(heading) * speed * 0.8 + dy * 2, 5);
            spin.set(3, -4, 2);
            speed *= 0.93;
          }
          if (!obstacle.hit) continue;
          velocity.z -= 18 * h;
          object.position.addScaledVector(velocity, h);
          object.rotation.x += spin.x * h;
          object.rotation.y += spin.y * h;
          object.rotation.z += spin.z * h;
          if (object.position.z < obstacle.floor) {
            object.position.z = obstacle.floor;
            velocity.z = Math.abs(velocity.z) * 0.25;
            velocity.x *= Math.exp(-5 * h);
            velocity.y *= Math.exp(-5 * h);
            spin.multiplyScalar(Math.exp(-5 * h));
          }
        }
      }
      car.rotation.set(pitch, 0, heading, 'ZXY');
      for (const [index, wheel] of wheels.entries()) {
        wheel.rotation.z = index < 2 ? steering : 0;
        wheel.rotation.x = (wheel.rotation.x - travelled / 0.42) % (2 * Math.PI);
      }

      // Smooth our own stage-space pose; navigation re-poses the stage camera each frame.
      root.updateMatrixWorld(true);
      root.localToWorld(eye.set(car.position.x + Math.sin(heading) * 10, car.position.y - Math.cos(heading) * 10, car.position.z + 6));
      car.localToWorld(target.set(0, 2, 1.2));
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
