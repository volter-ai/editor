import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import { triggerVolumeOf } from '@volter/editor-threejs/adapter/trigger-volume';
import { setUserData } from '@volter/editor-threejs/ecs/user-data';
import * as THREE from 'three';

const RING = new THREE.Color(0x4fd1c5);
const RING_SELECTED = new THREE.Color(0x9ff0e8);
const SEGMENTS = 64;
/** How far the corner ticks rise off the ring, in world units. */
const TICK_HEIGHT = 0.6;

/**
 * Editor-only visualization for a project-owned trigger volume — the group
 * whose radius decides where a hazard fires or a quest arrives. The game's
 * source says nothing about being authored; it just carries the radius in
 * `userData`, and this helper draws it: a ground circle in the source's local
 * XZ plane that extends upward at ±X/±Z, which is what such a volume tests.
 *
 * Same contract as `ReflectionProbeHelper`: it follows the live Object3D but
 * owns every line and material it draws, sits on EDITOR_LAYER, and therefore
 * never enters the game's tree or its runtime camera.
 */
export class TriggerVolumeHelper extends THREE.Group {
  private signature = '';
  private selected = false;

  constructor(readonly source: THREE.Object3D) {
    super();
    this.name = 'Trigger Volume Helper';
    this.matrixAutoUpdate = false;
    this.renderOrder = 998;
    setUserData(this, 'editorHelper', true);
    setUserData(this, 'editorHelperType', 'trigger-volumes');
    this.layers.set(EDITOR_LAYER);
    this.refresh(true);
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.refresh(true);
  }

  update(): void {
    this.refresh(false);
    this.source.updateWorldMatrix(true, false);
    this.matrix.copy(this.source.matrixWorld);
    this.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    this.clearVisuals();
    this.removeFromParent();
  }

  private refresh(force: boolean): void {
    const volume = triggerVolumeOf(this.source);
    if (!volume) return;
    const radius = volume.radius;
    const next = String(radius);
    if (!force && next === this.signature) return;
    this.signature = next;
    this.clearVisuals();

    const color = this.selected ? RING_SELECTED : RING;
    const opacity = this.selected ? 1 : 0.62;

    const ring: number[] = [];
    for (let i = 0; i < SEGMENTS; i += 1) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      ring.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    }
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
    const loop = new THREE.LineLoop(ringGeometry, this.lineMaterial(color, opacity));
    loop.renderOrder = this.renderOrder;
    this.add(loop);

    const ticks: number[] = [];
    for (const [x, z] of [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ] as const) {
      ticks.push(x, 0, z, x, TICK_HEIGHT, z);
    }
    const tickGeometry = new THREE.BufferGeometry();
    tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    const tickLines = new THREE.LineSegments(tickGeometry, this.lineMaterial(color, opacity));
    tickLines.renderOrder = this.renderOrder;
    this.add(tickLines);

    this.traverse((object) => object.layers.set(EDITOR_LAYER));
  }

  private lineMaterial(color: THREE.Color, opacity: number): THREE.LineBasicMaterial {
    return new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity,
      toneMapped: false,
    });
  }

  private clearVisuals(): void {
    for (const child of [...this.children]) {
      child.removeFromParent();
      const line = child as THREE.LineSegments;
      line.geometry?.dispose();
      const materials = Array.isArray(line.material) ? line.material : [line.material];
      for (const material of materials) material?.dispose();
    }
  }
}
