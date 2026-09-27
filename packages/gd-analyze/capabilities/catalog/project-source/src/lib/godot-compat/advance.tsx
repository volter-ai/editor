/**
 * @godot-class Node
 * @role PROTOCOL
 *
 * A node that advances itself (an animation player, a particle system) does it from its own
 * component's hooks: the host's `useFrame` for its internal processing and `useBeforePhysicsStep`
 * for its internal physics processing, as a three.js component animates itself. The only hooks
 * compat takes from the host, each advancing one node: compat never drives other nodes' work from
 * the frame (docs/GODOT.md §The lane's law, row 4). The SceneTree advances the same way, from the
 * world's component (`useGodotTree`): its own frames, timers, tweens and deletion queue.
 */

import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { useLayoutEffect } from 'react';
import { get_physics_process_delta_time, godot_node_advance } from './node';
import { godot_tree_physics_begin, godot_tree_physics_end, godot_tree_process_begin, godot_tree_process_end } from './scene-tree';

/**
 * Runs one node's own internal processing from its component's frame and physics step.
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1219
 */
export function useGodotAdvance(entity: object): void {
  useFrame((_, delta) => godot_node_advance(entity, false, delta));
  useBeforePhysicsStep(() => godot_node_advance(entity, true, get_physics_process_delta_time(entity)));
}

/**
 * The SceneTree's frames on the host's clock, from the world's component: each Rapier step begins
 * and ends its physics frame, each R3F frame begins and ends its process frame, so timers, tweens
 * and the deletion queue run after the scripts' own hooks, as `SceneTree::physics_process` and
 * `SceneTree::process` run them after the nodes. Registered from a layout effect, the step's begin
 * is its first callback, and the frame's begin runs first by its priority.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:639
 */
export function useGodotTree(): void {
  const rapier = useRapier();
  useLayoutEffect(() => {
    const begin = { current: (world: { readonly timestep: number }) => godot_tree_physics_begin(world.timestep) };
    const end = { current: () => godot_tree_physics_end() };
    rapier.beforeStepCallbacks.add(begin as never);
    rapier.afterStepCallbacks.add(end as never);
    return () => {
      rapier.beforeStepCallbacks.delete(begin as never);
      rapier.afterStepCallbacks.delete(end as never);
    };
  }, [rapier]);
  useFrame((_, delta) => godot_tree_process_begin(delta), -1);
  useFrame(() => godot_tree_process_end());
}
