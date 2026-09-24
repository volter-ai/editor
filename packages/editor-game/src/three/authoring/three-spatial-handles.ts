/** One source-backed provider for the native Three component handles currently
 * projected by the R3F authoring adapter. The shell receives only generic
 * layers; component dispatch stays on this substrate side of the seam. */

import type {
  PhysicsColliderShape,
  SpatialHandlesProvider,
  SpatialPoint3,
  StructuralWriteOutcome,
} from '@vgai/project/adapter';
import type * as THREE from 'three';
import {
  positionalAudioEditFromWorld,
  positionalAudioHandleLayer,
  previewPositionalAudioEdit,
} from './spatial-audio-handles';
import {
  type ColliderSourceBinding,
  colliderEditFromWorld,
  colliderHandleLayer,
} from './spatial-collider-handles';
import {
  type JointSourceBinding,
  jointAnchorEditFromWorld,
  jointHandleLayer,
} from './spatial-joint-handles';
import { lightEditFromWorld, lightHandleLayer, previewLightEdit } from './spatial-light-handles';
import {
  type LodSourceBinding,
  lodEditFromWorld,
  lodHandleLayer,
  previewLodDistance,
} from './spatial-lod-handles';
import {
  type ParticleSourceBinding,
  particleEditFromWorld,
  particleHandleLayer,
  previewParticleEdit,
} from './spatial-particle-handles';

interface HandleEdit {
  readonly field: { readonly path: string };
  readonly value: number;
  readonly preview: () => void;
}

export function createThreeSpatialHandlesProvider(options: {
  readonly object: (id: string) => THREE.Object3D | null;
  readonly sourceTag: (id: string) => string | undefined;
  readonly writable: (id: string, path: string) => boolean;
  /** The adapter's own field write. Its per-edit ack passes through unchanged
   * so the shell can distinguish a round trip from a void live-only effect. */
  readonly commit: (id: string, path: string, value: number) => StructuralWriteOutcome;
  readonly colliderBindings: (id: string) => readonly ColliderSourceBinding[];
  readonly previewCollider: (colliderId: string, shape: PhysicsColliderShape) => void;
  readonly commitCollider: (
    id: string,
    sourceOid: string,
    args: readonly number[],
  ) => StructuralWriteOutcome;
  readonly jointBindings: (id: string) => readonly JointSourceBinding[];
  readonly previewJointAnchor: (
    jointId: string,
    endpoint: 0 | 1,
    anchor: readonly [number, number, number],
  ) => void;
  readonly commitJoint: (
    binding: JointSourceBinding,
    params: readonly unknown[],
  ) => StructuralWriteOutcome;
  readonly particleBindings: (id: string) => readonly ParticleSourceBinding[];
  readonly commitParticle: (
    binding: ParticleSourceBinding,
    field: string,
    value: number,
  ) => StructuralWriteOutcome;
  readonly lodBindings: (id: string) => readonly LodSourceBinding[];
  readonly commitLodDistance: (
    binding: LodSourceBinding,
    level: number,
    value: number,
  ) => StructuralWriteOutcome;
}): SpatialHandlesProvider {
  const edit = (id: string, handleId: string, point: SpatialPoint3): HandleEdit | null => {
    const object = options.object(id);
    if (!object) return null;
    const sourceTag = options.sourceTag(id);
    const light = lightEditFromWorld(object, sourceTag, handleId, point);
    if (light) {
      return {
        field: light.field,
        value: light.value,
        preview: () => previewLightEdit(object, light),
      };
    }
    const audio = positionalAudioEditFromWorld(object, sourceTag, handleId, point);
    return audio
      ? {
          field: audio.field,
          value: audio.value,
          preview: () => previewPositionalAudioEdit(object, audio),
        }
      : null;
  };

  return {
    layers: (id) => {
      const object = options.object(id);
      if (!object) return [];
      const writable = (path: string) => options.writable(id, path);
      return [
        ...options.colliderBindings(id).map(colliderHandleLayer),
        ...options.jointBindings(id).map(jointHandleLayer),
        ...options.particleBindings(id).map(particleHandleLayer),
        ...options.lodBindings(id).map(lodHandleLayer),
        lightHandleLayer(object, writable),
        positionalAudioHandleLayer(object, writable),
      ].filter((layer) => layer !== null);
    },
    preview: (id, handleId, point) => {
      const collider = colliderEditFromWorld(options.colliderBindings(id), handleId, point);
      if (collider) {
        options.previewCollider(collider.colliderId, collider.shape);
        return;
      }
      const joint = jointAnchorEditFromWorld(options.jointBindings(id), handleId, point);
      if (joint) {
        options.previewJointAnchor(joint.binding.snapshot.id, joint.endpoint, joint.anchor);
        return;
      }
      const particle = particleEditFromWorld(options.particleBindings(id), handleId, point);
      if (particle) {
        previewParticleEdit(particle);
        return;
      }
      const lod = lodEditFromWorld(options.lodBindings(id), handleId, point);
      if (lod) {
        previewLodDistance(lod);
        return;
      }
      edit(id, handleId, point)?.preview();
    },
    commit: (id, handleId, point) => {
      // Every branch passes the adapter write's own acknowledgement straight
      // through. The shell, not this component-specific router, grades it.
      const collider = colliderEditFromWorld(options.colliderBindings(id), handleId, point);
      if (collider) return options.commitCollider(id, collider.sourceOid, collider.args);
      const joint = jointAnchorEditFromWorld(options.jointBindings(id), handleId, point);
      if (joint) return options.commitJoint(joint.binding, joint.params);
      const particle = particleEditFromWorld(options.particleBindings(id), handleId, point);
      if (particle) {
        return options.commitParticle(particle.binding, particle.field, particle.value);
      }
      const lod = lodEditFromWorld(options.lodBindings(id), handleId, point);
      if (lod) return options.commitLodDistance(lod.binding, lod.level, lod.value);
      const next = edit(id, handleId, point);
      if (!next || !options.writable(id, next.field.path)) return;
      return options.commit(id, next.field.path, next.value);
    },
  };
}
