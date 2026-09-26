import type { PointData } from 'pixi.js';

export interface GodotRect2 {
  position: PointData;
  size: PointData;
  end: PointData;
}

export interface GodotRect2i {
  position: PointData;
  size: PointData;
  end: PointData;
}

const vector = (x = 0, y = 0): PointData => ({ x, y });
const copyVector = (value: Readonly<PointData>): PointData => vector(value.x, value.y);

function makeRect(position: Readonly<PointData>, size: Readonly<PointData>): GodotRect2 {
  const value = {
    position: copyVector(position),
    size: copyVector(size),
    get end(): PointData {
      return vector(this.position.x + this.size.x, this.position.y + this.size.y);
    },
    set end(end: Readonly<PointData>) {
      this.size = vector(end.x - this.position.x, end.y - this.position.y);
    },
  };
  return value;
}

function makeRecti(position: Readonly<PointData>, size: Readonly<PointData>): GodotRect2i {
  return makeRect(position, size) as GodotRect2i;
}

const isRect = (value: unknown): value is GodotRect2 =>
  typeof value === 'object' &&
  value !== null &&
  'position' in value &&
  'size' in value &&
  typeof (value as GodotRect2).position?.x === 'number' &&
  typeof (value as GodotRect2).position?.y === 'number' &&
  typeof (value as GodotRect2).size?.x === 'number' &&
  typeof (value as GodotRect2).size?.y === 'number';

const equalVector = (a: Readonly<PointData>, b: Readonly<PointData>): boolean =>
  a.x === b.x && a.y === b.y;

const equalRect = (a: GodotRect2, b: unknown): boolean =>
  isRect(b) && equalVector(a.position, b.position) && equalVector(a.size, b.size);

const isEqualApproxNumber = (a: number, b: number): boolean => {
  if (a === b) return true;
  let tolerance = 0.00001 * Math.abs(a);
  if (tolerance < 0.00001) tolerance = 0.00001;
  return Math.abs(a - b) < tolerance;
};

const isEqualApproxVector = (a: Readonly<PointData>, b: Readonly<PointData>): boolean =>
  isEqualApproxNumber(a.x, b.x) && isEqualApproxNumber(a.y, b.y);

function containsValue(left: GodotRect2, right: unknown): boolean {
  if (Array.isArray(right)) return right.some((entry) => equalRect(left, entry));
  if (right instanceof Map) return [...right.keys()].some((entry) => equalRect(left, entry));
  return typeof right === 'object' && right !== null && Object.hasOwn(right, String(left));
}

export function godotRect2New(...args: unknown[]): GodotRect2 {
  if (args.length === 0) return makeRect(vector(), vector());
  if (args.length === 1 && isRect(args[0])) return makeRect(args[0].position, args[0].size);
  if (args.length === 2) return makeRect(args[0] as PointData, args[1] as PointData);
  if (args.length === 4) {
    return makeRect(
      vector(Number(args[0]), Number(args[1])),
      vector(Number(args[2]), Number(args[3])),
    );
  }
  throw new Error(`godot-compat: unsupported Rect2 constructor arity ${args.length}`);
}

export function godotRect2iNew(...args: unknown[]): GodotRect2i {
  if (args.length === 0) return makeRecti(vector(), vector());
  if (args.length === 1 && isRect(args[0])) {
    return makeRecti(
      vector(Math.trunc(args[0].position.x), Math.trunc(args[0].position.y)),
      vector(Math.trunc(args[0].size.x), Math.trunc(args[0].size.y)),
    );
  }
  if (args.length === 2) return makeRecti(args[0] as PointData, args[1] as PointData);
  if (args.length === 4) {
    return makeRecti(
      vector(Number(args[0]), Number(args[1])),
      vector(Number(args[2]), Number(args[3])),
    );
  }
  throw new Error(`godot-compat: unsupported Rect2i constructor arity ${args.length}`);
}

/** Historical constructor spelling retained for translated viewport values. */
export function rect2(x: number, y: number, width: number, height: number): GodotRect2 {
  return godotRect2New(x, y, width, height);
}

function rectIntersects(a: GodotRect2, b: GodotRect2, includeBorders = false): boolean {
  const aEnd = a.end;
  const bEnd = b.end;
  return includeBorders
    ? !(
        a.position.x > bEnd.x ||
        aEnd.x < b.position.x ||
        a.position.y > bEnd.y ||
        aEnd.y < b.position.y
      )
    : !(
        a.position.x >= bEnd.x ||
        aEnd.x <= b.position.x ||
        a.position.y >= bEnd.y ||
        aEnd.y <= b.position.y
      );
}

function rectEncloses(a: GodotRect2, b: GodotRect2): boolean {
  const aEnd = a.end;
  const bEnd = b.end;
  return (
    b.position.x >= a.position.x &&
    b.position.y >= a.position.y &&
    bEnd.x <= aEnd.x &&
    bEnd.y <= aEnd.y
  );
}

function rectIntersection(a: GodotRect2, b: GodotRect2): GodotRect2 {
  if (!rectIntersects(a, b)) return godotRect2New();
  const position = vector(
    Math.max(a.position.x, b.position.x),
    Math.max(a.position.y, b.position.y),
  );
  const end = vector(Math.min(a.end.x, b.end.x), Math.min(a.end.y, b.end.y));
  return makeRect(position, vector(end.x - position.x, end.y - position.y));
}

function rectMerge(a: GodotRect2, b: GodotRect2): GodotRect2 {
  const position = vector(
    Math.min(a.position.x, b.position.x),
    Math.min(a.position.y, b.position.y),
  );
  const end = vector(Math.max(a.end.x, b.end.x), Math.max(a.end.y, b.end.y));
  return makeRect(position, vector(end.x - position.x, end.y - position.y));
}

function rectExpand(a: GodotRect2, point: Readonly<PointData>): GodotRect2 {
  const begin = vector(Math.min(a.position.x, point.x), Math.min(a.position.y, point.y));
  const end = vector(Math.max(a.end.x, point.x), Math.max(a.end.y, point.y));
  return makeRect(begin, vector(end.x - begin.x, end.y - begin.y));
}

function rectGrowIndividual(
  a: GodotRect2,
  left: number,
  top: number,
  right: number,
  bottom: number,
): GodotRect2 {
  return makeRect(
    vector(a.position.x - left, a.position.y - top),
    vector(a.size.x + left + right, a.size.y + top + bottom),
  );
}

export function godotRect2Call<T = unknown>(
  receiver: GodotRect2,
  method: string,
  args: readonly unknown[],
): T;
export function godotRect2Call(
  receiver: GodotRect2,
  method: string,
  args: readonly unknown[],
): unknown {
  const point = (index: number): PointData => args[index] as PointData;
  const rect = (index: number): GodotRect2 => args[index] as GodotRect2;
  const number = (index: number): number => Number(args[index]);
  switch (method) {
    case 'get_center':
      return vector(
        receiver.position.x + receiver.size.x * 0.5,
        receiver.position.y + receiver.size.y * 0.5,
      );
    case 'get_area':
      return receiver.size.x * receiver.size.y;
    case 'has_area':
      return receiver.size.x > 0 && receiver.size.y > 0;
    case 'has_point':
      return (
        point(0).x >= receiver.position.x &&
        point(0).y >= receiver.position.y &&
        point(0).x < receiver.end.x &&
        point(0).y < receiver.end.y
      );
    case 'is_equal_approx':
      return (
        isEqualApproxVector(receiver.position, rect(0).position) &&
        isEqualApproxVector(receiver.size, rect(0).size)
      );
    case 'is_finite':
      return [receiver.position.x, receiver.position.y, receiver.size.x, receiver.size.y].every(
        Number.isFinite,
      );
    case 'intersects':
      return rectIntersects(receiver, rect(0), Boolean(args[1] ?? false));
    case 'encloses':
      return rectEncloses(receiver, rect(0));
    case 'intersection':
      return rectIntersection(receiver, rect(0));
    case 'merge':
      return rectMerge(receiver, rect(0));
    case 'expand':
      return rectExpand(receiver, point(0));
    case 'get_support':
      return vector(
        receiver.position.x + (point(0).x > 0 ? receiver.size.x : 0),
        receiver.position.y + (point(0).y > 0 ? receiver.size.y : 0),
      );
    case 'grow':
      return rectGrowIndividual(receiver, number(0), number(0), number(0), number(0));
    case 'grow_side': {
      const amount = number(1);
      return rectGrowIndividual(
        receiver,
        number(0) === 0 ? amount : 0,
        number(0) === 1 ? amount : 0,
        number(0) === 2 ? amount : 0,
        number(0) === 3 ? amount : 0,
      );
    }
    case 'grow_individual':
      return rectGrowIndividual(receiver, number(0), number(1), number(2), number(3));
    case 'abs':
      return makeRect(
        vector(
          receiver.position.x + Math.min(receiver.size.x, 0),
          receiver.position.y + Math.min(receiver.size.y, 0),
        ),
        vector(Math.abs(receiver.size.x), Math.abs(receiver.size.y)),
      );
    default:
      throw new Error(`godot-compat: unsupported Rect2.${method}`);
  }
}

export function godotRect2iCall<T = unknown>(
  receiver: GodotRect2i,
  method: string,
  args: readonly unknown[],
): T;
export function godotRect2iCall(
  receiver: GodotRect2i,
  method: string,
  args: readonly unknown[],
): unknown {
  if (method === 'get_center')
    return vector(
      receiver.position.x + Math.trunc(receiver.size.x / 2),
      receiver.position.y + Math.trunc(receiver.size.y / 2),
    );
  if (method === 'intersects') return rectIntersects(receiver, args[0] as GodotRect2i);
  if (method === 'abs') return godotRect2iNew(godotRect2Call(receiver, method, args));
  const result = godotRect2Call(receiver, method, args);
  return isRect(result) ? godotRect2iNew(result) : result;
}

export function godotRect2Operator(operator: string, left: GodotRect2, right: unknown): unknown {
  switch (operator) {
    case '==':
      return equalRect(left, right);
    case '!=':
      return !equalRect(left, right);
    case 'not':
      return equalRect(left, godotRect2New());
    case 'in':
      return containsValue(left, right);
    default:
      throw new Error(`godot-compat: unsupported Rect2 operator ${operator}`);
  }
}

export function godotRect2iOperator(operator: string, left: GodotRect2i, right: unknown): unknown {
  return godotRect2Operator(operator, left, right);
}
