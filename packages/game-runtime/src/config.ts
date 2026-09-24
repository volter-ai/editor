/**
 * Node-loadable engine APIs used while a project's Vite configuration is
 * evaluated. The package build emits this entry as ordinary JavaScript, so
 * project config remains package-native without asking Node to execute raw
 * TypeScript or reach into an adjacent checkout.
 *
 * A project's `*.schema.ts` is reached from `vite.config.ts` itself (through
 * `./src/data/assets`, so the dangling-ref gate can run the real Zod), which
 * is why every schema-time field factory belongs here: `dataRef` and `curve`
 * are both authored in a schema, and a schema module must stay loadable by
 * plain Node.
 */
export {
  type CurveAxes,
  type CurvePoint,
  type CurveValue,
  curve,
  sampleCurve,
} from './data/curve';
export { type DataRef, dataRef, getRef } from './data/data-ref';
export { type VgaiDataCheckOptions, vgaiDataCheck } from './data/vite-plugin-data';
