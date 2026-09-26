export type OpenSimplexNoise4D = (x: number, y: number, z: number, w: number) => number;
export function makeNoise4D(permutation: ArrayLike<number>): OpenSimplexNoise4D;
