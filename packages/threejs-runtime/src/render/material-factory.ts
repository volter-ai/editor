import * as THREE from 'three';
import type { MaterialDescriptor } from '../asset-formats/material';
import type { MeshDescriptor } from '../asset-formats/mesh';
import { loadTexture } from '../asset-loaders';
import { DEFAULTS } from '../defaults';

/**
 * Single source of truth for turning a `MeshDescriptor` / `MaterialDescriptor` descriptor
 * into Three.js geometry/material. Both the runtime scene-loader and the editor's
 * entity-factory import these, so the editor preview renders exactly what the game
 * renders (the WYSIWYG guarantee). Previously these were
 * copy-pasted in two places and had to be hand-synced — any new material feature
 * added to one and not the other silently broke that guarantee.
 *
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: straightforward type-based switch with fallback args
export function createGeometry(mesh: MeshDescriptor): THREE.BufferGeometry {
  const args = mesh.args ?? [];
  switch (mesh.type) {
    case 'box':
      return new THREE.BoxGeometry(args[0] ?? 1, args[1] ?? 1, args[2] ?? 1);
    case 'sphere':
      return new THREE.SphereGeometry(args[0] ?? 0.5, args[1] ?? 32, args[2] ?? 16);
    case 'plane':
      // args[2]/args[3] (width/height segments) matter for vertex-displacing
      // materials (e.g. the Water shader) — they used to be silently dropped,
      // which collapsed the water demo to a 2-triangle quad.
      return new THREE.PlaneGeometry(args[0] ?? 1, args[1] ?? 1, args[2] ?? 1, args[3] ?? 1);
    case 'cylinder':
      return new THREE.CylinderGeometry(
        args[0] ?? 0.5,
        args[1] ?? 0.5,
        args[2] ?? 1,
        args[3] ?? 32,
      );
    case 'capsule':
      return new THREE.CapsuleGeometry(args[0] ?? 0.5, args[1] ?? 1, args[2] ?? 4, args[3] ?? 16);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat type-based switch building Three materials
export function createMaterial(mat?: MaterialDescriptor): THREE.Material {
  if (!mat) return new THREE.MeshStandardMaterial({ color: DEFAULTS.material.color });

  // Only include texture props when actually defined (Three.js warns on undefined values)
  const textures: {
    map?: THREE.Texture;
    normalMap?: THREE.Texture;
    emissiveMap?: THREE.Texture;
    aoMap?: THREE.Texture;
    lightMap?: THREE.Texture;
    roughnessMap?: THREE.Texture;
    metalnessMap?: THREE.Texture;
  } = {};
  if (mat.map) textures.map = loadTexture(mat.map);
  if (mat.normalMap) textures.normalMap = loadTexture(mat.normalMap);
  if (mat.emissiveMap) textures.emissiveMap = loadTexture(mat.emissiveMap);
  if (mat.aoMap) textures.aoMap = loadTexture(mat.aoMap);
  if (mat.lightMap) textures.lightMap = loadTexture(mat.lightMap);
  if (mat.roughnessMap) textures.roughnessMap = loadTexture(mat.roughnessMap);
  if (mat.metalnessMap) textures.metalnessMap = loadTexture(mat.metalnessMap);

  // R1c — every fallback below reads DEFAULTS.material.* instead of
  // duplicating its value as a bare literal, so DEFAULTS stays the single
  // source of truth for what an omitted field renders as (see
  // `material-factory.test.ts`'s
  // "omitted-field" locks, which fail if either copy drifts from the other).
  const dMat = DEFAULTS.material;
  const sideValue = mat.side ?? dMat.side;
  const side =
    sideValue === 'back'
      ? THREE.BackSide
      : sideValue === 'double'
        ? THREE.DoubleSide
        : THREE.FrontSide;
  const opacity = mat.opacity ?? dMat.opacity;
  const transparent = mat.transparent ?? dMat.transparent;

  switch (mat.type) {
    case 'basic':
      return new THREE.MeshBasicMaterial({
        color: mat.color ?? dMat.color,
        ...textures,
        lightMapIntensity: mat.lightMapIntensity ?? 1,
        opacity,
        transparent,
        side,
      });
    case 'toon':
      return new THREE.MeshToonMaterial({
        color: mat.color ?? dMat.color,
        ...textures,
        lightMapIntensity: mat.lightMapIntensity ?? 1,
        emissive: mat.emissive ?? dMat.emissive,
        emissiveIntensity: mat.emissiveIntensity ?? dMat.emissiveIntensity,
        opacity,
        transparent,
        side,
      });
    case 'physical':
      return new THREE.MeshPhysicalMaterial({
        color: mat.color ?? dMat.color,
        metalness: mat.metalness ?? dMat.metalness,
        roughness: mat.roughness ?? dMat.roughness,
        ...textures,
        lightMapIntensity: mat.lightMapIntensity ?? 1,
        emissive: mat.emissive ?? dMat.emissive,
        emissiveIntensity: mat.emissiveIntensity ?? dMat.emissiveIntensity,
        opacity,
        transparent,
        side,
        flatShading: mat.flatShading ?? dMat.flatShading,
        // Clearcoat
        ...(mat.clearcoat
          ? {
              clearcoat: mat.clearcoat.clearcoat,
              clearcoatRoughness:
                mat.clearcoat.clearcoatRoughness ?? dMat.clearcoat.clearcoatRoughness,
              ...(mat.clearcoat.clearcoatMap
                ? { clearcoatMap: loadTexture(mat.clearcoat.clearcoatMap) }
                : {}),
              ...(mat.clearcoat.clearcoatRoughnessMap
                ? { clearcoatRoughnessMap: loadTexture(mat.clearcoat.clearcoatRoughnessMap) }
                : {}),
            }
          : {}),
        // Transmission — `thickness` used to hardcode a literal `0` here,
        // silently diverging from DEFAULTS.material.transmission.thickness
        // (0.5, per the editor's Transmission inspector default). Fixed:
        // read DEFAULTS directly, like every other fallback in this file.
        ...(mat.transmission
          ? {
              transmission: mat.transmission.transmission,
              ior: mat.transmission.ior ?? dMat.transmission.ior,
              thickness: mat.transmission.thickness ?? dMat.transmission.thickness,
              ...(mat.transmission.attenuationColor
                ? { attenuationColor: new THREE.Color(mat.transmission.attenuationColor) }
                : {}),
              attenuationDistance: mat.transmission.attenuationDistance ?? Infinity,
              ...(mat.transmission.transmissionMap
                ? { transmissionMap: loadTexture(mat.transmission.transmissionMap) }
                : {}),
            }
          : {}),
        // Sheen
        ...(mat.sheen
          ? {
              sheen: mat.sheen.sheen,
              sheenColor: new THREE.Color(mat.sheen.sheenColor ?? dMat.sheen.sheenColor),
              sheenRoughness: mat.sheen.sheenRoughness ?? dMat.sheen.sheenRoughness,
              ...(mat.sheen.sheenColorMap
                ? { sheenColorMap: loadTexture(mat.sheen.sheenColorMap) }
                : {}),
              ...(mat.sheen.sheenRoughnessMap
                ? { sheenRoughnessMap: loadTexture(mat.sheen.sheenRoughnessMap) }
                : {}),
            }
          : {}),
        // Iridescence
        ...(mat.iridescence
          ? {
              iridescence: mat.iridescence.iridescence,
              iridescenceIOR: mat.iridescence.iridescenceIOR ?? dMat.iridescence.iridescenceIOR,
              iridescenceThicknessRange:
                mat.iridescence.iridescenceThicknessRange ??
                dMat.iridescence.iridescenceThicknessRange,
              ...(mat.iridescence.iridescenceMap
                ? { iridescenceMap: loadTexture(mat.iridescence.iridescenceMap) }
                : {}),
              ...(mat.iridescence.iridescenceThicknessMap
                ? {
                    iridescenceThicknessMap: loadTexture(mat.iridescence.iridescenceThicknessMap),
                  }
                : {}),
            }
          : {}),
        // Displacement
        ...(mat.displacementMap ? { displacementMap: loadTexture(mat.displacementMap) } : {}),
        ...(mat.displacementScale !== undefined
          ? { displacementScale: mat.displacementScale }
          : {}),
        ...(mat.displacementBias !== undefined ? { displacementBias: mat.displacementBias } : {}),
      });
    default:
      return new THREE.MeshStandardMaterial({
        color: mat.color ?? dMat.color,
        metalness: mat.metalness ?? dMat.metalness,
        roughness: mat.roughness ?? dMat.roughness,
        ...textures,
        lightMapIntensity: mat.lightMapIntensity ?? 1,
        emissive: mat.emissive ?? dMat.emissive,
        emissiveIntensity: mat.emissiveIntensity ?? dMat.emissiveIntensity,
        opacity,
        transparent,
        side,
        flatShading: mat.flatShading ?? dMat.flatShading,
      });
  }
}
