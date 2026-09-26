export type OpenSimplexNoise3D = (x: number, y: number, z: number) => number;
export function makeNoise3D(permutation: ArrayLike<number>): OpenSimplexNoise3D;
