/**
 * The sole public build-time Godot operation. Compiler phases are implementation details and are
 * deliberately unavailable as package entrypoints, so callers cannot assemble an alternate
 * semantic pipeline. Runtime projects never import this package.
 */
export { type ImportGodotProjectOptions, importGodotProject } from './import-project';
