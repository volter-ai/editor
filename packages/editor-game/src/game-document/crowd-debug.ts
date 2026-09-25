/**
 * Play-mode crowd debug draw (W1a) — agent-clearance cylinders + velocity
 * arrows for every live crowd agent, drawn INTO the running game's scene so
 * the Game tab shows them over the actual gameplay.
 *
 * Reads only the `NavigationAdapter.crowdAgents()` capability off the active
 * game's `SystemAdapters` (installed by play-mode's `setActiveSystems`) — the
 * editor never touches recast's `Crowd` directly. A game whose navigation
 * adapter omits `crowdAgents` simply draws nothing (capability-absence
 * degradation, same doctrine as the rest of the seam).
 *
 * Toggled from the Game tab's Debug menu (`CenterDocuments.tsx`), mirroring
 * the active-document debug-control pattern there.
 */

import { getActiveSystems } from '@volter/editor-sdk/kit/authoring/active-systems';
import type { NavCrowdAgentState } from '@volter/editor-project/adapter';
import { setUserData } from '@volter/threejs-runtime/ecs/user-data';
import * as THREE from 'three';
import { getGameScene } from '../play/play-mode';

let _enabled = false;
let _raf = 0;
let _group: THREE.Group | null = null;
let _attachedScene: THREE.Scene | null = null;

/** Unit cylinder scaled per-agent to (radius, height, radius). */
const _cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
const _cylMat = new THREE.MeshBasicMaterial({
  color: 0x22ccee,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthWrite: false,
});

interface AgentVisual {
  root: THREE.Group;
  cylinder: THREE.Mesh;
  /** Per-visual material clone, so a FAILED agent can flush red without
   *  repainting the whole crowd. */
  cylinderMaterial: THREE.MeshBasicMaterial;
  arrow: THREE.ArrowHelper;
  /** The agent's REQUESTED PATH — its local corridor corners, drawn in scene
   *  space (not under `root`, which follows the agent). */
  path: THREE.Line;
  /** The move target, a small marker at the corridor's end. */
  target: THREE.Mesh;
}

const _pathMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.9 });
const _targetGeo = new THREE.SphereGeometry(0.12, 12, 8);
const _targetMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthWrite: false });
const FAILED_COLOR = 0xff3344;
const OK_COLOR = 0x22ccee;

let _visuals: AgentVisual[] = [];

export function crowdDebugEnabled(): boolean {
  return _enabled;
}

export function setCrowdDebugEnabled(enabled: boolean): void {
  if (enabled === _enabled) return;
  _enabled = enabled;
  if (enabled) {
    _raf = requestAnimationFrame(_tick);
  } else {
    cancelAnimationFrame(_raf);
    _teardown();
  }
}

function _tick(): void {
  if (!_enabled) return;
  _raf = requestAnimationFrame(_tick);
  const scene = getGameScene();
  const agents = scene ? (getActiveSystems().navigation?.crowdAgents?.() ?? []) : [];

  // (Re)attach the group to whatever game scene is currently live — play
  // restarts swap scenes out from under a long-lived toggle.
  if (scene !== _attachedScene) {
    if (_attachedScene && _group) _attachedScene.remove(_group);
    _attachedScene = scene;
    if (scene) {
      if (!_group) {
        _group = new THREE.Group();
        _group.name = 'crowd-debug-draw';
        setUserData(_group, 'editorHelper', true);
      }
      scene.add(_group);
    }
  }
  if (!_group || !scene) return;

  _syncVisualCount(_group, agents.length);
  for (let i = 0; i < agents.length; i++) {
    _updateAgentVisual(_visuals[i]!, agents[i]!);
  }
}

/** Grow/shrink the pooled per-agent visuals to match the live agent count. */
function _syncVisualCount(group: THREE.Group, count: number): void {
  while (_visuals.length < count) {
    const root = new THREE.Group();
    const cylinderMaterial = _cylMat.clone();
    const cylinder = new THREE.Mesh(_cylGeo, cylinderMaterial);
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      0xffaa00,
    );
    const path = new THREE.Line(new THREE.BufferGeometry(), _pathMat);
    const target = new THREE.Mesh(_targetGeo, _targetMat);
    root.add(cylinder);
    root.add(arrow);
    group.add(root);
    group.add(path);
    group.add(target);
    _visuals.push({ root, cylinder, cylinderMaterial, arrow, path, target });
  }
  while (_visuals.length > count) {
    const v = _visuals.pop()!;
    group.remove(v.root);
    group.remove(v.path);
    group.remove(v.target);
    v.arrow.dispose();
    v.path.geometry.dispose();
    v.cylinderMaterial.dispose();
  }
}

function _updateAgentVisual(v: AgentVisual, a: NavCrowdAgentState): void {
  v.root.position.set(a.position.x, a.position.y, a.position.z);
  v.cylinder.scale.set(a.radius, a.height, a.radius);
  v.cylinder.position.y = a.height / 2;
  // A FAILED agent — off the navmesh, going nowhere — flushes red; everything
  // else keeps the crowd colour. An adapter that predates `state` reports
  // undefined and draws as walking.
  v.cylinderMaterial.color.setHex(a.state === 'invalid' ? FAILED_COLOR : OK_COLOR);
  // The REQUESTED PATH: the agent's local corridor, drawn from its own feet
  // through the corners, with the move target marked at its own position.
  const corners = a.corners ?? [];
  if (corners.length > 0) {
    v.path.visible = true;
    v.path.geometry.setFromPoints([
      new THREE.Vector3(a.position.x, a.position.y + 0.05, a.position.z),
      ...corners.map((c) => new THREE.Vector3(c.x, c.y + 0.05, c.z)),
    ]);
  } else {
    v.path.visible = false;
  }
  if (a.target && corners.length > 0) {
    v.target.visible = true;
    v.target.position.set(a.target.x, a.target.y + 0.05, a.target.z);
  } else {
    v.target.visible = false;
  }
  const speed = Math.hypot(a.velocity.x, a.velocity.y, a.velocity.z);
  if (speed > 0.01) {
    v.arrow.visible = true;
    v.arrow.position.y = a.height / 2;
    v.arrow.setDirection(
      new THREE.Vector3(a.velocity.x / speed, a.velocity.y / speed, a.velocity.z / speed),
    );
    // Arrow length = half a second of travel, min 0.2 so it stays legible.
    v.arrow.setLength(Math.max(speed * 0.5, 0.2));
  } else {
    v.arrow.visible = false;
  }
}

function _teardown(): void {
  if (_group) {
    _attachedScene?.remove(_group);
    for (const v of _visuals) v.arrow.dispose();
    _group.clear();
  }
  _visuals = [];
  _group = null;
  _attachedScene = null;
}
