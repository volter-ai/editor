/**
 * The packages a game's own generated modules (its scenes, scripts, world and data) import, beside
 * the capability files': three, React and React DOM, R3F, drei, Rapier, `tunnel-rat`, which carries
 * a scene's Controls to the page beside the Canvas, and `its-fine`, whose bridge carries the
 * contexts of their place with them. Emit refuses a generated
 * module that imports any other (`emit/index.ts`), and the plan keeps these declared however few
 * capability files the game reaches (`artifacts/plan.ts`).
 */
export const GODOT_GENERATED_MODULE_PACKAGES: ReadonlySet<string> = new Set([
  'three',
  'react',
  'react-dom',
  '@react-three/fiber',
  '@react-three/drei',
  '@react-three/rapier',
  '@dimforge/rapier3d-compat',
  'tunnel-rat',
  'its-fine',
]);

/** The package a bare import specifier names: its scope and name, or its first segment. */
export function godotImportPackage(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] as string);
}
