/**
 * @godot-class Node
 * @role PROTOCOL
 *
 * A node that advances itself (an animation player, a particle system) does it from its own
 * component's hooks: the host's `useFrame` for its internal processing and `useBeforePhysicsStep`
 * for its internal physics processing, as a three.js component animates itself. The only hooks
 * compat takes from the host, each advancing one node: compat never drives other nodes' work from
 * the frame (docs/GODOT.md §The lane's law, row 4).
 */

import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep } from '@react-three/rapier';
import { get_physics_process_delta_time, godot_node_advance } from './node';

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
