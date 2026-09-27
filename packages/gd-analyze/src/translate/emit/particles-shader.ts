/**
 * The particles shader mode's built-ins as Godot's Compatibility renderer names them in its
 * particle process pass (`drivers/gles3/storage/material_storage.cpp:1461-1495`), which is the
 * vendored `particles.glsl` (`gpu-particles-3d.ts`) the lowered `start()` and `process()` bodies are
 * placed into, at `#CODE : START` and `#CODE : PROCESS`. `PI`, `TAU` and `E` are the renderer's
 * literal text (`String::num`, 14 decimals). Sub-emitters (`emit_subparticle`, the `FLAG_EMIT_*`
 * constants) are stubbed there too; they are not carried, and a shader that names one refuses.
 */
import type { GodotShaderBuiltins } from './shader-glsl';

export const GODOT_PARTICLES_SHADER_BUILTINS: GodotShaderBuiltins = {
  COLOR: 'out_color',
  VELOCITY: 'out_velocity_flags.xyz',
  MASS: 'mass',
  ACTIVE: 'particle_active',
  RESTART: 'restart',
  CUSTOM: 'out_custom',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`USERDATA${String(n)}`, `out_userdata${String(n)}`])),
  TRANSFORM: 'xform',
  TIME: 'time',
  PI: '3.14159265358979',
  TAU: '6.28318530717959',
  E: '2.71828182845905',
  LIFETIME: 'lifetime',
  DELTA: 'local_delta',
  NUMBER: 'particle_number',
  INDEX: 'index',
  AMOUNT_RATIO: 'amount_ratio',
  EMISSION_TRANSFORM: 'emission_transform',
  RANDOM_SEED: 'random_seed',
  RESTART_POSITION: 'restart_position',
  RESTART_ROT_SCALE: 'restart_rotation_scale',
  RESTART_VELOCITY: 'restart_velocity',
  RESTART_COLOR: 'restart_color',
  RESTART_CUSTOM: 'restart_custom',
  COLLIDED: 'collided',
  COLLISION_NORMAL: 'collision_normal',
  COLLISION_DEPTH: 'collision_depth',
  ATTRACTOR_FORCE: 'attractor_force',
  EMITTER_VELOCITY: 'emitter_velocity',
  INTERPOLATE_TO_END: 'interp_to_end',
};

/** The particles render modes and the defines they set (`material_storage.cpp:1506-1509`). */
export const GODOT_PARTICLES_RENDER_MODE_DEFINES: Readonly<Record<string, string>> = {
  disable_force: 'DISABLE_FORCE',
  disable_velocity: 'DISABLE_VELOCITY',
  keep_data: 'ENABLE_KEEP_DATA',
  collision_use_scale: 'USE_COLLISION_SCALE',
};
