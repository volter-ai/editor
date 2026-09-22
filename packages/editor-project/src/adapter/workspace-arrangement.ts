/** The editor's OWN captured dock arrangements (Animate, Look), shared data used by
 * imported layout components. A package's workspace ships its own beside its
 * layout contribution (`@vgai/blender`'s `model-arrangement.json`). */

/**
 * ONE EDITOR AREA of a workspace, and the document that fills it.
 *
 * **A Blender editor AREA is an editor group; the drawer holds utilities**
 * (orchestrator ruling 2026-09-19, WORK.md I5). Blender's UV Editing is a
 * side-by-side split of the centre (786/785 measured on the engine), Shading
 * and Animation a top/bottom split, and both the dock and the frame have
 * exactly that shape in editor groups — a second group beside or below the
 * document, with the workspace's own split ratio. So the UV editor, the node
 * editor and the image view are DOCUMENTS a workspace opens
 * into editor groups, never drawer views; the drawer keeps the utilities that
 * are not Blender areas (Console, Profiler, Network).
 *
 * THIS AMENDS "a workspace positions chrome and dock groups only; it never
 * opens documents" (ARCHITECTURE-CORE §Editor chrome, 2026-08-30), and the
 * amendment is narrow: a workspace opens the documents ITS OWN REFERENCE
 * FRAME'S SCREEN HAS, named here, and never a session's content. That is why
 * `normalizePresetLayout` still strips every `kind: 'document'` panel out of a
 * captured arrangement — the capture carries the GROUP and its settled size,
 * this list carries which document fills it, and the two never overlap.
 */
export interface WorkspaceAreaContribution {
  /** Stable area id, scoped to the workspace. BOTH hosts key an editor group by
   *  it: the dock's group id is `vgai:area:<id>`, and under the Code-OSS frame
   *  it is the key of `vgaiDocuments.ts`'s `Map<areaId, IEditorGroup>` — the
   *  group `IEditorGroupsService.addGroup` created from this area's `place`
   *  (WORK.md §THE TIMELINE item 1, landed 2026-09-20). */
  readonly id: string;
  /** The `workspace.document` CONTRIBUTION id this area opens (the
   *  contribution's file-derived id, e.g. `blender-uv-editor.document`), not a
   *  document id: the document is minted per open subject. */
  readonly document: string;
  /** Where the group sits relative to the centre document's group. */
  readonly place: 'left' | 'right' | 'above' | 'below';
  /** The area's share of that split, 0..1 — Blender's own measured ratio,
   *  cited by the workspace that declares it. It is the BOOTSTRAP size only:
   *  once a capture of this workspace exists, the captured leaf's own size
   *  wins, exactly as the drawer's captured height wins over its default.
   *  Under the frame the same rule is `setSize` applied ONCE at group
   *  creation, against the two groups' combined extent — a person's drag on
   *  the sash is never overwritten, and a group they closed is re-created at
   *  this ratio on the next reconcile, because a Blender area is resized or
   *  joined, never closed. */
  readonly ratio: number;
}

export interface WorkspaceArrangement {
  /** Persistence identity, not a lookup key for an engine-owned implementation. */
  readonly id: string;
  readonly title: string;
  readonly regions?: {
    /** The WORKSPACE tab strip in the top bar (Blender's); a click on a tab
     *  is the explicit act that switches. Absent means hidden. */
    readonly workspaceTabs?: 'shown' | 'hidden';
    readonly header?: 'shown' | 'hidden';
    readonly shelf?: 'shown' | 'hidden';
    readonly inspector?: 'column' | 'properties';
    readonly drawer?: 'shown' | 'hidden';
    /** The top bar's runtime TELEMETRY cluster — the frame-rate readout, its
     *  sparkline and the audio meter. `hidden` leaves the corner to the quiet
     *  product controls (Invite, Account); the Profiler utility remains the
     *  door to the same numbers. Absent means shown. */
    readonly telemetry?: 'shown' | 'hidden';
    /** The `·TypeName` a component-instance row prints after its name in the
     *  hierarchy. `hidden` leaves the row its NAME alone, the way Blender's
     *  Outliner does — there the type is the glyph. The type stays reachable
     *  through the row's own tooltip and the inspector. Absent means shown. */
    readonly hierarchyTypeSuffix?: 'shown' | 'hidden';
    /** The dotted RULE a component-instance row draws under its name in the
     *  hierarchy. `hidden` leaves the name unmarked, the way Blender's Outliner
     *  does — it marks an instance nowhere in that panel, in any selection
     *  state. The fact stays reachable through the row's own tooltip, its Go to
     *  Callsite / Open Component Source actions and the inspector. Absent means
     *  shown. */
    readonly hierarchyInstanceRule?: 'shown' | 'hidden';
    /** Which restriction columns a hierarchy row carries at its right edge:
     *  this editor's selection lock beside the eye (`select+viewport`), or
     *  Blender's default filter (`viewport+render`) — the eye in its own
     *  column with the render column reserved and blank, three.js having one
     *  visibility flag for viewport and render alike. Absent means the pair. */
    readonly hierarchyRestrictions?: 'select+viewport' | 'viewport+render';
  };
  /** The workspace's EDITOR AREAS beside the centre document — see
   *  {@link WorkspaceAreaContribution}. Absent: the centre document alone. */
  readonly areas?: readonly WorkspaceAreaContribution[];
}
