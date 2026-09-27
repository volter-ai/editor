/**
 * Stylized (NPR) rendering: toon and anime materials, inverted-hull outlines,
 * crease lines, and the ink viewport.
 *
 * Split out of `modeling.ts`, where it was invisible — this is a real rendering
 * capability, and its post-process half (`anime-composite.ts`) read as dead code
 * with zero importers purely because its other half lived in a file named after
 * geometry construction.
 */
import * as THREE from 'three';

export interface ToonMaterialOptions {
  readonly color?: THREE.ColorRepresentation;
  readonly depthWrite?: boolean;
  readonly doubleSided?: boolean;
  readonly emissive?: THREE.ColorRepresentation;
  readonly emissiveIntensity?: number;
  readonly gradientMap?: THREE.Texture | null;
  readonly map?: THREE.Texture | null;
  readonly opacity?: number;
}

export interface AnimeMaterialOptions extends ToonMaterialOptions {
  readonly highlightColor?: THREE.ColorRepresentation;
  readonly highlightSoftness?: number;
  readonly highlightStrength?: number;
  readonly highlightThreshold?: number;
  readonly inkColor?: THREE.ColorRepresentation;
  readonly litColor?: THREE.ColorRepresentation;
  readonly name?: string;
  readonly rimColor?: THREE.ColorRepresentation;
  readonly rimPower?: number;
  readonly rimStrength?: number;
  readonly rimThreshold?: number;
  readonly shadowColor?: THREE.ColorRepresentation;
  readonly shadowSoftness?: number;
  readonly shadowThreshold?: number;
  readonly specularColor?: THREE.ColorRepresentation;
  readonly specularPower?: number;
  readonly specularStrength?: number;
  readonly specularThreshold?: number;
}

interface AnimeProfile {
  readonly highlightSoftness: number;
  readonly highlightStrength: number;
  readonly highlightThreshold: number;
  readonly inkColor: string;
  readonly rimPower: number;
  readonly rimStrength: number;
  readonly rimThreshold: number;
  readonly shadowSoftness: number;
  readonly shadowThreshold: number;
  readonly specularPower: number;
  readonly specularStrength: number;
  readonly specularThreshold: number;
}

export interface InkOptions {
  readonly color?: THREE.ColorRepresentation;
  readonly exclude?: (mesh: THREE.Mesh) => boolean;
  readonly fadeEnd?: number;
  readonly fadeStart?: number;
  readonly includeTransparent?: boolean;
  readonly opacity?: number;
  readonly thicknessPixels?: number;
  readonly thresholdAngle?: number;
  readonly viewportHeight?: number;
}

function animeProfile(material: THREE.Material | undefined): AnimeProfile | undefined {
  return material?.userData['animeProfile'] as AnimeProfile | undefined;
}

export function toonGradient(
  colors: readonly THREE.ColorRepresentation[] = ['#263238', '#78909c', '#eceff1'],
): THREE.DataTexture {
  const data = new Uint8Array(colors.length * 4);
  colors.forEach((value, index) => {
    const color = new THREE.Color(value);
    data[index * 4] = Math.round(color.r * 255);
    data[index * 4 + 1] = Math.round(color.g * 255);
    data[index * 4 + 2] = Math.round(color.b * 255);
    data[index * 4 + 3] = 255;
  });
  const texture = new THREE.DataTexture(data, colors.length, 1, THREE.RGBAFormat);
  texture.name = 'toon-gradient';
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function toonMaterial(options: ToonMaterialOptions = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color: options.color ?? '#ffffff',
    depthWrite: options.depthWrite ?? true,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 0,
    gradientMap: options.gradientMap ?? null,
    map: options.map ?? null,
    opacity: options.opacity ?? 1,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: (options.opacity ?? 1) < 1,
  });
}

/** Native Toon material with project-owned light bands; it remains an ordinary material. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the material profile is one flat native-shader option map
export function animeMaterial(options: AnimeMaterialOptions = {}): THREE.MeshToonMaterial {
  const litColor = new THREE.Color(options.litColor ?? options.color ?? '#ffffff');
  const shadowColor = new THREE.Color(options.shadowColor ?? litColor.clone().multiplyScalar(0.42));
  const highlightColor = new THREE.Color(
    options.highlightColor ?? litColor.clone().lerp(new THREE.Color('#ffffff'), 0.3),
  );
  const rimColor = new THREE.Color(options.rimColor ?? highlightColor);
  const specularColor = new THREE.Color(options.specularColor ?? highlightColor);
  const inkColor = new THREE.Color(
    options.inkColor ?? shadowColor.clone().lerp(new THREE.Color('#101827'), 0.62),
  );
  const profile: AnimeProfile = {
    highlightSoftness: options.highlightSoftness ?? 0.035,
    highlightStrength: options.highlightStrength ?? 0.2,
    highlightThreshold: options.highlightThreshold ?? 1.03,
    inkColor: `#${inkColor.getHexString()}`,
    rimPower: options.rimPower ?? 2.4,
    rimStrength: options.rimStrength ?? 0.12,
    rimThreshold: options.rimThreshold ?? 0.62,
    shadowSoftness: options.shadowSoftness ?? 0.025,
    shadowThreshold: options.shadowThreshold ?? 0.62,
    specularPower: options.specularPower ?? 28,
    specularStrength: options.specularStrength ?? 0,
    specularThreshold: options.specularThreshold ?? 0.72,
  };
  const material = toonMaterial(options);
  material.name = options.name ?? 'anime-material';
  material.userData['animeProfile'] = profile;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      animeHighlightColor: { value: highlightColor },
      animeHighlightSoftness: { value: profile.highlightSoftness },
      animeHighlightStrength: { value: profile.highlightStrength },
      animeHighlightThreshold: { value: profile.highlightThreshold },
      animeLitColor: { value: litColor },
      animeRimColor: { value: rimColor },
      animeRimPower: { value: profile.rimPower },
      animeRimStrength: { value: profile.rimStrength },
      animeRimThreshold: { value: profile.rimThreshold },
      animeShadowColor: { value: shadowColor },
      animeShadowSoftness: { value: profile.shadowSoftness },
      animeShadowThreshold: { value: profile.shadowThreshold },
      animeSpecularColor: { value: specularColor },
      animeSpecularPower: { value: profile.specularPower },
      animeSpecularStrength: { value: profile.specularStrength },
      animeSpecularThreshold: { value: profile.specularThreshold },
    });
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `
        uniform vec3 animeLitColor;
        uniform vec3 animeShadowColor;
        uniform vec3 animeHighlightColor;
        uniform vec3 animeRimColor;
        uniform vec3 animeSpecularColor;
        uniform float animeShadowThreshold;
        uniform float animeShadowSoftness;
        uniform float animeHighlightThreshold;
        uniform float animeHighlightSoftness;
        uniform float animeHighlightStrength;
        uniform float animeRimPower;
        uniform float animeRimThreshold;
        uniform float animeRimStrength;
        uniform float animeSpecularPower;
        uniform float animeSpecularThreshold;
        uniform float animeSpecularStrength;

        void main() {
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
        float animeBaseLuma = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.04);
        float animeLightLuma = dot(max(outgoingLight - totalEmissiveRadiance, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
        float animeLightLevel = clamp(animeLightLuma / animeBaseLuma, 0.0, 1.5);
        float animeShadowBand = smoothstep(animeShadowThreshold - animeShadowSoftness, animeShadowThreshold + animeShadowSoftness, animeLightLevel);
        vec3 animeColor = mix(animeShadowColor, animeLitColor, animeShadowBand);
        float animeHighlightBand = smoothstep(animeHighlightThreshold - animeHighlightSoftness, animeHighlightThreshold + animeHighlightSoftness, animeLightLevel) * animeHighlightStrength;
        animeColor = mix(animeColor, animeHighlightColor, animeHighlightBand);
        vec3 animeViewDirection = normalize(vViewPosition);
        float animeRimFactor = pow(1.0 - clamp(dot(normal, animeViewDirection), 0.0, 1.0), animeRimPower);
        float animeRimMask = step(animeRimThreshold, animeRimFactor) * animeRimStrength;
        animeColor = mix(animeColor, animeRimColor, animeRimMask);
        #if NUM_DIR_LIGHTS > 0
          vec3 animeHalfDirection = normalize(directionalLights[0].direction + animeViewDirection);
          float animeSpecularFactor = pow(max(dot(normal, animeHalfDirection), 0.0), animeSpecularPower);
          float animeSpecularMask = step(animeSpecularThreshold, animeSpecularFactor) * animeSpecularStrength;
          animeColor = mix(animeColor, animeSpecularColor, animeSpecularMask);
        #endif
        outgoingLight = animeColor + totalEmissiveRadiance;
        #include <opaque_fragment>
      `,
    );
  };
  material.customProgramCacheKey = () => 'vgai-anime-material-v1';
  return material;
}

export function addInvertedHullOutlines(
  root: THREE.Object3D,
  options: InkOptions = {},
): THREE.Mesh[] {
  const sources: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData['isInkOutline']) return;
    const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
    if (sourceMaterial?.transparent && options.includeTransparent !== true) return;
    if (options.exclude?.(object)) return;
    sources.push(object);
  });

  const materials = new Map<string, THREE.ShaderMaterial>();
  const materialFor = (source: THREE.Mesh) => {
    const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
    const color = new THREE.Color(
      options.color ?? animeProfile(sourceMaterial)?.inkColor ?? '#171923',
    );
    const key = color.getHexString();
    const cached = materials.get(key);
    if (cached) return cached;
    const material = new THREE.ShaderMaterial({
      depthTest: true,
      depthWrite: false,
      fragmentShader: `
        uniform vec3 inkColor;
        varying float inkAlpha;
        void main() {
          if (inkAlpha < 0.01) discard;
          gl_FragColor = vec4(inkColor, inkAlpha);
        }
      `,
      side: THREE.BackSide,
      toneMapped: false,
      transparent: true,
      uniforms: {
        fadeEnd: { value: options.fadeEnd ?? 46 },
        fadeStart: { value: options.fadeStart ?? 26 },
        inkColor: { value: color },
        thicknessPixels: { value: options.thicknessPixels ?? 3.2 },
        viewportHeight: { value: options.viewportHeight ?? 1080 },
      },
      vertexShader: `
        uniform float viewportHeight;
        uniform float thicknessPixels;
        uniform float fadeStart;
        uniform float fadeEnd;
        varying float inkAlpha;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vec3 viewNormal = normalize(normalMatrix * normal);
          float viewDepth = max(-viewPosition.z, 0.001);
          float worldUnitsPerPixel = (2.0 * viewDepth) / (projectionMatrix[1][1] * viewportHeight);
          vec2 outlineDirection = normalize(viewNormal.xy + vec2(0.00001));
          viewPosition.xy += outlineDirection * worldUnitsPerPixel * thicknessPixels;
          inkAlpha = 1.0 - smoothstep(fadeStart, fadeEnd, viewDepth);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
    });
    material.name = `inverted-hull-ink-${key}`;
    material.userData['isAnimeInkMaterial'] = true;
    materials.set(key, material);
    return material;
  };

  return sources.map((source) => {
    const outline = new THREE.Mesh(source.geometry, materialFor(source));
    outline.name = `${source.name || source.uuid}-ink-outline`;
    outline.userData['isInkOutline'] = true;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.raycast = () => {};
    outline.renderOrder = -1;
    source.add(outline);
    return outline;
  });
}

export function addCreaseLines(
  root: THREE.Object3D,
  options: InkOptions = {},
): THREE.LineSegments[] {
  const sources: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      object.userData['isInkOutline'] ||
      object.userData['isCreaseLines']
    )
      return;
    const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
    if (sourceMaterial?.transparent && options.includeTransparent !== true) return;
    if (options.exclude?.(object)) return;
    sources.push(object);
  });
  const materials = new Map<string, THREE.ShaderMaterial>();
  const materialFor = (source: THREE.Mesh) => {
    const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
    const color = new THREE.Color(
      options.color ?? animeProfile(sourceMaterial)?.inkColor ?? '#11131b',
    );
    const key = color.getHexString();
    const cached = materials.get(key);
    if (cached) return cached;
    const material = new THREE.ShaderMaterial({
      depthTest: true,
      depthWrite: false,
      fragmentShader: `
        uniform vec3 inkColor;
        uniform float opacity;
        varying float inkAlpha;
        void main() {
          float alpha = opacity * inkAlpha;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(inkColor, alpha);
        }
      `,
      toneMapped: false,
      transparent: true,
      uniforms: {
        fadeEnd: { value: options.fadeEnd ?? 38 },
        fadeStart: { value: options.fadeStart ?? 22 },
        inkColor: { value: color },
        opacity: { value: options.opacity ?? 0.72 },
      },
      vertexShader: `
        uniform float fadeStart;
        uniform float fadeEnd;
        varying float inkAlpha;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          float viewDepth = max(-viewPosition.z, 0.001);
          inkAlpha = 1.0 - smoothstep(fadeStart, fadeEnd, viewDepth);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
    });
    material.name = `crease-ink-${key}`;
    materials.set(key, material);
    return material;
  };
  return sources.map((source) => {
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(source.geometry, options.thresholdAngle ?? 38),
      materialFor(source),
    );
    lines.name = `${source.name || source.uuid}-crease-lines`;
    lines.userData['isCreaseLines'] = true;
    lines.renderOrder = 1;
    lines.raycast = () => {};
    source.add(lines);
    return lines;
  });
}

function reversedWindingGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone();
  const index = geometry.index;
  if (index) {
    for (let offset = 0; offset < index.count; offset += 3) {
      const second = index.getX(offset + 1);
      index.setX(offset + 1, index.getX(offset + 2));
      index.setX(offset + 2, second);
    }
    index.needsUpdate = true;
    return geometry;
  }

  for (const attribute of Object.values(geometry.attributes)) {
    for (let offset = 0; offset < attribute.count; offset += 3) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        const second = attribute.getComponent(offset + 1, component);
        attribute.setComponent(
          offset + 1,
          component,
          attribute.getComponent(offset + 2, component),
        );
        attribute.setComponent(offset + 2, component, second);
      }
    }
    attribute.needsUpdate = true;
  }
  return geometry;
}

/** glTF-portable silhouette geometry: normal meshes, no custom shader or loader hook. */
export function addPortableHullOutlines(
  root: THREE.Object3D,
  options: Pick<InkOptions, 'color' | 'exclude' | 'includeTransparent'> & {
    readonly relativeThickness?: number;
  } = {},
): THREE.Mesh[] {
  const sources: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData['isInkOutline']) return;
    const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
    if (sourceMaterial?.transparent && options.includeTransparent !== true) return;
    if (options.exclude?.(object)) return;
    sources.push(object);
  });
  const materials = new Map<string, THREE.MeshBasicMaterial>();
  return sources.map((source) => {
    const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
    const color = new THREE.Color(
      options.color ?? animeProfile(sourceMaterial)?.inkColor ?? '#171923',
    );
    const key = color.getHexString();
    let material = materials.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      material.name = `portable-hull-ink-${key}`;
      materials.set(key, material);
    }
    const outline = new THREE.Mesh(reversedWindingGeometry(source.geometry), material);
    outline.name = `${source.name || source.uuid}-portable-ink-outline`;
    outline.scale.setScalar(1 + (options.relativeThickness ?? 0.018));
    outline.userData['isInkOutline'] = true;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.raycast = () => {};
    outline.renderOrder = -1;
    source.add(outline);
    return outline;
  });
}

/** glTF-portable hard creases using ordinary line geometry and materials. */
export function addPortableCreaseLines(
  root: THREE.Object3D,
  options: Pick<
    InkOptions,
    'color' | 'exclude' | 'includeTransparent' | 'opacity' | 'thresholdAngle'
  > = {},
): THREE.LineSegments[] {
  const sources: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData['isInkOutline']) return;
    const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
    if (sourceMaterial?.transparent && options.includeTransparent !== true) return;
    if (options.exclude?.(object)) return;
    sources.push(object);
  });
  const materials = new Map<string, THREE.LineBasicMaterial>();
  return sources.map((source) => {
    const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
    const color = new THREE.Color(
      options.color ?? animeProfile(sourceMaterial)?.inkColor ?? '#11131b',
    );
    const key = color.getHexString();
    let material = materials.get(key);
    if (!material) {
      material = new THREE.LineBasicMaterial({
        color,
        opacity: options.opacity ?? 0.68,
        toneMapped: false,
        transparent: (options.opacity ?? 0.68) < 1,
      });
      material.name = `portable-crease-ink-${key}`;
      materials.set(key, material);
    }
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(source.geometry, options.thresholdAngle ?? 46),
      material,
    );
    lines.name = `${source.name || source.uuid}-portable-crease-lines`;
    lines.userData['isCreaseLines'] = true;
    lines.raycast = () => {};
    source.add(lines);
    return lines;
  });
}

export function setAnimeInkViewport(root: THREE.Object3D, viewportHeight: number): void {
  const materials = new Set<THREE.ShaderMaterial>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => {
      if (material.userData['isAnimeInkMaterial']) {
        materials.add(material as THREE.ShaderMaterial);
      }
    });
  });
  materials.forEach((material) => {
    material.uniforms['viewportHeight']!.value = Math.max(1, viewportHeight);
  });
}
