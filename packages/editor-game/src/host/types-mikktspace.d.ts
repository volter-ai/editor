/**
 * Ambient declaration for three's MikkTSpace wasm helper. `@types/three`
 * carried `examples/jsm/libs/mikktspace.module.d.ts` until 0.180, which ships
 * types for `fflate`, `lil-gui`, `meshopt_decoder`, `stats` and `tween` only —
 * so the module the browser dependency table registers
 * (`served-bundle-runtime-modules.ts`, for a hosted project that computes tangents)
 * became untyped in place. The shape below is the module's own export list
 * (`three/examples/jsm/libs/mikktspace.module.js`).
 */
declare module 'three/addons/libs/mikktspace.module.js' {
  /** Resolves once the embedded wasm module has been instantiated. */
  export const ready: Promise<void>;
  /** True after {@link ready} settles. */
  export let isReady: boolean;
  export function generateTangents(
    position: Float32Array,
    normal: Float32Array,
    texcoord: Float32Array,
  ): Float32Array;
}
