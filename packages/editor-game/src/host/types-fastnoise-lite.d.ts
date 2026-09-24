/**
 * Ambient declaration for `fastnoise-lite`, which ships no types. It enters
 * the editor only through the browser dependency table
 * (`served-bundle-runtime-modules.ts`) so a hosted project importing it — the
 * Godot compat noise protocols do — resolves; the editor never calls into it.
 */
declare module 'fastnoise-lite';
