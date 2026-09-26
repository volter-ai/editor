/**
 * The translated Godot world's project-owned physics slots.
 *
 * The static half is exported by the generated world entry. The live half attaches the exact
 * Rapier bodies that world and its translated scenes already own; no second registry or simulation
 * is created. Canvas resolves a selected Pixi display object through the collider-owner relation
 * every translated 2D world already maintains. Three resolves a selected entity id through the
 * live Object3D graph and the body mark written where each translated scene creates its body.
 */
import { bodyOwningNode } from '@volter/threejs-runtime/adapter/body-marks';
import { createRapierBodyEditing } from '@volter/threejs-runtime/adapter/rapier-physics-adapter';
import type { PhysicsAdapter } from '@volter/editor-project/adapter/system-adapter';
import { createSystemSlot } from '@volter/editor-project/adapter/system-slot';
import type { PhysicsAdapter2D } from '@volter/game-runtime/pixi/system-adapters';
import type { Container } from 'pixi.js';
import type { Object3D } from 'three';

interface EditableBody2D {
  bodyType(): number;
  isDynamic(): boolean;
  isKinematic(): boolean;
  setBodyType(type: number, wakeUp: boolean): void;
  setTranslation(position: { readonly x: number; readonly y: number }, wakeUp: boolean): void;
  setRotation(rotation: number, wakeUp: boolean): void;
}

interface GodotPhysicsOwner2D {
  readonly node: Container;
  readonly body?: EditableBody2D;
}

const physics2DSlot = createSystemSlot<PhysicsAdapter2D>({
  name: 'godotPhysicsSystem2D',
  unattachedMessage:
    'no translated Godot canvas world has attached its Rapier2D bodies yet — the player is ' +
    'stopped or the scene is still mounting.',
  members: {
    ownerOf: { kind: 'read', empty: 'none' },
    freeze: { kind: 'action' },
    commit: { kind: 'action' },
    unfreeze: { kind: 'action' },
  },
});

/** Attach the live collider-owner relation; the returned detach owns no Rapier resource. */
export function attachGodotPhysicsSystem2D(
  owners: () => Iterable<GodotPhysicsOwner2D>,
): () => void {
  const frozen = new WeakMap<Container, number>();
  const bodyFor = (display: Container): EditableBody2D | undefined => {
    for (const owner of owners()) {
      if (owner.node === display) return owner.body;
    }
    return undefined;
  };
  return physics2DSlot.attach({
    keyedBy: 'display',
    ownerOf(display) {
      const body = bodyFor(display);
      return body !== undefined && (body.isDynamic() || body.isKinematic()) ? 'physics' : 'none';
    },
    freeze(display) {
      const body = bodyFor(display);
      if (body === undefined) return;
      frozen.set(display, body.bodyType());
      body.setBodyType(2 /* KinematicPositionBased */, true);
    },
    commit(display, position, rotation) {
      const body = bodyFor(display);
      if (body === undefined) return;
      body.setTranslation({ x: position[0], y: position[1] }, true);
      body.setRotation(rotation, true);
    },
    unfreeze(display) {
      const body = bodyFor(display);
      const prior = frozen.get(display);
      if (body === undefined || prior === undefined) return;
      body.setBodyType(prior, true);
      frozen.delete(display);
    },
  });
}

/** The canvas entry's stable display-keyed physics declaration. */
export function godotPhysicsSystem2D(): PhysicsAdapter2D {
  return {
    keyedBy: 'display',
    ownerOf: (display) => physics2DSlot.slot.ownerOf(display),
    freeze: (display) => physics2DSlot.slot.freeze(display),
    commit: (display, position, rotation) =>
      physics2DSlot.slot.commit(display, position, rotation),
    unfreeze: (display) => physics2DSlot.slot.unfreeze(display),
  };
}

const physics3DSlot = createSystemSlot<PhysicsAdapter>({
  name: 'godotPhysicsSystem3D',
  unattachedMessage:
    'no translated Godot three world has attached its Rapier3D bodies yet — the player is ' +
    'stopped or the scene is still mounting.',
  members: {
    ownerOf: { kind: 'read', empty: 'unresolved' },
    freeze: { kind: 'action' },
    commit: { kind: 'action' },
    unfreeze: { kind: 'action' },
  },
});

/** Attach the mounted scene graph. Body ownership remains the existing per-node mark. */
export function attachGodotPhysicsSystem3D(root: () => Object3D | null): () => void {
  const adapter = createRapierBodyEditing((nodeId) => {
    const sceneRoot = root();
    if (sceneRoot === null) return { kind: 'unresolved' };
    let node: Object3D | undefined;
    sceneRoot.traverse((candidate) => {
      if (node === undefined && candidate.userData['entityId'] === nodeId) node = candidate;
    });
    if (node === undefined) return { kind: 'unresolved' };
    for (let candidate: Object3D | null = node; candidate !== null; candidate = candidate.parent) {
      const body = bodyOwningNode(candidate);
      if (body !== undefined) return { kind: 'body', body };
    }
    return { kind: 'no-body' };
  });
  return physics3DSlot.attach(adapter);
}

/** The three entry's stable node-id-keyed physics declaration. */
export function godotPhysicsSystem3D(): PhysicsAdapter {
  return physics3DSlot.slot;
}
