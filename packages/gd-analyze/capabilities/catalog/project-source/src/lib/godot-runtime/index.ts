/**
 * Godot port runtime — copied project machinery, separate from Godot API compatibility.
 *
 * Compat binds translated Godot-shaped calls to native libraries. This capability owns the port's
 * actual mounted stores and project-scoped surface scheduler factory. The translator may bind a
 * scene to these exports, but must never print another implementation of them.
 */
export * from './input-rig';
export * from './observation';
export * from './packed-array-codecs';
export * from './physics-system';
export * from './postprocessing';
export * from './preview-context';
export * from './runtime';
export * from './scene-lifecycle';
