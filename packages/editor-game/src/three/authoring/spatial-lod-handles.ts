/** Native THREE.LOD distance thresholds projected onto generic viewport guides. */

import type { R3fLodBinding } from '@volter/editor-core/ui-source/r3f-lod-binding';
import type { SpatialHandleLayer, SpatialPoint3 } from '@volter/editor-project/adapter';
import * as THREE from 'three';

const COLORS = ['#7dd3fc', '#60a5fa', '#818cf8', '#a78bfa', '#c084fc'];
const ROUND_TO = 1000;

export interface LodSourceBinding {
  readonly key: string;
  readonly sourceOid?: string;
  readonly sourceFile?: string;
  readonly source?: R3fLodBinding;
  readonly lod: THREE.LOD;
  readonly writableDistances: ReadonlySet<number>;
  readonly writableHysteresis: boolean;
}

export interface LodDistanceEdit {
  readonly binding: LodSourceBinding;
  readonly level: number;
  readonly value: number;
}

function centerOf(binding: LodSourceBinding): THREE.Vector3 {
  binding.lod.updateWorldMatrix(true, false);
  return binding.lod.getWorldPosition(new THREE.Vector3());
}

function color(index: number): string {
  return COLORS[index % COLORS.length]!;
}

export function lodHandleLayer(binding: LodSourceBinding): SpatialHandleLayer {
  const center = centerOf(binding);
  const guides: SpatialHandleLayer['guides'][number][] = [];
  const handles: SpatialHandleLayer['handles'][number][] = [];
  binding.lod.levels.forEach((level, index) => {
    if (!Number.isFinite(level.distance) || level.distance <= 0) return;
    guides.push({
      kind: 'sphere',
      center: [center.x, center.y, center.z],
      radius: level.distance,
      color: color(index),
      opacity: 0.56,
    });
    handles.push({
      id: `lod:${encodeURIComponent(binding.key)}:${index}`,
      label: `LOD ${index} distance`,
      position: [center.x + level.distance, center.y, center.z],
      color: color(index),
      writable: binding.writableDistances.has(index),
    });
  });
  return { id: `lod:${binding.key}`, category: 'lod', guides, handles };
}

function rounded(value: number): number {
  return Math.round(value * ROUND_TO) / ROUND_TO;
}

export function normalizeLodDistance(
  binding: LodSourceBinding,
  level: number,
  value: number,
): number {
  const previous = binding.lod.levels[level - 1]?.distance;
  const next = binding.lod.levels[level + 1]?.distance;
  const minimum = previous === undefined ? 0 : previous + 0.01;
  const maximum = next === undefined ? Number.POSITIVE_INFINITY : Math.max(minimum, next - 0.01);
  return rounded(THREE.MathUtils.clamp(value, minimum, maximum));
}

export function lodEditFromWorld(
  bindings: readonly LodSourceBinding[],
  handleId: string,
  worldPosition: SpatialPoint3,
): LodDistanceEdit | null {
  const match = /^lod:([^:]+):(\d+)$/.exec(handleId);
  if (!match) return null;
  const key = decodeURIComponent(match[1]!);
  const level = Number(match[2]);
  const binding = bindings.find((candidate) => candidate.key === key);
  if (!binding || !binding.writableDistances.has(level)) return null;
  const value = new THREE.Vector3(...worldPosition).distanceTo(centerOf(binding));
  return { binding, level, value: normalizeLodDistance(binding, level, value) };
}

export function previewLodDistance(edit: LodDistanceEdit): void {
  const level = edit.binding.lod.levels[edit.level];
  if (level) level.distance = edit.value;
}
