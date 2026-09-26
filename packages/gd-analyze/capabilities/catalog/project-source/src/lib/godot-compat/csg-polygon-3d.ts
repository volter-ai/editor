/** Native Three geometry for Godot CSGPolygon MODE_DEPTH extrusion. */
import {
  ExtrudeGeometry,
  Shape,
  ShapeUtils,
  Vector2,
  type BufferGeometry,
  type UVGenerator,
} from 'three';

export interface GodotCsgPolygonPoint {
  readonly x: number;
  readonly y: number;
}

export interface GodotCsgPolygonGeometryOptions {
  readonly polygon: readonly GodotCsgPolygonPoint[];
  readonly depth: number;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`CSGPolygon.${member} requires a finite float.`);
  }
  return value;
}

function samePoint(a: Vector2, b: Vector2): boolean {
  return a.x === b.x && a.y === b.y;
}

function pointKey(point: Vector2): string {
  return `${point.x},${point.y}`;
}

interface GodotDepthUvFrame {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  readonly contourIndex: ReadonlyMap<string, number>;
}

function createGodotDepthUvGenerator(
  contour: readonly Vector2[],
  depth: number,
): UVGenerator {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const contourIndex = new Map<string, number>();

  for (let index = 0; index < contour.length; index += 1) {
    const point = contour[index]!;
    const key = pointKey(point);
    if (contourIndex.has(key)) {
      throw new RangeError(
        'CSGPolygon.polygon cannot contain a repeated interior point in MODE_DEPTH.',
      );
    }
    contourIndex.set(key, index);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const frame: GodotDepthUvFrame = {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
    contourIndex,
  };
  if (frame.width <= 0 || frame.height <= 0) {
    throw new RangeError('CSGPolygon.polygon must enclose a non-degenerate 2D extent.');
  }

  const vertex = (vertices: number[], index: number): Vector2 =>
    new Vector2(vertices[index * 3]!, vertices[index * 3 + 1]!);
  const contourPosition = (point: Vector2): number => {
    const index = frame.contourIndex.get(pointKey(point));
    if (index === undefined) {
      throw new RangeError('CSGPolygon extrusion produced a side outside its normalized contour.');
    }
    return index;
  };
  const capUv = (vertices: number[], index: number): Vector2 => {
    const point = vertex(vertices, index);
    const nx = (point.x - frame.minX) / frame.width;
    const ny = (point.y - frame.minY) / frame.height;
    const generatedZ = vertices[index * 3 + 2]!;
    if (generatedZ !== 0 && generatedZ !== depth) {
      throw new RangeError('CSGPolygon cap was generated outside its MODE_DEPTH planes.');
    }
    const front = generatedZ === depth;
    return new Vector2(front ? nx * 0.5 : 1 - nx * 0.5, 1 - ny * 0.5);
  };
  const sideU = (vertices: number[], index: number): number => {
    const generatedZ = vertices[index * 3 + 2]!;
    if (generatedZ === depth) return 0;
    if (generatedZ === 0) return 1;
    throw new RangeError('CSGPolygon side was generated outside its MODE_DEPTH planes.');
  };

  return {
    generateTopUV(_geometry, vertices, indexA, indexB, indexC) {
      return [indexA, indexB, indexC].map((index) => capUv(vertices, index));
    },
    generateSideWallUV(_geometry, vertices, indexA, indexB, indexC, indexD) {
      const a = contourPosition(vertex(vertices, indexA));
      const b = contourPosition(vertex(vertices, indexB));
      const sides = contour.length;
      let vA: number;
      let vB: number;
      if ((a + 1) % sides === b) {
        vA = a / sides / 2;
        vB = (a + 1) / sides / 2;
      } else if ((b + 1) % sides === a) {
        vB = b / sides / 2;
        vA = (b + 1) / sides / 2;
      } else {
        throw new RangeError('CSGPolygon extrusion produced an edge outside its normalized contour.');
      }

      return [
        new Vector2(sideU(vertices, indexA), vA),
        new Vector2(sideU(vertices, indexB), vB),
        new Vector2(sideU(vertices, indexC), vB),
        new Vector2(sideU(vertices, indexD), vA),
      ];
    },
  };
}

/**
 * Build the native Shape/ExtrudeGeometry equivalent of Godot's MODE_DEPTH brush.
 *
 * Both engines place the polygon in local XY and extrude along local Z. Three starts an extrusion
 * at Z=0 and extends toward positive Z; Godot keeps its front cap at Z=0 and extends toward
 * negative Z, so the completed geometry is translated by -depth. The custom UV generator follows
 * Godot's depth-mode atlas exactly: front/back caps use their mirrored normalized half-width
 * regions, while side U runs front-to-back and side V advances by normalized contour index through
 * 0..0.5. The helper returns native geometry directly and retains no parallel mesh representation.
 */
export function createGodotCsgPolygonGeometry(
  options: GodotCsgPolygonGeometryOptions,
): BufferGeometry {
  const depth = finite(options.depth, 'depth');
  if (depth <= 0) {
    throw new RangeError('CSGPolygon.depth must be greater than zero in MODE_DEPTH.');
  }
  if (options.polygon.length < 3) {
    throw new RangeError('CSGPolygon.polygon requires at least three points.');
  }

  const points = options.polygon.map((point, index) => {
    const x = finite(point.x, `polygon[${index}].x`);
    const y = finite(point.y, `polygon[${index}].y`);
    return new Vector2(x, y);
  });
  while (points.length > 1 && samePoint(points[0]!, points[points.length - 1]!)) {
    points.pop();
  }
  if (points.length < 3) {
    throw new RangeError('CSGPolygon.polygon requires at least three distinct contour points.');
  }

  // ExtrudeGeometry normalizes outer contours to clockwise before building its side faces. Give
  // it that contour up front; Godot performs the same area-based reversal before indexing side UVs.
  const contour = ShapeUtils.isClockWise(points) ? points : [...points].reverse();
  const shape = new Shape(contour);
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: false,
    UVGenerator: createGodotDepthUvGenerator(contour, depth),
  });
  geometry.translate(0, 0, -depth);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
