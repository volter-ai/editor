import * as THREE from 'three';
import { createNeutralMatcapTexture } from './matcap-texture';

/** Temporary developer-facing shading modes. These never become scene data. */
export type ViewportShadingMode =
  | 'solid'
  | 'clay'
  | 'unlit'
  | 'wireframe'
  | 'matcap'
  | 'normals'
  | 'overdraw';

type MaterialPair = {
  clay: THREE.MeshStandardMaterial;
  unlit: THREE.MeshBasicMaterial;
  wireframe: THREE.MeshBasicMaterial;
};

function materialColor(material: THREE.Material): THREE.Color {
  const color = (material as THREE.Material & { color?: THREE.Color }).color;
  return color?.clone() ?? new THREE.Color(0xbec7d1);
}

function textureOf(material: THREE.Material, key: 'map' | 'alphaMap'): THREE.Texture | null {
  return (
    (material as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null })[
      key
    ] ?? null
  );
}

/**
 * Applies a render-only material view and restores every native material in a
 * `finally` block. Gameplay and authoring therefore always observe the real
 * materials; only renderer work inside {@link render} sees the diagnostic view.
 */
export class ViewportShadingRenderer {
  private readonly _derived = new Map<THREE.Material, MaterialPair>();
  private readonly _normals = new THREE.MeshNormalMaterial();
  /**
   * The clay/sculpt look. Built on FIRST USE, not at construction: the matcap
   * sphere is drawn into a 2D canvas, and every ViewportShadingRenderer that
   * only ever draws `solid` would otherwise pay for a texture nobody samples.
   * `toneMapped: false` for the same reason the overdraw material sets it —
   * a diagnostic look must read exactly as authored, not as the document's
   * exposure and tone curve happen to grade it.
   */
  private _matcap: THREE.MeshMatcapMaterial | null = null;
  private _matcapTexture: THREE.Texture | null = null;
  private readonly _overdraw = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.08,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  render(
    scene: THREE.Scene,
    mode: ViewportShadingMode,
    draw: () => void,
    include: (mesh: THREE.Mesh) => boolean = () => true,
  ): void {
    if (mode === 'solid') {
      draw();
      return;
    }

    const originals: Array<{
      mesh: THREE.Mesh;
      material: THREE.Material | THREE.Material[];
    }> = [];
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material || !include(mesh)) return;
      originals.push({ mesh, material: mesh.material });
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => this._materialFor(material, mode))
        : this._materialFor(mesh.material, mode);
    });

    try {
      draw();
    } finally {
      for (const { mesh, material } of originals) mesh.material = material;
    }
  }

  dispose(): void {
    for (const pair of this._derived.values()) {
      pair.clay.dispose();
      pair.unlit.dispose();
      pair.wireframe.dispose();
    }
    this._derived.clear();
    this._normals.dispose();
    this._overdraw.dispose();
    this._matcap?.dispose();
    this._matcapTexture?.dispose();
    this._matcap = null;
    this._matcapTexture = null;
  }

  private _materialFor(
    material: THREE.Material,
    mode: Exclude<ViewportShadingMode, 'solid'>,
  ): THREE.Material {
    if (mode === 'normals') return this._normals;
    if (mode === 'overdraw') return this._overdraw;
    if (mode === 'matcap') {
      if (!this._matcap) {
        this._matcapTexture = createNeutralMatcapTexture();
        this._matcap = new THREE.MeshMatcapMaterial({
          matcap: this._matcapTexture,
          toneMapped: false,
        });
      }
      return this._matcap;
    }

    let pair = this._derived.get(material);
    if (!pair) {
      const common: THREE.MeshBasicMaterialParameters = {
        color: materialColor(material),
        map: textureOf(material, 'map'),
        alphaMap: textureOf(material, 'alphaMap'),
        alphaTest: material.alphaTest,
        opacity: material.opacity,
        transparent: material.transparent,
        side: material.side,
        depthTest: material.depthTest,
        depthWrite: material.depthWrite,
        vertexColors: Boolean(
          (material as THREE.Material & { vertexColors?: boolean }).vertexColors,
        ),
        fog: (material as THREE.Material & { fog?: boolean }).fog ?? true,
      };
      pair = {
        clay: new THREE.MeshStandardMaterial({
          color: 0xaeb6c0,
          roughness: 0.82,
          metalness: 0,
          flatShading: true,
          alphaMap: textureOf(material, 'alphaMap'),
          alphaTest: material.alphaTest,
          opacity: material.opacity,
          transparent: material.transparent,
          side: material.side,
          depthTest: material.depthTest,
          depthWrite: material.depthWrite,
        }),
        unlit: new THREE.MeshBasicMaterial(common),
        wireframe: new THREE.MeshBasicMaterial({ ...common, wireframe: true }),
      };
      this._derived.set(material, pair);
    }
    return pair[mode];
  }
}
