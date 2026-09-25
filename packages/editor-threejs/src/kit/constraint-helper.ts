import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import { type ConstraintMark, constraintsOf } from '@volter/editor-threejs/adapter/constraint';
import { setUserData } from '@volter/editor-threejs/ecs/user-data';
import * as THREE from 'three';

const CHAIN = new THREE.Color(0x43c6ff);
const TARGET = new THREE.Color(0xffb84a);
const POLE = new THREE.Color(0xd875ff);
const ERROR = new THREE.Color(0xff4d68);
const HOVER = new THREE.Color(0xffffff);

export type ConstraintControlKind = 'target' | 'pole';

/** A pickable viewport effector backed by the constraint's real hierarchy
 * object. The helper mesh is only its editor projection; selection and
 * transforms always go through `object`. */
export interface ConstraintControl {
  readonly kind: ConstraintControlKind;
  readonly label: string;
  readonly object: THREE.Object3D;
  readonly mesh: THREE.Mesh;
}

interface ConstraintVisual {
  readonly mark: ConstraintMark;
  readonly chain: THREE.Line;
  readonly targetLine: THREE.Line;
  readonly poleLine: THREE.Line;
  readonly joints: THREE.Mesh[];
  readonly target: THREE.Mesh;
  readonly pole: THREE.Mesh;
  readonly targetHit: THREE.Mesh;
  readonly poleHit: THREE.Mesh;
  readonly positions: THREE.Vector3[];
  readonly targetPosition: THREE.Vector3;
  readonly polePosition: THREE.Vector3;
}

function line(color: THREE.Color): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }),
  );
}

function point(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.Mesh {
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }),
  );
}

function setLinePoints(target: THREE.Line, points: readonly THREE.Vector3[]): void {
  target.visible = points.length > 1;
  if (!target.visible) return;
  let position = target.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || position.count !== points.length) {
    position = new THREE.Float32BufferAttribute(points.length * 3, 3);
    target.geometry.setAttribute('position', position);
  }
  for (let index = 0; index < points.length; index++) {
    position.setXYZ(index, points[index]!.x, points[index]!.y, points[index]!.z);
  }
  position.needsUpdate = true;
  target.geometry.computeBoundingSphere();
}

/**
 * Editor-owned projection of project-owned spatial constraints. It uses the
 * real live bones and ordinary target/pole Object3Ds, but every line and point
 * it creates stays on EDITOR_LAYER and out of the authored hierarchy.
 */
export class ConstraintHelper extends THREE.Group {
  private selected = false;
  private hoveredControl: THREE.Mesh | null = null;
  private selectedObjects: ReadonlySet<THREE.Object3D> = new Set();
  private visuals: ConstraintVisual[] = [];

  constructor(readonly source: THREE.Object3D) {
    super();
    this.name = 'Constraint Helper';
    this.renderOrder = 999;
    setUserData(this, 'editorHelper', true);
    setUserData(this, 'editorHelperType', 'constraints');
    this.layers.set(EDITOR_LAYER);
    this.refreshStructure();
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
  }

  setSelectedObjects(objects: ReadonlySet<THREE.Object3D>): void {
    this.selectedObjects = objects;
  }

  /** The orange target and purple pole are effectors, not decorative joints.
   * Expose only those two meshes to the viewport's editor-helper picker. */
  controlMeshes(): THREE.Mesh[] {
    return this.visuals.flatMap((visual) =>
      [visual.targetHit, visual.poleHit].filter((mesh) => mesh.visible),
    );
  }

  /** True when this helper is already the native viewport presentation for
   * the object. Such nodes must not also receive the legacy corner-bracket
   * fallback: the constraint lines/handle are their visible representation. */
  presents(object: THREE.Object3D): boolean {
    if (object === this.source) return true;
    return this.visuals.some((visual) => {
      const snapshot = visual.mark.getSnapshot();
      return object === snapshot.target || object === snapshot.pole;
    });
  }

  controlFor(mesh: THREE.Object3D): ConstraintControl | null {
    for (const visual of this.visuals) {
      const snapshot = visual.mark.getSnapshot();
      if ((mesh === visual.target || mesh === visual.targetHit) && snapshot.target) {
        return {
          kind: 'target',
          label: snapshot.target.name || `${visual.mark.config.label} target`,
          object: snapshot.target,
          mesh: visual.target,
        };
      }
      if ((mesh === visual.pole || mesh === visual.poleHit) && snapshot.pole) {
        return {
          kind: 'pole',
          label: snapshot.pole.name || `${visual.mark.config.label} pole`,
          object: snapshot.pole,
          mesh: visual.pole,
        };
      }
    }
    return null;
  }

  setHoveredControl(mesh: THREE.Mesh | null): void {
    this.hoveredControl = mesh;
  }

  update(camera: THREE.Camera): void {
    this.refreshStructure();
    for (const visual of this.visuals) this.updateVisual(visual, camera);
  }

  dispose(): void {
    this.clearVisuals();
    this.removeFromParent();
  }

  private refreshStructure(): void {
    const marks = constraintsOf(this.source);
    const unchanged =
      marks.length === this.visuals.length &&
      marks.every((mark, index) => {
        const snapshot = mark.getSnapshot();
        const pointCount =
          snapshot.chain.length > 0 ? snapshot.chain.length : snapshot.constrained ? 1 : 0;
        return (
          this.visuals[index]?.mark === mark && this.visuals[index]?.positions.length === pointCount
        );
      });
    if (unchanged) return;
    this.clearVisuals();
    this.visuals = marks.map((mark) => this.makeVisual(mark));
  }

  private makeVisual(mark: ConstraintMark): ConstraintVisual {
    const snapshot = mark.getSnapshot();
    const points =
      snapshot.chain.length > 0
        ? snapshot.chain
        : snapshot.constrained
          ? [snapshot.constrained]
          : [];
    const chain = line(CHAIN);
    const targetLine = line(TARGET);
    const poleLine = line(POLE);
    const joints = points.map(() => point(new THREE.SphereGeometry(0.035, 10, 7), CHAIN));
    const target = point(new THREE.OctahedronGeometry(0.085), TARGET);
    const pole = point(new THREE.TetrahedronGeometry(0.075), POLE);
    // Gizmos in established editors use a larger invisible picking volume
    // than their painted handle. Preserve the compact octahedron/tetrahedron
    // while giving each a forgiving screen hit target that wins before model
    // geometry behind it.
    const hitMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      colorWrite: false,
    });
    const targetHit = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 7), hitMaterial);
    const poleHit = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 7), hitMaterial.clone());
    for (const object of [
      chain,
      targetLine,
      poleLine,
      ...joints,
      target,
      pole,
      targetHit,
      poleHit,
    ]) {
      object.renderOrder = this.renderOrder;
      object.layers.set(EDITOR_LAYER);
      this.add(object);
    }
    return {
      mark,
      chain,
      targetLine,
      poleLine,
      joints,
      target,
      pole,
      targetHit,
      poleHit,
      positions: points.map(() => new THREE.Vector3()),
      targetPosition: new THREE.Vector3(),
      polePosition: new THREE.Vector3(),
    };
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: each branch updates one independent handle in a compact per-frame projection.
  private updateVisual(visual: ConstraintVisual, camera: THREE.Camera): void {
    const snapshot = visual.mark.getSnapshot();
    const points =
      snapshot.chain.length > 0
        ? snapshot.chain
        : snapshot.constrained
          ? [snapshot.constrained]
          : [];
    for (let index = 0; index < points.length; index++) {
      points[index]!.getWorldPosition(visual.positions[index]!);
    }
    setLinePoints(visual.chain, visual.positions);
    for (let index = 0; index < visual.joints.length; index++) {
      const joint = visual.joints[index]!;
      const position = visual.positions[index];
      joint.visible = Boolean(position);
      if (position) {
        joint.position.copy(position);
        joint.scale.setScalar(this.handleScale(camera, position));
      }
    }

    const tip = visual.positions.at(-1);
    const targetPosition = snapshot.target?.getWorldPosition(visual.targetPosition) ?? null;
    const polePosition = snapshot.pole?.getWorldPosition(visual.polePosition) ?? null;
    setLinePoints(visual.targetLine, tip && targetPosition ? [tip, targetPosition] : []);
    setLinePoints(
      visual.poleLine,
      visual.positions[0] && polePosition ? [visual.positions[0], polePosition] : [],
    );
    visual.target.visible = targetPosition !== null;
    if (targetPosition) {
      visual.target.position.copy(targetPosition);
      visual.target.scale.setScalar(
        this.handleScale(camera, targetPosition) *
          (this.hoveredControl === visual.target ? 1.22 : 1),
      );
    }
    visual.targetHit.visible = targetPosition !== null;
    if (targetPosition) {
      visual.targetHit.position.copy(targetPosition);
      visual.targetHit.scale.copy(visual.target.scale);
    }
    visual.pole.visible = polePosition !== null;
    if (polePosition) {
      visual.pole.position.copy(polePosition);
      visual.pole.scale.setScalar(
        this.handleScale(camera, polePosition) * (this.hoveredControl === visual.pole ? 1.22 : 1),
      );
    }
    visual.poleHit.visible = polePosition !== null;
    if (polePosition) {
      visual.poleHit.position.copy(polePosition);
      visual.poleHit.scale.copy(visual.pole.scale);
    }

    const failed = snapshot.status === 'error' || snapshot.status === 'unresolved';
    const opacity = this.selected ? 1 : 0.52;
    for (const object of [visual.chain, ...visual.joints]) {
      const material = object.material as THREE.LineBasicMaterial | THREE.MeshBasicMaterial;
      material.color.copy(failed ? ERROR : CHAIN);
      material.opacity = opacity;
    }
    const targetActive =
      this.hoveredControl === visual.target ||
      (snapshot.target !== null && this.selectedObjects.has(snapshot.target));
    const poleActive =
      this.hoveredControl === visual.pole ||
      (snapshot.pole !== null && this.selectedObjects.has(snapshot.pole));
    (visual.target.material as THREE.MeshBasicMaterial).color.copy(targetActive ? HOVER : TARGET);
    (visual.pole.material as THREE.MeshBasicMaterial).color.copy(poleActive ? HOVER : POLE);
    (visual.targetLine.material as THREE.LineBasicMaterial).color.copy(TARGET);
    (visual.poleLine.material as THREE.LineBasicMaterial).color.copy(POLE);
    (visual.targetLine.material as THREE.LineBasicMaterial).opacity = opacity;
    (visual.poleLine.material as THREE.LineBasicMaterial).opacity = opacity;
    (visual.target.material as THREE.MeshBasicMaterial).opacity = targetActive ? 1 : opacity;
    (visual.pole.material as THREE.MeshBasicMaterial).opacity = poleActive ? 1 : opacity;
  }

  /** Keep control points legible like ordinary editor gizmos while retaining
   * enough world-scale variation to read depth. */
  private handleScale(camera: THREE.Camera, position: THREE.Vector3): number {
    return THREE.MathUtils.clamp(camera.position.distanceTo(position) / 8, 0.65, 4);
  }

  private clearVisuals(): void {
    for (const child of [...this.children]) {
      child.removeFromParent();
      const renderable = child as THREE.Line | THREE.Mesh;
      renderable.geometry.dispose();
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      for (const material of materials) material.dispose();
    }
    this.visuals = [];
    this.hoveredControl = null;
  }
}
