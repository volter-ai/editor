# The canvas editor and its reference

A `canvas` root (Pixi, through `@pixi/react`) is a game's 2D scene. Its nearest product is Godot's 2D
editor, the main screen a Godot project's `Node2D` scenes are authored in. Figma is the reference for
the component board, a layout of UI, not a game scene, and is recorded separately when that board
returns. This page records the reference's structure, then maps every control of ours to its owner in
it.

## Godot's 2D editor, as installed

Read from Godot 4.7.1 (`/opt/homebrew/bin/godot`) on 2026-09-26. An editor plugin rendered the editor's
own viewport to an image and walked every button and menu item of the 2D toolbar with its tooltip, so
the rows below are the editor's own text. The project is a `Node2D` world with a sprite rotated 22.9°.

| Panel | What it owns |
|---|---|
| Scene dock (left) | the node tree: selection, reparenting, visibility eye per node |
| Inspector (right) | every property of the selected node, `Node2D` Transform first (Position, Rotation, Scale, Skew) |
| 2D toolbar (above the viewport) | the tool modes, snapping, lock and group, the skeleton menu, the View menu, and a menu for the selected node's type |
| Viewport | rulers on its top and left edges, guides dragged out of them, the zoom widget in its top-left corner, the origin's axis lines, the game's viewport rectangle, and the selection's frame, handles and pivot |
| Bottom panel | Output, Debugger, Audio, Animation, Shader Editor |

The 2D toolbar, left to right:

| Control | Godot's own words |
|---|---|
| Select mode | "Command+Drag: Rotate selected node around pivot. Alt+Drag: Move selected node. Command+Alt+Drag: Scale selected node. V: Set selected node's pivot position. Alt+RMB: Show list of all nodes at position clicked, including locked. RMB: Add node at position clicked." |
| Move, Rotate, Scale modes | one mode each; Scale adds "Shift: Scale proportionally." |
| List Select mode | "Show list of selectable nodes at position clicked." |
| Pivot mode | "Click to change object's pivot. Shift: Set temporary pivot." |
| Pan mode | "You can also use Pan View shortcut (Space by default) to pan in any mode." |
| Ruler mode | "LMB+Drag: Measure the distance between two points in 2D space." |
| Smart snap and grid snap | two toggles, both off by default (the frame shows neither pressed; a pressed cube-icon toggle beside them has no tooltip in the dump and is unidentified) |
| Snapping Options | Use Rotation Snap, Use Scale Snap, Snap Relative, Use Pixel Snap (on); Smart Snapping: Snap to Parent, Node Anchor, Node Sides, Node Center, Other Nodes, Guides (all on); Configure Snap… |
| Lock | "Lock selected node, preventing selection and movement." |
| Group | "Groups the selected node with its children. This causes the parent to be selected when any child node is clicked in 2D and 3D view." |
| Skeleton Options | Show Bones, Make Bone2D Node(s) from Node(s) |
| View | Grid (Show, Show When Snapping, Hide; Toggle Grid), Show Helpers, Show Rulers (on), Show Guides (on), Show Origin (on), Show Viewport (on), Gizmos (Position, Lock, Group, Transformation), Center Selection, Frame Selection, Clear Guides, Auto Resample CanvasItems, Preview Canvas Scale, Preview Theme, Preview Translation |
| Selected node's type (here `Sprite2D`) | Convert to MeshInstance2D, Convert to Polygon2D, Create CollisionPolygon2D Sibling, Create LightOccluder2D Sibling |
| Zoom widget (in the viewport) | Center View, zoom out, the percentage (resets to 100%), zoom in |

In the viewport, a selected node is framed by a box turned with the node, with eight handles and its
pivot drawn at its origin. The game's viewport rectangle is the project's window size from the origin,
drawn as a thin outline.

## Figma, for the component board

The `2D` board lays a project's Pixi stories out as frames on one canvas, the way a Figma page holds
frames. Figma's structure, read from its own Help Center pages on 2026-09-26 (the app renders a web
UI this box cannot capture, so the pages are the source, not a render):

| Region | What it owns |
|---|---|
| Toolbar | Move, Hand (Space held), Scale, Frame, Section, Slice, shapes, Pen, Pencil, Text, Comment, Annotation, Measurement, the Actions menu, Dev Mode |
| Left sidebar, File tab | pages, and the layers panel: nesting, collapse, lock, visibility, rename, find, layer order |
| Left sidebar, Assets tab | the file's and libraries' components |
| Right sidebar, Design tab | with nothing selected: the file's styles and variables, the canvas background, page export; with a layer: alignment, rotation and position, size, radius, constraints, layout guides, component properties, instance, auto layout, blend, text, fill, stroke, effects, export |
| Zoom | the zoom percentage and its menu, at the top of the properties panel |

## Ours, mapped

`CanvasSceneViewport.tsx` draws the canvas document; `RootSelectionOverlay.tsx` draws its selection;
the tool strip and snap control are the kit's `Toolbar.tsx`. Walked on a `canvas` root
(`canvas-probe`, 2026-09-26).

| Our control | Owner in the reference | State |
|---|---|---|
| Hierarchy panel | Scene dock | selection walked (container › Square); visibility not walked |
| Inspector (Transform: x, y, rotation, scale) | Inspector | writes the source's JSX attribute; undo restores it |
| Move, Rotate, Scale | Move, Rotate, Scale modes | present |
| Select, with the box's eight handles and the rotate handle | Select mode, which shows the handles | present: on the 2D surface Select is the handle mode, lit when a scene opens, and the strip has no separate Transform button (walked: Select lit on a fresh open and armed 8 handles). Cmd (Ctrl)-drag rotates the selected node about its pivot and Cmd+Alt-drag scales it, wherever the press lands (walked: a Cmd-drag took Target from 0.5 to 1.1958 rad). Alt-drag moves the selected node from wherever the press lands, snapping as a plain move does (walked: a press off Target moved it +24, +15). V puts the selected node's pivot under the pointer, its position compensating so the content stays put, written to source as `pivot={{ x, y }}` (walked on Block: the pivot handle landed at the pointer and the box did not move); the pivot handle's own drag now writes on a source-backed canvas too. With smart snap on, V and the pivot's drag snap it to its own node's sides and centre line along the node's turned axes (walked on the turned Block: V 1.5 units inside the right side wrote `pivot={{ x: 60, y: 0 }}`; with smart snap off, `{ x: 58.5, y: 1.5 }`) |
| Shift while resizing from a corner, or on the Scale gizmo | Scale mode's "Shift: Scale proportionally" | present (walked: a Shift-held SE box drag wrote `scale={1.2}`, and Shift on the gizmo's x handle `scale={1.625}`) |
| Toggle smart snap | Smart snap | present: a move aligns the box's sides or centre to the parent, other nodes' sides and centres, and guides (walked: on writes 580 against a neighbour's edge, off writes the free 581.5) |
| Toggle snap (Grid Snap in 2D), Snap settings | grid snap, Snapping Options, Configure Snap | the grid step (8 px) and offset, which the drawn grid follows; Use Rotation Snap, Use Scale Snap, Snap Relative (off) and Use Pixel Snap (on) as Godot keeps them; Smart Snapping's Snap to Parent, Other Nodes, Node Sides, Node Center and Guides. Walked: step 8 wrote (728, 432); step 10 with offset x 3 wrote (723, 440), the grid redrawn at 10; a free move wrote whole pixels (724, 435); Snap Relative from (724, 435) wrote (748, 451). Other Nodes' own switch is not walked. Partial: Node Anchor has no row (a Pixi node has no anchors); Configure Snap's Primary Line Every and the rotation and scale offsets have no field; pixel snap rounds even under a rotated parent, where Godot's does not |
| Rulers; guides dragged from them, moved, removed by right-click | rulers and guides | present |
| View menu: Show Grid, Rulers, Guides, Origin, Viewport; Center Selection, Frame Selection, Clear Guides | View | partial: these items are present, each the view's own switch (walked through the menu's clicks); Godot's Grid submenu (Show When Snapping), Show Helpers, Gizmos and the Preview items are not. Our grid is on by default; Godot's frame shows none |
| The game's viewport rectangle | View › Show Viewport | the manifest's `resolution` from the origin |
| Toggle 2D grid | View › Grid | a shortcut to the menu's switch |
| Frame all, Frame selection | View › Frame Selection | present; Frame all has no exact home |
| Zoom widget: Center view, zoom out, percentage (resets to 100%), zoom in | zoom widget: Center View, −, %, + | partial: our Center view puts the game's viewport rectangle in the middle of the pane at the current zoom (walked: its centre landed on the pane's, 888, 319), but Godot's own Center View target was not read from the installed product, so the behaviour is unverified against it; the scene zooms from 2% to 3200% |
| Pan mode (hand), and middle-drag, right-drag, Space-drag in any mode; wheel zooms at the cursor | Pan mode and Pan View | present (walked: a drag in Pan mode moved the origin 80 px) |
| Ruler mode: a drag reads its length in world units, its angle and its Δx, Δy | Ruler mode | present (walked before the Δ readout: 100 screen px at 153% read "65.5 px · 0.0°") |
| Alt-hover measurement between the selection and another node | Figma's measurement | present |
| Stationary right-click: the nodes under the pointer | Alt+RMB list; List Select mode | present on right-click, no mode button |
| Lock / Unlock selected node (toolbar), a shortcut to the hierarchy's lock | Lock | partial: the button toggles the lock (walked), which lasts the session; Godot saves it in the scene and draws a lock gizmo |
| Group / Ungroup selected node (toolbar), `grouped` beside `locked` | Group | present for the session (walked: with the root grouped, a click on a child selected the root; ungrouped, the child) |
| The selection frame turned with a rotated node: its eight handles on the node's own box, the rotate handle above its own top edge, its own size in the label; a handle resizes along the node's axes with the opposite corner held | Select mode's frame on a rotated node | present (walked: a turned 120×120 square resized to 153×139, `scale={{ x: 1.2746, y: 1.161 }}`, its NW corner still at the same pixel after the write) |
| The origin handle (the dot at a container's `pivot`, a sprite's `anchor`), dragged | Pivot mode ("Click to change object's pivot") | in the Pixi adapter's `spatialHandles`: the drag writes the origin and compensates `position` in one undo step; not walked here |

## Gaps, the work order

Judged against the references by an independent reviewer on 2026-09-26, ranked. Now present:
Select as the handle mode, rotation and scale snap under their own toggles, Shift for proportional
scaling, Center View and a wider zoom, the ruler's Δx and Δy, Group, and the grid's step and
offset with Snap to Other Nodes, Snap Relative and Use Pixel Snap, Alt-drag move, and V with the
pivot snapping to its node's sides and centre.

1. Configure Snap's primary line and rotation and scale offsets.
2. Right-click: Godot's RMB adds a node at the point and Alt+RMB lists the nodes there; ours lists on
   RMB. No List Select or Pivot button.
3. Lock and Group last only the session; Godot saves them in the scene with a gizmo.
4. The View menu's Grid submenu, Helpers, Gizmos and Preview items; Skew in the Inspector.
5. The `2D` board against Figma: the layers list for its frames and the zoom menu; its zoom sits
   bottom-right where Figma's sits at the top of the properties panel.
