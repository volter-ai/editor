/**
 * Godot's dynamic `Object` protocol over the translated project's own objects.
 *
 * ## What remains dynamic
 *
 * Literal native properties and methods still lose their string at emission: the emitter resolves
 * them through the same covered member row a direct access uses. Computed names cross a generated,
 * exact-runtime-class table whose entries call those same covered backends. Translated script
 * members take Godot's ScriptInstance-first path, while unregistered identities and declared but
 * uncovered ClassDB names refuse loudly. Generic reflection must never bypass renderer aliases.
 * Godot Dictionaries and Callables remain the compat protocol's own values.
 *
 * `has_method` is the same dynamic question without invocation: the receiver is not a compile-time
 * fact, so object.ts reads the translated object's real method rather than consulting a table.
 *
 * ## Why script names survive here
 *
 * Because it is still the method's real name. A GDScript `func collect_coin()` becomes a TS method
 * `collect_coin()` — `translate/model.ts`'s `safeIdent` changes a name only when it collides with
 * a JS reserved word — so the literal in the script and the property on the emitted class are the
 * same string. That is a fact about the emitter, and it is why script-owned names read the emitted
 * object before the shared native table is consulted.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing. **Shares:** the object, which is the caller's. **Teardown:** none.
 */

import { GodotCallable, godotCallableCall } from './callable';
import { godotDictionaryCall } from './dictionary-protocol';
import { godotInstanceId } from './gdscript-builtins';
import { type GodotNodePath, godotNodePathNew, godotNodePathString } from './node-path';
import {
  isGodotObjectFreed,
  linkGodotObjectLifetime,
  markGodotObjectFreed,
} from './object-liveness';
import { type PackedStringArray, packedStringArray } from './packed-array';
import {
  createSignal,
  emitRetainedGodotSignal,
  type GodotSignal,
  isRetainedGodotSignal,
} from './signal';

export type GodotObjectDeferredHook = (invoke: () => void) => void;

/** One native property row, shared at module scope by every instance of its Godot class. */
export interface GodotObjectPropertyDispatch {
  readonly get?: (binding: GodotObjectBinding) => unknown;
  readonly set?: (binding: GodotObjectBinding, value: unknown) => void;
  readonly result?: 'scene' | 'scene-array';
}

/** One native method row, shared at module scope by every instance of its Godot class. */
export interface GodotObjectMethodDispatch {
  readonly call: (binding: GodotObjectBinding, args: readonly unknown[]) => unknown;
  readonly result?: 'scene' | 'scene-array';
}

/**
 * A generated class table. `null` means ClassDB declares the name but no covered dynamic backend
 * can answer it; `undefined` means the class does not declare it. That distinction is what keeps a
 * genuinely absent get/set nil/no-op while an uncovered real member refuses loudly.
 */
export interface GodotObjectClassDispatch {
  /** ClassDB construction may consume the translated world's ordinary scene context. */
  readonly construct?: (context: unknown, args: readonly unknown[]) => unknown;
  readonly properties: Readonly<Record<string, GodotObjectPropertyDispatch | null>>;
  /** ClassDB signal names only; kept separate so signal lookup never executes an ordinary getter. */
  readonly signals: Readonly<Record<string, GodotObjectPropertyDispatch | null>>;
  readonly methods: Readonly<Record<string, GodotObjectMethodDispatch | null>>;
}

/** Resolve one source-proven ClassDB row without weakening a generated dispatch table's open shape. */
export function requireGodotObjectClassDispatch(
  table: Readonly<Record<string, GodotObjectClassDispatch>>,
  godotClass: string,
): GodotObjectClassDispatch {
  const dispatch = table[godotClass];
  if (dispatch === undefined) {
    throw new Error(`godot-compat: Object dispatch table has no ClassDB row for ${godotClass}.`);
  }
  return dispatch;
}

/** Tiny per-instance metadata; all executable dispatch lives in the shared class table above. */
export interface GodotObjectBinding {
  readonly godotClass: string;
  readonly value: object;
  readonly native: unknown;
  readonly scene?: unknown;
  /** SceneContext for node backends. Absent by construction on Resource/RefCounted bindings. */
  readonly context?: unknown;
  readonly dispatch: GodotObjectClassDispatch;
  /** One source-derived set shared by every instance of a translated script class. */
  readonly scriptMembers?: ReadonlySet<string>;
  /** Authored signal name -> collision-safe emitted handle field. */
  readonly scriptSignals?: Readonly<Record<string, string>>;
  /** Exact translated Script resource attached to this instance, when it has one. */
  readonly script?: GodotScriptResource;
}

export interface GodotScriptResource {
  readonly resource_path: string;
  readonly resource_name: string;
  readonly godot_base_class: string;
  readonly can_instantiate: true;
  readonly global_name: string;
  readonly base_script_path: string;
  source_code: string;
  reload(keepState?: boolean): never;
}

/** Execute the translated class allocation followed by GDScript's `_init` constructor hook. */
export function godotConstructTranslatedScript<T extends object>(
  create: () => T,
  args: readonly unknown[] = [],
): T {
  const instance = create();
  const initializer = Reflect.get(instance, '_init');
  if (initializer === undefined) {
    if (args.length > 0) {
      throw new TypeError(
        `godot-compat: translated script constructor received ${args.length} argument(s), but declares no _init.`,
      );
    }
    return instance;
  }
  if (typeof initializer !== 'function') {
    throw new TypeError('godot-compat: translated script _init member is not callable.');
  }
  Reflect.apply(initializer, instance, [...args]);
  return instance;
}

const SCRIPT_RESOURCES_BY_PATH = new Map<string, GodotScriptResource>();
const SCRIPT_FACTORIES = new WeakMap<
  GodotScriptResource,
  (args: readonly unknown[], context?: unknown) => object
>();

/** Attach the emitted class constructor to its module-static Script resource identity. */
export function bindGodotScriptFactory(
  script: GodotScriptResource,
  factory: (args: readonly unknown[], context?: unknown) => object,
): void {
  if (SCRIPT_FACTORIES.has(script)) {
    throw new Error(
      `Translated Script ${script.resource_path || '<dynamic>'} already has an instance factory.`,
    );
  }
  SCRIPT_FACTORIES.set(script, factory);
}

/** `some_script.new(args...)` constructs the emitted class and runs its `_init` hook. */
export function godotScriptNew(
  script: unknown,
  args: readonly unknown[],
  context?: unknown,
): object {
  const object = requireObject(script, 'Script.new');
  const factory = SCRIPT_FACTORIES.get(object as GodotScriptResource);
  if (factory === undefined) {
    const path = (object as Partial<GodotScriptResource>).resource_path;
    throw new Error(
      `godot-compat: Script.new has no translated class factory for ${typeof path === 'string' && path !== '' ? path : '<dynamic GDScript>'}.`,
    );
  }
  return factory(args, context);
}

export function godotScriptResourceByPath(resourcePath: string): GodotScriptResource {
  const resource = SCRIPT_RESOURCES_BY_PATH.get(resourcePath);
  if (resource === undefined) {
    throw new Error(`No translated Script resource is registered for ${resourcePath}.`);
  }
  return resource;
}

const objectBindings = new WeakMap<object, GodotObjectBinding>();
const scriptValuesByNative = new WeakMap<object, object>();
const nativeReleases = new WeakMap<object, Set<() => void>>();
const objectMetadata = new WeakMap<object, Map<string, unknown>>();
const propertyListRevisions = new WeakMap<object, number>();
const userSignals = new WeakMap<object, Map<string, readonly GodotPropertyInfo[]>>();
const referenceCounts = new WeakMap<object, number>();
const signalBlockingObjects = new WeakSet<object>();
const messageTranslationDisabledObjects = new WeakSet<object>();
const objectTranslationDomains = new WeakMap<object, string>();

/** Object's retained signal-blocking bit; Godot drops emissions while this is enabled. */
export function godotObjectIsBlockingSignals(receiver: unknown): boolean {
  return signalBlockingObjects.has(requireObject(receiver, 'is_blocking_signals'));
}

export function godotObjectSetBlockSignals(receiver: unknown, enabled: unknown): void {
  const object = requireObject(receiver, 'set_block_signals');
  if (typeof enabled !== 'boolean') {
    throw new TypeError('godot-compat: Object.set_block_signals requires a bool.');
  }
  if (enabled) signalBlockingObjects.add(object);
  else signalBlockingObjects.delete(object);
}

/** Object's `_can_translate` bit defaults true in both Godot 3 and 4. */
export function godotObjectCanTranslateMessages(receiver: unknown): boolean {
  return !messageTranslationDisabledObjects.has(requireObject(receiver, 'can_translate_messages'));
}

export function godotObjectSetMessageTranslation(receiver: unknown, enabled: unknown): void {
  const object = requireObject(receiver, 'set_message_translation');
  if (typeof enabled !== 'boolean') {
    throw new TypeError('godot-compat: Object.set_message_translation requires a bool.');
  }
  if (enabled) messageTranslationDisabledObjects.delete(object);
  else messageTranslationDisabledObjects.add(object);
}

/** Godot 4's per-Object TranslationDomain name; the empty domain is the default server domain. */
export function godotObjectGetTranslationDomain(receiver: unknown): string {
  return objectTranslationDomains.get(requireObject(receiver, 'get_translation_domain')) ?? '';
}

export function godotObjectSetTranslationDomain(receiver: unknown, domain: unknown): void {
  const object = requireObject(receiver, 'set_translation_domain');
  if (typeof domain !== 'string') {
    throw new TypeError('godot-compat: Object.set_translation_domain requires a StringName.');
  }
  if (domain === '') objectTranslationDomains.delete(object);
  else objectTranslationDomains.set(object, domain);
}

/** Deliver Object.notification to the translated ScriptInstance virtual retained on this identity. */
export function godotObjectNotification(receiver: unknown, what: unknown, reversed = false): void {
  if (!Number.isSafeInteger(what)) {
    throw new TypeError('godot-compat: Object.notification requires an integer notification code.');
  }
  if (typeof reversed !== 'boolean') {
    throw new TypeError('godot-compat: Object.notification reversed requires a bool.');
  }
  void godotCallScriptVirtual(receiver, '_notification', [what]);
}

/** Retain destruction owned by one native Godot Object without conflating detach with free. */
export function registerGodotObjectNativeRelease(native: object, release: () => void): () => void {
  const releases = nativeReleases.get(native) ?? new Set<() => void>();
  releases.add(release);
  nativeReleases.set(native, releases);
  return () => {
    releases.delete(release);
    if (releases.size === 0) nativeReleases.delete(native);
  };
}

/** Run and forget one native Object's retained destruction callbacks exactly once. */
export function releaseGodotObjectNativeBindings(native: object): void {
  const releases = nativeReleases.get(native);
  if (releases === undefined) return;
  nativeReleases.delete(native);
  for (const release of [...releases].reverse()) release();
}
const IDENTITY_ONLY_DISPATCH: GodotObjectClassDispatch = {
  properties: {},
  signals: {},
  methods: {},
};

/** Whether a value already carries retained Godot ClassDB/script identity. */
export function godotObjectHasBinding(receiver: unknown): receiver is object {
  return typeof receiver === 'object' && receiver !== null && objectBindings.has(receiver);
}

/** Runtime base Object/RefCounted constructors for non-render identities. */
export function createGodotPlainObject(godotClass: 'Object' | 'Reference' | 'RefCounted'): object {
  const value = {};
  registerGodotObjectIdentity(value, godotClass);
  if (godotClass === 'Reference' || godotClass === 'RefCounted') referenceCounts.set(value, 1);
  return value;
}

/** Initializes a detached reference-counted identity exactly once. */
export function godotRefCountedInitRef(receiver: unknown): boolean {
  const object = requireObject(receiver, 'init_ref');
  const count = referenceCounts.get(object) ?? 0;
  if (count !== 0) return false;
  referenceCounts.set(object, 1);
  return true;
}

/** Acquires one strong Godot reference while the retained identity remains live. */
export function godotRefCountedReference(receiver: unknown): boolean {
  const object = requireObject(receiver, 'reference');
  const count = referenceCounts.get(object) ?? 0;
  if (count >= 0x7fffffff)
    throw new RangeError('godot-compat: RefCounted reference count overflow.');
  referenceCounts.set(object, count + 1);
  return true;
}

/** Releases one strong reference and reports whether the identity reached zero. */
export function godotRefCountedUnreference(receiver: unknown): boolean {
  const object = requireObject(receiver, 'unreference');
  const count = referenceCounts.get(object) ?? 1;
  if (count <= 0)
    throw new Error('godot-compat: RefCounted.unreference called with no live reference.');
  const next = count - 1;
  referenceCounts.set(object, next);
  if (next !== 0) return false;
  markGodotObjectFreed(object);
  return true;
}

/** Returns the retained strong-reference count visible to Godot 4 scripts. */
export function godotRefCountedGetReferenceCount(receiver: unknown): number {
  const object = requireObject(receiver, 'get_reference_count');
  return referenceCounts.get(object) ?? 1;
}

/** Stable nonzero ObjectID identity. Godot intentionally exposes no semantic meaning in the bits. */
export function godotObjectInstanceId(value: unknown): bigint {
  return godotInstanceId(requireObject(value, 'get_instance_id'));
}

/**
 * Native ClassDB ancestry for the engine identities reached by the translated corpus. This is the
 * same engine-class carrier used by Object's dynamic binding and `node is EngineClass`; script
 * `class_name` values deliberately do not enter this table because Object::get_class/is_class ask
 * the native type hierarchy in both pinned engines.
 */
const GODOT_CLASS_PARENTS_3: Readonly<Record<string, string>> = {
  ARVRCamera: 'Camera',
  ARVRController: 'Spatial',
  ARVROrigin: 'Spatial',
  AudioEffectCapture: 'AudioEffect',
  AudioEffectEQ: 'AudioEffect',
  AudioStreamMicrophone: 'AudioStream',
  EditorSettings: 'Resource',
  GDNativeLibrary: 'Resource',
  NativeScript: 'Script',
  HashingContext: 'Reference',
  Particles2D: 'Node2D',
  ParticlesMaterial: 'Material',
  Material: 'Resource',
  SpatialMaterial: 'Material',
  CanvasItemMaterial: 'Material',
  Shader: 'Resource',
  ShaderMaterial: 'Material',
  PhysicsMaterial: 'Resource',
  CryptoKey: 'Resource',
  X509Certificate: 'Resource',
  Mesh: 'Resource',
  PrimitiveMesh: 'Mesh',
  CapsuleMesh: 'PrimitiveMesh',
  PlaneMesh: 'PrimitiveMesh',
  PrismMesh: 'PrimitiveMesh',
  ShortCut: 'Resource',
  Theme: 'Resource',
  Font: 'Resource',
  BitmapFont: 'Font',
  DynamicFont: 'Font',
  DynamicFontData: 'Resource',
  StyleBox: 'Resource',
  StyleBoxFlat: 'StyleBox',
  StyleBoxEmpty: 'StyleBox',
  StyleBoxLine: 'StyleBox',
  StyleBoxTexture: 'StyleBox',
  HTTPClient: 'Reference',
  HTTPRequest: 'Node',
  Tween: 'Node',
  PacketPeer: 'Reference',
  Crypto: 'Reference',
  Thread: 'Reference',
  Semaphore: 'Reference',
  PhysicsShapeQueryParameters: 'Reference',
  Physics2DDirectBodyState: 'Object',
  StreamPeer: 'Reference',
  StreamPeerBuffer: 'StreamPeer',
  NetworkedMultiplayerPeer: 'PacketPeer',
  WebSocketMultiplayerPeer: 'NetworkedMultiplayerPeer',
  WebSocketClient: 'WebSocketMultiplayerPeer',
  WebSocketServer: 'WebSocketMultiplayerPeer',
  WebSocketPeer: 'PacketPeer',
  TCPServer: 'Reference',
  WebRTCPeerConnection: 'Reference',
  WebRTCDataChannel: 'PacketPeer',
  WebRTCMultiplayer: 'NetworkedMultiplayerPeer',
  MultiplayerAPI: 'Reference',
  Animation: 'Resource',
  AnimationLibrary: 'Resource',
  Curve3D: 'Resource',
  Path: 'Spatial',
  SpriteFrames: 'Resource',
  AnimationPlayer: 'Node',
  AnimationNode: 'Resource',
  AnimationRootNode: 'AnimationNode',
  AnimationNodeSync: 'AnimationNode',
  AnimationNodeAnimation: 'AnimationRootNode',
  AnimationNodeTransition: 'AnimationNodeSync',
  AnimationNodeTimeScale: 'AnimationNode',
  AnimationNodeTimeSeek: 'AnimationNode',
  AnimationNodeBlendSpace1D: 'AnimationNodeSync',
  AnimationNodeBlendSpace2D: 'AnimationNodeSync',
  AnimationNodeStateMachine: 'AnimationNode',
  AnimationNodeStateMachineTransition: 'Resource',
  AnimationNodeBlendTree: 'AnimationRootNode',
  AnimationNodeBlend2: 'AnimationNodeSync',
  AnimationNodeBlend3: 'AnimationNodeSync',
  AnimationNodeAdd2: 'AnimationNodeSync',
  AnimationNodeAdd3: 'AnimationNodeSync',
  AnimationNodeSub2: 'AnimationNodeSync',
  AnimationNodeOneShot: 'AnimationNodeSync',
  AnimationNodeStateMachinePlayback: 'Resource',
  BitMap: 'Resource',
  File: 'Reference',
  Image: 'Reference',
  Texture: 'Resource',
  ViewportTexture: 'Texture',
  ImageTexture: 'Texture',
  AtlasTexture: 'Texture',
  AnimatedTexture: 'Texture',
  CameraTexture: 'Texture',
  CanvasTexture: 'Texture',
  LargeTexture: 'Texture',
  MeshTexture: 'Texture',
  ProxyTexture: 'Texture',
  AStar: 'Reference',
  AStar2D: 'Reference',
  Area2D: 'CollisionObject2D',
  AudioStreamPlayer: 'Node',
  AudioStreamPlayer2D: 'Node2D',
  AudioStreamPlayer3D: 'Spatial',
  Listener: 'Spatial',
  AudioEffect: 'Resource',
  AudioEffectPitchShift: 'AudioEffect',
  AudioEffectLimiter: 'AudioEffect',
  AudioEffectHardLimiter: 'AudioEffect',
  AudioEffectSpectrumAnalyzer: 'AudioEffect',
  AudioEffectSpectrumAnalyzerInstance: 'Reference',
  VideoStream: 'Resource',
  VideoStreamTheora: 'VideoStream',
  VideoPlayer: 'Control',
  CanvasItem: 'Node',
  CanvasLayer: 'Node',
  CanvasGroup: 'Node2D',
  CanvasModulate: 'Node2D',
  MenuBar: 'Control',
  BackBufferCopy: 'Node2D',
  RemoteTransform2D: 'Node2D',
  VisibleOnScreenNotifier2D: 'Node2D',
  VisibleOnScreenEnabler2D: 'VisibleOnScreenNotifier2D',
  Bone2D: 'Node2D',
  CollisionObject: 'Spatial',
  CollisionObject2D: 'Node2D',
  CollisionShape: 'Spatial',
  CollisionPolygon: 'Spatial',
  CollisionShape2D: 'Node2D',
  Light: 'VisualInstance',
  DirectionalLight: 'Light',
  OmniLight: 'Light',
  SpotLight: 'Light',
  OccluderPolygon2D: 'Resource',
  TileSet: 'Resource',
  SpriteBase3D: 'GeometryInstance',
  Sprite3D: 'SpriteBase3D',
  TileMap: 'Node2D',
  Shape2D: 'Resource',
  Shape: 'Resource',
  BoxShape: 'Shape',
  SphereShape: 'Shape',
  CapsuleShape: 'Shape',
  CylinderShape: 'Shape',
  RayShape: 'Shape',
  ConvexPolygonShape: 'Shape',
  ConcavePolygonShape: 'Shape',
  Material3D: 'Material',
  ResourceInteractiveLoader: 'Reference',
  CircleShape2D: 'Shape2D',
  RectangleShape2D: 'Shape2D',
  CapsuleShape2D: 'Shape2D',
  RayShape2D: 'Shape2D',
  SegmentShape2D: 'Shape2D',
  ConvexPolygonShape2D: 'Shape2D',
  ConcavePolygonShape2D: 'Shape2D',
  LineShape2D: 'Shape2D',
  Container: 'Control',
  Control: 'CanvasItem',
  BaseButton: 'Control',
  Button: 'BaseButton',
  CheckBox: 'Button',
  CheckButton: 'Button',
  LinkButton: 'BaseButton',
  MenuButton: 'Button',
  OptionButton: 'Button',
  TextureButton: 'BaseButton',
  Range: 'Control',
  ProgressBar: 'Range',
  ScrollBar: 'Range',
  HScrollBar: 'ScrollBar',
  VScrollBar: 'ScrollBar',
  Slider: 'Range',
  HSlider: 'Slider',
  VSlider: 'Slider',
  SpinBox: 'Range',
  BoxContainer: 'Container',
  HBoxContainer: 'BoxContainer',
  VBoxContainer: 'BoxContainer',
  CenterContainer: 'Container',
  GridContainer: 'Container',
  MarginContainer: 'Container',
  PanelContainer: 'Container',
  SplitContainer: 'Container',
  HSplitContainer: 'SplitContainer',
  VSplitContainer: 'SplitContainer',
  AspectRatioContainer: 'Container',
  TabContainer: 'Container',
  Panel: 'Control',
  Label: 'Control',
  LineEdit: 'Control',
  TextEdit: 'Control',
  Tree: 'Control',
  ItemList: 'Control',
  ColorRect: 'Control',
  TextureRect: 'Control',
  NinePatchRect: 'Control',
  ColorPicker: 'BoxContainer',
  ColorPickerButton: 'Button',
  ToolButton: 'Button',
  TouchScreenButton: 'Node2D',
  PopupPanel: 'PopupDialog',
  PopupMenu: 'Popup',
  WindowDialog: 'PopupDialog',
  AcceptDialog: 'WindowDialog',
  ConfirmationDialog: 'AcceptDialog',
  FileDialog: 'ConfirmationDialog',
  GraphEdit: 'Control',
  GraphNode: 'Container',
  CullInstance: 'Spatial',
  GDScript: 'Script',
  GDScriptNativeClass: 'Reference',
  GeometryInstance: 'VisualInstance',
  InputEvent: 'Resource',
  InputEventAction: 'InputEvent',
  InputEventJoypadButton: 'InputEvent',
  InputEventJoypadMotion: 'InputEvent',
  InputEventKey: 'InputEventWithModifiers',
  InputEventMouse: 'InputEventWithModifiers',
  InputEventMouseButton: 'InputEventMouse',
  InputEventMouseMotion: 'InputEventMouse',
  InputEventScreenDrag: 'InputEvent',
  InputEventScreenTouch: 'InputEvent',
  InputEventWithModifiers: 'InputEvent',
  KinematicBody: 'PhysicsBody',
  KinematicBody2D: 'PhysicsBody2D',
  MeshInstance: 'GeometryInstance',
  MeshInstance2D: 'Node2D',
  Light2D: 'Node2D',
  LightOccluder2D: 'Node2D',
  PinJoint2D: 'Node2D',
  DampedSpringJoint2D: 'Node2D',
  GrooveJoint2D: 'Node2D',
  Path2D: 'Node2D',
  PathFollow2D: 'Node2D',
  NavigationRegion2D: 'Node2D',
  RayCast2D: 'Node2D',
  ShapeCast2D: 'Node2D',
  Camera2D: 'Node2D',
  CollisionPolygon2D: 'Node2D',
  YSort: 'Node2D',
  Node: 'Object',
  Node2D: 'CanvasItem',
  Position2D: 'Node2D',
  Polygon2D: 'Node2D',
  PopupDialog: 'Popup',
  Popup: 'Control',
  PackedScene: 'Resource',
  PhysicsBody: 'CollisionObject',
  PhysicsBody2D: 'CollisionObject2D',
  Reference: 'Object',
  Resource: 'Reference',
  RichTextLabel: 'Control',
  RichTextEffect: 'Resource',
  CharFXTransform: 'Reference',
  ReferenceRect: 'Control',
  RigidBody: 'PhysicsBody',
  RigidBody2D: 'PhysicsBody2D',
  Script: 'Resource',
  ScrollContainer: 'Container',
  Skeleton2D: 'Node2D',
  Sky: 'Resource',
  PanoramaSky: 'Sky',
  Spatial: 'Node',
  StaticBody: 'PhysicsBody',
  Timer: 'Node',
  Viewport: 'Node',
  ViewportContainer: 'Container',
  VisualInstance: 'CullInstance',
};

const GODOT_CLASS_PARENTS_4: Readonly<Record<string, string>> = {
  AudioEffectCapture: 'AudioEffect',
  AudioEffectEQ: 'AudioEffect',
  AudioStreamMicrophone: 'AudioStream',
  CodeHighlighter: 'SyntaxHighlighter',
  EditorSettings: 'Resource',
  SeparationRayShape3D: 'Shape3D',
  RichTextEffect: 'Resource',
  CharFXTransform: 'RefCounted',
  CodeEdit: 'TextEdit',
  TextEdit: 'Control',
  GDScriptSyntaxHighlighter: 'EditorSyntaxHighlighter',
  EditorSyntaxHighlighter: 'SyntaxHighlighter',
  SyntaxHighlighter: 'Resource',
  GPUParticles2D: 'Node2D',
  ParticleProcessMaterial: 'Material',
  Material: 'Resource',
  BaseMaterial3D: 'Material',
  StandardMaterial3D: 'BaseMaterial3D',
  ORMMaterial3D: 'BaseMaterial3D',
  RDShaderFile: 'Resource',
  RDShaderSPIRV: 'Resource',
  ProceduralSkyMaterial: 'Material',
  PhysicalSkyMaterial: 'Material',
  Sky: 'Resource',
  CanvasItemMaterial: 'Material',
  Shader: 'Resource',
  ShaderMaterial: 'Material',
  PanoramaSkyMaterial: 'Material',
  PhysicsMaterial: 'Resource',
  CryptoKey: 'Resource',
  X509Certificate: 'Resource',
  TLSOptions: 'RefCounted',
  Crypto: 'RefCounted',
  Thread: 'RefCounted',
  Semaphore: 'RefCounted',
  ENetConnection: 'RefCounted',
  ENetMultiplayerPeer: 'MultiplayerPeer',
  WebSocketMultiplayerPeer: 'MultiplayerPeer',
  WebRTCPeerConnection: 'RefCounted',
  WebRTCDataChannel: 'PacketPeer',
  WebRTCMultiplayerPeer: 'MultiplayerPeer',
  Mesh: 'Resource',
  PrimitiveMesh: 'Mesh',
  CapsuleMesh: 'PrimitiveMesh',
  PlaneMesh: 'PrimitiveMesh',
  PrismMesh: 'PrimitiveMesh',
  Shortcut: 'Resource',
  Theme: 'Resource',
  Font: 'Resource',
  FontFile: 'Font',
  FontVariation: 'Font',
  SystemFont: 'Font',
  StyleBox: 'Resource',
  StyleBoxFlat: 'StyleBox',
  StyleBoxEmpty: 'StyleBox',
  StyleBoxLine: 'StyleBox',
  StyleBoxTexture: 'StyleBox',
  HTTPClient: 'RefCounted',
  HashingContext: 'RefCounted',
  HTTPRequest: 'Node',
  PacketPeer: 'RefCounted',
  PhysicsPointQueryParameters3D: 'RefCounted',
  PhysicsDirectBodyState2D: 'Object',
  PhysicsShapeQueryParameters3D: 'RefCounted',
  StreamPeer: 'RefCounted',
  StreamPeerSocket: 'StreamPeer',
  StreamPeerTCP: 'StreamPeerSocket',
  StreamPeerTLS: 'StreamPeerSocket',
  StreamPeerBuffer: 'StreamPeer',
  SocketServer: 'RefCounted',
  TCPServer: 'SocketServer',
  WebSocketPeer: 'PacketPeer',
  MultiplayerAPI: 'RefCounted',
  Animation: 'Resource',
  AnimationLibrary: 'Resource',
  Curve3D: 'Resource',
  Path3D: 'Node3D',
  SpriteFrames: 'Resource',
  AnimationMixer: 'Node',
  AnimationPlayer: 'AnimationMixer',
  AnimationNode: 'Resource',
  AnimationRootNode: 'AnimationNode',
  AnimationNodeSync: 'AnimationNode',
  AnimationNodeAnimation: 'AnimationRootNode',
  AnimationNodeTransition: 'AnimationNodeSync',
  AnimationNodeTimeScale: 'AnimationNode',
  AnimationNodeTimeSeek: 'AnimationNode',
  AnimationNodeBlendSpace1D: 'AnimationNodeSync',
  AnimationNodeBlendSpace2D: 'AnimationNodeSync',
  AnimationNodeStateMachine: 'AnimationNode',
  AnimationNodeStateMachineTransition: 'Resource',
  AnimationNodeBlendTree: 'AnimationRootNode',
  AnimationNodeBlend2: 'AnimationNodeSync',
  AnimationNodeBlend3: 'AnimationNodeSync',
  SceneReplicationConfig: 'Resource',
  MultiplayerSynchronizer: 'Node',
  MultiplayerSpawner: 'Node',
  AnimationNodeAdd2: 'AnimationNodeSync',
  AnimationNodeAdd3: 'AnimationNodeSync',
  AnimationNodeSub2: 'AnimationNodeSync',
  AnimationNodeOneShot: 'AnimationNodeSync',
  AnimationNodeStateMachinePlayback: 'RefCounted',
  BitMap: 'Resource',
  FileAccess: 'RefCounted',
  Image: 'RefCounted',
  JSON: 'Resource',
  Texture2D: 'Resource',
  TextLine: 'RefCounted',
  TextParagraph: 'RefCounted',
  ViewportTexture: 'Texture2D',
  ImageTexture: 'Texture2D',
  AtlasTexture: 'Texture2D',
  AnimatedTexture: 'Texture2D',
  CameraTexture: 'Texture2D',
  CanvasTexture: 'Texture2D',
  PlaceholderTexture2D: 'Texture2D',
  PortableCompressedTexture2D: 'Texture2D',
  ProxyTexture2D: 'Texture2D',
  AStar2D: 'RefCounted',
  AStar3D: 'RefCounted',
  AStarGrid2D: 'RefCounted',
  Area2D: 'CollisionObject2D',
  AudioStreamPlayer: 'Node',
  AudioStreamPlayer2D: 'Node2D',
  AudioStreamPlayer3D: 'Node3D',
  AudioEffect: 'Resource',
  AudioEffectPitchShift: 'AudioEffect',
  AudioEffectLimiter: 'AudioEffect',
  AudioEffectHardLimiter: 'AudioEffect',
  AudioEffectSpectrumAnalyzer: 'AudioEffect',
  AudioEffectSpectrumAnalyzerInstance: 'AudioEffectInstance',
  AudioEffectInstance: 'RefCounted',
  AudioStream: 'Resource',
  AudioStreamGenerator: 'AudioStream',
  AudioStreamGeneratorPlayback: 'AudioStreamPlaybackResampled',
  AudioStreamPlaybackResampled: 'AudioStreamPlayback',
  AudioStreamPlayback: 'RefCounted',
  AudioStreamRandomizer: 'AudioStream',
  AudioStreamPolyphonic: 'AudioStream',
  AudioStreamPlaybackPolyphonic: 'AudioStreamPlayback',
  AudioStreamPlaylist: 'AudioStream',
  AudioStreamPlaybackPlaylist: 'AudioStreamPlayback',
  AudioStreamSynchronized: 'AudioStream',
  AudioStreamPlaybackSynchronized: 'AudioStreamPlayback',
  AudioStreamInteractive: 'AudioStream',
  AudioStreamPlaybackInteractive: 'AudioStreamPlayback',
  VideoStream: 'Resource',
  VideoStreamTheora: 'VideoStream',
  VideoStreamPlayer: 'Node',
  NavigationPolygon: 'Resource',
  NavigationMeshSourceGeometryData2D: 'Resource',
  NavigationAgent3D: 'Node3D',
  NavigationRegion3D: 'Node3D',
  NavigationLink3D: 'Node3D',
  NavigationObstacle3D: 'Node3D',
  Camera3D: 'Node3D',
  XRCamera3D: 'Camera3D',
  XRController3D: 'XRNode3D',
  XRNode3D: 'Node3D',
  XROrigin3D: 'Node3D',
  CanvasItem: 'Node',
  CanvasLayer: 'Node',
  CollisionObject2D: 'Node2D',
  CollisionObject3D: 'Node3D',
  PhysicsBody2D: 'CollisionObject2D',
  PhysicsBody3D: 'CollisionObject3D',
  RigidBody2D: 'PhysicsBody2D',
  RigidBody3D: 'PhysicsBody3D',
  CharacterBody2D: 'PhysicsBody2D',
  CharacterBody3D: 'PhysicsBody3D',
  CollisionShape2D: 'Node2D',
  OccluderPolygon2D: 'Resource',
  TileSet: 'Resource',
  TileSetSource: 'Resource',
  TileSetAtlasSource: 'TileSetSource',
  TileMapPattern: 'Resource',
  TileMap: 'Node2D',
  Shape2D: 'Resource',
  Shape3D: 'Resource',
  BoxShape3D: 'Shape3D',
  SphereShape3D: 'Shape3D',
  CapsuleShape3D: 'Shape3D',
  CylinderShape3D: 'Shape3D',
  ConvexPolygonShape3D: 'Shape3D',
  ConcavePolygonShape3D: 'Shape3D',
  CircleShape2D: 'Shape2D',
  RectangleShape2D: 'Shape2D',
  CapsuleShape2D: 'Shape2D',
  SegmentShape2D: 'Shape2D',
  ConvexPolygonShape2D: 'Shape2D',
  ConcavePolygonShape2D: 'Shape2D',
  WorldBoundaryShape2D: 'Shape2D',
  CollisionShape3D: 'Node3D',
  CollisionPolygon3D: 'Node3D',
  Light3D: 'VisualInstance3D',
  DirectionalLight3D: 'Light3D',
  OmniLight3D: 'Light3D',
  SpotLight3D: 'Light3D',
  Container: 'Control',
  Control: 'CanvasItem',
  BaseButton: 'Control',
  Button: 'BaseButton',
  CheckBox: 'Button',
  CheckButton: 'Button',
  LinkButton: 'BaseButton',
  MenuButton: 'Button',
  OptionButton: 'Button',
  TextureButton: 'BaseButton',
  Range: 'Control',
  ProgressBar: 'Range',
  ScrollBar: 'Range',
  HScrollBar: 'ScrollBar',
  VScrollBar: 'ScrollBar',
  Slider: 'Range',
  HSlider: 'Slider',
  VSlider: 'Slider',
  SpinBox: 'Range',
  BoxContainer: 'Container',
  HBoxContainer: 'BoxContainer',
  VBoxContainer: 'BoxContainer',
  CenterContainer: 'Container',
  GridContainer: 'Container',
  MarginContainer: 'Container',
  PanelContainer: 'Container',
  FlowContainer: 'Container',
  HFlowContainer: 'FlowContainer',
  VFlowContainer: 'FlowContainer',
  SplitContainer: 'Container',
  HSplitContainer: 'SplitContainer',
  VSplitContainer: 'SplitContainer',
  AspectRatioContainer: 'Container',
  TabContainer: 'Container',
  FoldableContainer: 'Container',
  Panel: 'Control',
  Label: 'Control',
  LineEdit: 'Control',
  Tree: 'Control',
  ItemList: 'Control',
  ColorRect: 'Control',
  TextureRect: 'Control',
  NinePatchRect: 'Control',
  ColorPicker: 'VBoxContainer',
  ColorPickerButton: 'Button',
  TouchScreenButton: 'Node2D',
  TabBar: 'Control',
  MenuBar: 'Control',
  Popup: 'Window',
  PopupPanel: 'Popup',
  PopupMenu: 'Popup',
  AcceptDialog: 'Window',
  ConfirmationDialog: 'AcceptDialog',
  FileDialog: 'ConfirmationDialog',
  GDScript: 'Script',
  GeometryInstance3D: 'VisualInstance3D',
  InputEvent: 'Resource',
  InputEventAction: 'InputEvent',
  InputEventFromWindow: 'InputEvent',
  InputEventJoypadButton: 'InputEvent',
  InputEventJoypadMotion: 'InputEvent',
  InputEventKey: 'InputEventWithModifiers',
  InputEventMouse: 'InputEventWithModifiers',
  InputEventMouseButton: 'InputEventMouse',
  InputEventMouseMotion: 'InputEventMouse',
  InputEventScreenDrag: 'InputEventFromWindow',
  InputEventScreenTouch: 'InputEventFromWindow',
  InputEventWithModifiers: 'InputEventFromWindow',
  MeshInstance3D: 'GeometryInstance3D',
  MeshInstance2D: 'Node2D',
  PointLight2D: 'Node2D',
  DirectionalLight2D: 'Node2D',
  LightOccluder2D: 'Node2D',
  PinJoint2D: 'Node2D',
  DampedSpringJoint2D: 'Node2D',
  GrooveJoint2D: 'Node2D',
  Path2D: 'Node2D',
  PathFollow2D: 'Node2D',
  NavigationRegion2D: 'Node2D',
  NavigationAgent2D: 'Node',
  RayCast2D: 'Node2D',
  ShapeCast2D: 'Node2D',
  CollisionPolygon2D: 'Node2D',
  NavigationLink2D: 'Node2D',
  NavigationObstacle2D: 'Node2D',
  SpriteBase3D: 'GeometryInstance3D',
  Sprite3D: 'SpriteBase3D',
  RemoteTransform3D: 'Node3D',
  Node: 'Object',
  Node2D: 'CanvasItem',
  Window: 'Viewport',
  Viewport: 'Node',
  Marker2D: 'Node2D',
  Node3D: 'Node',
  Bone2D: 'Node2D',
  Polygon2D: 'Node2D',
  PackedScene: 'Resource',
  RefCounted: 'Object',
  Resource: 'RefCounted',
  RichTextLabel: 'Control',
  GraphEdit: 'Control',
  GraphElement: 'Container',
  GraphNode: 'GraphElement',
  GraphFrame: 'GraphElement',
  Script: 'Resource',
  ScrollContainer: 'Container',
  Skeleton2D: 'Node2D',
  TileMapLayer: 'Node2D',
  TileData: 'RefCounted',
  Timer: 'Node',
  VisualInstance3D: 'Node3D',
};

/** Class names whose existing native identity carriers are accepted by engine-class `is`. */
export const GODOT_IS_A_CLASSES: ReadonlySet<string> = new Set([
  'AudioStreamPlayer',
  'AudioStreamPlayer3D',
  'Button',
  'TextureButton',
  'OptionButton',
  'ColorPickerButton',
  'ColorRect',
  'RigidBody',
  'KinematicBody',
  'LineEdit',
  'MeshInstance',
  'Range',
  'Slider',
  'SpinBox',
  'StaticBody',
  'TabBar',
  'TextEdit',
  'PhysicsBody',
  'CollisionObject',
  'CollisionShape',
  'Node',
  'Spatial',
  'SpatialMaterial',
  'Sprite',
  'Sprite2D',
  'Shape',
  'BoxShape',
  'CylinderShape',
  'Shape3D',
  'BoxShape3D',
  'CylinderShape3D',
  'InputEventMouseButton',
]);

/** The existing Three marker key; emitted native values use no parallel identity registry. */
export const GODOT_CLASS_KEY = 'godotClass';
/**
 * Attach class identity to one emitted value. The binding is deliberately data-only: no closure,
 * Map, Set or handler is allocated per object; `dispatch` and `scriptMembers` are module statics.
 */
export function registerGodotObjectBinding(
  value: object,
  binding: Omit<GodotObjectBinding, 'value'>,
): void {
  objectBindings.set(value, { ...binding, value });
  if (isReflectable(binding.native)) {
    if (binding.native !== value) scriptValuesByNative.set(binding.native, value);
    linkGodotObjectLifetime(value, binding.native);
  }
}

/**
 * Attach native ClassDB identity when this class has no generated dynamic-dispatch table. It uses
 * the same binding map and is replaced by {@link registerGodotObjectBinding} if a fuller binding
 * is installed later; there is no second identity registry.
 */
export function registerGodotObjectIdentity(
  value: object,
  godotClass: string,
  script?: GodotScriptResource,
  native: unknown = value,
  context?: unknown,
): void {
  const existing = objectBindings.get(value);
  if (existing !== undefined && existing.dispatch !== IDENTITY_ONLY_DISPATCH) return;
  const retainedScript = script ?? existing?.script;
  const retainedContext = context ?? existing?.context;
  const retainedNative = existing !== undefined && native === value ? existing.native : native;
  objectBindings.set(value, {
    godotClass,
    value,
    native: retainedNative,
    dispatch: IDENTITY_ONLY_DISPATCH,
    ...(retainedContext === undefined ? {} : { context: retainedContext }),
    ...(retainedScript === undefined ? {} : { script: retainedScript }),
  });
}

/** One module-static Script resource identity for an emitted GDScript source file. */
export function createGodotScriptResource(
  resourcePath: string,
  godotBaseClass: string,
  globalName = '',
  sourceCode = '',
  baseScriptPath = '',
): GodotScriptResource {
  if (!resourcePath.startsWith('res://') || !resourcePath.endsWith('.gd')) {
    throw new Error(
      `Translated Script resource must be a res://*.gd path; received ${resourcePath}.`,
    );
  }
  const slash = resourcePath.lastIndexOf('/');
  const dot = resourcePath.lastIndexOf('.');
  if (typeof sourceCode !== 'string') throw new TypeError('Script.source_code requires a String.');
  const resource: GodotScriptResource = {
    resource_path: resourcePath,
    resource_name: resourcePath.slice(slash + 1, dot),
    godot_base_class: godotBaseClass,
    can_instantiate: true as const,
    global_name: globalName,
    base_script_path: baseScriptPath,
    source_code: sourceCode,
    reload(_keepState = false): never {
      throw new Error(
        'Script.reload cannot compile GDScript in the translated browser runtime; re-import the authored source.',
      );
    },
  };
  let retainedSourceCode = sourceCode;
  Object.defineProperty(resource, 'source_code', {
    enumerable: true,
    configurable: true,
    get: () => retainedSourceCode,
    set: (value: string) => {
      if (typeof value !== 'string') throw new TypeError('Script.source_code requires a String.');
      retainedSourceCode = value;
    },
  });
  registerGodotObjectIdentity(resource, 'GDScript');
  SCRIPT_RESOURCES_BY_PATH.set(resourcePath, resource);
  return resource;
}

/** `Object.get_script()` preserves the exact module-static Script resource identity. */
export function godotObjectGetScript(receiver: unknown): GodotScriptResource | null {
  const object = requireObject(receiver, 'get_script');
  return objectBindings.get(object)?.script ?? null;
}

/** `Object.set_script` replaces only the retained Script Resource binding, preserving native identity. */
export function godotObjectSetScript(receiver: unknown, script: GodotScriptResource | null): void {
  const object = requireObject(receiver, 'set_script');
  const binding = objectBindings.get(object);
  if (binding === undefined)
    throw new Error('Object.set_script requires retained Godot object identity.');
  if (script !== null && (typeof script !== 'object' || !('resource_path' in script))) {
    throw new TypeError('Object.set_script requires a GDScript Resource or null.');
  }
  const { script: _priorScript, ...withoutScript } = binding;
  objectBindings.set(object, script === null ? withoutScript : { ...withoutScript, script });
}

/** Default `GDScript.new()` Resource identity; source compilation remains the authored translator's job. */
export function createEmptyGodotGDScript(): GodotScriptResource {
  const script: GodotScriptResource = {
    resource_path: '',
    resource_name: '',
    godot_base_class: 'RefCounted',
    can_instantiate: true,
    global_name: '',
    base_script_path: '',
    source_code: '',
    reload(_keepState = false): never {
      throw new Error(
        'Script.reload cannot compile GDScript in the translated browser runtime; re-import the authored source.',
      );
    },
  };
  let retainedSourceCode = '';
  Object.defineProperty(script, 'source_code', {
    enumerable: true,
    configurable: true,
    get: () => retainedSourceCode,
    set: (value: string) => {
      if (typeof value !== 'string') throw new TypeError('Script.source_code requires a String.');
      retainedSourceCode = value;
    },
  });
  registerGodotObjectIdentity(script, 'GDScript');
  return script;
}

type OpenObjectSignalMethod = 'connect' | 'disconnect' | 'is_connected' | 'emit_signal';

interface RetainedObjectSignals {
  readonly native?: GodotSignal<readonly unknown[]>;
  readonly authoredUser?: GodotSignal<readonly unknown[]>;
  readonly authoredScript?: GodotSignal<readonly unknown[]>;
}

function retainedObjectSignals(binding: GodotObjectBinding, key: string): RetainedObjectSignals {
  const directNative = isReflectable(binding.native) ? Reflect.get(binding.native, key) : undefined;
  const generatedSignal = binding.dispatch.signals[key];
  const generatedNative =
    generatedSignal !== undefined && generatedSignal !== null && generatedSignal.get !== undefined
      ? generatedSignal.get(binding)
      : undefined;
  const authoredUser =
    userSignals.get(binding.value)?.has(key) === true ? Reflect.get(binding.value, key) : undefined;
  const scriptField = binding.scriptSignals?.[key] ?? key;
  const scriptHandle =
    binding.scriptMembers?.has(key) === true ? Reflect.get(binding.value, scriptField) : undefined;
  const authoredScript = isReflectable(scriptHandle)
    ? Reflect.get(scriptHandle, 'signal')
    : undefined;
  const native = isRetainedGodotSignal(directNative)
    ? directNative
    : isRetainedGodotSignal(generatedNative)
      ? generatedNative
      : undefined;
  return {
    ...(native === undefined ? {} : { native }),
    ...(isRetainedGodotSignal(authoredUser) ? { authoredUser } : {}),
    ...(isRetainedGodotSignal(authoredScript) ? { authoredScript } : {}),
  };
}

export interface GodotRetainedSignalValueOwner {
  readonly signal?: GodotSignal<readonly unknown[]>;
  readonly emit?: (...args: readonly unknown[]) => void;
}

/** Exact first-class Signal backing over registered ClassDB/user/script signal ownership. */
export function godotRetainedSignalValueOwner(
  receiver: unknown,
  name: unknown,
): GodotRetainedSignalValueOwner {
  const binding = reflectedBinding(receiver, 'Signal');
  const key = userSignalName(name, 'Signal');
  const generatedSignal = binding.dispatch.signals[key];
  const generatedNative =
    generatedSignal !== undefined && generatedSignal !== null && generatedSignal.get !== undefined
      ? generatedSignal.get(binding)
      : undefined;
  const authoredUser =
    userSignals.get(binding.value)?.has(key) === true ? Reflect.get(binding.value, key) : undefined;
  const scriptField = binding.scriptSignals?.[key] ?? key;
  const scriptHandle =
    binding.scriptMembers?.has(key) === true ? Reflect.get(binding.value, scriptField) : undefined;
  const authoredScript = isReflectable(scriptHandle)
    ? Reflect.get(scriptHandle, 'signal')
    : undefined;
  const signal = isRetainedGodotSignal(generatedNative)
    ? generatedNative
    : isRetainedGodotSignal(authoredUser)
      ? authoredUser
      : isRetainedGodotSignal(authoredScript)
        ? authoredScript
        : undefined;
  const authored = isRetainedGodotSignal(authoredUser)
    ? authoredUser
    : isRetainedGodotSignal(authoredScript)
      ? authoredScript
      : undefined;
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(authored === undefined
      ? {}
      : {
          emit: (...args: readonly unknown[]) => {
            if (!signalBlockingObjects.has(binding.value)) emitRetainedGodotSignal(authored, args);
          },
        }),
  };
}

function retainedNativeSignal(
  binding: GodotObjectBinding,
  name: unknown,
  member: OpenObjectSignalMethod,
): GodotSignal<readonly unknown[]> {
  const key = userSignalName(name, member);
  const retained = retainedObjectSignals(binding, key);
  // Engine signals expose only their connectable half to source. Object.emit_signal is admitted
  // solely for an authored user signal whose handle this object owns; native private emitters stay
  // inaccessible. Connection queries may use either exact retained owner.
  const signal =
    member === 'emit_signal'
      ? (retained.authoredUser ?? retained.authoredScript)
      : (retained.native ?? retained.authoredUser ?? retained.authoredScript);
  if (!isRetainedGodotSignal(signal)) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${member} names unregistered signal '${key}'.`,
    );
  }
  return signal as GodotSignal<readonly unknown[]>;
}

function connectionFlags(value: unknown, defer?: (invoke: () => void) => void): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || ((value as number) & ~15) !== 0) {
    throw new TypeError('godot-compat: Object.connect flags require a uint32 subset of 1/2/4/8.');
  }
  const flags = value as number;
  if ((flags & 1) !== 0 && defer === undefined) {
    throw new Error(
      'godot-compat: Object.connect CONNECT_DEFERRED requires the owning SceneTree deferred queue.',
    );
  }
  return flags;
}

/**
 * Exact retained Object signal protocol for a statically open/base Object or Node receiver.
 *
 * The signal name intentionally remains runtime data here. Godot 3 commonly enumerates
 * `get_signal_list()` and asks `is_connected(row.name, target, method)`; Godot 4 retains the same
 * dynamic Object door with a Callable. Both spellings resolve against the registered native,
 * user, or translated-script signal owner above and query the same Callable comparator map used
 * by connect/disconnect, so bound-callable identity is never reconstructed from a JavaScript
 * function's source.
 */
export function godotOpenObjectSignalCall(
  receiver: unknown,
  major: 3 | 4,
  method: 'is_connected',
  args: readonly unknown[],
): boolean;
export function godotOpenObjectSignalCall(
  receiver: unknown,
  major: 3 | 4,
  method: 'disconnect',
  args: readonly unknown[],
): undefined;
export function godotOpenObjectSignalCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenObjectSignalMethod,
  args: readonly unknown[],
  defer?: (invoke: () => void) => void,
): unknown;
export function godotOpenObjectSignalCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenObjectSignalMethod,
  args: readonly unknown[],
  defer?: (invoke: () => void) => void,
): unknown {
  const binding = reflectedBinding(receiver, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open Object.${method} refuses a translated script method override.`,
    );
  }
  if (args.length === 0) {
    throw new TypeError(`godot-compat: Object.${method} requires a signal name.`);
  }
  const signal = retainedNativeSignal(binding, args[0], method);
  if (method === 'emit_signal') {
    if (!signalBlockingObjects.has(binding.value)) emitRetainedGodotSignal(signal, args.slice(1));
    return major === 4 ? 0 : undefined;
  }

  let callable: GodotCallable;
  let flags = 0;
  let invoke: (...emitted: readonly unknown[]) => unknown;
  if (major === 3) {
    const expected = method === 'connect' ? [3, 4, 5] : [3];
    if (!expected.includes(args.length)) {
      throw new TypeError(
        `godot-compat: Godot 3 Object.${method} received ${args.length} arguments.`,
      );
    }
    const target = args[1];
    reflectedBinding(target, `${method} target`);
    if (typeof args[2] !== 'string' || args[2].length === 0) {
      throw new TypeError(`godot-compat: Godot 3 Object.${method} requires a method String.`);
    }
    callable = godotObjectMethodCallable(target, args[2]);
    const binds = method === 'connect' ? (args[3] ?? []) : [];
    if (!Array.isArray(binds)) {
      throw new TypeError('godot-compat: Godot 3 Object.connect binds require Array.');
    }
    flags = method === 'connect' ? connectionFlags(args[4] ?? 0, defer) : 0;
    invoke = (...emitted) => {
      const call = (): void => {
        void callable.call(...emitted, ...binds);
      };
      if ((flags & 1) !== 0) (defer as (invoke: () => void) => void)(call);
      else call();
    };
  } else {
    const expected = method === 'connect' ? [2, 3] : [2];
    if (!expected.includes(args.length)) {
      throw new TypeError(
        `godot-compat: Godot 4 Object.${method} received ${args.length} arguments.`,
      );
    }
    if (!(args[1] instanceof GodotCallable)) {
      throw new TypeError(`godot-compat: Godot 4 Object.${method} requires Callable.`);
    }
    callable = args[1];
    flags = method === 'connect' ? connectionFlags(args[2] ?? 0, defer) : 0;
    invoke = (...emitted) => {
      const call = (): void => {
        void callable.call(...emitted);
      };
      if ((flags & 1) !== 0) (defer as (invoke: () => void) => void)(call);
      else call();
    };
  }

  if (method === 'connect') {
    // Object::connect reports ERR_INVALID_PARAMETER for an existing slot unless this request is
    // reference-counted. Keep the existing connection intact and preserve the engine return code;
    // createSignal's lower-level duplicate refusal remains the guard for non-Object consumers.
    if (signal.isConnected(callable) && (flags & 8) === 0) {
      console.error(
        `godot-compat: ${binding.godotClass}.connect found the callable already connected to ` +
          `signal '${String(args[0])}'.`,
      );
      return 31;
    }
    signal.connect(
      (...emitted) => {
        void invoke(...emitted);
      },
      { flags, oneShot: (flags & 4) !== 0 },
      callable,
    );
    return 0;
  }
  if (method === 'disconnect') {
    signal.disconnect(callable);
    return undefined;
  }
  return signal.isConnected(callable);
}

/** Object.has_signal over the exact retained Signal protocol, never arbitrary method reflection. */
export function godotObjectHasSignal(receiver: unknown, name: unknown): boolean {
  const binding = reflectedBinding(receiver, 'has_signal');
  if (typeof name !== 'string') throw new TypeError('Object.has_signal requires a StringName.');
  const retained = retainedObjectSignals(binding, name);
  return (
    Object.hasOwn(binding.dispatch.signals, name) ||
    retained.native !== undefined ||
    retained.authoredUser !== undefined ||
    retained.authoredScript !== undefined
  );
}

/** Object.get_signal_connection_list over the retained slot map used by connect/disconnect. */
export function godotObjectGetSignalConnectionList(
  receiver: unknown,
  name: unknown,
  major: 3 | 4,
): readonly Readonly<Record<string, unknown>>[] {
  const binding = reflectedBinding(receiver, 'get_signal_connection_list');
  if (typeof name !== 'string') {
    throw new TypeError('Object.get_signal_connection_list requires a StringName.');
  }
  const retained = retainedObjectSignals(binding, name);
  const signal = retained.native ?? retained.authoredUser ?? retained.authoredScript;
  if (signal === undefined) return [];
  return signal.getConnections().map(({ callable, flags }) =>
    major === 3
      ? {
          signal: name,
          method: callable.getMethod(),
          source: binding.value,
          target: callable.getObject(),
          binds: [],
          flags,
        }
      : { signal: name, callable, flags },
  );
}

/** Godot 3's editor-facing property-list invalidation, retained for dynamic inspector consumers. */
export function godotObjectPropertyListChangedNotify(receiver: unknown): void {
  const object = requireObject(receiver, 'property_list_changed_notify');
  propertyListRevisions.set(object, (propertyListRevisions.get(object) ?? 0) + 1);
}

export function godotObjectPropertyListRevision(receiver: unknown): number {
  return propertyListRevisions.get(requireObject(receiver, 'property list revision')) ?? 0;
}

export interface GodotPropertyInfo {
  readonly name: string;
  readonly type: number;
  readonly hint: number;
  readonly hint_string: string;
  readonly usage: number;
  readonly class_name?: string;
}

export interface GodotMethodInfo {
  readonly name: string;
  readonly args: readonly GodotPropertyInfo[];
  readonly default_args: readonly unknown[];
  readonly flags: number;
  readonly id: number;
  readonly return: GodotPropertyInfo;
}

const NIL_PROPERTY_INFO: GodotPropertyInfo = {
  name: '',
  type: 0,
  hint: 0,
  hint_string: '',
  usage: 6,
};

function reflectedBinding(receiver: unknown, member: string): GodotObjectBinding {
  const object = requireObject(receiver, member);
  const binding = objectBindings.get(object);
  if (binding === undefined) {
    throw new Error(`Object.${member} requires retained Godot ClassDB identity.`);
  }
  return binding;
}

/** ClassDB/script property names backed by the exact generated dispatch table. */
export function godotObjectGetPropertyList(receiver: unknown): readonly GodotPropertyInfo[] {
  const binding = reflectedBinding(receiver, 'get_property_list');
  const names = new Set<string>(Object.keys(binding.dispatch.properties));
  for (const name of binding.scriptMembers ?? []) {
    if (typeof Reflect.get(binding.value, name) !== 'function') names.add(name);
  }
  return [...names].map((name) => ({
    name,
    type: 0,
    hint: 0,
    hint_string: '',
    usage: 6,
  }));
}

/** ClassDB/script method names backed by the exact generated dispatch table. */
export function godotObjectGetMethodList(receiver: unknown): readonly GodotMethodInfo[] {
  const binding = reflectedBinding(receiver, 'get_method_list');
  const names = new Set<string>(Object.keys(binding.dispatch.methods));
  for (const name of binding.scriptMembers ?? []) {
    if (typeof Reflect.get(binding.value, name) === 'function') names.add(name);
  }
  return [...names].map((name, id) => ({
    name,
    args: [],
    default_args: [],
    flags: 1,
    id,
    return: NIL_PROPERTY_INFO,
  }));
}

/** Signal inventory from the retained signal objects attached to the actual native identity. */
export function godotObjectGetSignalList(receiver: unknown): readonly GodotMethodInfo[] {
  const binding = reflectedBinding(receiver, 'get_signal_list');
  const names = new Set<string>(Object.keys(binding.dispatch.signals));
  const candidates = new Set<string>([
    ...Object.keys(binding.value),
    ...(isReflectable(binding.native) ? Object.keys(binding.native) : []),
    ...(binding.scriptMembers ?? []),
  ]);
  for (const name of candidates) {
    const retained = retainedObjectSignals(binding, name);
    if (
      retained.native !== undefined ||
      retained.authoredUser !== undefined ||
      retained.authoredScript !== undefined
    )
      names.add(name);
  }
  const authored = userSignals.get(binding.value);
  for (const name of authored?.keys() ?? []) names.add(name);
  return [...names].map((name, id) => ({
    name,
    args: authored?.get(name) ?? [],
    default_args: [],
    flags: 1,
    id,
    return: NIL_PROPERTY_INFO,
  }));
}

function userSignalName(value: unknown, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Object.${member} requires a non-empty StringName.`);
  }
  return value;
}

export function godotObjectAddUserSignal(
  receiver: unknown,
  name: unknown,
  argumentsList: unknown = [],
): void {
  const object = requireObject(receiver, 'add_user_signal');
  const key = userSignalName(name, 'add_user_signal');
  if (!Array.isArray(argumentsList))
    throw new TypeError('Object.add_user_signal arguments must be an Array.');
  if (godotObjectHasSignal(object, key)) {
    console.error(`godot-compat: Object already has signal '${key}'.`);
    return;
  }
  const normalized = argumentsList.map((entry, index): GodotPropertyInfo => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof Reflect.get(entry, 'name') !== 'string'
    ) {
      throw new TypeError(
        `Object.add_user_signal argument ${index} requires a property Dictionary with name.`,
      );
    }
    return {
      name: Reflect.get(entry, 'name') as string,
      type: Number.isSafeInteger(Reflect.get(entry, 'type'))
        ? (Reflect.get(entry, 'type') as number)
        : 0,
      hint: Number.isSafeInteger(Reflect.get(entry, 'hint'))
        ? (Reflect.get(entry, 'hint') as number)
        : 0,
      hint_string:
        typeof Reflect.get(entry, 'hint_string') === 'string'
          ? (Reflect.get(entry, 'hint_string') as string)
          : '',
      usage: Number.isSafeInteger(Reflect.get(entry, 'usage'))
        ? (Reflect.get(entry, 'usage') as number)
        : 6,
    };
  });
  const handle = createSignal<readonly unknown[]>();
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value: handle.signal,
  });
  const signals = userSignals.get(object) ?? new Map<string, readonly GodotPropertyInfo[]>();
  signals.set(key, normalized);
  userSignals.set(object, signals);
}

export function godotObjectRemoveUserSignal(receiver: unknown, name: unknown): void {
  const object = requireObject(receiver, 'remove_user_signal');
  const key = userSignalName(name, 'remove_user_signal');
  const signals = userSignals.get(object);
  if (signals?.delete(key) !== true) return;
  Reflect.deleteProperty(object, key);
  if (signals.size === 0) userSignals.delete(object);
}

export function godotObjectHasUserSignal(receiver: unknown, name: unknown): boolean {
  const object = requireObject(receiver, 'has_user_signal');
  return userSignals.get(object)?.has(userSignalName(name, 'has_user_signal')) === true;
}

export function godotObjectHasMethod(receiver: unknown, name: unknown): boolean {
  if (typeof name !== 'string') throw new TypeError('Object.has_method requires a StringName.');
  const binding = reflectedBinding(receiver, 'has_method');
  if (binding.scriptMembers?.has(name) === true)
    return typeof Reflect.get(binding.value, name) === 'function';
  return binding.dispatch.methods[name] !== undefined;
}

function indexedNames(pathValue: unknown, member: string): readonly string[] {
  if (typeof pathValue !== 'string' && (typeof pathValue !== 'object' || pathValue === null)) {
    throw new TypeError(`Object.${member} requires a NodePath.`);
  }
  const path = godotNodePathNew(
    typeof pathValue === 'string' ? pathValue : godotNodePathString(pathValue as GodotNodePath),
  );
  const names = path.subnames.length > 0 ? path.subnames : path.names;
  if (names.length === 0) throw new Error(`Object.${member} requires a non-empty property path.`);
  return names;
}

/** Object.get_indexed walks Variant property subnames through exact dynamic dispatch. */
export function godotObjectGetIndexed(receiver: unknown, pathValue: unknown): unknown {
  let current = receiver;
  for (const name of indexedNames(pathValue, 'get_indexed')) {
    current = godotObjectGet(current, name);
    if (current === null) return null;
  }
  return current;
}

/** Object.set_indexed resolves the owning value and writes the final subname. */
export function godotObjectSetIndexed(receiver: unknown, pathValue: unknown, value: unknown): void {
  const names = indexedNames(pathValue, 'set_indexed');
  let current = receiver;
  for (const name of names.slice(0, -1)) {
    current = godotObjectGet(current, name);
    if (!isReflectable(current)) {
      throw new Error(`Object.set_indexed could not resolve property owner at '${name}'.`);
    }
  }
  godotObjectSet(current, names[names.length - 1] as string, value);
}

/** Object.to_string honors a translated `_to_string` override before native identity text. */
export function godotObjectToString(receiver: unknown): string {
  const binding = reflectedBinding(receiver, 'to_string');
  if (binding.scriptMembers?.has('_to_string') === true) {
    const custom = Reflect.get(binding.value, '_to_string');
    if (typeof custom === 'function') {
      const value = Reflect.apply(custom, binding.value, []);
      if (typeof value !== 'string') throw new TypeError('Object._to_string must return a String.');
      return value;
    }
  }
  return `<${binding.godotClass}#${godotObjectInstanceId(binding.value).toString()}>`;
}

/** `Script.instance_has(object)` compares the retained module-static Script resource identity. */
export function godotScriptInstanceHas(script: unknown, candidate: unknown): boolean {
  const scriptObject = requireObject(script, 'Script.instance_has');
  if (typeof candidate !== 'object' || candidate === null) return false;
  return objectBindings.get(candidate)?.script === scriptObject;
}

/**
 * GDScript's `object is ProjectScript` test.
 *
 * The right operand is a module-static Script Resource, not the emitted scene class. Godot starts
 * from the receiver's attached Script and compares resource identity while walking
 * `get_base_script()`. The translated resources retain that same path link, so this operation does
 * the identical walk through the one resource registry rather than substituting JavaScript
 * `instanceof` (which would make scene attachment, not script inheritance, decide the result).
 */
export function godotScriptIsA(receiver: unknown, targetResourcePath: string): boolean {
  if (typeof targetResourcePath !== 'string' || targetResourcePath === '') {
    throw new TypeError(
      'godot-compat: a project-script `is` test requires a translated res:// path.',
    );
  }
  const target = SCRIPT_RESOURCES_BY_PATH.get(targetResourcePath);
  if (target === undefined) {
    throw new Error(`Translated Script resource ${targetResourcePath} is not registered.`);
  }
  if (!isReflectable(receiver)) return false;
  let candidate = objectBindings.get(receiver)?.script;
  if (candidate === undefined) return false;
  const seen = new Set<GodotScriptResource>();
  while (candidate !== undefined) {
    if (candidate === target) return true;
    if (seen.has(candidate)) {
      throw new Error(
        `Translated Script inheritance contains a cycle at ${candidate.resource_path || '<dynamic>'}.`,
      );
    }
    seen.add(candidate);
    if (candidate.base_script_path === '') return false;
    const base = SCRIPT_RESOURCES_BY_PATH.get(candidate.base_script_path);
    if (base === undefined) {
      throw new Error(
        `Translated base Script resource ${candidate.base_script_path} is not registered.`,
      );
    }
    candidate = base;
  }
  return false;
}

interface GodotNestedScriptClassIdentity {
  readonly classId: string;
  readonly baseClassId: string | null;
}

const NESTED_SCRIPT_CLASS_BY_INSTANCE = new WeakMap<object, string>();
const NESTED_SCRIPT_CLASS_BASES = new Map<string, string | null>();

/** Bind one emitted inner-class instance to its exact source class and declared inner base. */
export function bindGodotNestedScriptClass(
  receiver: object,
  classId: string,
  baseClassId: string | null = null,
): void {
  if (classId === '' || (baseClassId !== null && baseClassId === '')) {
    throw new TypeError(
      'godot-compat: nested Script class identity requires non-empty source ids.',
    );
  }
  const identity: GodotNestedScriptClassIdentity = { classId, baseClassId };
  const priorBase = NESTED_SCRIPT_CLASS_BASES.get(identity.classId);
  if (priorBase !== undefined && priorBase !== identity.baseClassId) {
    throw new Error(
      `godot-compat: nested Script class ${identity.classId} was registered with conflicting bases.`,
    );
  }
  NESTED_SCRIPT_CLASS_BASES.set(identity.classId, identity.baseClassId);
  NESTED_SCRIPT_CLASS_BY_INSTANCE.set(receiver, identity.classId);
}

/** GDScript `value is Outer.Inner`, walking the inner Script class's declared base chain. */
export function godotNestedScriptIsA(receiver: unknown, targetClassId: string): boolean {
  if (targetClassId === '') {
    throw new TypeError('godot-compat: nested Script `is` requires a non-empty source class id.');
  }
  if (!isReflectable(receiver)) return false;
  let candidate: string | null | undefined = NESTED_SCRIPT_CLASS_BY_INSTANCE.get(receiver);
  const seen = new Set<string>();
  while (candidate !== undefined && candidate !== null) {
    if (candidate === targetClassId) return true;
    if (seen.has(candidate)) {
      throw new Error(`godot-compat: nested Script inheritance contains a cycle at ${candidate}.`);
    }
    seen.add(candidate);
    candidate = NESTED_SCRIPT_CLASS_BASES.get(candidate);
  }
  return false;
}

/** `Script.can_instantiate()` for a translated, valid GDScript module. */
export function godotScriptCanInstantiate(script: unknown): boolean {
  const object = requireObject(script, 'Script.can_instantiate');
  return (object as Partial<GodotScriptResource>).can_instantiate === true;
}

/** Exact translated base Script resource, or null when the source extends an engine class. */
export function godotScriptGetBaseScript(script: unknown): GodotScriptResource | null {
  const object = requireObject(script, 'Script.get_base_script');
  const path = (object as Partial<GodotScriptResource>).base_script_path;
  if (typeof path !== 'string') {
    throw new Error('Script.get_base_script requires a translated Script resource.');
  }
  if (path === '') return null;
  const base = SCRIPT_RESOURCES_BY_PATH.get(path);
  if (base === undefined) {
    throw new Error(`Translated base Script resource ${path} is not registered.`);
  }
  return base;
}

/** Authored UTF-8 source retained on the translated Script identity. */
export function godotScriptGetSourceCode(script: unknown): string {
  const object = requireObject(script, 'Script.get_source_code');
  const source = (object as Partial<GodotScriptResource>).source_code;
  if (typeof source !== 'string') {
    throw new Error('Script.get_source_code requires a translated Script resource.');
  }
  return source;
}

export function godotScriptHasSourceCode(script: unknown): boolean {
  return godotScriptGetSourceCode(script) !== '';
}

/** `Script.get_instance_base_type()` preserves the source-derived engine base class. */
export function godotScriptInstanceBaseType(script: unknown): string {
  const object = requireObject(script, 'Script.get_instance_base_type');
  const base = (object as Partial<GodotScriptResource>).godot_base_class;
  if (typeof base !== 'string') {
    throw new Error('Script.get_instance_base_type requires a translated GDScript resource.');
  }
  return base;
}

/** Script.get_global_name() is the source `class_name`, or empty when the script has none. */
export function godotScriptGlobalName(script: unknown): string {
  const object = requireObject(script, 'Script.get_global_name');
  const name = (object as Partial<GodotScriptResource>).global_name;
  if (typeof name !== 'string')
    throw new Error('Script.get_global_name requires a translated Script resource.');
  return name;
}

function isReflectable(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function requireObject(receiver: unknown, member: string): object {
  if (!isReflectable(receiver)) {
    throw new Error(`godot-compat: Object.${member} requires a live Object receiver.`);
  }
  if (isGodotObjectFreed(receiver))
    throw new Error(`godot-compat: Object.${member} called on a freed Object.`);
  return receiver;
}

export interface GodotFreeTree {
  isInsideTree(node: object): boolean;
  detachedNode(node: object): void;
  readonly deferred: { isQueuedForDeletion(node: object): boolean };
}

/** Immediate Object.free over retained Pixi/Three/Resource identities. */
export function godotObjectFree(tree: GodotFreeTree, receiver: unknown): void {
  const object = requireObject(receiver, 'free');
  const retainedNative = godotObjectNative(object);
  const nativeObject = isReflectable(retainedNative) ? retainedNative : object;
  const insideTree = tree.isInsideTree(nativeObject);
  const native = nativeObject as {
    children?: readonly object[];
    removeFromParent?: () => void;
    destroy?: (options?: unknown) => void;
    dispose?: () => void;
    geometry?: { dispose?: () => void };
    material?: unknown;
  };
  const nativeSubtree: object[] = [];
  const collect = (one: object): void => {
    nativeSubtree.push(one);
    const children = (one as { children?: readonly object[] }).children;
    if (children !== undefined) for (const child of children) collect(child);
  };
  collect(nativeObject);
  native.removeFromParent?.();
  if (insideTree) tree.detachedNode(nativeObject);
  for (const one of nativeSubtree.reverse()) releaseGodotObjectNativeBindings(one);
  native.destroy?.({ children: true });
  native.geometry?.dispose?.();
  for (const material of Array.isArray(native.material) ? native.material : [native.material]) {
    (material as { dispose?: () => void } | undefined)?.dispose?.();
  }
  native.dispose?.();
  if (nativeObject !== object) markGodotObjectFreed(nativeObject);
  markGodotObjectFreed(object);
}

export function godotObjectIsQueuedForDeletion(tree: GodotFreeTree, receiver: unknown): boolean {
  return tree.deferred.isQueuedForDeletion(requireObject(receiver, 'is_queued_for_deletion'));
}

function requireMetadataName(name: unknown, member: string): string {
  if (typeof name !== 'string') {
    throw new Error(`godot-compat: Object.${member} requires a String/StringName metadata key.`);
  }
  return name;
}

/** Object::set_meta; NIL removes the entry in both pinned 3.6.2 and 4.7 sources. */
export function godotObjectSetMeta(receiver: unknown, name: unknown, value: unknown): void {
  const object = requireObject(receiver, 'set_meta');
  const key = requireMetadataName(name, 'set_meta');
  if (value === null) {
    objectMetadata.get(object)?.delete(key);
    return;
  }
  let metadata = objectMetadata.get(object);
  if (metadata === undefined) {
    metadata = new Map();
    objectMetadata.set(object, metadata);
  }
  metadata.set(key, value);
}

/** Object::get_meta, including its diagnostic+NIL result when no non-NIL default was supplied. */
export function godotObjectGetMeta(
  receiver: unknown,
  name: unknown,
  hasDefault: boolean,
  defaultValue: unknown = null,
): unknown {
  const object = requireObject(receiver, 'get_meta');
  const key = requireMetadataName(name, 'get_meta');
  const metadata = objectMetadata.get(object);
  if (metadata?.has(key) === true) return metadata.get(key);
  // In Object::get_meta a NIL default is the sentinel too: explicitly passing null still emits the
  // engine error and returns NIL. Keep that observable distinction from a non-NIL fallback.
  if (hasDefault && defaultValue !== null) return defaultValue;
  console.error(`godot-compat: The object does not have any 'meta' values with the key '${key}'.`);
  return null;
}

export function godotObjectHasMeta(receiver: unknown, name: unknown): boolean {
  const object = requireObject(receiver, 'has_meta');
  return objectMetadata.get(object)?.has(requireMetadataName(name, 'has_meta')) === true;
}

export function godotObjectRemoveMeta(receiver: unknown, name: unknown): void {
  const object = requireObject(receiver, 'remove_meta');
  objectMetadata.get(object)?.delete(requireMetadataName(name, 'remove_meta'));
}

/** Seed the metadata serialized beside an authored scene/resource object and preserve identity. */
export function godotObjectSeedMetadata<T extends object>(
  receiver: T,
  entries: readonly (readonly [string, unknown])[],
): T {
  for (const [name, value] of entries) godotObjectSetMeta(receiver, name, value);
  return receiver;
}

/**
 * Object::get_meta_list for the measured Godot 3 surface. Godot 3's Dictionary is backed by an
 * OrderedHashMap and therefore returns insertion order. Godot 4 changed metadata to HashMap; its
 * unspecified iteration order cannot be recreated from JavaScript's ordered Map, so that dialect
 * stays loud until an exact carrier records the native order.
 */
export function godotObjectGetMetaList(receiver: unknown, major: 3 | 4): PackedStringArray {
  const object = requireObject(receiver, 'get_meta_list');
  if (major === 4) {
    throw new Error(
      'godot-compat: Object.get_meta_list has unspecified HashMap order in Godot 4; exact ordering requires an authored/native order carrier.',
    );
  }
  return packedStringArray(objectMetadata.get(object)?.keys() ?? []);
}

function carriedGodotClass(receiver: unknown): string {
  const object = requireObject(receiver, 'get_class');
  const bound = objectBindings.get(object);
  if (bound !== undefined) return bound.godotClass;
  const declared = Reflect.get(object, '__godotClass');
  if (typeof declared === 'string') return declared;
  const userData = Reflect.get(object, 'userData');
  if (typeof userData === 'object' && userData !== null) {
    const marked = Reflect.get(userData, GODOT_CLASS_KEY);
    if (typeof marked === 'string') return marked;
  }
  throw new Error(
    'godot-compat: Object.get_class reached an object without an emitted native Godot class ' +
      'carrier; JavaScript constructor names and script class_name are not ClassDB identity.',
  );
}

/** Native engine class only; translated script `class_name` never substitutes for ClassDB. */
export function godotObjectGetClass(receiver: unknown): string {
  return carriedGodotClass(receiver);
}

/** Native ClassDB ancestry, split by the exact source major because Resource's parent was renamed. */
export function godotObjectIsClass(receiver: unknown, className: unknown, major: 3 | 4): boolean {
  if (typeof className !== 'string') {
    throw new Error('godot-compat: Object.is_class requires a String/StringName class name.');
  }
  const parents = major === 3 ? GODOT_CLASS_PARENTS_3 : GODOT_CLASS_PARENTS_4;
  let current: string | undefined = carriedGodotClass(receiver);
  while (current !== undefined) {
    if (current === className) return true;
    current = parents[current];
  }
  return false;
}

/** Existing `node is EngineClass` backend over the same native identity carrier. */
export function godotIsA(receiver: unknown, className: string, major: 3 | 4): boolean {
  return godotObjectIsClass(receiver, className, major);
}

/**
 * GDScript's native-class `as` operation over an emitted engine Object.
 *
 * Godot lowers this to OPCODE_CAST_TO_NATIVE: nil stays nil, an Object whose ClassDB identity
 * derives from the requested native class is retained unchanged, and every other Object becomes
 * nil. The browser carrier therefore remains the one native Three/Pixi/Resource value; the
 * retained ClassDB binding supplies the ancestry check and no JavaScript constructor identity is
 * allowed to stand in for it.
 */
export function godotObjectClassCast<T extends object = object>(
  receiver: unknown,
  className: string,
  major: 3 | 4,
): T | null {
  if (!isReflectable(receiver)) return null;
  return godotObjectIsClass(receiver, className, major) ? (receiver as T) : null;
}

export function godotObjectBindingOf(receiver: unknown): GodotObjectBinding {
  if (!isReflectable(receiver)) {
    throw new Error('godot-compat: Object dynamic dispatch received a non-object value.');
  }
  const binding = objectBindings.get(receiver);
  if (binding === undefined) {
    throw new Error(
      'godot-compat: Object dynamic dispatch reached an unregistered value. Engine-backed ' +
        'objects must carry a proven Godot class binding; arbitrary JavaScript reflection is ' +
        'refused because it can bypass native aliases.',
    );
  }
  return binding;
}

/** Native Node/Object identity retained behind one translated ScriptInstance.
 *
 * GDScript's value is its ScriptInstance while ClassDB and SceneTree operate on the native owner
 * allocated by Script.new(). The binding is the single exact relation between those identities;
 * callers must not inspect a generated class for a conveniently named `node` property.
 */
export function godotObjectNative(receiver: unknown): unknown {
  if (!isReflectable(receiver)) return receiver;
  return objectBindings.get(receiver)?.native ?? receiver;
}

/** ScriptInstance value belonging to one retained native owner, or the native value itself. */
export function godotObjectScriptValue(native: unknown): unknown {
  return isReflectable(native) ? (scriptValuesByNative.get(native) ?? native) : native;
}

/**
 * Read a statically bound ClassDB property through the same executable compat declaration used by
 * Object.get. The compiler contributes only the already-bound property name; receiver adaptation
 * and runtime meaning remain entirely in copied compat.
 */
export interface GodotBoundReceiver {
  readonly value: object;
  readonly native: unknown;
  readonly scene?: unknown;
  readonly context?: unknown;
}

function explicitBinding(
  dispatch: GodotObjectClassDispatch,
  godotClass: string,
  receiver: GodotBoundReceiver,
): GodotObjectBinding {
  return { godotClass, dispatch, ...receiver };
}

export function godotBoundPropertyGet<T = unknown>(
  dispatch: GodotObjectClassDispatch,
  godotClass: string,
  receiver: GodotBoundReceiver,
  property: string,
): T {
  const binding = explicitBinding(dispatch, godotClass, receiver);
  const native = binding.dispatch.properties[property] ?? binding.dispatch.signals[property];
  if (native === undefined || native === null || native.get === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${property} has no readable compatibility binding.`,
    );
  }
  return native.get(binding) as T;
}

/** Write a statically bound ClassDB property through its executable compat declaration. */
export function godotBoundPropertySet(
  dispatch: GodotObjectClassDispatch,
  godotClass: string,
  receiver: GodotBoundReceiver,
  property: string,
  value: unknown,
): void {
  const binding = explicitBinding(dispatch, godotClass, receiver);
  const native = binding.dispatch.properties[property];
  if (native === undefined || native === null || native.set === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${property} has no writable compatibility binding.`,
    );
  }
  native.set(binding, value);
}

/** Invoke a statically bound ClassDB method through its executable compat declaration. */
export function godotBoundMethodCall<T = unknown>(
  dispatch: GodotObjectClassDispatch,
  godotClass: string,
  receiver: GodotBoundReceiver,
  method: string,
  args: readonly unknown[],
): T {
  const binding = explicitBinding(dispatch, godotClass, receiver);
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no callable compatibility binding.`,
    );
  }
  return native.call(binding, args) as T;
}

/**
 * Capture one statically resolved ClassDB method as Godot's standard Callable value.
 *
 * This is the value-form twin of {@link godotBoundMethodCall}: the compiler contributes the same
 * pinned class, executable dispatch row, adapted receiver and method name, while copied compat
 * retains both the invocation and Callable identity semantics. A generated/native method does not
 * have to be installed as a JavaScript property on the retained object for expressions such as
 * `player.play.call_deferred()` to remain valid.
 */
export function godotBoundMethodCallable(
  dispatch: GodotObjectClassDispatch,
  godotClass: string,
  receiver: GodotBoundReceiver,
  method: string,
  argumentCount?: number,
): GodotCallable {
  const binding = explicitBinding(dispatch, godotClass, receiver);
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no callable compatibility binding.`,
    );
  }
  return GodotCallable.standard(binding.value, method, argumentCount, (...args) =>
    native.call(binding, args),
  );
}

/** Construct one ClassDB object through the class' executable compatibility declaration. */
export function godotBoundConstruct<T = unknown>(
  dispatch: GodotObjectClassDispatch,
  godotClass: string,
  context: unknown,
  args: readonly unknown[],
): T {
  if (dispatch.construct === undefined) {
    throw new Error(`godot-compat: ${godotClass}.new has no constructor compatibility binding.`);
  }
  return dispatch.construct(context, args) as T;
}

const bindingOf = godotObjectBindingOf;

type OpenNodePresentationProperty =
  | 'name'
  | 'visible'
  | 'environment'
  | 'transform'
  | 'rotation'
  | 'translation'
  | 'color'
  | 'text'
  | 'texture'
  | 'shape'
  | 'disabled'
  | 'editable'
  | 'placeholder_text'
  | 'button_pressed'
  | 'pressed'
  | 'selected'
  | 'current_tab'
  | 'item_count'
  | 'collision_layer'
  | 'collision_mask'
  | 'input_pickable'
  | 'monitoring'
  | 'monitorable'
  | 'value'
  | 'min_value'
  | 'max_value'
  | 'playing'
  | 'stream'
  | 'volume_db'
  | 'pitch_scale'
  | 'animation'
  | 'autoplay'
  | 'speed_scale'
  | 'current_animation'
  | 'stream_paused'
  | 'bus'
  | 'linear_velocity'
  | 'angular_velocity'
  | 'gravity_scale'
  | 'velocity'
  | 'mass'
  | 'sleeping'
  | 'lock_rotation'
  | 'freeze'
  | 'linear_damp'
  | 'angular_damp';
type OpenNodePresentationMethod =
  | 'hide'
  | 'show'
  | 'play'
  | 'start'
  | 'grab_focus'
  | 'release_focus'
  | 'has_focus';
export type OpenNodeAnimationPlaybackMethod =
  | 'stop'
  | 'pause'
  | 'seek'
  | 'is_playing'
  | 'play_backwards'
  | 'queue'
  | 'clear_queue'
  | 'advance'
  | 'set_speed_scale'
  | 'get_speed_scale'
  | 'set_current_animation'
  | 'get_current_animation'
  | 'get_current_animation_length'
  | 'get_current_animation_position'
  | 'get_playing_speed';
export type OpenNodeTimerProperty = 'wait_time' | 'one_shot' | 'time_left';
export type OpenNodeTimerMethod =
  | 'is_stopped'
  | 'get_time_left'
  | 'set_wait_time'
  | 'get_wait_time'
  | 'set_one_shot'
  | 'is_one_shot';
export type OpenNodeMediaPlaybackMethod =
  | 'get_playback_position'
  | 'set_volume_db'
  | 'get_volume_db'
  | 'set_pitch_scale'
  | 'get_pitch_scale'
  | 'set_stream_paused'
  | 'get_stream_paused'
  | 'set_bus'
  | 'get_bus';
export type OpenNodeCameraProperty =
  | 'current'
  | 'enabled'
  | 'fov'
  | 'near'
  | 'far'
  | 'projection'
  | 'zoom'
  | 'offset'
  | 'size'
  | 'keep_aspect'
  | 'cull_mask'
  | 'frustum_offset'
  | 'anchor_mode'
  | 'ignore_rotation'
  | 'position_smoothing_enabled'
  | 'smoothing_enabled'
  | 'position_smoothing_speed'
  | 'limit_left'
  | 'limit_right'
  | 'limit_top'
  | 'limit_bottom'
  | 'limit_smoothed'
  | 'drag_horizontal_enabled'
  | 'drag_vertical_enabled'
  | 'drag_left_margin'
  | 'drag_right_margin'
  | 'drag_top_margin'
  | 'drag_bottom_margin';
export type OpenNodeCameraMethod =
  | 'make_current'
  | 'clear_current'
  | 'is_current'
  | 'project_ray_origin'
  | 'project_ray_normal'
  | 'unproject_position'
  | 'project_position'
  | 'align'
  | 'force_update_scroll'
  | 'reset_smoothing'
  | 'get_camera_screen_center'
  | 'get_screen_center_position'
  | 'get_target_position'
  | 'get_anchor_mode'
  | 'set_anchor_mode'
  | 'get_drag_margin'
  | 'set_drag_margin'
  | 'get_limit'
  | 'set_limit'
  | 'set_ignore_rotation'
  | 'is_ignoring_rotation'
  | 'set_position_smoothing_enabled'
  | 'is_position_smoothing_enabled'
  | 'set_position_smoothing_speed'
  | 'get_position_smoothing_speed'
  | 'is_position_behind'
  | 'is_position_in_frustum'
  | 'get_cull_mask'
  | 'set_cull_mask'
  | 'get_cull_mask_value'
  | 'set_cull_mask_value'
  | 'get_far'
  | 'set_far'
  | 'get_near'
  | 'set_near'
  | 'get_size'
  | 'set_size'
  | 'set_current';
type OpenNodePhysicsMethod =
  | 'move_and_slide'
  | 'move_and_collide'
  | 'is_on_floor'
  | 'is_on_wall'
  | 'is_on_ceiling'
  | 'apply_central_impulse'
  | 'apply_impulse'
  | 'get_slide_count'
  | 'get_slide_collision'
  | 'get_last_slide_collision'
  | 'get_floor_normal'
  | 'get_wall_normal'
  | 'get_last_motion'
  | 'get_position_delta'
  | 'get_real_velocity';
type OpenNodeRigidBodyStateMethod =
  | 'set_mass'
  | 'get_mass'
  | 'set_sleeping'
  | 'is_sleeping'
  | 'set_freeze_enabled'
  | 'is_freeze_enabled'
  | 'set_linear_damp'
  | 'get_linear_damp'
  | 'set_angular_damp'
  | 'get_angular_damp';
type OpenNodeRigidBodyForceMethod =
  | 'add_central_force'
  | 'add_force'
  | 'add_torque'
  | 'apply_central_force'
  | 'apply_force'
  | 'apply_torque'
  | 'add_constant_central_force'
  | 'add_constant_force'
  | 'add_constant_torque'
  | 'set_constant_force'
  | 'get_constant_force'
  | 'set_constant_torque'
  | 'get_constant_torque';
type OpenNodeProcessMethod =
  | 'set_process'
  | 'set_physics_process'
  | 'is_processing'
  | 'is_physics_processing';
type OpenNodeContextMethod = 'get_tree' | 'get_viewport' | 'get_world_2d' | 'get_world_3d';
type OpenNodeUiMethod =
  | 'accept_event'
  | 'get_combined_minimum_size'
  | 'get_minimum_size'
  | 'minimum_size_changed'
  | 'update_minimum_size'
  | 'reset_size'
  | 'update'
  | 'queue_redraw';
type OpenNodeCollisionAreaMethod =
  | 'get_collision_layer'
  | 'set_collision_layer'
  | 'get_collision_mask'
  | 'set_collision_mask'
  | 'is_monitoring'
  | 'set_monitoring'
  | 'is_monitorable'
  | 'set_monitorable'
  | 'get_collision_layer_bit'
  | 'set_collision_layer_bit'
  | 'get_collision_mask_bit'
  | 'set_collision_mask_bit'
  | 'get_collision_layer_value'
  | 'set_collision_layer_value'
  | 'get_collision_mask_value'
  | 'set_collision_mask_value'
  | 'set_pickable'
  | 'is_pickable';
type OpenNodeNativeSignal =
  | 'body_entered'
  | 'body_exited'
  | 'area_entered'
  | 'area_exited'
  | 'input_event'
  | 'mouse_entered'
  | 'mouse_exited'
  | 'pressed'
  | 'toggled'
  | 'value_changed'
  | 'text_changed'
  | 'item_selected'
  | 'animation_finished'
  | 'focus_entered'
  | 'focus_exited'
  | 'gui_input'
  | 'button_down'
  | 'button_up'
  | 'changed'
  | 'scrolling'
  | 'text_entered'
  | 'caret_changed'
  | 'item_clicked'
  | 'text_submitted'
  | 'tab_changed'
  | 'canceled'
  | 'timeout';

function openNodePresentationBinding(
  receiver: unknown,
  major: 3 | 4,
  member: string,
): GodotObjectBinding {
  if (!godotObjectIsClass(receiver, 'Node', major)) {
    throw new TypeError(
      `godot-compat: open Node.${member} requires a retained native Node identity.`,
    );
  }
  return bindingOf(receiver);
}

function requireRigidBodyStateOwner(
  binding: GodotObjectBinding,
  major: 3 | 4,
  property: OpenNodePresentationProperty,
): void {
  if (
    binding.godotClass !== 'RigidBody2D' &&
    binding.godotClass !== (major === 3 ? 'RigidBody' : 'RigidBody3D')
  ) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${property} is not an exact retained RigidBody state row.`,
    );
  }
}

function rigidBodyStateMethodProperty(
  method: OpenNodeRigidBodyStateMethod,
): 'mass' | 'sleeping' | 'freeze' | 'linear_damp' | 'angular_damp' {
  if (method === 'set_mass' || method === 'get_mass') return 'mass';
  if (method === 'set_sleeping' || method === 'is_sleeping') return 'sleeping';
  if (method === 'set_freeze_enabled' || method === 'is_freeze_enabled') return 'freeze';
  if (method === 'set_linear_damp' || method === 'get_linear_damp') return 'linear_damp';
  return 'angular_damp';
}

function requireRigidBodyStateValue(
  binding: GodotObjectBinding,
  property: 'mass' | 'sleeping' | 'freeze' | 'linear_damp' | 'angular_damp',
  value: unknown,
): void {
  if (property === 'mass' || property === 'linear_damp' || property === 'angular_damp') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires finite float.`);
    }
  } else if (typeof value !== 'boolean') {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires bool.`);
  }
}

type PhysicsMotionShape = 'float' | 'vector2' | 'vector3';

function physicsMotionShape(
  binding: GodotObjectBinding,
  major: 3 | 4,
  property: OpenNodePresentationProperty,
): PhysicsMotionShape | undefined {
  const className = binding.godotClass;
  const rigid2D = className === 'RigidBody2D';
  const rigid3D = major === 3 ? className === 'RigidBody' : className === 'RigidBody3D';
  const character2D = major === 4 && className === 'CharacterBody2D';
  const character3D = major === 4 && className === 'CharacterBody3D';
  if (property === 'linear_velocity') {
    if (rigid2D) return 'vector2';
    if (rigid3D) return 'vector3';
  }
  if (property === 'angular_velocity') {
    if (rigid2D) return 'float';
    if (rigid3D) return 'vector3';
  }
  if (property === 'gravity_scale' && (rigid2D || rigid3D)) return 'float';
  if (property === 'velocity') {
    if (character2D) return 'vector2';
    if (character3D) return 'vector3';
  }
  return undefined;
}

function requirePhysicsMotionValue(
  binding: GodotObjectBinding,
  major: 3 | 4,
  property: OpenNodePresentationProperty,
  value: unknown,
): void {
  const shape = physicsMotionShape(binding, major, property);
  if (shape === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${property} is not an exact retained physics-motion row.`,
    );
  }
  if (shape === 'float') {
    if (typeof value === 'number' && Number.isFinite(value)) return;
  } else if (typeof value === 'object' && value !== null) {
    const x = Reflect.get(value, 'x');
    const y = Reflect.get(value, 'y');
    const z = Reflect.get(value, 'z');
    if (
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y) &&
      (shape === 'vector2' ? z === undefined : typeof z === 'number' && Number.isFinite(z))
    )
      return;
  }
  throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires ${shape}.`);
}

/** Exact generated native property dispatch for a statically open/base Node receiver. */
export function godotOpenNodePresentationGet(
  receiver: unknown,
  major: 3 | 4,
  property: OpenNodePresentationProperty,
): unknown {
  const binding = openNodePresentationBinding(receiver, major, property);
  if (binding.scriptMembers?.has(property) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${property} is owned by a translated script field; ` +
        'native presentation dispatch is refused.',
    );
  }
  if (major === 3 && (property === 'lock_rotation' || property === 'freeze')) {
    throw new Error(
      `godot-compat: ${property} is a Godot 4 RigidBody property and is not declared by Godot 3.`,
    );
  }
  if (
    property === 'mass' ||
    property === 'sleeping' ||
    property === 'lock_rotation' ||
    property === 'freeze' ||
    property === 'linear_damp' ||
    property === 'angular_damp'
  ) {
    requireRigidBodyStateOwner(binding, major, property);
  }
  const native = binding.dispatch.properties[property];
  if (native === undefined || native === null || native.get === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${property} has no exact native presentation getter.`,
    );
  }
  const value = native.get(binding);
  if (
    property === 'linear_velocity' ||
    property === 'angular_velocity' ||
    property === 'gravity_scale' ||
    property === 'velocity'
  ) {
    requirePhysicsMotionValue(binding, major, property, value);
  }
  if (
    (property === 'mass' || property === 'linear_damp' || property === 'angular_damp') &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${property} getter must return finite float.`,
    );
  }
  if (
    (property === 'sleeping' || property === 'lock_rotation' || property === 'freeze') &&
    typeof value !== 'boolean'
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} getter must return bool.`);
  }
  if (
    (property === 'disabled' ||
      property === 'editable' ||
      property === 'button_pressed' ||
      property === 'pressed' ||
      property === 'autoplay' ||
      property === 'input_pickable' ||
      property === 'stream_paused') &&
    typeof value !== 'boolean'
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} getter must return bool.`);
  }
  if (property === 'placeholder_text' && typeof value !== 'string') {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.placeholder_text getter must return String.`,
    );
  }
  if (
    (property === 'selected' || property === 'current_tab' || property === 'item_count') &&
    (typeof value !== 'number' || !Number.isInteger(value))
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} getter must return int.`);
  }
  if (
    (property === 'collision_layer' || property === 'collision_mask') &&
    (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)
  ) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${property} getter must return uint32.`,
    );
  }
  if ((property === 'monitoring' || property === 'monitorable') && typeof value !== 'boolean') {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} getter must return bool.`);
  }
  if (
    (property === 'value' ||
      property === 'min_value' ||
      property === 'max_value' ||
      property === 'speed_scale' ||
      property === 'volume_db' ||
      property === 'pitch_scale') &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${property} getter must return float.`,
    );
  }
  if ((property === 'animation' || property === 'current_animation') && typeof value !== 'string') {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${property} getter must return StringName/String.`,
    );
  }
  if (property === 'bus' && typeof value !== 'string') {
    throw new TypeError(`godot-compat: ${binding.godotClass}.bus getter must return StringName.`);
  }
  return value;
}

/** Exact generated native Signal value for a statically open/base Node receiver. */
export function godotOpenNodeNativeSignal(
  receiver: unknown,
  major: 3 | 4,
  signalName: OpenNodeNativeSignal,
): GodotSignal<readonly unknown[]> {
  const binding = openNodePresentationBinding(receiver, major, signalName);
  if (binding.scriptMembers?.has(signalName) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${signalName} is owned by a translated script ` +
        'member; native signal dispatch is refused.',
    );
  }
  const generated = binding.dispatch.signals[signalName];
  if (generated === undefined || generated === null || generated.get === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${signalName} has no exact retained native Signal row.`,
    );
  }
  const signal = generated.get(binding);
  if (!isRetainedGodotSignal(signal)) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${signalName} did not return a retained Signal identity.`,
    );
  }
  return signal;
}

/** Exact generated native property write; translated script fields and arbitrary JS are excluded. */
export function godotOpenNodePresentationSet(
  receiver: unknown,
  major: 3 | 4,
  property: OpenNodePresentationProperty,
  value: unknown,
): void {
  const binding = openNodePresentationBinding(receiver, major, property);
  if (binding.scriptMembers?.has(property) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${property} is owned by a translated script field; ` +
        'native presentation dispatch is refused.',
    );
  }
  if (
    property === 'linear_velocity' ||
    property === 'angular_velocity' ||
    property === 'gravity_scale' ||
    property === 'velocity'
  ) {
    requirePhysicsMotionValue(binding, major, property, value);
  }
  if (
    (property === 'mass' || property === 'linear_damp' || property === 'angular_damp') &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires finite float.`);
  }
  if (
    (property === 'sleeping' || property === 'lock_rotation' || property === 'freeze') &&
    typeof value !== 'boolean'
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires bool.`);
  }
  if (major === 3 && (property === 'lock_rotation' || property === 'freeze')) {
    throw new Error(
      `godot-compat: ${property} is a Godot 4 RigidBody property and is not declared by Godot 3.`,
    );
  }
  if (
    property === 'mass' ||
    property === 'sleeping' ||
    property === 'lock_rotation' ||
    property === 'freeze' ||
    property === 'linear_damp' ||
    property === 'angular_damp'
  ) {
    requireRigidBodyStateOwner(binding, major, property);
  }
  if (
    (property === 'disabled' ||
      property === 'editable' ||
      property === 'button_pressed' ||
      property === 'pressed' ||
      property === 'autoplay' ||
      property === 'input_pickable' ||
      property === 'stream_paused') &&
    typeof value !== 'boolean'
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires bool.`);
  }
  if (property === 'placeholder_text' && typeof value !== 'string') {
    throw new TypeError(`godot-compat: ${binding.godotClass}.placeholder_text requires String.`);
  }
  if (
    (property === 'selected' || property === 'current_tab' || property === 'item_count') &&
    (typeof value !== 'number' || !Number.isInteger(value))
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires int.`);
  }
  if (
    (property === 'collision_layer' || property === 'collision_mask') &&
    (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires uint32.`);
  }
  if ((property === 'monitoring' || property === 'monitorable') && typeof value !== 'boolean') {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires bool.`);
  }
  if (
    (property === 'value' ||
      property === 'min_value' ||
      property === 'max_value' ||
      property === 'speed_scale' ||
      property === 'volume_db' ||
      property === 'pitch_scale') &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires float.`);
  }
  if ((property === 'animation' || property === 'current_animation') && typeof value !== 'string') {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${property} requires StringName/String.`,
    );
  }
  if (property === 'bus' && typeof value !== 'string') {
    throw new TypeError(`godot-compat: ${binding.godotClass}.bus requires StringName/String.`);
  }
  const native = binding.dispatch.properties[property];
  if (native === undefined || native === null || native.set === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${property} has no exact native presentation setter.`,
    );
  }
  native.set(binding, value);
}

/** Exact generated native method dispatch for a statically open/base Node receiver. */
export function godotOpenNodePresentationCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodePresentationMethod,
  args: readonly unknown[] = [],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${method} is owned by a translated script override; ` +
        'native presentation dispatch is refused.',
    );
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact native presentation method.`,
    );
  }
  if (binding.godotClass === 'Timer' && method === 'start') {
    if (args.length > 1) {
      throw new TypeError(
        `godot-compat: Timer.start requires 0..1 argument(s), received ${args.length}.`,
      );
    }
  }
  if (method === 'play') {
    const maximum =
      binding.godotClass === 'AnimationPlayer'
        ? 4
        : binding.godotClass === 'AnimatedSprite'
          ? 2
          : binding.godotClass === 'AnimatedSprite2D' || binding.godotClass === 'AnimatedSprite3D'
            ? major === 3
              ? 1
              : 3
            : binding.godotClass.startsWith('AudioStreamPlayer')
              ? 1
              : binding.godotClass === 'VideoPlayer' || binding.godotClass === 'VideoStreamPlayer'
                ? 0
                : undefined;
    if (maximum !== undefined && args.length > maximum) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.play requires 0..${maximum} argument(s), ` +
          `received ${args.length}.`,
      );
    }
  }
  const result = native.call(binding, args);
  if (binding.godotClass === 'Timer' && method === 'start') {
    if (result !== undefined) {
      throw new TypeError('godot-compat: Timer.start must return void.');
    }
  }
  if (
    method === 'play' &&
    (binding.godotClass === 'AnimationPlayer' ||
      binding.godotClass.startsWith('AnimatedSprite') ||
      binding.godotClass.startsWith('AudioStreamPlayer') ||
      binding.godotClass === 'VideoPlayer' ||
      binding.godotClass === 'VideoStreamPlayer') &&
    result !== undefined
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.play must return void.`);
  }
  return result;
}

/** Exact generated Control/CanvasItem UI call for a statically open/base Node receiver. */
export function godotOpenNodeUiCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeUiMethod,
  args: readonly unknown[],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${method} is owned by a translated script ` +
        'override; native UI dispatch is refused.',
    );
  }
  if (
    method === 'update' || method === 'minimum_size_changed'
      ? major !== 3
      : method === 'queue_redraw' || method === 'update_minimum_size' || method === 'reset_size'
        ? major !== 4
        : false
  ) {
    throw new Error(`godot-compat: ${method} is not declared by Godot ${major}.`);
  }
  const redraw = method === 'update' || method === 'queue_redraw';
  const resetSize = method === 'reset_size';
  const validOwner = redraw
    ? godotObjectIsClass(receiver, 'CanvasItem', major)
    : resetSize
      ? godotObjectIsClass(receiver, 'Control', major) ||
        godotObjectIsClass(receiver, 'Window', major)
      : godotObjectIsClass(receiver, 'Control', major);
  if (!validOwner) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} is not an exact retained UI owner.`,
    );
  }
  if (args.length !== 0) {
    throw new TypeError(`godot-compat: ${method} takes no arguments.`);
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact generated native UI row.`,
    );
  }
  const result = native.call(binding, args);
  if (method === 'get_combined_minimum_size' || method === 'get_minimum_size') {
    if (
      typeof result !== 'object' ||
      result === null ||
      typeof Reflect.get(result, 'x') !== 'number' ||
      typeof Reflect.get(result, 'y') !== 'number'
    ) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return Vector2.`);
    }
  }
  return result;
}

const ANIMATION_PLAYBACK_CLASSES = new Set([
  'AnimationPlayer',
  'AnimatedSprite',
  'AnimatedSprite2D',
  'AnimatedSprite3D',
]);
const MEDIA_PLAYBACK_CLASSES = new Set([
  'AudioStreamPlayer',
  'AudioStreamPlayer2D',
  'AudioStreamPlayer3D',
  'VideoPlayer',
  'VideoStreamPlayer',
]);

function requireAnimationPlaybackArity(
  className: string,
  major: 3 | 4,
  method: OpenNodeAnimationPlaybackMethod,
  count: number,
): void {
  let minimum = 0;
  let maximum = 0;
  switch (method) {
    case 'seek':
      minimum = 1;
      maximum = MEDIA_PLAYBACK_CLASSES.has(className) ? 1 : major === 3 ? 2 : 3;
      break;
    case 'play_backwards':
      maximum = className === 'AnimationPlayer' ? 2 : 1;
      break;
    case 'stop':
      maximum = className === 'AnimationPlayer' ? 1 : 0;
      break;
    case 'queue':
    case 'advance':
    case 'set_speed_scale':
    case 'set_current_animation':
      minimum = 1;
      maximum = 1;
      break;
    default:
      break;
  }
  if (count < minimum || count > maximum) {
    const expected = minimum === maximum ? `${minimum}` : `${minimum}..${maximum}`;
    throw new TypeError(
      `godot-compat: ${className}.${method} requires ${expected} argument(s), received ${count}.`,
    );
  }
}

/** Exact generated playback row over the retained AnimationPlayer/AnimatedSprite native owner. */
export function godotOpenNodeAnimationPlaybackCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeAnimationPlaybackMethod,
  args: readonly unknown[] = [],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  const timerStop = binding.godotClass === 'Timer' && method === 'stop';
  const mediaMethod =
    MEDIA_PLAYBACK_CLASSES.has(binding.godotClass) &&
    (method === 'stop' || method === 'seek' || method === 'is_playing');
  if (!ANIMATION_PLAYBACK_CLASSES.has(binding.godotClass) && !timerStop && !mediaMethod) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} is not an animation playback owner.`,
    );
  }
  if (major === 3 && method === 'pause') {
    throw new Error('godot-compat: AnimationPlayer.pause is unavailable in Godot 3.');
  }
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${method} is owned by a translated script override; ` +
        'native animation dispatch is refused.',
    );
  }
  requireAnimationPlaybackArity(binding.godotClass, major, method, args.length);
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact native animation playback row.`,
    );
  }
  const result = native.call(binding, args);
  if (method === 'is_playing') {
    if (typeof result !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return bool.`);
    }
    return result;
  }
  if (method === 'get_current_animation') {
    if (typeof result !== 'string') {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} must return StringName/String.`,
      );
    }
    return result;
  }
  if (
    method === 'get_speed_scale' ||
    method === 'get_current_animation_length' ||
    method === 'get_current_animation_position' ||
    method === 'get_playing_speed'
  ) {
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} must return finite float.`,
      );
    }
    return result;
  }
  if (result !== undefined) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return void.`);
  }
  return undefined;
}

function mediaPlaybackBinding(receiver: unknown, major: 3 | 4, member: string) {
  const binding = openNodePresentationBinding(receiver, major, member);
  if (!MEDIA_PLAYBACK_CLASSES.has(binding.godotClass)) {
    throw new Error(`godot-compat: ${binding.godotClass}.${member} is not a media playback owner.`);
  }
  if (binding.scriptMembers?.has(member) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${member} is owned by a translated script ` +
        'override; native media dispatch is refused.',
    );
  }
  return binding;
}

/** Exact generated media method over the retained WebAudio/HTMLVideo playback owner. */
export function godotOpenNodeMediaPlaybackCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeMediaPlaybackMethod,
  args: readonly unknown[],
): unknown {
  const binding = mediaPlaybackBinding(receiver, major, method);
  const setter = method.startsWith('set_');
  const expected = setter ? 1 : 0;
  if (args.length !== expected) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${method} requires ${expected} argument(s), ` +
        `received ${args.length}.`,
    );
  }
  if (
    (method === 'set_volume_db' || method === 'set_pitch_scale') &&
    (typeof args[0] !== 'number' || !Number.isFinite(args[0]))
  ) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires finite float.`);
  }
  if (method === 'set_stream_paused' && typeof args[0] !== 'boolean') {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires bool.`);
  }
  if (method === 'set_bus' && typeof args[0] !== 'string') {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${method} requires StringName/String.`,
    );
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact native media playback row.`,
    );
  }
  const result = native.call(binding, args);
  if (setter) {
    if (result !== undefined) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return void.`);
    }
    return undefined;
  }
  if (method === 'get_stream_paused') {
    if (typeof result !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return bool.`);
    }
    return result;
  }
  if (method === 'get_bus') {
    if (typeof result !== 'string') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return StringName.`);
    }
    return result;
  }
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return finite float.`);
  }
  return result;
}

const CAMERA_CLASSES = new Set(['Camera', 'Camera2D', 'Camera3D']);

function cameraBinding(receiver: unknown, major: 3 | 4, member: string) {
  const binding = openNodePresentationBinding(receiver, major, member);
  if (!CAMERA_CLASSES.has(binding.godotClass)) {
    throw new Error(`godot-compat: ${binding.godotClass}.${member} is not a Camera owner.`);
  }
  if (binding.scriptMembers?.has(member) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${member} is owned by a translated script ` +
        'override; native camera dispatch is refused.',
    );
  }
  return binding;
}

function requireFiniteVector(value: unknown, dimensions: 2 | 3, member: string): void {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`godot-compat: ${member} must return Vector${dimensions}.`);
  }
  const candidate = value as { x?: unknown; y?: unknown; z?: unknown };
  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y) ||
    (dimensions === 3 && (typeof candidate.z !== 'number' || !Number.isFinite(candidate.z)))
  ) {
    throw new TypeError(`godot-compat: ${member} must return finite Vector${dimensions}.`);
  }
}

export function godotOpenNodeCameraGet(
  receiver: unknown,
  major: 3 | 4,
  property: OpenNodeCameraProperty,
): unknown {
  const binding = cameraBinding(receiver, major, property);
  const native = binding.dispatch.properties[property];
  if (native === undefined || native === null || native.get === undefined) {
    throw new Error(`godot-compat: ${binding.godotClass}.${property} has no exact camera getter.`);
  }
  const result = native.get(binding);
  if (
    property === 'current' ||
    property === 'enabled' ||
    property === 'ignore_rotation' ||
    property === 'position_smoothing_enabled' ||
    property === 'smoothing_enabled' ||
    property === 'limit_smoothed' ||
    property === 'drag_horizontal_enabled' ||
    property === 'drag_vertical_enabled'
  ) {
    if (typeof result !== 'boolean')
      throw new TypeError(`godot-compat: ${binding.godotClass}.${property} must return bool.`);
  } else if (
    property === 'projection' ||
    property === 'keep_aspect' ||
    property === 'cull_mask' ||
    property === 'anchor_mode' ||
    property === 'limit_left' ||
    property === 'limit_right' ||
    property === 'limit_top' ||
    property === 'limit_bottom'
  ) {
    if (typeof result !== 'number' || !Number.isInteger(result))
      throw new TypeError(`godot-compat: ${binding.godotClass}.${property} must return int.`);
  } else if (property === 'zoom' || property === 'offset' || property === 'frustum_offset') {
    requireFiniteVector(result, 2, `${binding.godotClass}.${property}`);
  } else if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${property} must return finite float.`,
    );
  }
  return result;
}

export function godotOpenNodeCameraSet(
  receiver: unknown,
  major: 3 | 4,
  property: OpenNodeCameraProperty,
  value: unknown,
): void {
  const binding = cameraBinding(receiver, major, property);
  if (
    property === 'current' ||
    property === 'enabled' ||
    property === 'ignore_rotation' ||
    property === 'position_smoothing_enabled' ||
    property === 'smoothing_enabled' ||
    property === 'limit_smoothed' ||
    property === 'drag_horizontal_enabled' ||
    property === 'drag_vertical_enabled'
  ) {
    if (typeof value !== 'boolean')
      throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires bool.`);
  } else if (
    property === 'projection' ||
    property === 'keep_aspect' ||
    property === 'cull_mask' ||
    property === 'anchor_mode' ||
    property === 'limit_left' ||
    property === 'limit_right' ||
    property === 'limit_top' ||
    property === 'limit_bottom'
  ) {
    if (typeof value !== 'number' || !Number.isInteger(value))
      throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires int.`);
  } else if (property === 'zoom' || property === 'offset' || property === 'frustum_offset') {
    requireFiniteVector(value, 2, `${binding.godotClass}.${property}`);
  } else if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${property} requires finite float.`);
  }
  const native = binding.dispatch.properties[property];
  if (native === undefined || native === null || native.set === undefined) {
    throw new Error(`godot-compat: ${binding.godotClass}.${property} has no exact camera setter.`);
  }
  native.set(binding, value);
}

export function godotOpenNodeCameraCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeCameraMethod,
  args: readonly unknown[],
): unknown {
  const binding = cameraBinding(receiver, major, method);
  const expected =
    method === 'project_position' ||
    method === 'set_cull_mask_value' ||
    method === 'set_drag_margin' ||
    method === 'set_limit'
      ? 2
      : method === 'project_ray_origin' ||
          method === 'project_ray_normal' ||
          method === 'unproject_position' ||
          method === 'is_position_behind' ||
          method === 'is_position_in_frustum' ||
          method === 'get_cull_mask_value' ||
          method === 'set_cull_mask' ||
          method === 'set_far' ||
          method === 'set_near' ||
          method === 'set_size' ||
          method === 'set_current' ||
          method === 'set_anchor_mode' ||
          method === 'get_drag_margin' ||
          method === 'get_limit' ||
          method === 'set_ignore_rotation' ||
          method === 'set_position_smoothing_enabled' ||
          method === 'set_position_smoothing_speed'
        ? 1
        : 0;
  if (args.length !== expected) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${method} requires ${expected} argument(s), received ${args.length}.`,
    );
  }
  if (method === 'is_position_behind' || method === 'is_position_in_frustum') {
    requireFiniteVector(args[0], 3, `${binding.godotClass}.${method} argument`);
  } else if (method === 'get_cull_mask_value') {
    if (typeof args[0] !== 'number' || !Number.isInteger(args[0])) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires an int layer.`);
    }
  } else if (method === 'set_cull_mask_value') {
    if (typeof args[0] !== 'number' || !Number.isInteger(args[0]) || typeof args[1] !== 'boolean') {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} requires int layer and bool enabled.`,
      );
    }
  } else if (method === 'set_cull_mask') {
    if (typeof args[0] !== 'number' || !Number.isInteger(args[0])) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires int.`);
    }
  } else if (method === 'set_current') {
    if (typeof args[0] !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires bool.`);
    }
  } else if (method === 'set_far' || method === 'set_near' || method === 'set_size') {
    if (typeof args[0] !== 'number' || !Number.isFinite(args[0])) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires finite float.`);
    }
  } else if (
    method === 'set_anchor_mode' ||
    method === 'get_drag_margin' ||
    method === 'get_limit'
  ) {
    if (typeof args[0] !== 'number' || !Number.isInteger(args[0])) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires int.`);
    }
  } else if (method === 'set_drag_margin') {
    if (
      typeof args[0] !== 'number' ||
      !Number.isInteger(args[0]) ||
      typeof args[1] !== 'number' ||
      !Number.isFinite(args[1])
    ) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} requires int side and finite float margin.`,
      );
    }
  } else if (method === 'set_limit') {
    if (
      typeof args[0] !== 'number' ||
      !Number.isInteger(args[0]) ||
      typeof args[1] !== 'number' ||
      !Number.isInteger(args[1])
    ) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} requires int side and int limit.`,
      );
    }
  } else if (method === 'set_ignore_rotation' || method === 'set_position_smoothing_enabled') {
    if (typeof args[0] !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires bool.`);
    }
  } else if (method === 'set_position_smoothing_speed') {
    if (typeof args[0] !== 'number' || !Number.isFinite(args[0])) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} requires finite float.`);
    }
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(`godot-compat: ${binding.godotClass}.${method} has no exact camera method.`);
  }
  const result = native.call(binding, args);
  if (method === 'is_current') {
    if (typeof result !== 'boolean')
      throw new TypeError(`godot-compat: ${binding.godotClass}.is_current must return bool.`);
    return result;
  }
  if (method === 'is_position_behind' || method === 'is_position_in_frustum') {
    if (typeof result !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return bool.`);
    }
    return result;
  }
  if (method === 'get_cull_mask_value') {
    if (typeof result !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return bool.`);
    }
    return result;
  }
  if (method === 'get_cull_mask') {
    if (typeof result !== 'number' || !Number.isInteger(result)) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return int.`);
    }
    return result;
  }
  if (method === 'get_far' || method === 'get_near' || method === 'get_size') {
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} must return finite float.`,
      );
    }
    return result;
  }
  if (method === 'get_anchor_mode' || method === 'get_limit') {
    if (typeof result !== 'number' || !Number.isInteger(result)) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return int.`);
    }
    return result;
  }
  if (method === 'get_drag_margin' || method === 'get_position_smoothing_speed') {
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} must return finite float.`,
      );
    }
    return result;
  }
  if (method === 'is_ignoring_rotation' || method === 'is_position_smoothing_enabled') {
    if (typeof result !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return bool.`);
    }
    return result;
  }
  if (
    method === 'project_ray_origin' ||
    method === 'project_ray_normal' ||
    method === 'project_position'
  ) {
    requireFiniteVector(result, 3, `${binding.godotClass}.${method}`);
    return result;
  }
  if (method === 'unproject_position') {
    requireFiniteVector(result, 2, `${binding.godotClass}.${method}`);
    return result;
  }
  if (
    method === 'get_camera_screen_center' ||
    method === 'get_screen_center_position' ||
    method === 'get_target_position'
  ) {
    requireFiniteVector(result, 2, `${binding.godotClass}.${method}`);
    return result;
  }
  if (result !== undefined)
    throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return void.`);
  return undefined;
}

function timerBinding(receiver: unknown, major: 3 | 4, member: string) {
  const binding = openNodePresentationBinding(receiver, major, member);
  if (binding.godotClass !== 'Timer') {
    throw new Error(`godot-compat: ${binding.godotClass}.${member} is not a Timer owner.`);
  }
  if (binding.scriptMembers?.has(member) === true) {
    throw new Error(
      `godot-compat: open Timer.${member} is owned by a translated script override; ` +
        'native timer dispatch is refused.',
    );
  }
  return binding;
}

/** Exact retained scheduler-backed Timer property read. */
export function godotOpenNodeTimerGet(
  receiver: unknown,
  major: 3 | 4,
  property: OpenNodeTimerProperty,
): number | boolean {
  const binding = timerBinding(receiver, major, property);
  const native = binding.dispatch.properties[property];
  if (native === undefined || native === null || native.get === undefined) {
    throw new Error(`godot-compat: Timer.${property} has no exact native timer getter.`);
  }
  const value = native.get(binding);
  if (property === 'one_shot') {
    if (typeof value !== 'boolean')
      throw new TypeError('godot-compat: Timer.one_shot must be bool.');
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`godot-compat: Timer.${property} must be finite float.`);
  }
  return value;
}

/** Exact retained scheduler-backed Timer property write. */
export function godotOpenNodeTimerSet(
  receiver: unknown,
  major: 3 | 4,
  property: Exclude<OpenNodeTimerProperty, 'time_left'>,
  value: unknown,
): void {
  const binding = timerBinding(receiver, major, property);
  const native = binding.dispatch.properties[property];
  if (native === undefined || native === null || native.set === undefined) {
    throw new Error(`godot-compat: Timer.${property} has no exact native timer setter.`);
  }
  native.set(binding, value);
}

/** Exact retained scheduler-backed Timer method dispatch. */
export function godotOpenNodeTimerCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeTimerMethod,
  args: readonly unknown[],
): unknown {
  const binding = timerBinding(receiver, major, method);
  const setter = method === 'set_wait_time' || method === 'set_one_shot';
  const expected = setter ? 1 : 0;
  if (args.length !== expected) {
    throw new TypeError(
      `godot-compat: Timer.${method} requires ${expected} argument(s), received ${args.length}.`,
    );
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(`godot-compat: Timer.${method} has no exact native timer method.`);
  }
  const result = native.call(binding, args);
  if (setter) {
    if (result !== undefined)
      throw new TypeError(`godot-compat: Timer.${method} must return void.`);
    return undefined;
  }
  if (method === 'is_stopped' || method === 'is_one_shot') {
    if (typeof result !== 'boolean')
      throw new TypeError(`godot-compat: Timer.${method} must return bool.`);
    return result;
  }
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new TypeError(`godot-compat: Timer.${method} must return finite float.`);
  }
  return result;
}

/** Exact generated CollisionObject/Area method row for a statically open/base Node receiver. */
export function godotOpenNodeCollisionAreaCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeCollisionAreaMethod,
  args: readonly unknown[],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${method} is owned by a translated script override; ` +
        'native collision/Area dispatch is refused.',
    );
  }
  const bitMethod = method.endsWith('_bit');
  const valueMethod = method.endsWith('_value');
  if ((bitMethod && major !== 3) || (valueMethod && major !== 4)) {
    throw new Error(`godot-compat: ${method} is not declared by Godot ${major}.`);
  }
  const perLayer = bitMethod || valueMethod;
  const setter = method.startsWith('set_');
  const expected = perLayer ? (setter ? 2 : 1) : setter ? 1 : 0;
  if (args.length !== expected) {
    throw new TypeError(
      `godot-compat: ${method} requires exactly ${expected} argument${expected === 1 ? '' : 's'}.`,
    );
  }
  const layerSetter = method === 'set_collision_layer' || method === 'set_collision_mask';
  if (
    layerSetter &&
    (typeof args[0] !== 'number' ||
      !Number.isSafeInteger(args[0]) ||
      args[0] < 0 ||
      args[0] > 0xffff_ffff)
  ) {
    throw new TypeError(`godot-compat: ${method} requires uint32.`);
  }
  if (
    (method === 'set_monitoring' || method === 'set_monitorable' || method === 'set_pickable') &&
    typeof args[0] !== 'boolean'
  ) {
    throw new TypeError(`godot-compat: ${method} requires bool.`);
  }
  if (perLayer) {
    const index = args[0];
    const minimum = major === 3 ? 0 : 1;
    const maximum = major === 3 ? 31 : 32;
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < minimum ||
      index > maximum
    ) {
      throw new RangeError(`godot-compat: ${method} layer index must be ${minimum}..${maximum}.`);
    }
    if (setter && typeof args[1] !== 'boolean') {
      throw new TypeError(`godot-compat: ${method} enabled argument requires bool.`);
    }
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact generated collision/Area row.`,
    );
  }
  const result = native.call(binding, args);
  if (method === 'get_collision_layer' || method === 'get_collision_mask') {
    if (
      typeof result !== 'number' ||
      !Number.isSafeInteger(result) ||
      result < 0 ||
      result > 0xffff_ffff
    ) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return uint32.`);
    }
  } else if (
    method === 'is_monitoring' ||
    method === 'is_monitorable' ||
    method === 'is_pickable' ||
    (perLayer && !setter)
  ) {
    if (typeof result !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return bool.`);
    }
  }
  return result;
}

function requireOpenPhysicsMethodArity(
  major: 3 | 4,
  method: OpenNodePhysicsMethod,
  args: readonly unknown[],
): void {
  let minimum = 0;
  let maximum = 0;
  if (method === 'move_and_slide') {
    minimum = major === 3 ? 1 : 0;
    maximum = major === 3 ? 6 : 0;
  } else if (method === 'move_and_collide') {
    minimum = 1;
    maximum = 4;
  } else if (method === 'apply_central_impulse') {
    minimum = maximum = 1;
  } else if (method === 'apply_impulse') {
    minimum = major === 3 ? 2 : 1;
    maximum = 2;
  } else if (method === 'get_slide_collision') {
    minimum = maximum = 1;
  }
  if (args.length < minimum || args.length > maximum) {
    const expected = minimum === maximum ? `${minimum}` : `${minimum}..${maximum}`;
    throw new TypeError(
      `godot-compat: Godot ${major} ${method} requires ${expected} argument(s); got ${args.length}.`,
    );
  }
}

function requireOpenPhysicsMethodResult(
  binding: GodotObjectBinding,
  major: 3 | 4,
  method: OpenNodePhysicsMethod,
  result: unknown,
): unknown {
  if (method === 'is_on_floor' || method === 'is_on_wall' || method === 'is_on_ceiling') {
    if (typeof result !== 'boolean') {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} did not return bool.`);
    }
    return result;
  }
  if (method === 'move_and_slide') {
    if (major === 4) {
      if (typeof result !== 'boolean') {
        throw new TypeError(
          `godot-compat: ${binding.godotClass}.move_and_slide did not return bool.`,
        );
      }
      return result;
    }
    const value = result as { readonly x?: unknown; readonly y?: unknown; readonly z?: unknown };
    const vector2 = binding.godotClass === 'KinematicBody2D';
    if (
      result === null ||
      typeof result !== 'object' ||
      typeof value.x !== 'number' ||
      !Number.isFinite(value.x) ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.y) ||
      (vector2 ? value.z !== undefined : typeof value.z !== 'number' || !Number.isFinite(value.z))
    ) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.move_and_slide did not return ${vector2 ? 'Vector2' : 'Vector3'}.`,
      );
    }
    return result;
  }
  if (method === 'move_and_collide') {
    if (result !== null && typeof result !== 'object') {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.move_and_collide did not return an Object or null.`,
      );
    }
    return result;
  }
  if (method === 'get_slide_count') {
    if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.get_slide_count did not return a non-negative int.`,
      );
    }
    return result;
  }
  if (method === 'get_slide_collision' || method === 'get_last_slide_collision') {
    if (result !== null && typeof result !== 'object') {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} did not return a collision Object or null.`,
      );
    }
    return result;
  }
  if (
    method === 'get_floor_normal' ||
    method === 'get_wall_normal' ||
    method === 'get_last_motion' ||
    method === 'get_position_delta' ||
    method === 'get_real_velocity'
  ) {
    const value = result as { readonly x?: unknown; readonly y?: unknown; readonly z?: unknown };
    const vector2 =
      binding.godotClass === 'KinematicBody2D' || binding.godotClass === 'CharacterBody2D';
    if (
      result === null ||
      typeof result !== 'object' ||
      typeof value.x !== 'number' ||
      !Number.isFinite(value.x) ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.y) ||
      (vector2 ? value.z !== undefined : typeof value.z !== 'number' || !Number.isFinite(value.z))
    ) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} did not return ${vector2 ? 'Vector2' : 'Vector3'}.`,
      );
    }
    return result;
  }
  if (result !== undefined) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return void.`);
  }
  return undefined;
}

/** Exact generated Rapier-backed method dispatch for a statically open/base Node receiver. */
export function godotOpenNodePhysicsCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodePhysicsMethod,
  args: readonly unknown[],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${method} is owned by a translated script override; native physics dispatch is refused.`,
    );
  }
  if (
    major === 3 &&
    (method === 'get_last_slide_collision' ||
      method === 'get_wall_normal' ||
      method === 'get_last_motion' ||
      method === 'get_position_delta' ||
      method === 'get_real_velocity')
  ) {
    throw new Error(
      `godot-compat: ${method} is a Godot 4 CharacterBody query and is not declared by Godot 3.`,
    );
  }
  requireOpenPhysicsMethodArity(major, method, args);
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact generated Rapier method on this surface and Godot major.`,
    );
  }
  return requireOpenPhysicsMethodResult(binding, major, method, native.call(binding, args));
}

/** Exact generated RigidBody method row over the same live state as its property counterpart. */
export function godotOpenNodeRigidBodyStateCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeRigidBodyStateMethod,
  args: readonly unknown[],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${method} is owned by a translated script override; native rigid-body dispatch is refused.`,
    );
  }
  const property = rigidBodyStateMethodProperty(method);
  requireRigidBodyStateOwner(binding, major, property);
  if (major === 3 && (method === 'set_freeze_enabled' || method === 'is_freeze_enabled')) {
    throw new Error(
      `godot-compat: ${method} is a Godot 4 RigidBody method and is not declared by Godot 3.`,
    );
  }
  const setter = method.startsWith('set_');
  const expected = setter ? 1 : 0;
  if (args.length !== expected) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${method} requires exactly ${expected} argument(s).`,
    );
  }
  if (setter) requireRigidBodyStateValue(binding, property, args[0]);
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact generated rigid-body method on this surface and Godot major.`,
    );
  }
  const result = native.call(binding, args);
  if (setter) {
    if (result !== undefined) {
      throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return void.`);
    }
    return undefined;
  }
  requireRigidBodyStateValue(binding, property, result);
  return result;
}

function rigidBodyForceMethodArity(
  major: 3 | 4,
  method: OpenNodeRigidBodyForceMethod,
): readonly [minimum: number, maximum: number] {
  if (major === 3) {
    if (method === 'add_force') return [2, 2];
    return [1, 1];
  }
  if (method === 'get_constant_force' || method === 'get_constant_torque') return [0, 0];
  if (method === 'apply_force' || method === 'add_constant_force') return [1, 2];
  return [1, 1];
}

/** Exact generated force/torque row over the retained native Rapier rigid body. */
export function godotOpenNodeRigidBodyForceCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeRigidBodyForceMethod,
  args: readonly unknown[],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open ${binding.godotClass}.${method} is owned by a translated script override; native rigid-body dispatch is refused.`,
    );
  }
  requireRigidBodyStateOwner(binding, major, 'mass');
  const legacy =
    method === 'add_central_force' || method === 'add_force' || method === 'add_torque';
  if ((major === 3) !== legacy) {
    throw new Error(
      `godot-compat: ${method} is not declared by Godot ${major} for this rigid-body force dialect.`,
    );
  }
  const [minimum, maximum] = rigidBodyForceMethodArity(major, method);
  if (args.length < minimum || args.length > maximum) {
    const expected = minimum === maximum ? `${minimum}` : `${minimum}..${maximum}`;
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${method} requires ${expected} argument(s); got ${args.length}.`,
    );
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact generated force/torque method on this surface and Godot major.`,
    );
  }
  const result = native.call(binding, args);
  if (method === 'get_constant_force' || method === 'get_constant_torque') {
    if (method === 'get_constant_torque' && binding.godotClass === 'RigidBody2D') {
      if (typeof result !== 'number' || !Number.isFinite(result)) {
        throw new TypeError('godot-compat: RigidBody2D.get_constant_torque did not return float.');
      }
      return result;
    }
    const value = result as { readonly x?: unknown; readonly y?: unknown; readonly z?: unknown };
    const vector2 = binding.godotClass === 'RigidBody2D';
    if (
      result === null ||
      typeof result !== 'object' ||
      typeof value.x !== 'number' ||
      !Number.isFinite(value.x) ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.y) ||
      (vector2 ? value.z !== undefined : typeof value.z !== 'number' || !Number.isFinite(value.z))
    ) {
      throw new TypeError(
        `godot-compat: ${binding.godotClass}.${method} did not return ${vector2 ? 'Vector2' : 'Vector3'}.`,
      );
    }
    return result;
  }
  if (result !== undefined) {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${method} must return void.`);
  }
  return undefined;
}

/** Exact generated Node scheduler row for a statically open/base Node receiver. */
export function godotOpenNodeProcessCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeProcessMethod,
  args: readonly unknown[],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open Node.${method} refuses a translated script override; only the native scheduler row is admissible.`,
    );
  }
  const setter = method === 'set_process' || method === 'set_physics_process';
  const expected = setter ? 1 : 0;
  if (args.length !== expected) {
    throw new TypeError(
      `godot-compat: Node.${method} requires exactly ${expected} argument${expected === 1 ? '' : 's'}.`,
    );
  }
  if (setter && typeof args[0] !== 'boolean') {
    throw new TypeError(`godot-compat: Node.${method} requires bool.`);
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact generated scheduler dispatch row.`,
    );
  }
  const result = native.call(binding, args);
  if (!setter && typeof result !== 'boolean') {
    throw new TypeError(`godot-compat: ${binding.godotClass}.${method} did not return bool.`);
  }
  return result;
}

/** Exact retained SceneTree/viewport/world identity for a statically open/base Node receiver. */
export function godotOpenNodeContextCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenNodeContextMethod,
  args: readonly unknown[],
): unknown {
  const binding = openNodePresentationBinding(receiver, major, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open Node.${method} refuses a translated script override; only the native context row is admissible.`,
    );
  }
  if (args.length !== 0) {
    throw new TypeError(`godot-compat: Node.${method} requires exactly 0 arguments.`);
  }
  if (method === 'get_world_3d' && major !== 4) {
    throw new Error('godot-compat: Node.get_world_3d is not declared by Godot 3.x.');
  }
  const context = binding.context;
  if ((typeof context !== 'object' && typeof context !== 'function') || context === null) {
    throw new Error(
      `godot-compat: detached ${binding.godotClass}.${method} has no retained runtime context.`,
    );
  }
  const tree = Reflect.get(context, 'tree') as unknown;
  const isInsideTree =
    (typeof tree === 'object' || typeof tree === 'function') && tree !== null
      ? Reflect.get(tree, 'isInsideTree')
      : undefined;
  if (
    typeof isInsideTree !== 'function' ||
    Reflect.apply(isInsideTree, tree as object, [binding.native]) !== true
  ) {
    throw new Error(
      `godot-compat: detached ${binding.godotClass}.${method} has no SceneTree context.`,
    );
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact generated context dispatch row on this surface.`,
    );
  }
  const result = native.call(binding, args);
  if ((typeof result !== 'object' && typeof result !== 'function') || result === null) {
    throw new TypeError(
      `godot-compat: ${binding.godotClass}.${method} returned no retained identity.`,
    );
  }
  return result;
}

function scriptOwns(binding: GodotObjectBinding, name: string): boolean {
  return binding.scriptMembers?.has(name) === true;
}

/** Invoke an engine virtual only through the translated ScriptInstance override, if one exists. */
export function godotCallScriptVirtual(
  receiver: unknown,
  method: string,
  args: readonly unknown[],
): unknown {
  const binding = bindingOf(receiver);
  if (!scriptOwns(binding, method)) return undefined;
  const candidate = Reflect.get(receiver as object, method) as unknown;
  if (typeof candidate !== 'function') {
    throw new TypeError(`godot-compat: script virtual '${method}' is not callable.`);
  }
  return Reflect.apply(candidate, receiver, args);
}

/** `Object.get` after literal ClassDB properties have been lowered by the emitter. */
export function godotObjectGet(
  receiver: unknown,
  property: unknown,
  defaultValue: unknown = null,
): unknown {
  if (receiver instanceof Map)
    return godotDictionaryCall(receiver, 'get', [property, defaultValue]);
  if (!isReflectable(receiver) || typeof property !== 'string') return null;
  const binding = bindingOf(receiver);
  // Object::get asks ScriptInstance before ClassDB. Reflection is legal only after the generated
  // source member set proves this is a translated script name, never for a renderer property.
  if (scriptOwns(binding, property)) return Reflect.get(receiver, property);
  const native = binding.dispatch.properties[property];
  if (native === undefined) return null;
  if (native === null || native.get === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${property} is declared but has no covered dynamic getter.`,
    );
  }
  return native.get(binding);
}

/** `Object.set` after literal ClassDB properties have been lowered by the emitter. */
export function godotObjectSet(receiver: unknown, property: unknown, value: unknown): void {
  if (receiver instanceof Map) {
    godotDictionaryCall(receiver, 'set', [property, value]);
    return;
  }
  if (!isReflectable(receiver) || typeof property !== 'string') return;
  const binding = bindingOf(receiver);
  if (scriptOwns(binding, property)) {
    Reflect.set(receiver, property, value);
    return;
  }
  const native = binding.dispatch.properties[property];
  if (native === undefined) return;
  if (native === null || native.set === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${property} is declared but has no covered dynamic setter.`,
    );
  }
  native.set(binding, value);
}

/** `Object.call` across script-first bindings, generated native backends, or weakly typed Callable. */
export function godotObjectCall<T = unknown>(receiver: unknown, args: readonly unknown[]): T {
  // A weakly typed Callable call can arrive through Object.call. Preserve Callable's bind/unbind
  // argument protocol rather than treating its wrapper method as an ordinary JS function.
  if (receiver instanceof GodotCallable) {
    return godotCallableCall(receiver, 'call', args) as T;
  }
  const method = args[0];
  if (!isReflectable(receiver) || typeof method !== 'string') {
    throw new Error('godot-compat: Object.call requires an object and a StringName method.');
  }
  const binding = bindingOf(receiver);
  if (scriptOwns(binding, method)) {
    const candidate = Reflect.get(receiver, method) as unknown;
    if (typeof candidate === 'function')
      return Reflect.apply(candidate, receiver, args.slice(1)) as T;
  }
  const native = binding.dispatch.methods[method];
  if (native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} is declared but has no covered dynamic method backend.`,
    );
  }
  if (native === undefined) {
    // Godot's `_call_bind` propagates CALL_ERROR_INVALID_METHOD to GDScript, which reports a
    // SCRIPT ERROR and aborts the current function. Throwing is the corresponding loud control
    // flow; returning null here would silently continue past a native call that did not.
    throw new Error(`godot-compat: Invalid call. Nonexistent function '${method} (via call)'.`);
  }
  return native.call(binding, args.slice(1)) as T;
}

/** A standard Callable whose invocation stays on Object's exact script-first/ClassDB dispatch. */
export function godotObjectMethodCallable(
  receiver: unknown,
  method: string,
  argumentCount?: number,
): GodotCallable {
  const binding = reflectedBinding(receiver, 'Callable method reference');
  const scriptMethod =
    scriptOwns(binding, method) && typeof Reflect.get(binding.value, method) === 'function';
  const nativeMethod = binding.dispatch.methods[method];
  if (!scriptMethod && nativeMethod === undefined) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} is not a retained Callable method.`,
    );
  }
  if (!scriptMethod && nativeMethod === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no covered Callable backend.`,
    );
  }
  return GodotCallable.standard(binding.value, method, argumentCount, (...callArgs) =>
    godotObjectCall(binding.value, [method, ...callArgs]),
  );
}

/** `Object.callv`, including a weakly typed `Callable.callv(array)` receiver. */
export function godotObjectCallv(receiver: unknown, args: readonly unknown[]): unknown {
  if (receiver instanceof GodotCallable) {
    return godotCallableCall(receiver, 'callv', [args[0]]);
  }
  const values = Array.isArray(args[1]) ? args[1] : [];
  const method = args[0];
  if (!isReflectable(receiver) || typeof method !== 'string') {
    console.error('godot-compat: Object.callv requires an object and a StringName method.');
    return null;
  }
  const binding = bindingOf(receiver);
  if (scriptOwns(binding, method)) {
    const candidate = Reflect.get(receiver, method) as unknown;
    if (typeof candidate === 'function') return Reflect.apply(candidate, receiver, values);
  }
  const native = binding.dispatch.methods[method];
  if (native === null) {
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} is declared but has no covered dynamic method backend.`,
    );
  }
  if (native === undefined) {
    // Object::callv reports ERR_FAIL_V_MSG and returns nil, but — unlike Object.call's GDScript
    // binding error — the caller continues. Keep that diagnostic/control-flow distinction.
    console.error(
      `godot-compat: Error calling method from 'callv': '${method}': Method not found.`,
    );
    return null;
  }
  return native.call(binding, values);
}

type OpenObjectProtocolMethod =
  | 'get'
  | 'set'
  | 'call'
  | 'callv'
  | 'has_method'
  | 'has_signal'
  | 'get_class'
  | 'is_class'
  | 'get_meta'
  | 'set_meta'
  | 'has_meta'
  | 'remove_meta'
  | 'get_meta_list'
  | 'get_script'
  | 'get_indexed'
  | 'set_indexed'
  | 'get_property_list'
  | 'get_method_list'
  | 'notify_property_list_changed'
  | 'property_list_changed_notify'
  | 'get_instance_id'
  | 'add_user_signal'
  | 'has_user_signal'
  | 'remove_user_signal'
  | 'get_signal_list'
  | 'is_queued_for_deletion'
  | 'free'
  | 'call_deferred'
  | 'set_deferred';

/** Open/base Object calls over one retained script-first/generated-ClassDB binding. */
export function godotOpenObjectProtocolCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenObjectProtocolMethod,
  args: readonly unknown[],
  defer?: GodotObjectDeferredHook,
): unknown {
  const binding = reflectedBinding(receiver, method);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open Object.${method} refuses a translated script member conflict.`,
    );
  }
  if (
    (method === 'notify_property_list_changed' && major !== 4) ||
    (method === 'property_list_changed_notify' && major !== 3) ||
    (method === 'remove_user_signal' && major !== 4) ||
    (method === 'free' && major !== 3)
  ) {
    throw new Error(`godot-compat: Object.${method} is not declared by Godot ${major}.x.`);
  }
  const zeroArguments =
    method === 'get_class' ||
    method === 'get_meta_list' ||
    method === 'get_script' ||
    method === 'get_property_list' ||
    method === 'get_method_list' ||
    method === 'notify_property_list_changed' ||
    method === 'property_list_changed_notify' ||
    method === 'get_instance_id' ||
    method === 'get_signal_list' ||
    method === 'is_queued_for_deletion' ||
    method === 'free';
  const twoArguments =
    method === 'set' ||
    method === 'callv' ||
    method === 'set_meta' ||
    method === 'set_indexed' ||
    method === 'set_deferred';
  const validArity =
    method === 'call' || method === 'call_deferred'
      ? args.length >= 1
      : method === 'get_meta' || method === 'add_user_signal'
        ? args.length === 1 || args.length === 2
        : args.length === (zeroArguments ? 0 : twoArguments ? 2 : 1);
  if (!validArity) {
    const expected =
      method === 'call' || method === 'call_deferred'
        ? 'at least 1'
        : method === 'get_meta' || method === 'add_user_signal'
          ? '1 or 2'
          : String(zeroArguments ? 0 : twoArguments ? 2 : 1);
    throw new TypeError(
      `godot-compat: Object.${method} received ${args.length} arguments; expected ${expected}.`,
    );
  }
  if (method === 'get') return godotObjectGet(receiver, args[0]);
  if (method === 'set') return godotObjectSet(receiver, args[0], args[1]);
  if (method === 'call') return godotObjectCall(receiver, args);
  if (method === 'call_deferred' || method === 'set_deferred') {
    if (defer === undefined) {
      throw new Error(
        `godot-compat: Object.${method} requires the owning SceneTree deferred queue.`,
      );
    }
    if (method === 'call_deferred') return godotObjectCallDeferred(receiver, args, defer);
    return godotObjectSetDeferred(receiver, args[0], args[1], defer);
  }
  if (method === 'callv') {
    if (!Array.isArray(args[1])) {
      throw new TypeError('godot-compat: Object.callv requires an Array of method arguments.');
    }
    return godotObjectCallv(receiver, args);
  }
  if (method === 'has_method') return godotObjectHasMethod(receiver, args[0]);
  if (method === 'has_signal') return godotObjectHasSignal(receiver, args[0]);
  if (method === 'get_class') return godotObjectGetClass(receiver);
  if (method === 'is_class') return godotObjectIsClass(receiver, args[0], major);
  if (method === 'get_meta') {
    return godotObjectGetMeta(receiver, args[0], args.length === 2, args[1]);
  }
  if (method === 'set_meta') return godotObjectSetMeta(receiver, args[0], args[1]);
  if (method === 'has_meta') return godotObjectHasMeta(receiver, args[0]);
  if (method === 'remove_meta') return godotObjectRemoveMeta(receiver, args[0]);
  if (method === 'get_meta_list') return godotObjectGetMetaList(receiver, major);
  if (method === 'get_script') return godotObjectGetScript(receiver);
  if (method === 'get_indexed') return godotObjectGetIndexed(receiver, args[0]);
  if (method === 'set_indexed') return godotObjectSetIndexed(receiver, args[0], args[1]);
  if (method === 'get_property_list') return godotObjectGetPropertyList(receiver);
  if (method === 'get_method_list') return godotObjectGetMethodList(receiver);
  if (method === 'notify_property_list_changed' || method === 'property_list_changed_notify') {
    return godotObjectPropertyListChangedNotify(receiver);
  }
  if (method === 'get_instance_id') return godotObjectInstanceId(receiver);
  if (method === 'add_user_signal') {
    return godotObjectAddUserSignal(receiver, args[0], args[1] ?? []);
  }
  if (method === 'has_user_signal') return godotObjectHasUserSignal(receiver, args[0]);
  if (method === 'remove_user_signal') return godotObjectRemoveUserSignal(receiver, args[0]);
  if (method === 'get_signal_list') return godotObjectGetSignalList(receiver);
  if (method === 'is_queued_for_deletion') {
    return godotObjectCall(receiver, ['is_queued_for_deletion']);
  }
  return godotObjectCall(receiver, ['free']);
}

/** `Object.call_deferred`: invocation here, scheduling in SceneTree's real frame-end queue. */
export function godotObjectCallDeferred(
  receiver: unknown,
  args: readonly unknown[],
  defer: GodotObjectDeferredHook,
): void {
  if (receiver instanceof GodotCallable) {
    defer(() => {
      godotCallableCall(receiver, 'call', args);
    });
    return;
  }
  defer(() => {
    const method = args[0];
    if (!isReflectable(receiver) || typeof method !== 'string') {
      console.error(
        'godot-compat: deferred Object.call requires an object and a StringName method.',
      );
      return;
    }
    const binding = bindingOf(receiver);
    if (scriptOwns(binding, method)) {
      const candidate = Reflect.get(receiver, method) as unknown;
      if (typeof candidate === 'function') {
        Reflect.apply(candidate, receiver, args.slice(1));
        return;
      }
    }
    const native = binding.dispatch.methods[method];
    if (native === null) {
      console.error(
        `godot-compat: ${binding.godotClass}.${method} is declared but has no covered deferred backend.`,
      );
      return;
    }
    if (native === undefined) {
      // MessageQueue drains a missing deferred method as an engine diagnostic and continues the
      // queue. It does not re-enter the immediate Object.call binding's aborting path.
      console.error(`godot-compat: Error calling deferred method '${method}': Method not found.`);
      return;
    }
    native.call(binding, args.slice(1));
  });
}

/** `Object.set_deferred` queues one exact script-first/generated-ClassDB property write. */
export function godotObjectSetDeferred(
  receiver: unknown,
  property: unknown,
  value: unknown,
  defer: GodotObjectDeferredHook,
): void {
  reflectedBinding(receiver, 'set_deferred');
  if (typeof property !== 'string') {
    throw new TypeError('godot-compat: Object.set_deferred requires a property StringName.');
  }
  defer(() => {
    godotObjectSet(receiver, property, value);
  });
}

/**
 * `object.has_method("collect_coin")` — `coin.gd:9`.
 *
 * Godot answers for any callable the object exposes — a script `func`, a built-in method, or one
 * inherited — and returns `false` rather than erroring for a name nothing carries. `typeof x[name]
 * === 'function'` matches all of that, including inheritance, because a method on a prototype is a
 * property of the instance for this test exactly as it is in Godot.
 *
 * `null`/`undefined` answers `false` instead of throwing: Godot's `has_method` on a freed object
 * returns false too, and the one measured call site is a guard whose whole purpose is to be safe
 * to ask.
 */
export function hasMethod(object: unknown, name: string): boolean {
  if (object === null || object === undefined) return false;
  return typeof (object as Record<string, unknown>)[name] === 'function';
}

/** `is_instance_valid(object)` — false for null and after SceneTree's deferred deletion drained. */
export function isInstanceValid<T extends object>(
  tree: { readonly deferred: { wasFreed(node: object): boolean } },
  object: T | null | undefined,
): object is T {
  return object !== null && object !== undefined && !tree.deferred.wasFreed(object);
}
