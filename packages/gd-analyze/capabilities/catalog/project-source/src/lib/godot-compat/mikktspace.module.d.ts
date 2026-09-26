/** Type boundary for Three's bundled MikkTSpace WebAssembly module. */
declare module 'three/addons/libs/mikktspace.module.js' {
  export let isReady: boolean;
  export const ready: Promise<unknown>;
  export function generateTangents(
    position: Float32Array,
    normal: Float32Array,
    texcoord: Float32Array,
  ): Float32Array;
}
