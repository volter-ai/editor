/**
 * export-cycle-probe/loss-ledger.ts — members the Godot→IR→Godot cycle cannot restore.
 *
 * Reasons are one of: the model does not hold it / the emitter has no spelling / writer
 * normalization (Godot or our pretty-printer would rewrite it even from a complete model).
 */
export interface LossEntry {
  readonly member: string;
  readonly reason: 'model-does-not-hold' | 'emitter-gap' | 'writer-normalization';
  readonly notes: string;
}

export const LOSS_LEDGER: readonly LossEntry[] = [
  {
    member: 'ScriptFile source text / comments / warning-ignore pragmas',
    reason: 'model-does-not-hold',
    notes:
      'readGodotProject parses `.gd` into a lang36 AST and discards the bytes. The cycle pretty-prints the AST. Comments are gone. Semantic members the AST holds (export, signals, funcs, $paths) survive — measured: pretty-print re-parses and the closed-loop port is 0 hunks.',
  },
  {
    member:
      'project.godot config/description, config/icon, window/size/test_*, [layer_names], vram_compression/*',
    reason: 'model-does-not-hold',
    notes:
      'project-settings.ts lifts only the keys a translator reads. Squash authors all of these; none reach GodotProject. They do not move the port.',
  },
  {
    member:
      'ImportSidecar: [remap] dest path, Godot 3 animation/clip_* tables, unread importer options',
    reason: 'model-does-not-hold',
    notes:
      'GodotSceneImportParams (root_type, fps, naming_version, loop modes, suffix flags, root scale) now live on ImportSidecar.sceneParams and the cycle emits them. Remap dest is Godot cache, not consumed. G3 clip tables are unread (squash amount=0). The other ~90 importer options have no reader.',
  },
  {
    member: 'ogg import loop=true / texture importer keys beyond sampler flags',
    reason: 'model-does-not-hold',
    notes:
      'House In a Forest Loop.ogg.import authors loop=true. ImportSidecar does not hold it. The translator does not read it either — the closed loop is silent.',
  },
  {
    member: 'ResourceDocument.format / load_steps / project.godot comment header',
    reason: 'model-does-not-hold',
    notes:
      'format is inferred from engine.major (2 on Godot 3). load_steps is recomputed. Reader ignores both.',
  },
  {
    member: 'InputEventBinding string/null fields (resource_name, script)',
    reason: 'model-does-not-hold',
    notes:
      'readInputActions keeps only number|bool fields. Re-emitting those reconstructs the same model.',
  },
  {
    member: 'ScriptFile.bytes / lineCount / AST line numbers',
    reason: 'writer-normalization',
    notes:
      'Pretty-printed GDScript is shorter (no comments). compare-models strips these on purpose.',
  },
  {
    member: 'Godot 4.7 script load of Godot 3 `export` / KinematicBody',
    reason: 'writer-normalization',
    notes:
      'The box Godot is 4.7.1. --import builds the asset cache (exit 0) then the editor parse of Godot 3 GDScript fails — on the ORIGINAL fixture too. Not a cycle loss. Driving frames is not feasible without a Godot 3 binary or a converter pass.',
  },
];
