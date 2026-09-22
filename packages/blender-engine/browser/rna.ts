/**
 * THE RNA DOOR'S CONTRACT — what `session.py`'s `rna_view`, `rna_context` and
 * `rna_set` answer, as types. TYPES ONLY, no imports and no values: the
 * Properties sections (`../contributions/blender-properties-*`) read these
 * shapes, and a type-only module costs their closure nothing.
 *
 * Everything here is Blender's own introspection of Blender's own data
 * (`bl_rna.properties`) — the ruling's "everything Blender SHOWS about a
 * datablock, we show, in OUR panels, read from the engine through bpy and RNA"
 * (ARCHITECTURE-CORE §Blender north star, "Inspection parity, not editing
 * parity"). Nothing in this file is a vgai invention over RNA: every field is
 * a `PropertyRNA` member, a `bpy.types` name, or an address `path_from_id()`
 * produced.
 */

/** `PropertyRNA.type` — Blender's own property-type enum. */
export type BlenderRnaType =
  | 'BOOLEAN'
  | 'INT'
  | 'FLOAT'
  | 'STRING'
  | 'ENUM'
  | 'POINTER'
  | 'COLLECTION';

/** A POINTER property's target: where it lives and what it is. */
export interface BlenderRnaPointer {
  /** The target's own address, or null for a struct RNA cannot address. */
  readonly path: string | null;
  readonly name: string | null;
  readonly type: string;
}

/** A COLLECTION property's value: its length, and at most the door's own
 *  `names` limit of names — absent entirely when the collection's item type
 *  has no `name` (a mesh's `vertices`), which is what keeps a 100k-element
 *  collection a COUNT. */
export interface BlenderRnaCollectionValue {
  readonly count: number;
  readonly names?: readonly string[];
}

/** One item of an `EnumProperty`. `icon` is Blender's own icon NAME
 *  (`MESH_DATA`), which our icon set does not draw — it rides along because
 *  the door reports what RNA holds, not what we happen to paint. */
export interface BlenderRnaEnumItem {
  readonly identifier: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
}

export type BlenderRnaValue =
  | boolean
  | number
  | string
  | readonly (boolean | number)[]
  | readonly string[]
  | BlenderRnaPointer
  | BlenderRnaCollectionValue
  | null;

/** ONE `bl_rna` PROPERTY. */
export interface BlenderRnaRow {
  readonly identifier: string;
  /** `PropertyRNA.name` — the UI name Blender itself would label it with. */
  readonly name: string;
  readonly type: BlenderRnaType;
  /** `PropertyRNA.subtype` — `COLOR`, `DISTANCE`, `ANGLE`, `FILE_PATH`,
   *  `FACTOR`, `NONE`… This is what turns a 3-float array into a colour
   *  swatch instead of three numbers. */
  readonly subtype: string;
  readonly description: string;
  /** The RNA STRUCT that declares this property (`Object`, `ID`, `Mesh`) —
   *  the only grouping RNA exposes, and the one the generic view groups by.
   *  Blender's panel layout is not this and is not read (the ruling). */
  readonly group: string;
  readonly groupName: string;
  readonly arrayLength: number;
  /** Blender says so: declared read-only, or this datablock refuses the write
   *  (`is_property_readonly`). Rendered dimmed, never as a disabled control. */
  readonly readonly: boolean;
  /** `PropertyRNA.is_hidden` — RNA's own `PROP_HIDDEN` flag
   *  (`rna_rna.cc:795-799`). Blender declares the property and draws it
   *  nowhere: `ID.original` on every datablock (`rna_ID.cc:2440-2448`),
   *  `ViewLayer.depsgraph` (`rna_layer.cc:733`), the NLA tweak storage
   *  (`rna_animation.cc:1701,1713`). The door reports it; the generic view
   *  OMITS it, and no curated list names one. */
  readonly hidden?: boolean;
  /** UNDRAWN STATE — RNA never gave this property UI text, so
   *  `rna_define.cc:1311-1312`'s defaults still stand: `name` is the
   *  identifier and `description` is empty. The modifier panel-open booleans
   *  are the worked case (`rna_def_modifier_panel_open_prop`,
   *  `rna_modifier.cc:2694-2705`, which sets no `PROP_HIDDEN` — so this is a
   *  second rule rather than a restatement of {@link hidden}): a panel arrow's
   *  state, not data about the datablock. The door reports it; the generic
   *  view OMITS it, and no curated list names one. */
  readonly undrawn?: boolean;
  readonly softMin?: number;
  readonly softMax?: number;
  readonly hardMin?: number;
  readonly hardMax?: number;
  readonly step?: number;
  readonly precision?: number;
  readonly lengthMax?: number;
  readonly isFlag?: boolean;
  readonly items?: readonly BlenderRnaEnumItem[];
  /** `fixed_type` — what a POINTER points at / a COLLECTION holds. */
  readonly itemType?: string;
  readonly value?: BlenderRnaValue;
  /** An array too long to serialise, described instead (`"64 values"`). */
  readonly valueOmitted?: string;
  /** The read itself threw — reported rather than swallowed, so a property
   *  that cannot be read is visibly a property that cannot be read. */
  readonly valueError?: string;
}

export interface BlenderRnaGroup {
  readonly id: string;
  readonly label: string;
  readonly rows: readonly BlenderRnaRow[];
}

export interface BlenderRnaStructView {
  readonly path: string;
  readonly kind: 'struct';
  /** `bl_rna.identifier` — `Object`, `Mesh`, `Bone`, `SubsurfModifier`. */
  readonly type: string;
  readonly typeName: string;
  readonly name: string | null;
  readonly count: number;
  readonly groups: readonly BlenderRnaGroup[];
}

export interface BlenderRnaCollectionItem {
  readonly name: string | null;
  readonly path: string | null;
  readonly type: string;
}

export interface BlenderRnaCollectionView {
  readonly path: string;
  readonly kind: 'collection';
  readonly count: number;
  readonly items: readonly BlenderRnaCollectionItem[];
}

export type BlenderRnaView = BlenderRnaStructView | BlenderRnaCollectionView;

/** An addressed datablock the context names (the active bone, the active
 *  modifier…). */
export interface BlenderRnaNamed {
  readonly name: string | null;
  readonly path: string | null;
  readonly type: string | null;
}

export interface BlenderRnaMaterialSlot extends BlenderRnaNamed {
  readonly index: number;
  readonly slots: number;
}

export interface BlenderRnaVertexGroup extends BlenderRnaNamed {
  readonly index: number;
}

/**
 * ONE TEXTURE USER, as `buttons_texture.cc` enumerates them
 * (`buttons_texture_users_from_context`, `:244-366`): the struct that HOLDS a
 * texture pointer, the property it holds it in, and the texture itself.
 * `label` is the C's own group name ("Compositor", "Line Style", "Modifiers",
 * "Particles", "Fields", "Brush"), and the order is the C's, so user 0 is the
 * one `buttons_texture_context_compute` makes active by default.
 */
export interface BlenderRnaTextureUser {
  readonly label: string;
  readonly name: string | null;
  readonly path: string | null;
  readonly property: string;
  readonly texture: BlenderRnaNamed | null;
}

/**
 * ONE PROPERTIES TAB, as Blender would show it for this context.
 *
 * `id` is `buttons_context.cc`'s own `BCONTEXT_*` in lower case; the ORDER of
 * the list is `ED_buttons_tabs_list` (`space_buttons.cc:201-256`); `paths` are
 * the datablocks that tab shows, in the order it shows them. A tab absent from
 * the list is a tab Blender would not draw for this object.
 */
export interface BlenderRnaTab {
  readonly id: string;
  readonly label: string;
  /** OUR icon-set glyph name for this tab (`blender.icons.json`), not
   *  Blender's `ICON_*`: the glyph is our own drawing in Blender's idiom. */
  readonly icon: string;
  readonly paths: readonly { readonly label: string; readonly path: string }[];
}

export interface BlenderRnaContext {
  readonly scene: string;
  readonly viewLayer: string;
  readonly world: string | null;
  readonly collection: string | null;
  /** `Object.mode` — `OBJECT`, `EDIT`, `POSE`, `WEIGHT_PAINT`… */
  readonly mode: string | null;
  /** `scene.render.engine`, which is `context.engine` — what every
   *  `COMPAT_ENGINES` poll in `bl_ui` tests. `BlenderCuratedPanel.engine`
   *  reads it rather than copying the condition. */
  readonly engine: string;
  readonly active: {
    readonly name: string;
    readonly type: string;
    readonly path: string;
    readonly dataPath: string | null;
    readonly dataType: string | null;
  } | null;
  readonly activeBone: BlenderRnaNamed | null;
  readonly activePoseBone: BlenderRnaNamed | null;
  readonly activeMaterial: BlenderRnaMaterialSlot | null;
  readonly activeModifier: BlenderRnaNamed | null;
  readonly activeVertexGroup: BlenderRnaVertexGroup | null;
  readonly activeShapeKey: BlenderRnaNamed | null;
  readonly activeConstraint: BlenderRnaNamed | null;
  readonly activeParticleSystem: BlenderRnaNamed | null;
  readonly textureUsers: readonly BlenderRnaTextureUser[];
  readonly activeTextureUser: BlenderRnaTextureUser | null;
  readonly tabs: readonly BlenderRnaTab[];
}

/** What `rna_set` answers: the property it wrote, re-read from the engine. */
export interface BlenderRnaWrite {
  readonly path: string;
  readonly property: string;
  readonly value: BlenderRnaValue;
}

// ---- the outliner tree -----------------------------------------------------
//
// WHAT `session.py`'s `rna_outliner` ANSWERS: Blender's VIEW LAYER tree for the
// session's scene, as rows (WORK.md §Blender in the tab is Blender,
// "Inspection parity", I3). Every field below is Blender's own — a `TSE_*`
// element type, an `ICON_*` name `tree_element_get_icon` picks, a restriction
// column `outliner_draw_restrictbuts` draws — and nothing here is a vgai
// invention over the Outliner.

/**
 * ONE ROW'S RESTRICTION COLUMNS, as `outliner_draw_restrictbuts`
 * (`outliner_draw.cc:1173-1854`) reads them. Each member is TRUE when the thing
 * is RESTRICTED, which is the sense Blender's own property carries
 * (`hide_viewport`, `hide_render`, `exclude`); a modifier's `show_render` and a
 * constraint's `enabled` are inverted at the door so every column reads the
 * same way round. A member ABSENT is a column Blender draws on no row of that
 * type.
 */
export interface BlenderOutlinerRestrict {
  /** The EYE — an object's view layer base (`Object.hide_get()`), a layer
   *  collection's `hide_viewport`, a constraint's `enabled`. */
  readonly hide?: boolean;
  /** The RENDER CAMERA — `Object.hide_render`, `Collection.hide_render`, a
   *  modifier's `show_render`. */
  readonly render?: boolean;
  /** The MONITOR — `Object.hide_viewport`, a modifier's `show_viewport`, a
   *  pose bone's `hide`. Blender's Disable in Viewports column, which is OFF by
   *  default (`space_outliner.cc:399`) and reported all the same. */
  readonly viewport?: boolean;
  /** The CHECKBOX, layer collections only — `LayerCollection.exclude`. */
  readonly exclude?: boolean;
}

export interface BlenderOutlinerRow {
  /** The row's IDENTITY — its `path`, except where Blender draws one datablock
   *  twice in one tree (an object linked into two collections, the
   *  `TE_CHILD_NOT_IN_COLLECTION` duplicate), where an `@2` ordinal keeps the
   *  rows distinct. */
  readonly id: string;
  /** The engine's own address, which opens in the RNA door unchanged. */
  readonly path: string;
  readonly name: string;
  /** Blender's own element type — `TSE_SOME_ID`, `TSE_LAYER_COLLECTION`,
   *  `TSE_MODIFIER`, `TSE_BONE`, `TSE_DEFGROUP_BASE`… */
  readonly type: string;
  /** The `ICON_*` name `tree_element_get_icon` picks for this row, WITHOUT the
   *  `ICON_` prefix — the spelling {@link BlenderRnaEnumItem.icon} already
   *  uses. */
  readonly icon: string;
  /** Blender's default open state: the Scene Collection and every editable
   *  layer collection, and nothing else (`outliner_tree.cc:139` against
   *  `tree_display_view_layer.cc:130,167`). */
  readonly expanded: boolean;
  readonly children: readonly BlenderOutlinerRow[];
  /** How many children the door's page left behind (`_OUTLINER_PAGE`). Absent
   *  when the whole list is here. */
  readonly more?: number;
  /** The RNA struct this row's datablock is (`Object`, `Mesh`, `Material`). */
  readonly struct?: string;
  /** `Object.type` on an object row, which is what picks its glyph. */
  readonly objectType?: string;
  /** THE OBJECT THIS ROW BELONGS TO. Blender's own activation walks back to the
   *  owning object (`outliner_search_back_te(te, ID_OB)`,
   *  `outliner_select.cc:863`), so a datablock row selects its object and the
   *  Properties rail follows — which is what this carries. */
  readonly object?: string;
  /** A layer collection row's COLLECTION address. The row itself is addressed
   *  by its POSITION in the view layer, because a `LayerCollection` has no
   *  `path_from_id()` (I2's finding); this is the collection datablock it
   *  shows. */
  readonly data?: string;
  readonly selected?: boolean;
  readonly active?: boolean;
  /** `TE_CHILD_NOT_IN_COLLECTION` — a child drawn under its parent although it
   *  is not in that collection. Blender leaves it unexpanded and draws it no
   *  restriction columns at all (`outliner_draw.cc:1282-1286`). */
  readonly notInCollection?: boolean;
  readonly restrict?: BlenderOutlinerRestrict;
}

export interface BlenderOutlinerTree {
  readonly scene: string;
  readonly viewLayer: string;
  /** `bpy.context.mode` — the editor-wide mode a `poll` tests (`OBJECT`,
   *  `EDIT_MESH`, `POSE`, `PAINT_WEIGHT`…). */
  readonly mode: string;
  /** `Object.mode` of the engine's active object, which is what the Outliner's
   *  own pose rows key on. */
  readonly objectMode: string | null;
  readonly active: string | null;
  /** The roots — one Scene Collection row, under the default filters. */
  readonly rows: readonly BlenderOutlinerRow[];
}

/** What `outliner_set` answers: the column it wrote, re-read from the engine. */
export interface BlenderOutlinerWrite {
  readonly path: string;
  readonly column: string;
  readonly value: boolean;
}

/* ---- the node editor's tree ---------------------------------------------- */

/** `NodeSocket.type` — the `SOCK_*` that picks the socket's COLOUR
 *  (`std_node_socket_colors[]`, `drawnode.cc:987-1013`). Left open, because
 *  Blender adds socket types and the door reports what the engine answers. */
export type BlenderNodeSocketType = string;

/** `NodeSocket.display_shape` — `rna_node_socket.cc:793-802`. */
export type BlenderNodeSocketShape =
  | 'CIRCLE'
  | 'SQUARE'
  | 'DIAMOND'
  | 'CIRCLE_DOT'
  | 'SQUARE_DOT'
  | 'DIAMOND_DOT'
  | 'LINE'
  | 'VOLUME_GRID'
  | 'LIST';

export interface BlenderNodeSocket {
  readonly identifier: string;
  readonly name: string;
  readonly label: string | null;
  readonly type: BlenderNodeSocketType;
  readonly shape: BlenderNodeSocketShape;
  /** `enabled` and `hide` together are the node editor's own availability
   *  test: an unavailable socket occupies no row and draws no mark. */
  readonly enabled: boolean;
  readonly hide: boolean;
  /** `hide_value` — Blender draws the name alone, never the inline widget. */
  readonly hideValue: boolean;
  readonly linked: boolean;
  readonly multiInput: boolean;
  readonly index: number;
  /** `default_value`, flattened: a number, a string, a name (for a pointer
   *  socket), up to four floats (a colour or a vector), or null where the
   *  socket carries none — a shader or a geometry socket. */
  readonly value: number | string | boolean | readonly number[] | null;
}

/** `Node.color_tag` (`rna_nodetree.cc:79-100`, `:9480-9484`), which RNA reads
 *  from `bke::node_color_tag(*node)` — the value `node_get_colorid`
 *  (`node_draw.cc:1388-1434`) switches on to pick the header colour. */
export type BlenderNodeColorTag =
  | 'NONE'
  | 'ATTRIBUTE'
  | 'COLOR'
  | 'CONVERTER'
  | 'DISTORT'
  | 'FILTER'
  | 'GEOMETRY'
  | 'INPUT'
  | 'MATTE'
  | 'OUTPUT'
  | 'SCRIPT'
  | 'SHADER'
  | 'TEXTURE'
  | 'VECTOR'
  | 'PATTERN'
  | 'INTERFACE'
  | 'GROUP';

export interface BlenderNode {
  readonly name: string;
  readonly idname: string;
  readonly type: string;
  /** `bl_label` — what the header prints when the node carries no `label`. */
  readonly typeLabel: string;
  readonly label: string | null;
  readonly colorTag: BlenderNodeColorTag;
  /** Tree-space `[x, y]`: the node's top-left corner, which is where
   *  `node_update_basis` starts laying out (`node_draw.cc:1295-1300`). */
  readonly location: readonly number[];
  readonly width: number;
  /** `Node.hide` — Blender's COLLAPSED node, drawn as a short rounded bar
   *  (`node_update_collapsed`, `node_draw.cc:1326-1390`). */
  readonly collapsed: boolean;
  readonly muted: boolean;
  readonly selected: boolean;
  readonly useCustomColor: boolean;
  readonly color: readonly number[];
  /** The frame node this one sits inside, by name, or null. */
  readonly parent: string | null;
  /** `NODE_DO_OUTPUT` through its one RNA spelling. */
  readonly activeOutput: boolean;
  /**
   * HOW MANY SOCKET PANELS THE NODE DECLARES (`Node.panel_states`). A panel
   * state carries a `persistent_uid` and `is_collapsed` and nothing else
   * (`rna_nodetree.cc:9289-9299`, `:9430-9434`); which SOCKETS belong to a
   * panel, and what a panel is CALLED, live in the node's C++ declaration
   * that `node_update_basis_from_declaration` (`node_draw.cc:1086-1218`)
   * walks, and bpy exposes neither — so that half is TRACED from Blender's
   * source (ruled 2026-09-19) and this door owes only the live half. The
   * trace and its table belong to the CONSUMER, `@volter/editor-blender`, because they
   * read a Blender checkout rather than the running engine; this package
   * answers what the engine knows and nothing else.
   */
  readonly panelCount: number;
  /**
   * The states themselves, IN DECLARATION ORDER — Blender indexes
   * `panel_states_array` by the declaration's panel index
   * (`node_draw.cc:1037`) and RNA's collection is that array, so position is
   * the join between this and the traced declaration. `identifier` is the
   * declaration's `persistent_uid`, carried so a mis-join is visible.
   */
  readonly panels: readonly { readonly identifier: number; readonly collapsed: boolean }[];
  /** `Node.show_options` → `NODE_OPTIONS`: with it clear, a declaration's
   *  LAYOUT rows draw nothing at all (`node_draw.cc:739-746`). */
  readonly showOptions: boolean;
  readonly inputs: readonly BlenderNodeSocket[];
  readonly outputs: readonly BlenderNodeSocket[];
}

export interface BlenderNodeLink {
  readonly fromNode: string;
  readonly fromSocket: string;
  readonly toNode: string;
  readonly toSocket: string;
  readonly muted: boolean;
  readonly valid: boolean;
}

/** What `rna_node_tree` answers. `path` null with `useNodes` false is a
 *  material whose `use_nodes` is off; `path` null with `material` null is no
 *  material at all — both states Blender draws as a bare background, never an
 *  error (`node_draw_space`'s else branch, `node_draw.cc:4849-4853`). */
export interface BlenderNodeTree {
  readonly path: string | null;
  readonly type?: string;
  readonly typeLabel?: string;
  readonly material: string | null;
  readonly useNodes: boolean | null;
  readonly active?: string | null;
  readonly nodes: readonly BlenderNode[];
  readonly links: readonly BlenderNodeLink[];
}

/**
 * What `rna_uv_layout` answers — ONE MESH'S UV LAYOUT, as Blender's UV editor
 * would draw it.
 *
 * THE PER-CORNER ARRAYS CROSS AS BASE64 typed-array bytes, for the reason
 * I4's weights do: a layout is `loops` two-float corners plus a
 * triangulation, and the generic RNA door answers a struct at a time.
 * `uvBase64` is `Float32Array` of `loops * 2` (u, v per corner, in corner
 * order); `triangleBase64` is `Uint32Array` of `triangles * 3` CORNER indices
 * into that array — Blender's own `calc_loop_triangles` fan, never one of
 * ours; `loopStartBase64` / `loopTotalBase64` are `Uint32Array` of
 * `polygons`, which is what makes a face's UV outline a contiguous walk;
 * `pinBase64` is `Uint8Array` of `loops` and is null when nothing is pinned.
 *
 * `active` null with a non-empty `layers` cannot happen (a mesh with UV maps
 * has an active one); `active` null with `layers` empty is a mesh that has no
 * UV map at all, which is a STATE — `arena-vanguard.blend`'s 17,778-vertex
 * body is exactly that, measured 2026-09-19 — and the door answers the header
 * alone.
 *
 * `selection` is null at this pin and says so rather than being absent: UV
 * selection lives in the BMesh an edit-mode session holds, and
 * `MeshUVLoopLayer` (`rna_mesh.cc:2380-2456`) declares `uv`, `pin`, `name`,
 * `active`, `active_render` and `active_clone` and no selection of any kind.
 */
export interface BlenderUvLayout {
  readonly object: string | null;
  readonly mesh: string | null;
  readonly path?: string;
  readonly layers: readonly string[];
  readonly active: string | null;
  /** `bpy.context.mode` — reported, never required (orchestrator ruling 1,
   *  2026-09-19: inspection is not mode-gated). */
  readonly mode: string;
  readonly loops: number;
  readonly polygons: number;
  readonly materials?: readonly (string | null)[];
  readonly uvBase64?: string;
  readonly triangleBase64?: string;
  readonly loopStartBase64?: string;
  readonly loopTotalBase64?: string;
  readonly triangles?: number;
  readonly pinBase64?: string | null;
  readonly selection?: string | null;
  readonly bounds?: readonly [number, number, number, number];
  readonly image?: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly source: string;
    readonly hasData: boolean;
  } | null;
}

/**
 * ONE MESH'S SKIN BINDING (`session.py`'s `rna_rig`) — what a
 * `THREE.SkinnedMesh` needs, and nothing Blender does not carry.
 *
 * WE VISUALIZE WITH THREE.JS, NOT BLENDER (owner rule, 2026-09-20). Blender
 * holds the animation as DATA; three.js plays it. This door and
 * {@link BlenderActionClip} are the whole of what crosses to make that true —
 * once per rig, rather than a depsgraph evaluation and a re-export per frame.
 *
 * THE BIND POSE IS `pose`, NOT `rest`, and that is the load-bearing fact: the
 * export door runs with `evaluate: True`, so the mesh columns the presenter
 * holds are the mesh ALREADY DEFORMED at Blender's current frame. A skeleton
 * bound in that same pose makes the skinning an identity there, so the picture
 * at the bind frame is exactly the frame Blender presented — and Blender's
 * `frame_current` never has to move again for playback.
 *
 * THE INDICES ARE BLENDER VERTEX INDICES. `DrawArrays.sourceVertex` maps a
 * drawn vertex back to its Blender one, and the presenter expands these arrays
 * through it (`blender-runtime-skin.ts`) exactly as I4's weight ramp does.
 */
export interface BlenderRigBone {
  readonly name: string;
  readonly parent: string | null;
  /** `Bone.matrix_local` — the REST pose in the armature object's space,
   *  row-major as four rows. Diagnostic here; the bind is `pose`. */
  readonly rest: readonly (readonly [number, number, number, number])[];
  /** `PoseBone.matrix` (`pchan->pose_mat`), the same matrix I4's bone overlay
   *  draws — the BIND pose, in the armature object's space. */
  readonly pose: readonly (readonly [number, number, number, number])[];
  readonly length: number;
  readonly deform: boolean;
  readonly connected: boolean;
}

export interface BlenderRigBinding {
  readonly object: string | null;
  readonly mesh?: string;
  readonly armature: string | null;
  readonly armatureData?: string;
  readonly bones: readonly BlenderRigBone[];
  readonly vertexCount: number;
  /** `scene.frame_current` when the binding was read — the frame the exported
   *  columns, and therefore the bind pose, belong to. */
  readonly frame?: number;
  readonly mode?: string;
  /** Bones whose pose is a SOLVER's rather than their channels'. The clip is
   *  derived from the F-Curves alone, so a constrained bone's playback cannot
   *  reproduce Blender's own answer; the view names them instead of drifting. */
  readonly constrainedBones?: readonly string[];
  /** Uint16, `vertexCount * 4`. */
  readonly skinIndexBase64?: string;
  /** Float32, `vertexCount * 4`, each vertex's four normalized to sum to one. */
  readonly skinWeightBase64?: string;
  readonly maxInfluences?: number;
  readonly truncatedVertices?: number;
  readonly unweightedVertices?: number;
  readonly unmappedGroups?: readonly string[];
  /** Why there is no binding, when there is none. Never a silent empty. */
  readonly reason?: string;
}

/** EVERY SKIN BINDING THE SCENE NEEDS, which is the PRESENTER's question: a
 *  presented frame carries every object at once and the presenter has to know
 *  which of its meshes are `THREE.SkinnedMesh`es before it builds them. With
 *  `named` set, the list is that one mesh. */
export interface BlenderRig {
  /** `scene.frame_current` when the bindings were read — the frame the
   *  exported columns, and therefore every bind pose here, belong to. */
  readonly frame: number;
  readonly named: string | null;
  readonly rigs: readonly BlenderRigBinding[];
}

/**
 * ONE TRACK of {@link BlenderActionClip}: a bone's LOCAL `position`,
 * `quaternion` or `scale` sampled at every integer frame.
 *
 * `constant` says the door found every sample equal to the first and shipped
 * two keys instead of N — which is most of a rig, most of the time.
 */
export interface BlenderClipTrack {
  readonly bone: string;
  readonly property: 'position' | 'quaternion' | 'scale';
  readonly stride: number;
  readonly count: number;
  readonly constant: boolean;
  /** Float32 seconds, `count` of them, zero at `clipStart`. */
  readonly timeBase64: string;
  /** Float32, `count * stride`. */
  readonly valueBase64: string;
}

/** One column of the Timeline's summary row: a frame at which SOMETHING is
 *  keyed, with the most significant `Keyframe.type` any contributing curve
 *  carries and whether any of them is selected — Blender's two colour axes for
 *  a diamond (`.common.anim`'s six type pairs, `userdef_default_theme.c:320-331`). */
export interface BlenderClipKeyColumn {
  readonly frame: number;
  readonly type: string;
  readonly select: boolean;
}

/**
 * ONE ANIMATED OBJECT'S CONTRIBUTION to the summary row, and whether it is
 * SELECTED — the whole of what Blender's `show_keys_from_selected_only`
 * decides between.
 *
 * Blender's Timeline takes that flag from the SCENE rather than from the dope
 * sheet (`ac->scene->flag & SCE_KEYS_NO_SELONLY` → `ADS_FILTER_ONLYSEL`,
 * `anim_filter.cc:254-270`) and then skips any object whose base is not
 * selected (`anim_filter.cc:2307`). `selected` is that base flag through RNA,
 * `Object.select_get()`.
 *
 * The door reports every animated object either way; which side of the filter
 * a Timeline is on is VIEW state, because a headless Blender has no
 * `SpaceDopeSheet` to hold it and no scene flag we would be entitled to write.
 */
export interface BlenderClipSummaryObject {
  readonly object: string;
  readonly action: string;
  readonly selected: boolean;
  readonly keyframes: readonly BlenderClipKeyColumn[];
}

/**
 * ONE ACTION AS A THREE.JS CLIP (`session.py`'s `rna_action_clip`).
 *
 * THE SAMPLES ARE A BAKE, and it is a stated difference rather than an implied
 * one: Blender's channels are `PoseBone.location/rotation_(euler|quaternion)/scale` in the
 * bone's own REST space while three's `Bone` carries a transform relative to
 * its PARENT BONE, so the two are separated by a matrix product that no
 * per-channel relabelling can do. Composing per key would then also have to
 * reproduce Blender's Bezier handles between keys; sampling at every integer
 * frame and shipping LINEAR tracks is exact at every frame a Timeline can
 * scrub to, and linear in between.
 */
export interface BlenderActionClip {
  readonly object: string | null;
  readonly armature: string | null;
  readonly action: string | null;
  readonly slot: string | null;
  /** `layered` at this pin — an `Action` has no `.fcurves`; they live at
   *  `layers[0].strips[0].channelbags[0].fcurves`. `legacy` is the branch for
   *  a build where the old attribute is still there. */
  readonly channels?: string;
  /** The scene's own name — the Timeline's one write addresses
   *  `bpy.data.scenes["<name>"]`, because an RNA path starts at `bpy.data.`. */
  readonly scene?: string;
  readonly frameCurrent: number;
  readonly frameStart: number;
  readonly frameEnd: number;
  readonly fps: number;
  readonly fcurves?: number;
  readonly keys?: number;
  /** The SUBJECT's own columns — the action this clip plays. */
  readonly keyframes: readonly BlenderClipKeyColumn[];
  /** Every animated object in the view layer, for the summary row's
   *  selection filter. Always present; empty for a file with no animation. */
  readonly summary?: readonly BlenderClipSummaryObject[];
  readonly tracks: readonly BlenderClipTrack[];
  readonly clipStart?: number;
  readonly clipEnd?: number;
  readonly duration?: number;
  readonly sampled?: number;
  /** Bones the action names that the armature does not have. */
  readonly unplayedBones?: readonly string[];
  readonly reason?: string;
}
