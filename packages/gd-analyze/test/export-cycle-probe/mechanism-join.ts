/**
 * export-cycle-probe/mechanism-join.ts — Godot row → host mechanism → Unity row.
 *
 * Both import lanes map into ONE host vocabulary. Cross-engine emit is a JOIN on that vocabulary:
 * a Godot member/class row names a host mechanism; the Unity row that names the same mechanism is
 * the component/member we emit. No join → the loss ledger, never a stash.
 *
 * Each row cites BOTH sides. Host keys are stable identifiers taken from the registries' `host`
 * sentences / battery titles, not invented wrappers.
 */

export type JoinKind = 'class' | 'member' | 'lifecycle' | 'impedance';

export interface MechanismJoin {
  readonly host: string;
  readonly godot: string;
  readonly godotCite: string;
  readonly unity: string;
  readonly unityCite: string;
  readonly kind: JoinKind;
  /** Present on `impedance`: the conversion is litigated and lossy; cite the conversion module. */
  readonly impedance?: string;
}

export const MECHANISM_JOINS: readonly MechanismJoin[] = [
  {
    host: 'THREE.Object3D',
    godot: 'Spatial / Position3D / Node (entity)',
    godotCite: 'packages/editor/catalog/project-source/src/lib/godot-compat/object-dispatch-3-three.ts Spatial / Node',
    unity: 'GameObject + Transform (!u!1 + !u!4)',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!1 GameObject, !u!4 Transform',
    kind: 'class',
    impedance:
      'A Godot node IS the entity; Unity splits GameObject + component list. The join emits both halves.',
  },
  {
    host: 'THREE.Object3D.position/quaternion/scale',
    godot: 'Spatial.transform / translation',
    godotCite: 'packages/editor/catalog/project-source/src/lib/godot-compat/object-dispatch-3-three.ts Spatial.transform',
    unity: 'Transform.m_LocalPosition / m_LocalRotation / m_LocalScale',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!4 Transform',
    kind: 'member',
  },
  {
    host: 'RAPIER.RigidBodyDesc.kinematicPositionBased',
    godot: 'KinematicBody / StaticBody',
    godotCite: 'packages/editor/catalog/project-source/src/lib/godot-compat/object-dispatch-3-three.ts KinematicBody',
    unity: 'Rigidbody m_IsKinematic=1 (!u!54)',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!54 Rigidbody',
    kind: 'class',
    impedance:
      "Godot's KinematicBody is a collide-and-slide driver (move_and_slide). Unity's kinematic Rigidbody does not slide; CharacterController is refused at class grain.",
  },
  {
    host: 'RAPIER.ColliderDesc.cuboid',
    godot: 'BoxShape.extents (half)',
    godotCite: 'packages/gd-analyze/src/translate/data/shape-dimensions.ts BoxShape',
    unity: 'BoxCollider.m_Size (full) (!u!65)',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!65 BoxCollider',
    kind: 'member',
  },
  {
    host: 'RAPIER.ColliderDesc.ball',
    godot: 'SphereShape.radius',
    godotCite: 'packages/gd-analyze/src/translate/data/shape-dimensions.ts SphereShape',
    unity: 'SphereCollider.m_Radius (!u!135)',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!135 SphereCollider',
    kind: 'member',
  },
  {
    host: 'RAPIER.ColliderDesc.capsule',
    godot: 'CylinderShape (Y cylinder, no caps)',
    godotCite: 'packages/gd-analyze/src/translate/data/shape-dimensions.ts CylinderShape',
    unity: 'CapsuleCollider (!u!136) m_Direction=1',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!136 CapsuleCollider',
    kind: 'impedance',
    impedance:
      'A Godot cylinder is not a capsule. Closest modeled Unity collider; hemispherical caps are extra. Cited conversions.ts cylinderToUnityCapsule.',
  },
  {
    host: 'THREE.Mesh (BoxGeometry / CylinderGeometry)',
    godot: 'MeshInstance + CubeMesh / CylinderMesh',
    godotCite: 'packages/gd-analyze/src/translate/emit/scene-module-3d.ts mesh primitives',
    unity: 'MeshFilter + MeshRenderer (!u!33 + !u!23) over BUILT_IN_MESHES',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!33 MeshFilter, BUILT_IN_MESHES',
    kind: 'class',
  },
  {
    host: 'THREE.PerspectiveCamera / OrthographicCamera',
    godot: 'Camera.projection / fov / size',
    godotCite: 'packages/gd-analyze Godot Camera node (spatial camera)',
    unity: 'Camera (!u!20) field of view / orthographic / orthographic size',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!20 Camera',
    kind: 'class',
  },
  {
    host: 'THREE.DirectionalLight',
    godot: 'DirectionalLight.shadow_enabled',
    godotCite: 'packages/gd-analyze DirectionalLight node',
    unity: 'Light (!u!108) m_Type=1, m_Shadows.m_Type',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!108 Light',
    kind: 'class',
  },
  {
    host: 'port createTimer (tree-ticked countdown)',
    godot: 'Timer.wait_time / autostart / stop',
    godotCite: 'packages/editor/catalog/project-source/src/lib/godot-compat/object-dispatch-3-canvas.ts Timer',
    unity: 'project MonoBehaviour Timer (waitTime, autostart) — Unity ships no Timer class',
    unityCite: 'no Unity class row; expressed as a project script, which is what a Unity game authors',
    kind: 'class',
  },
  {
    host: 'text content of a UI element',
    godot: 'Label.text',
    godotCite: 'packages/editor/catalog/project-source/src/lib/godot-compat/object-dispatch-3-canvas.ts Label.text',
    unity: 'project MonoBehaviour serialized `text` (uGUI Text is a package script; Canvas is refused)',
    unityCite: 'packages/unity-analyze/src/analyze/class-ids.ts Canvas refused; PACKAGE_SCRIPT_BACKENDS Text.m_Text',
    kind: 'impedance',
    impedance: 'Godot Control layout (anchors/margins) has no host solve; RectTransform is modeled but not-implemented.',
  },
  {
    host: 'lifecycle ready / first frame',
    godot: 'Node._ready',
    godotCite: 'packages/editor/catalog/project-source/src/lib/godot-compat/object-dispatch-3-canvas.ts Node',
    unity: 'MonoBehaviour.Start',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!114 MonoBehaviour LIFECYCLE',
    kind: 'lifecycle',
  },
  {
    host: 'lifecycle per-frame',
    godot: 'Node._process',
    godotCite: 'packages/gd-analyze Node._process',
    unity: 'MonoBehaviour.Update',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!114 MonoBehaviour LIFECYCLE',
    kind: 'lifecycle',
  },
  {
    host: 'lifecycle physics tick',
    godot: 'Node._physics_process',
    godotCite: 'packages/gd-analyze Node._physics_process / set_physics_process emitter-resolved',
    unity: 'MonoBehaviour.FixedUpdate',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!114 MonoBehaviour LIFECYCLE',
    kind: 'lifecycle',
  },
  {
    host: 'InputManager polled action',
    godot: 'Input.is_action_pressed / InputEvent.is_action_pressed (emitter-resolved)',
    godotCite: 'packages/gd-analyze/src/registry/emitter-resolved.ts InputEvent.is_action_pressed',
    unity: 'Input.GetButton / Input.GetButtonDown',
    unityCite: 'packages/unity-analyze/src/translate/data/members.ts Input.GetAxis / InputManager',
    kind: 'member',
  },
  {
    host: 'PrefabInstance of a project prefab',
    godot: 'PackedScene instance= ExtResource',
    godotCite: 'packages/gd-analyze/src/read/godot-types.ts SceneNode.instanceOf',
    unity: 'PrefabInstance (!u!1001) + stripped Transform',
    unityCite: 'packages/unity-analyze/src/registry/backend-registry.data.ts !u!1001 PrefabInstance',
    kind: 'class',
  },
  {
    host: 'audio emitter',
    godot: 'AudioStreamPlayer',
    godotCite: 'packages/gd-analyze AudioStreamPlayer node',
    unity: 'AudioSource (!u!82) — modeled Web Audio player',
    unityCite: 'packages/unity-analyze/src/analyze/class-ids.ts !u!82 AudioSource',
    kind: 'class',
  },
];

export function joinByGodot(fragment: string): MechanismJoin | undefined {
  return MECHANISM_JOINS.find((row) => row.godot.includes(fragment));
}

export function joinByHost(host: string): MechanismJoin | undefined {
  return MECHANISM_JOINS.find((row) => row.host === host);
}

export interface UsedJoin {
  readonly join: MechanismJoin;
  readonly at: string;
}

export function formatJoinTable(used: readonly UsedJoin[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const { join, at } of used) {
    const key = `${join.godot} → ${join.unity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `${join.kind.toUpperCase()} host=${join.host}\n  godot: ${join.godot} (${join.godotCite})\n  unity: ${join.unity} (${join.unityCite})\n  e.g. ${at}` +
        (join.impedance === undefined ? '' : `\n  IMPEDANCE ${join.impedance}`),
    );
  }
  return lines.join('\n');
}
