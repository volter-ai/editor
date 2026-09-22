import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import { setObjectMark } from '@volter/editor-threejs/ecs/object-marks';
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/**
 * Viewport-owned emphasis for bones selected in an Object3D document.
 * SkeletonHelper supplies the whole rig context; this draws the selected
 * joint and its incident segments through the model so selection cannot be
 * lost inside opaque geometry.
 */
export class BoneSelectionHighlight extends THREE.Group {
  private readonly segments: Array<readonly [THREE.Bone, THREE.Bone]> = [];
  private readonly linePositions: Float32Array;
  private readonly pointPositions: Float32Array;
  private readonly lines: LineSegments2;
  private readonly lineMaterial: LineMaterial;
  private readonly points: THREE.Points;
  private readonly worldPosition = new THREE.Vector3();

  constructor(
    private readonly bones: readonly THREE.Bone[],
    color: number,
  ) {
    super();
    const seen = new Set<string>();
    for (const bone of bones) {
      const parent = bone.parent as THREE.Bone | null;
      if (parent?.isBone) this.addSegment(parent, bone, seen);
      for (const child of bone.children) {
        if ((child as THREE.Bone).isBone) this.addSegment(bone, child as THREE.Bone, seen);
      }
    }

    this.linePositions = new Float32Array(Math.max(this.segments.length * 6, 6));
    const lineGeometry = new LineSegmentsGeometry();
    lineGeometry.setPositions(this.linePositions);
    this.lineMaterial = new LineMaterial({
      color,
      linewidth: 5,
      worldUnits: false,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      alphaToCoverage: true,
    });
    this.lines = new LineSegments2(lineGeometry, this.lineMaterial);
    this.lines.onBeforeRender = (renderer) => {
      renderer.getSize(this.lineMaterial.resolution);
    };
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1001;
    this.add(this.lines);

    this.pointPositions = new Float32Array(Math.max(bones.length * 3, 3));
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(this.pointPositions, 3));
    const pointMaterial = new THREE.PointsMaterial({
      color,
      size: 11,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.points = new THREE.Points(pointGeometry, pointMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1002;
    this.add(this.points);

    this.name = '__object3d_document_bone_selection';
    setObjectMark(this, 'editorHelper', true);
    this.traverse((object) => object.layers.set(EDITOR_LAYER));
    this.update();
  }

  setColor(color: number): void {
    this.lineMaterial.color.setHex(color);
    (this.points.material as THREE.PointsMaterial).color.setHex(color);
  }

  update(): void {
    let offset = 0;
    for (const [start, end] of this.segments) {
      start.getWorldPosition(this.worldPosition);
      this.linePositions.set(this.worldPosition.toArray(), offset);
      end.getWorldPosition(this.worldPosition);
      this.linePositions.set(this.worldPosition.toArray(), offset + 3);
      offset += 6;
    }
    const lineStart = this.lines.geometry.getAttribute('instanceStart');
    if (lineStart) (lineStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true;

    offset = 0;
    for (const bone of this.bones) {
      bone.getWorldPosition(this.worldPosition);
      this.pointPositions.set(this.worldPosition.toArray(), offset);
      offset += 3;
    }
    const points = this.points.geometry.getAttribute('position');
    if (points) points.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.lineMaterial.dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }

  private addSegment(start: THREE.Bone, end: THREE.Bone, seen: Set<string>): void {
    const key = `${start.uuid}:${end.uuid}`;
    if (seen.has(key)) return;
    seen.add(key);
    this.segments.push([start, end]);
  }
}
