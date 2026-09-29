import type { GodotBoundScript } from '../godot-frontend/bound-program';

/**
 * What a program asks of the SceneTree and the resources it preloads: whether it changes the
 * current scene (`change_scene_to_file`, `change_scene_to_packed`), reloads it
 * (`reload_current_scene`) or pauses the tree (`set_pause`, a store to `paused`), and the paths its
 * `preload`s resolve to.
 */
export interface BoundGodotTreeRequests {
  readonly changesScene: boolean;
  readonly reloadsScene: boolean;
  readonly pausesTree: boolean;
  readonly preloads: readonly string[];
}

export function treeRequests(script: GodotBoundScript): BoundGodotTreeRequests {
  const called = new Set<string>();
  const preloads = new Set<string>();
  let pausesTree = false;
  for (const node of script.nodes) {
    if (node.kind === 'CALL') called.add(node.functionName);
    if (node.kind === 'IDENTIFIER' && node.name === 'paused') pausesTree = true;
    if (node.kind === 'PRELOAD' && node.resolvedPath !== undefined) preloads.add(node.resolvedPath);
  }
  return {
    changesScene: called.has('change_scene_to_packed') || called.has('change_scene_to_file'),
    reloadsScene: called.has('reload_current_scene'),
    pausesTree: pausesTree || called.has('set_pause'),
    preloads: [...preloads].sort(),
  };
}
