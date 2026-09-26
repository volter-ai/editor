/** The static observation declaration the translated root re-exports for the current host door. */
import {
  godotCensus,
  godotInputBinding,
  godotSettled,
  reloadGodotScene,
} from './runtime';

export const debug = {
  commands: {
    'godot.reload_current_scene': {
      description:
        'get_tree().reload_current_scene() — free the running main scene and mount a fresh one.',
      run: reloadGodotScene,
    },
  },
  state: { godot: godotCensus },
  input: godotInputBinding(),
  settled: godotSettled,
};
