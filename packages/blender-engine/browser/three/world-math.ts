/** Blender 5.2 `intern/cycles/kernel/svm/math_util.h` scalar Math operations. */
const divide = (a: number, b: number): number => (b !== 0 ? a / b : 0);
const clampUnit = (a: number): number => Math.min(1, Math.max(-1, a));
const smoothMin = (a: number, b: number, k: number): number => {
  const h = k !== 0 ? Math.max(k - Math.abs(a - b), 0) / k : 0;
  return Math.min(a, b) - (h * h * h * k) / 6;
};

export const worldMath = {
  ADD: (a: number, b: number) => a + b,
  SUBTRACT: (a: number, b: number) => a - b,
  MULTIPLY: (a: number, b: number) => a * b,
  DIVIDE: divide,
  POWER: (a: number, b: number) =>
    b === 0 ? 1 : a === 0 || (a < 0 && !Number.isInteger(b)) ? 0 : a ** b,
  LOGARITHM: (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : divide(Math.log(a), Math.log(b))),
  SQRT: (a: number) => Math.sqrt(Math.max(a, 0)),
  INVERSE_SQRT: (a: number) => (a > 0 ? 1 / Math.sqrt(a) : 0),
  ABSOLUTE: Math.abs,
  RADIANS: (a: number) => (a * Math.PI) / 180,
  DEGREES: (a: number) => (a * 180) / Math.PI,
  MINIMUM: (a: number, b: number) => Math.min(a, b),
  MAXIMUM: (a: number, b: number) => Math.max(a, b),
  LESS_THAN: (a: number, b: number) => Number(a < b),
  GREATER_THAN: (a: number, b: number) => Number(a > b),
  ROUND: (a: number) => Math.floor(a + 0.5),
  FLOOR: Math.floor,
  CEIL: Math.ceil,
  FRACT: (a: number) => a - Math.floor(a),
  MODULO: (a: number, b: number) => (b !== 0 ? a % b : 0),
  FLOORED_MODULO: (a: number, b: number) => (b !== 0 ? a - Math.floor(a / b) * b : 0),
  TRUNC: Math.trunc,
  SNAP: (a: number, b: number) => Math.floor(divide(a, b)) * b,
  WRAP: (a: number, b: number, c: number) =>
    b !== c ? a - (b - c) * Math.floor((a - c) / (b - c)) : c,
  PINGPONG: (a: number, b: number) => {
    if (b === 0) return 0;
    const t = (a - b) / (b * 2);
    return Math.abs((t - Math.floor(t)) * b * 2 - b);
  },
  SINE: Math.sin,
  COSINE: Math.cos,
  TANGENT: Math.tan,
  SINH: Math.sinh,
  COSH: Math.cosh,
  TANH: Math.tanh,
  ARCSINE: (a: number) => Math.asin(clampUnit(a)),
  ARCCOSINE: (a: number) => Math.acos(clampUnit(a)),
  ARCTANGENT: Math.atan,
  ARCTAN2: (a: number, b: number) => (a === 0 && b === 0 ? 0 : Math.atan2(a, b)),
  SIGN: Math.sign,
  EXPONENT: Math.exp,
  COMPARE: (a: number, b: number, c: number) =>
    Number(a === b || Math.abs(a - b) <= Math.max(c, 2 ** -23)),
  MULTIPLY_ADD: (a: number, b: number, c: number) => a * b + c,
  SMOOTH_MIN: smoothMin,
  SMOOTH_MAX: (a: number, b: number, c: number) => -smoothMin(-a, -b, c),
};
export type WorldMathOperation = keyof typeof worldMath;
