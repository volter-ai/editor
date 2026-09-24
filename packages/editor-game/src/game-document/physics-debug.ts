/**
 * Play-mode physics debug draw (W2a §2.3c) — Rapier's `debugRender()` collider
 * /joint wireframes plus live contact-point markers, over the running game in
 * the Game tab.
 *
 * Split of labor:
 * - The WIREFRAMES are the engine's own: `PhysicsAdapter.setDebugDrawEnabled`
 *   flips the flag the first-party adapter's render system reads, feeding
 *   `world.debugRender()` into the debug `LineSegments` that already lives in
 *   the game scene (`setup-physics.ts`, buffer-reusing). The editor does zero
 *   per-frame work for them.
 * - The CONTACT POINTS come from `PhysicsAdapter.contactPoints()` (world-space
 *   solver contacts over a reused buffer) and are drawn here as a pooled
 *   `THREE.Points` in the game scene, updated per RAF tick.
 *
 * Reads only `SystemAdapters.physics` capabilities off the active game
 * (installed by play-mode's `setActiveSystems`) — the editor never touches
 * Rapier directly. An adapter lacking the capabilities draws nothing
 * (capability-absence degradation). Toggled from the Game tab's Debug menu
 * (`CenterDocuments.tsx`), mirroring `crowd-debug.ts` exactly: RAF-driven,
 * scene-swap safe across play restarts, torn down on disable; on stop the
 * adapters are cleared (`setActiveSystems(null)`) and the game scene is
 * destroyed, so nothing leaks into the next session.
 */

import { getActiveSystems } from '@volter/editor-core/authoring/active-systems';
import { nodeKeyedPhysics, type PhysicsAdapter } from '@volter/editor-project/adapter';
import { setUserData } from '@volter/threejs-runtime/ecs/user-data';
import * as THREE from 'three';
import { getGameScene } from '../play/play-mode';

let _enabled = false;
let _raf = 0;
let _group: THREE.Group | null = null;
let _attachedScene: THREE.Scene | null = null;
/** The adapter instance the debug-draw flag was last applied to (play restarts install a fresh one). */
let _appliedAdapter: PhysicsAdapter | null = null;

let _points: THREE.Points | null = null;
let _pointsCapacity = 0;

export function physicsDebugEnabled(): boolean {
  return _enabled;
}

export function setPhysicsDebugEnabled(enabled: boolean): void {
  if (enabled === _enabled) return;
  _enabled = enabled;
  if (enabled) {
    _raf = requestAnimationFrame(_tick);
  } else {
    cancelAnimationFrame(_raf);
    _appliedAdapter?.setDebugDrawEnabled?.(false);
    _teardown();
  }
}

function _tick(): void {
  if (!_enabled) return;
  _raf = requestAnimationFrame(_tick);
  const scene = getGameScene();
  // Node-id keyed only: the wireframes and contact points are THREE objects
  // drawn into the game scene, so a canvas mount's display-keyed carrier is
  // not a degraded source here — it is a different subsystem entirely.
  const physics = scene ? nodeKeyedPhysics(getActiveSystems().physics) : null;

  // (Re)apply the engine-side debug-draw flag whenever the live adapter
  // changes — enabling before play starts, and re-enabling across play
  // restarts, both converge here.
  if (physics !== _appliedAdapter) {
    _appliedAdapter?.setDebugDrawEnabled?.(false);
    _appliedAdapter = physics;
    physics?.setDebugDrawEnabled?.(true);
  }

  _syncAttachment(scene);
  if (!_group || !scene) return;

  const contacts = physics?.contactPoints?.() ?? null;
  _updateContactPoints(_group, contacts);
}

/** (Re)attach the marker group to whatever game scene is currently live. */
function _syncAttachment(scene: THREE.Scene | null): void {
  if (scene === _attachedScene) return;
  if (_attachedScene && _group) _attachedScene.remove(_group);
  _attachedScene = scene;
  if (scene) {
    if (!_group) {
      _group = new THREE.Group();
      _group.name = 'physics-debug-draw';
      setUserData(_group, 'editorHelper', true);
    }
    scene.add(_group);
  }
}

/** Copy this frame's contact xyz triples into the pooled Points geometry. */
function _updateContactPoints(group: THREE.Group, contacts: Float32Array | null): void {
  const count = contacts ? contacts.length / 3 : 0;
  if (!_points) {
    _pointsCapacity = 64;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(_pointsCapacity * 3), 3),
    );
    const mat = new THREE.PointsMaterial({
      color: 0xff3355,
      size: 10,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    _points = new THREE.Points(geo, mat);
    _points.renderOrder = 999;
    _points.frustumCulled = false;
    group.add(_points);
  }
  const geo = _points.geometry;
  if (count > _pointsCapacity) {
    // Rare growth path (matches `updatePhysicsDebug`'s size-change handling):
    // replace the attribute only when capacity is actually exceeded.
    while (_pointsCapacity < count) _pointsCapacity *= 2;
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(_pointsCapacity * 3), 3),
    );
  }
  const attr = geo.getAttribute('position') as THREE.BufferAttribute;
  if (contacts && count > 0) (attr.array as Float32Array).set(contacts);
  attr.needsUpdate = true;
  geo.setDrawRange(0, count);
  _points.visible = count > 0;
}

/**
 * e2e hook (mirrors the world root's stage's `__vgaiViewport`): mechanical state for
 * The question this answers — is the Rapier debug wireframe live in the
 * game scene with real geometry, and how many contact markers are drawn.
 */
function _stateForE2E(): {
  enabled: boolean;
  wireframeInScene: boolean;
  wireframeVisible: boolean;
  wireframeVertexCount: number;
  contactMarkerCount: number;
} {
  const scene = getGameScene();
  const adapter = scene ? nodeKeyedPhysics(getActiveSystems().physics) : null;
  const mesh = (adapter?.debugDraw?.() ?? null) as THREE.LineSegments | null;
  let wireframeInScene = false;
  if (mesh && scene) {
    scene.traverse((o) => {
      if (o === mesh) wireframeInScene = true;
    });
  }
  const posAttr = mesh?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const drawRange = _points?.geometry.drawRange.count ?? 0;
  return {
    enabled: _enabled,
    wireframeInScene,
    wireframeVisible: mesh?.visible ?? false,
    wireframeVertexCount: posAttr?.count ?? 0,
    contactMarkerCount: _points?.visible && Number.isFinite(drawRange) ? drawRange : 0,
  };
}
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)['__vgaiPhysicsDebug'] = _stateForE2E;
}

function _teardown(): void {
  if (_group) {
    _attachedScene?.remove(_group);
    if (_points) {
      _points.geometry.dispose();
      (_points.material as THREE.Material).dispose();
    }
    _group.clear();
  }
  _points = null;
  _pointsCapacity = 0;
  _group = null;
  _attachedScene = null;
  _appliedAdapter = null;
}
