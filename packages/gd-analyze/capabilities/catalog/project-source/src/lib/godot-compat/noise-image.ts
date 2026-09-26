/** Godot 4.7 `Noise` scalar-to-Image generation and seamless skirt blending. */

import { createGodotImage, type GodotImage, IMAGE_FORMAT } from './image';

export interface GodotNoiseSampler {
  get_noise_2d(x: number, y: number): number;
  get_noise_3d(x: number, y: number, z: number): number;
}

function dimension(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`Noise.${member} requires positive integer dimensions.`);
  }
  return value;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Noise.${member} requires bool arguments.`);
  return value;
}

function scalar(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Noise.${member} requires finite scalar arguments.`);
  }
  return value;
}

function byte(value: number): number {
  return Math.trunc(Math.max(0, Math.min(255, value)));
}

function smoothstep(from: number, to: number, value: number): number {
  if (value <= from) return 0;
  if (value >= to) return 1;
  const t = (value - from) / (to - from);
  return t * t * (3 - 2 * t);
}

function blendByte(background: number, foreground: number, alpha: number): number {
  const sourceAlpha = alpha + 1;
  const inverseAlpha = 256 - alpha;
  return ((sourceAlpha * foreground + inverseAlpha * background) >> 8) & 0xff;
}

function imageBytes(image: GodotImage): Uint8Array {
  return Uint8Array.from(image.get_data());
}

export function generateGodotNoiseImages(
  sampler: GodotNoiseSampler,
  widthValue: unknown,
  heightValue: unknown,
  depthValue: unknown,
  invertValue: unknown,
  in3dSpaceValue: unknown,
  normalizeValue: unknown,
  member = 'get_image',
): GodotImage[] {
  const width = dimension(widthValue, member);
  const height = dimension(heightValue, member);
  const depth = dimension(depthValue, member);
  const invert = bool(invertValue, member);
  const in3dSpace = bool(in3dSpaceValue, member);
  const normalize = bool(normalizeValue, member);
  const imageLength = width * height;
  const images: GodotImage[] = [];

  if (normalize) {
    const values = new Float64Array(imageLength * depth);
    let minimum = Number.MAX_VALUE;
    let maximum = -Number.MAX_VALUE;
    let index = 0;
    for (let z = 0; z < depth; z += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = in3dSpace ? sampler.get_noise_3d(x, y, z) : sampler.get_noise_2d(x, y);
          values[index] = value;
          if (value < minimum) minimum = value;
          if (value > maximum) maximum = value;
          index += 1;
        }
      }
    }

    index = 0;
    for (let z = 0; z < depth; z += 1) {
      const data = new Uint8Array(imageLength);
      for (let pixel = 0; pixel < imageLength; pixel += 1) {
        let value = maximum === minimum ? 0 : byte(((values[index]! - minimum) / (maximum - minimum)) * 255);
        if (invert) value = 255 - value;
        data[pixel] = value;
        index += 1;
      }
      images.push(createGodotImage(width, height, false, IMAGE_FORMAT.FORMAT_L8, data));
    }
    return images;
  }

  for (let z = 0; z < depth; z += 1) {
    const data = new Uint8Array(imageLength);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = in3dSpace ? sampler.get_noise_3d(x, y, z) : sampler.get_noise_2d(x, y);
        const grayscale = byte(value * 127.5 + 127.5);
        data[x + y * width] = invert ? 255 - grayscale : grayscale;
      }
    }
    images.push(createGodotImage(width, height, false, IMAGE_FORMAT.FORMAT_L8, data));
  }
  return images;
}

function sourceIndex(
  x: number,
  y: number,
  sourceWidth: number,
  offsetX: number,
  offsetY: number,
  moduloX: number,
  moduloY: number,
): number {
  const sourceX = (x + offsetX) % moduloX;
  const sourceY = (y + offsetY) % moduloY;
  return sourceX + sourceY * sourceWidth;
}

function makeSeamlessSlice(source: GodotImage, width: number, height: number, skirtWidth: number, skirtHeight: number): GodotImage {
  const sourceWidth = width + skirtWidth;
  const sourceHeight = height + skirtHeight;
  const halfWidth = Math.trunc(width * 0.5);
  const halfHeight = Math.trunc(height * 0.5);
  const skirtEdgeX = halfWidth + skirtWidth;
  const skirtEdgeY = halfHeight + skirtHeight;
  const sourceData = imageBytes(source);
  const data = new Uint8Array(width * height);
  const read = (x: number, y: number, alternateX = false, alternateY = false): number =>
    sourceData[sourceIndex(
      x,
      y,
      sourceWidth,
      halfWidth,
      halfHeight,
      alternateX ? width : sourceWidth,
      alternateY ? height : sourceHeight,
    )]!;
  const output = (x: number, y: number): number => data[x + y * width]!;
  const write = (x: number, y: number, value: number): void => { data[x + y * width] = value; };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) write(x, y, read(x, y, true, true));
  }

  for (let x = halfWidth; x < skirtEdgeX; x += 1) {
    const alpha = Math.trunc(255 * (1 - smoothstep(0.1, 0.9, (x - halfWidth) / skirtWidth)));
    for (let y = 0; y < height; y += 1) {
      if (y >= halfHeight && y < skirtEdgeY) continue;
      write(x, y, blendByte(output(x, y), read(x, y, false, true), alpha));
    }
  }

  for (let y = halfHeight; y < skirtEdgeY; y += 1) {
    const alpha = Math.trunc(255 * (1 - smoothstep(0.1, 0.9, (y - halfHeight) / skirtHeight)));
    for (let x = 0; x < width; x += 1) {
      if (x >= halfWidth && x < skirtEdgeX) continue;
      write(x, y, blendByte(output(x, y), read(x, y, true, false), alpha));
    }
  }

  for (let y = halfHeight; y < skirtEdgeY; y += 1) {
    const yAlpha = Math.trunc(255 * (1 - smoothstep(0.1, 0.9, (y - halfHeight) / skirtHeight)));
    for (let x = halfWidth; x < skirtEdgeX; x += 1) {
      const xAlpha = Math.trunc(255 * (1 - smoothstep(0.1, 0.9, (x - halfWidth) / skirtWidth)));
      const top = blendByte(read(x, y, true, false), read(x, y), xAlpha);
      const bottom = blendByte(read(x, y, true, true), read(x, y, false, true), xAlpha);
      write(x, y, blendByte(bottom, top, yAlpha));
    }
  }
  return createGodotImage(width, height, false, IMAGE_FORMAT.FORMAT_L8, data);
}

export function generateGodotSeamlessNoiseImages(
  sampler: GodotNoiseSampler,
  widthValue: unknown,
  heightValue: unknown,
  depthValue: unknown,
  invertValue: unknown,
  in3dSpaceValue: unknown,
  skirtValue: unknown,
  normalizeValue: unknown,
  member = 'get_seamless_image',
): GodotImage[] {
  const width = dimension(widthValue, member);
  const height = dimension(heightValue, member);
  const depth = dimension(depthValue, member);
  const invert = bool(invertValue, member);
  const in3dSpace = bool(in3dSpaceValue, member);
  const normalize = bool(normalizeValue, member);
  const skirt = scalar(skirtValue, member);
  if (skirt < 0) throw new RangeError(`Noise.${member} requires a non-negative blend skirt.`);

  const skirtWidth = Math.max(1, Math.trunc(width * skirt));
  const skirtHeight = Math.max(1, Math.trunc(height * skirt));
  const skirtDepth = Math.max(1, Math.trunc(depth * skirt));
  const sources = generateGodotNoiseImages(
    sampler,
    width + skirtWidth,
    height + skirtHeight,
    depth + skirtDepth,
    invert,
    in3dSpace,
    normalize,
    member,
  );
  const images = sources.map((source) => makeSeamlessSlice(source, width, height, skirtWidth, skirtHeight));
  if (depth <= 1) return images;

  const halfDepth = Math.trunc(depth * 0.5);
  const skirtEdgeZ = halfDepth + skirtDepth;
  for (let index = 0; index < halfDepth; index += 1) {
    const swapped = images[index]!;
    images[index] = images[index + halfDepth]!;
    images[index + halfDepth] = swapped;
  }
  const output = images.slice(0, depth);
  for (let z = halfDepth; z < skirtEdgeZ; z += 1) {
    const alpha = Math.trunc(255 * (1 - smoothstep(0.1, 0.9, (z - halfDepth) / skirtDepth)));
    const background = imageBytes(images[z % depth]!);
    const foreground = imageBytes(images[z - halfDepth + depth]!);
    const data = new Uint8Array(width * height);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = blendByte(background[index]!, foreground[index]!, alpha);
    }
    output[z % depth] = createGodotImage(width, height, false, IMAGE_FORMAT.FORMAT_L8, data);
  }
  return output;
}
