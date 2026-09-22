import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import { reflectionProbeOf } from '@volter/editor-threejs/adapter/reflection-probe';
import { setUserData } from '@volter/editor-threejs/ecs/user-data';
import * as THREE from 'three';

const INFLUENCE = new THREE.Color(0x4aa8ff);
const INFLUENCE_SELECTED = new THREE.Color(0x75c4ff);
const PARALLAX = new THREE.Color(0xffb84a);
const CAPTURE = new THREE.Color(0xffffff);

/**
 * Editor-only visualization for a project-owned reflection probe. It follows
 * the live Object3D mark but owns every line and material it draws, so no
 * helper enters the game's JSX tree or its runtime camera.
 */
export class ReflectionProbeHelper extends THREE.Group {
  private signature = '';
  private selected = false;

  constructor(readonly source: THREE.Object3D) {
    super();
    this.name = 'Reflection Probe Helper';
    this.matrixAutoUpdate = false;
    this.renderOrder = 998;
    setUserData(this, 'editorHelper', true);
    setUserData(this, 'editorHelperType', 'reflection-probes');
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: each branch draws one independently meaningful probe volume.
  private refresh(force: boolean): void {
    const probe = reflectionProbeOf(this.source);
    if (!probe) return;
    const config = probe.config;
    const next = JSON.stringify(config);
    if (!force && next === this.signature) return;
    this.signature = next;
    this.clearVisuals();

    const influenceColor = this.selected ? INFLUENCE_SELECTED : INFLUENCE;
    const influenceOpacity = this.selected ? 1 : 0.62;
    const blend = Math.max(0, config.blendDistance);

    if (config.shape === 'sphere') {
      const radius = Math.max(0.01, config.radius);
      this.addWire(new THREE.SphereGeometry(radius, 24, 16), influenceColor, influenceOpacity);
      if (blend > 0 && radius - blend > 0.01) {
        this.addWire(
          new THREE.SphereGeometry(radius - blend, 20, 12),
          influenceColor,
          this.selected ? 0.55 : 0.28,
        );
      }
    } else {
      const [x, y, z] = config.size.map((value) => Math.max(0.01, value)) as [
        number,
        number,
        number,
      ];
      this.addWire(new THREE.BoxGeometry(x, y, z), influenceColor, influenceOpacity);
      const inner = [x - blend * 2, y - blend * 2, z - blend * 2] as const;
      if (blend > 0 && inner.every((value) => value > 0.01)) {
        this.addWire(
          new THREE.BoxGeometry(inner[0], inner[1], inner[2]),
          influenceColor,
          this.selected ? 0.55 : 0.28,
        );
      }
    }

    if (config.parallaxProjection) {
      const [x, y, z] = config.parallaxSize.map((value) => Math.max(0.01, value)) as [
        number,
        number,
        number,
      ];
      const box = this.addWire(
        new THREE.BoxGeometry(x, y, z),
        PARALLAX,
        this.selected ? 0.9 : 0.45,
      );
      box.position.fromArray(config.parallaxOffset);
    }

    const origin = this.addWire(
      new THREE.OctahedronGeometry(this.selected ? 0.16 : 0.11),
      CAPTURE,
      this.selected ? 1 : 0.72,
    );
    origin.position.fromArray(config.captureOffset);
    this.traverse((object) => object.layers.set(EDITOR_LAYER));
  }

  private addWire(
    sourceGeometry: THREE.BufferGeometry,
    color: THREE.Color,
    opacity: number,
  ): THREE.LineSegments {
    const geometry = new THREE.EdgesGeometry(sourceGeometry);
    sourceGeometry.dispose();
    const material = new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity,
      toneMapped: false,
    });
    const wire = new THREE.LineSegments(geometry, material);
    wire.renderOrder = this.renderOrder;
    this.add(wire);
    return wire;
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
