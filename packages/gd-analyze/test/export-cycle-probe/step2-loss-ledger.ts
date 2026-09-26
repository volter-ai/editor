/**
 * export-cycle-probe/step2-loss-ledger.ts — Godot → Unity → Godot losses.
 *
 * Reasons: no-join (no Unity row on the same host mechanism), structural-impedance (the join
 * exists but the engines split the fact differently), writer-normalization (pretty-print / YAML
 * spelling), model-does-not-hold (already a step-1 hole).
 */
export type Step2Reason =
  | 'no-join'
  | 'structural-impedance'
  | 'writer-normalization'
  | 'model-does-not-hold';

export interface Step2Loss {
  readonly member: string;
  readonly reason: Step2Reason;
  readonly notes: string;
}

export const STEP2_STANDING_LOSSES: readonly Step2Loss[] = [
  {
    member: 'ScriptFile source text / comments / warning-ignore pragmas',
    reason: 'model-does-not-hold',
    notes: 'Carried from step 1. The AST is the source; C# pretty-print is another writer.',
  },
  {
    member: 'project.godot unread keys (description, icon, test window, layer_names, vram_*)',
    reason: 'model-does-not-hold',
    notes: 'Step 1: the Godot model does not hold them, so the Unity hop cannot invent them.',
  },
  {
    member: 'ImportSidecar remap dest / unread importer options',
    reason: 'model-does-not-hold',
    notes: 'Scene-import params that ARE on the IR (rootType, animationFps) have no Unity ModelImporter twin for rootType; animation fps is a standing Unity ModelImporter field we do not yet write.',
  },
  {
    member: 'Godot node = Unity GameObject + component split',
    reason: 'structural-impedance',
    notes: 'Cited MECHANISM_JOINS THREE.Object3D. Invert reconstitutes one node per GameObject.',
  },
  {
    member: 'CylinderShape ↔ CapsuleCollider (caps, axes)',
    reason: 'structural-impedance',
    notes: 'Cited conversions.ts cylinderToUnityCapsule and Unity !u!136. A cylinder is not a capsule.',
  },
  {
    member: 'Basis handedness (Godot/three right-handed −Z vs Unity left-handed +Z)',
    reason: 'structural-impedance',
    notes: 'Cited packages/unity-analyze/src/translate/data/basis.ts M=diag(1,1,-1). The hop applies M; invert applies M again.',
  },
  {
    member: 'BoxShape.extents (half) ↔ BoxCollider.m_Size (full)',
    reason: 'structural-impedance',
    notes: 'Cited shape-dimensions.ts. The conversion is exact and composes.',
  },
  {
    member: 'AnimationPlayer tracks / Path+Curve3D / VisibilityNotifier',
    reason: 'no-join',
    notes: 'No Unity class row on a shared host mechanism. Emitted as empty GameObjects so names survive.',
  },
  {
    member: 'Control anchors/margins/theme; PackedScene .glb instance internals',
    reason: 'no-join',
    notes: 'uGUI Canvas is refused; RectTransform is not-implemented. .glb internals are Unity importer output, not project YAML.',
  },
  {
    member: 'KinematicBody.move_and_slide / get_slide_* / is_on_floor',
    reason: 'no-join',
    notes: 'Host is Rapier KCC. Unity CharacterController is refused (driver, not a modeled collider). C# keeps the Godot spelling so invert restores the AST call.',
  },
  {
    member: 'Autoload MusicPlayer',
    reason: 'no-join',
    notes: 'Unity has no autoload. MusicPlayer.unity is emitted as a scene; invert does not re-register [autoload].',
  },
  {
    member: 'PackedScene export / instance() — mob_scene',
    reason: 'no-join',
    notes:
      'Main.gd `export(PackedScene) var mob_scene` is a Godot resource reference. The Unity hop writes a SerializeField GameObject; invert does not restore an ExtResource, so mob_scene is undefined on the cycled Main.tscn. Closed-loop translate refuses at res://Main.gd:13 <unknown>.instance(...) — that is THIS row, not MusicPlayer/AudioStreamPlayer.',
  },
  {
    member: 'Signal connections (hit, timeout, body_entered, screen_exited, squashed)',
    reason: 'no-join',
    notes: 'UnityEvent persistent calls are native but a different grain than Godot [connection] lines. Not emitted; invert cannot restore them.',
  },
];
