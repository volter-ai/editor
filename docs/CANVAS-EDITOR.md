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
| Select, Move, Rotate, Scale | Select, Move, Rotate, Scale modes | present |
| Transform (all handles) | Select mode's handles | present: the box's eight handles and the rotate handle; a corner drag anchors the opposite corner |
| Toggle smart snap | Smart snap | present: a move aligns the box's sides or centre to the parent, other nodes' sides and centres, and guides (walked: on writes 580 against a neighbour's edge, off writes the free 581.5) |
| Toggle snap (Grid Snap in 2D), Snap settings | grid snap, Snapping Options | the translate, rotate and scale steps, and Smart Snapping's targets (Parent, Node Sides, Node Center, Guides); Godot's Node Anchor, Snap Relative and Use Pixel Snap have no row |
| Rulers; guides dragged from them, moved, removed by right-click | rulers and guides | present |
| View menu: Show Grid, Rulers, Guides, Origin, Viewport; Center Selection, Frame Selection, Clear Guides | View | present, each switch the view's own; walked through the menu's clicks |
| The game's viewport rectangle | View › Show Viewport | the manifest's `resolution` from the origin |
| Toggle 2D grid | View › Grid | a shortcut to the menu's switch |
| Frame all, Frame selection | View › Frame Selection; Center View | present |
| Zoom out, percentage (resets to 100%), zoom in | zoom widget | present |
| Pan mode (hand), and middle-drag, right-drag, Space-drag in any mode; wheel zooms at the cursor | Pan mode and Pan View | present (walked: a drag in Pan mode moved the origin 80 px) |
| Ruler mode: a drag reads its length in world units and its angle | Ruler mode | present (walked: 100 screen px at 153% read "65.5 px · 0.0°") |
| Alt-hover measurement between the selection and another node | Figma's measurement | present |
| Stationary right-click: the nodes under the pointer | Alt+RMB list; List Select mode | present on right-click, no mode button |
| Lock / Unlock selected node (toolbar), a shortcut to the hierarchy's lock | Lock | present (walked: the button toggles the node's lock) |
| The selection frame turned with a rotated node: its eight handles on the node's own box, the rotate handle above its own top edge, its own size in the label; a handle resizes along the node's axes with the opposite corner held | Select mode's frame on a rotated node | present (walked: a turned 120×120 square resized to 153×139, `scale={{ x: 1.2746, y: 1.161 }}`, its NW corner still at the same pixel after the write) |
| The origin handle (the dot at a container's `pivot`, a sprite's `anchor`), dragged | Pivot mode ("Click to change object's pivot") | in the Pixi adapter's `spatialHandles`: the drag writes the origin and compensates `position` in one undo step; not walked here |

## Gaps, the work order

Each is a control the reference has a home for and we lack, or have in a weaker form:

1. List Select as a mode (the list exists on a stationary right-click).
2. Group (a click on a child selects its grouped parent).
3. The `2D` board against Figma: frames and zoom are present (walked: a Pixi prefab's story as a
   labelled frame, Fit board, zoom out, the percentage, zoom in); the layers list for the board's
   frames, and the zoom menu, are not.

Below this line is planning, not measurement: what Group means for a JSX tree is decided when that
row is built.
