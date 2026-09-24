/** Native three.quarks emitter shapes projected onto generic viewport guides. */

import type {
  QuarksEmitterShape,
  R3fParticleBinding,
} from '@volter/editor-react/source/r3f-particle-binding';
import type { SpatialHandleLayer, SpatialPoint3 } from '@volter/editor-project/adapter';
import * as THREE from 'three';

const PARTICLE_COLOR = '#ff9f43';
const PARTICLE_SECONDARY = '#ffd166';
const ROUND_TO = 1000;

export interface NativeEmitterShape {
  readonly type: QuarksEmitterShape;
  radius?: number;
  arc?: number;
  thickness?: number;
  angle?: number;
  donutRadius?: number;
  width?: number;
  height?: number;
  column?: number;
  row?: number;
}

/**
 * A three.quarks `ParticleSystem.emitter`, once the SOURCE has declared it.
 *
 * Deliberately carries no `type: 'ParticleEmitter'` discriminant. Which live
 * object is an emitter is decided by the project's own source — the
 * `<primitive object={system.emitter}>` element the OID index stamps with a
 * `particleBinding` — never by string-matching a third-party library's
 * internal `Object3D.type`. See `particleBindingsOf` in
 * `r3f-source-authoring-adapter.ts` for the one place that decision is made.
 */
export interface NativeParticleEmitter extends THREE.Object3D {
  readonly system: { readonly emitterShape: NativeEmitterShape };
}

/**
 * The native emitter shape of an object the source already declared to be an
 * emitter, or `null` when the live object does not carry one.
 *
 * This reads the declared object's OWN three.quarks state; it is not a test of
 * whether an arbitrary object is an emitter, and must never be used as one.
 */
export function nativeEmitterShapeOf(object: THREE.Object3D): NativeEmitterShape | null {
  const shape = (object as Partial<NativeParticleEmitter>).system?.emitterShape;
  return shape && typeof shape.type === 'string' ? shape : null;
}

export interface ParticleSourceBinding {
  readonly sourceOid: string;
  readonly sourceFile: string;
  readonly source: R3fParticleBinding;
  readonly emitter: NativeParticleEmitter;
  readonly shape: NativeEmitterShape;
  readonly writableFields: ReadonlySet<string>;
}

export interface ParticleFieldEdit {
  readonly binding: ParticleSourceBinding;
  readonly field: string;
  readonly value: number;
}

function key(binding: ParticleSourceBinding): string {
  return encodeURIComponent(binding.sourceOid);
}

function point(value: THREE.Vector3): SpatialPoint3 {
  return [value.x, value.y, value.z];
}

function world(binding: ParticleSourceBinding, local: THREE.Vector3): SpatialPoint3 {
  binding.emitter.updateWorldMatrix(true, false);
  return point(local.clone().applyMatrix4(binding.emitter.matrixWorld));
}

function line(
  binding: ParticleSourceBinding,
  points: readonly THREE.Vector3[],
  opacity = 0.72,
): SpatialHandleLayer['guides'][number] {
  binding.emitter.updateWorldMatrix(true, false);
  const matrix = binding.emitter.matrixWorld;
  return {
    kind: 'line',
    points: points.map((candidate) => point(candidate.clone().applyMatrix4(matrix))),
    color: PARTICLE_COLOR,
    opacity,
  };
}

function ring(
  radius: number,
  plane: 'xy' | 'xz' | 'yz' = 'xy',
  segments = 48,
  arc = Math.PI * 2,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * arc;
    const a = Math.cos(angle) * radius;
    const b = Math.sin(angle) * radius;
    points.push(
      plane === 'xy'
        ? new THREE.Vector3(a, b, 0)
        : plane === 'xz'
          ? new THREE.Vector3(a, 0, b)
          : new THREE.Vector3(0, a, b),
    );
  }
  return points;
}

function rotateAroundZ(points: readonly THREE.Vector3[], angle: number): THREE.Vector3[] {
  return points.map((candidate) =>
    candidate.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), angle),
  );
}

function upperArc(radius: number, plane: 'xz' | 'yz', segments = 24): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI;
    const radial = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    points.push(plane === 'xz' ? new THREE.Vector3(radial, 0, z) : new THREE.Vector3(0, radial, z));
  }
  return points;
}

function field(
  shape: NativeEmitterShape,
  name: keyof NativeEmitterShape,
  fallback: number,
): number {
  const value = shape[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function outline(binding: ParticleSourceBinding): SpatialHandleLayer['guides'][number][] {
  const shape = binding.shape;
  const radius = field(shape, 'radius', 10);
  const arc = THREE.MathUtils.clamp(field(shape, 'arc', Math.PI * 2), 0, Math.PI * 2);
  const fullArc = Math.abs(arc - Math.PI * 2) < 0.001;
  switch (shape.type) {
    case 'point':
      return [
        line(binding, [new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0)]),
        line(binding, [new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 0.2, 0)]),
        line(binding, [new THREE.Vector3(0, 0, -0.2), new THREE.Vector3(0, 0, 0.2)]),
      ];
    case 'sphere':
      return [
        line(binding, ring(radius, 'xy', 48, arc)),
        line(binding, ring(radius, 'xz'), 0.5),
        line(binding, rotateAroundZ(ring(radius, 'xz'), fullArc ? Math.PI / 2 : arc), 0.5),
      ];
    case 'hemisphere':
      return [
        line(binding, ring(radius, 'xy', 48, arc)),
        line(binding, upperArc(radius, 'xz'), 0.55),
        line(binding, rotateAroundZ(upperArc(radius, 'xz'), fullArc ? Math.PI / 2 : arc), 0.55),
      ];
    case 'cone': {
      const angle = field(shape, 'angle', Math.PI / 6);
      const length = Math.max(radius, 1);
      const guides = [line(binding, ring(radius, 'xy', 48, arc))];
      const rays = fullArc
        ? [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
        : [0, arc / 3, (arc * 2) / 3, arc];
      for (const theta of rays) {
        const start = new THREE.Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius, 0);
        const end = start
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(theta) * Math.sin(angle),
              Math.sin(theta) * Math.sin(angle),
              Math.cos(angle),
            ).multiplyScalar(length),
          );
        guides.push(line(binding, [start, end], 0.58));
      }
      return guides;
    }
    case 'circle':
      return [line(binding, ring(radius, 'xy', 48, arc))];
    case 'donut': {
      const tube = field(shape, 'donutRadius', radius * 0.2);
      return [
        line(binding, ring(Math.max(0, radius - tube), 'xy', 48, arc), 0.45),
        line(binding, ring(radius, 'xy', 48, arc)),
        line(binding, ring(radius + tube, 'xy', 48, arc), 0.45),
        line(
          binding,
          ring(tube, 'xz').map((candidate) => candidate.add(new THREE.Vector3(radius, 0, 0))),
          0.45,
        ),
      ];
    }
    case 'rectangle':
    case 'grid': {
      const width = field(shape, 'width', shape.type === 'grid' ? 1 : 10);
      const height = field(shape, 'height', shape.type === 'grid' ? 1 : 10);
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      const guides = [
        line(binding, [
          new THREE.Vector3(-halfWidth, -halfHeight, 0),
          new THREE.Vector3(halfWidth, -halfHeight, 0),
          new THREE.Vector3(halfWidth, halfHeight, 0),
          new THREE.Vector3(-halfWidth, halfHeight, 0),
          new THREE.Vector3(-halfWidth, -halfHeight, 0),
        ]),
      ];
      if (shape.type === 'grid') {
        const columns = Math.min(16, Math.max(1, Math.round(field(shape, 'column', 10))));
        const rows = Math.min(16, Math.max(1, Math.round(field(shape, 'row', 10))));
        for (let index = 1; index < columns; index += 1) {
          const x = -halfWidth + (index / columns) * width;
          guides.push(
            line(
              binding,
              [new THREE.Vector3(x, -halfHeight, 0), new THREE.Vector3(x, halfHeight, 0)],
              0.24,
            ),
          );
        }
        for (let index = 1; index < rows; index += 1) {
          const y = -halfHeight + (index / rows) * height;
          guides.push(
            line(
              binding,
              [new THREE.Vector3(-halfWidth, y, 0), new THREE.Vector3(halfWidth, y, 0)],
              0.24,
            ),
          );
        }
      }
      return guides;
    }
  }
}

function handle(
  binding: ParticleSourceBinding,
  fieldName: string,
  label: string,
  local: THREE.Vector3,
): SpatialHandleLayer['handles'][number] {
  return {
    id: `particle:${key(binding)}:${fieldName}`,
    label,
    position: world(binding, local),
    color: fieldName === 'angle' ? PARTICLE_SECONDARY : PARTICLE_COLOR,
    writable: binding.writableFields.has(fieldName),
  };
}

export function particleHandleLayer(binding: ParticleSourceBinding): SpatialHandleLayer {
  const shape = binding.shape;
  const radius = field(shape, 'radius', 10);
  const handles: SpatialHandleLayer['handles'][number][] = [];
  if (['sphere', 'hemisphere', 'cone', 'circle', 'donut'].includes(shape.type)) {
    handles.push(handle(binding, 'radius', 'Emitter radius', new THREE.Vector3(radius, 0, 0)));
  }
  if (shape.type === 'cone') {
    const angle = field(shape, 'angle', Math.PI / 6);
    const length = Math.max(radius, 1);
    handles.push(
      handle(
        binding,
        'angle',
        'Cone angle',
        new THREE.Vector3(radius + Math.sin(angle) * length, 0, Math.cos(angle) * length),
      ),
    );
  }
  if (shape.type === 'donut') {
    handles.push(
      handle(
        binding,
        'donutRadius',
        'Donut tube radius',
        new THREE.Vector3(radius, 0, field(shape, 'donutRadius', radius * 0.2)),
      ),
    );
  }
  if (shape.type === 'rectangle' || shape.type === 'grid') {
    handles.push(
      handle(
        binding,
        'width',
        'Emitter width',
        new THREE.Vector3(field(shape, 'width', 1) / 2, 0, 0),
      ),
      handle(
        binding,
        'height',
        'Emitter height',
        new THREE.Vector3(0, field(shape, 'height', 1) / 2, 0),
      ),
    );
  }
  return {
    id: `particle:${key(binding)}`,
    category: 'particles',
    guides: outline(binding),
    handles,
  };
}

function rounded(value: number): number {
  return Math.round(value * ROUND_TO) / ROUND_TO;
}

function clampParticleField(fieldName: string, value: number): number {
  if (fieldName === 'angle') return rounded(THREE.MathUtils.clamp(value, 0.01, Math.PI / 2 - 0.01));
  if (fieldName === 'arc') return rounded(THREE.MathUtils.clamp(value, 0, Math.PI * 2));
  if (fieldName === 'thickness') return rounded(THREE.MathUtils.clamp(value, 0, 1));
  if (fieldName === 'column' || fieldName === 'row') return Math.max(1, Math.round(value));
  return rounded(Math.max(0.01, value));
}

export function normalizeParticleField(fieldName: string, value: number): number {
  return clampParticleField(fieldName, value);
}

export function particleEditFromWorld(
  bindings: readonly ParticleSourceBinding[],
  handleId: string,
  worldPosition: SpatialPoint3,
): ParticleFieldEdit | null {
  const match = /^particle:([^:]+):(radius|angle|donutRadius|width|height)$/.exec(handleId);
  const binding = match ? bindings.find((candidate) => key(candidate) === match[1]) : undefined;
  const fieldName = match?.[2];
  if (!binding || !fieldName || !binding.writableFields.has(fieldName)) return null;
  binding.emitter.updateWorldMatrix(true, false);
  const local = binding.emitter.worldToLocal(new THREE.Vector3(...worldPosition));
  const radius = field(binding.shape, 'radius', 10);
  let value: number;
  if (fieldName === 'radius') {
    value =
      binding.shape.type === 'sphere' || binding.shape.type === 'hemisphere'
        ? local.length()
        : Math.hypot(local.x, local.y);
  } else if (fieldName === 'angle') {
    value = Math.atan2(
      Math.max(0, Math.hypot(local.x, local.y) - radius),
      Math.abs(local.z) || 0.001,
    );
  } else if (fieldName === 'donutRadius') {
    value = Math.abs(local.z);
  } else if (fieldName === 'width') {
    value = Math.abs(local.x) * 2;
  } else {
    value = Math.abs(local.y) * 2;
  }
  return { binding, field: fieldName, value: clampParticleField(fieldName, value) };
}

export function previewParticleEdit(edit: ParticleFieldEdit): void {
  (edit.binding.shape as unknown as Record<string, unknown>)[edit.field] = edit.value;
}
