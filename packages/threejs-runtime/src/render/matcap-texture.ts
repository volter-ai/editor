import * as THREE from 'three';

/**
 * The neutral matcap sphere, DRAWN rather than shipped.
 *
 * A matcap is just a picture of a lit sphere sampled by view-space normal, so
 * there is nothing to vendor: the same three numbers a shader would use
 * (key, fill, rim) evaluated once per texel produce the image. Keeping it
 * procedural means the diagnostic look has no binary asset, no license, no
 * provenance row, and no way to go missing from a build.
 *
 * The look is deliberately CLAY: one warm key from the upper left, a cool
 * fill from the lower right, a tight rim, and a broad soft highlight — the
 * neutral sculpting material whose whole job is to let form read without
 * colour, texture or authored lighting getting a vote.
 */

const SIZE = 256;

/** sRGB transfer curve — the canvas holds display-referred bytes. */
function encode(value: number): number {
  const c = Math.min(1, Math.max(0, value));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function drawNeutralMatcap(size = SIZE): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const image = context.createImageData(size, size);

  const key = normalize(-0.45, 0.62, 0.64);
  const fill = normalize(0.65, -0.35, 0.5);
  // View direction is +Z for a matcap: the sphere is drawn facing the camera.
  const half = normalize(key[0], key[1], key[2] + 1);
  const base = [0.7, 0.69, 0.68];
  const fillColor = [0.34, 0.4, 0.52];
  const rimColor = [0.85, 0.88, 1];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px + 0.5) / size / 0.5 - 1;
      const ny = 1 - (py + 0.5) / size / 0.5;
      const r2 = nx * nx + ny * ny;
      // Outside the unit disc a matcap is never sampled by a facing surface,
      // but bilinear filtering reaches one texel past the silhouette. Clamp
      // to the rim normal so the edge stays the rim colour instead of
      // bleeding whatever happened to be there.
      const clamped = r2 > 1;
      const scale = clamped ? 1 / Math.sqrt(r2) : 1;
      const x = nx * scale;
      const y = ny * scale;
      const z = clamped ? 0 : Math.sqrt(Math.max(0, 1 - r2));

      const diffuse = Math.max(0, x * key[0] + y * key[1] + z * key[2]);
      const fillTerm = Math.max(0, x * fill[0] + y * fill[1] + z * fill[2]);
      const specular = Math.max(0, x * half[0] + y * half[1] + z * half[2]) ** 42 * 0.5;
      const rim = (1 - z) ** 3.2 * 0.4;

      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const lit =
          base[channel]! * (0.16 + 0.8 * diffuse) +
          fillColor[channel]! * 0.3 * fillTerm +
          rimColor[channel]! * rim +
          specular;
        image.data[offset + channel] = Math.round(encode(lit) * 255);
      }
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** The drawn sphere as a ready-to-sample texture. Callers own disposal. */
export function createNeutralMatcapTexture(size = SIZE): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(drawNeutralMatcap(size));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
