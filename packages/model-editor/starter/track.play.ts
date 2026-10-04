// SPDX-License-Identifier: MIT
// Copyright 2026 Volter AI, Inc.

/** Drive the detached Cube. All positions under root are Blender's metres, Z up. */
import * as THREE from 'three';
import { publishRaceState } from './race-state';

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
  const kerbs: THREE.Vector3[] = [];
  const obstacles: {
    object: THREE.Object3D; velocity: THREE.Vector3; spin: THREE.Vector3; floor: number; hit: boolean;
  }[] = [];
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    if (object.name.startsWith('Kerb.')) kerbs.push(object.position.clone());
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
  let elapsed = 0;
  let lap = 0;
  let lapStarted = 0;
  let lastLap = 0;
  let checkpoint = 0;
  let previousY = car.position.y;
  let effectClock = 0;
  let hudClock = 0;
  const checkpoints = [1, 2, 3].map(i => find(`Checkpoint.${i}`)).filter((o): o is THREE.Object3D => o !== null);
  const velocity = new THREE.Vector2();
  const effects = new THREE.Group();
  effects.name = 'Race effects';
  root.add(effects);
  const markGeometry = new THREE.PlaneGeometry(0.32, 0.7);
  const markMaterial = new THREE.MeshBasicMaterial({ color: '#0f1a1f', transparent: true, opacity: 0.6, depthWrite: false });
  const marks = Array.from({ length: 128 }, () => {
    const mark = new THREE.Mesh(markGeometry, markMaterial);
    mark.visible = false;
    effects.add(mark);
    return mark;
  });
  let nextMark = 0;
  const puffGeometry = new THREE.IcosahedronGeometry(0.22, 0);
  const puffs = Array.from({ length: 24 }, () => {
    const material = new THREE.MeshBasicMaterial({ color: '#e9edef', transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(puffGeometry, material);
    mesh.visible = false;
    effects.add(mesh);
    return { mesh, life: 0 };
  });
  let nextPuff = 0;
  let fps = 0;
  let measuredFrames = 0;
  let measuredSince = performance.now();
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
      elapsed += dt;
      measuredFrames++;
      const now = performance.now();
      if (now - measuredSince >= 1000) {
        fps = measuredFrames * 1000 / (now - measuredSince);
        measuredFrames = 0;
        measuredSince = now;
      }
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
        const drifting = grounded && Math.abs(steering) > 0.3 && Math.abs(speed) > 13;
        const grip = grounded ? (drifting ? 1.6 : 8) : 0.2;
        velocity.lerp(new THREE.Vector2(-Math.sin(heading) * speed, Math.cos(heading) * speed), 1 - Math.exp(-grip * h));
        travelled += velocity.length() * h * Math.sign(speed);
        car.position.x += velocity.x * h;
        car.position.y += velocity.y * h;
        const road = surfaceAt(car.position.x, car.position.y);
        const floor = road ?? 0;
        if (road === null && grounded) {
          speed *= Math.exp(-8 * h);
          speed = THREE.MathUtils.clamp(speed, -4, 4);
          velocity.multiplyScalar(Math.exp(-8 * h));
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
          verticalSpeed -= 30 * h;
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
      const roll = grounded ? -steering * Math.min(Math.abs(speed), 24) * 0.018 : 0;
      car.rotation.set(pitch, roll, heading, 'ZXY');
      effectClock += dt;
      const slipping = grounded && Math.abs(steering) > 0.3 && Math.abs(speed) > 13;
      const offroad = grounded && surfaceAt(car.position.x, car.position.y) === null;
      if ((slipping || offroad) && effectClock > 0.06) {
        effectClock = 0;
        for (const side of [-1, 1]) {
          const mark = marks[nextMark++ % marks.length]!;
          mark.position.copy(car.position).add(new THREE.Vector3(side * 1.2 * Math.cos(heading) + Math.sin(heading) * 0.78,
            side * 1.2 * Math.sin(heading) - Math.cos(heading) * 0.78, 0.018));
          mark.rotation.z = heading;
          mark.visible = true;
          const puff = puffs[nextPuff++ % puffs.length]!;
          puff.mesh.position.copy(mark.position).add(new THREE.Vector3(0, 0, 0.3));
          puff.mesh.scale.setScalar(1);
          puff.mesh.material.color.set(offroad ? '#c7641a' : '#e9edef');
          puff.life = 0.7;
          puff.mesh.visible = true;
        }
      }
      for (const puff of puffs) {
        if (puff.life <= 0) continue;
        puff.life -= dt;
        puff.mesh.visible = puff.life > 0;
        puff.mesh.material.opacity = Math.max(0, puff.life * 0.5);
        puff.mesh.position.z += dt * 0.9;
        puff.mesh.scale.addScalar(dt * 1.8);
      }
      const nextCheckpoint = checkpoints[checkpoint];
      if (lap > 0 && nextCheckpoint && Math.hypot(car.position.x - nextCheckpoint.position.x, car.position.y - nextCheckpoint.position.y) < 10)
        checkpoint++;
      if (previousY < -24 && car.position.y >= -24 && Math.abs(car.position.x - 32) < 5 && speed > 0) {
        if (lap === 0 || checkpoint === checkpoints.length) {
          lastLap = lap === 0 ? 0 : elapsed - lapStarted;
          lap++;
          checkpoint = 0;
          lapStarted = elapsed;
        }
      }
      previousY = car.position.y;
      hudClock += dt;
      if (hudClock >= 0.1) {
        hudClock = 0;
        publishRaceState({ lap: Math.max(1, lap), lapTime: lap ? elapsed - lapStarted : 0,
          lastLap, speed: Math.abs(speed) * 3.6, fps, airborne: !grounded });
      }
      for (const [index, wheel] of wheels.entries()) {
        wheel.rotation.z = index < 2 ? steering : 0;
        wheel.rotation.x = (wheel.rotation.x - travelled / 0.57) % (2 * Math.PI);
      }

      // Smooth our own stage-space pose; navigation re-poses the stage camera each frame.
      root.updateMatrixWorld(true);
      const pace = Math.min(30, Math.abs(speed));
      const distance = grounded ? 6 + pace * 0.07 : 12;
      const lookAhead = grounded ? 2.5 + pace * 0.04 : 0.5;
      const fov = 36 + pace * 0.28;
      const height = 1.2 + (distance + lookAhead) * Math.tan(THREE.MathUtils.degToRad(fov * 0.22));
      const kerb = grounded && kerbs.some(point => Math.hypot(point.x - car.position.x, point.y - car.position.y) < 1.4);
      const rumble = kerb ? Math.sin(elapsed * 90) * Math.min(0.05, pace * 0.003) : 0;
      const side = grounded ? 3 : 10;
      root.localToWorld(eye.set(car.position.x + Math.sin(heading) * distance + side * Math.cos(heading),
        car.position.y - Math.cos(heading) * distance + side * Math.sin(heading), car.position.z + height + rumble));
      root.localToWorld(target.set(car.position.x - Math.sin(heading) * lookAhead,
        car.position.y + Math.cos(heading) * lookAhead, car.position.z + (grounded ? 1.4 : 0.4)));
      if (!cameraStarted) {
        cameraPosition.copy(eye);
        cameraTarget.copy(target);
        cameraStarted = true;
      }
      const blend = 1 - Math.exp(-12 * dt);
      cameraPosition.lerp(eye, blend);
      cameraTarget.lerp(target, blend);
      const camera = context.camera;
      camera.position.copy(cameraPosition);
      if (camera.parent) camera.parent.worldToLocal(camera.position);
      camera.up.copy(up).applyAxisAngle(new THREE.Vector3().subVectors(cameraTarget, cameraPosition).normalize(), -roll * 0.3);
      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const perspective = camera as THREE.PerspectiveCamera;
        perspective.fov = fov;
        perspective.updateProjectionMatrix();
      }
      camera.lookAt(cameraTarget);
      camera.updateMatrixWorld(true);
    },
    dispose() {
      root.remove(effects);
      markGeometry.dispose();
      markMaterial.dispose();
      puffGeometry.dispose();
      for (const puff of puffs) puff.mesh.material.dispose();
    },
  };
}
