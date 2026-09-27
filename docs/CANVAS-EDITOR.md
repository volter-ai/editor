# The canvas editor and its reference

A game's UI is React DOM; Pixi is 2D game rendering. A `dom` root is the UI layer: the HUD over the
world, menus and screens, authored on the UI board (`workspace:ui-components`, from the root's
stories), where an element is selected with its layout and edited in place, and drawn over the world
in Play, where its elements take their own clicks. The `game` template ships one, `src/ui/game.tsx`,
as the HUD over its 3D world. A `canvas` root (Pixi, through `@pixi/react`) is a game's 2D scene:
sprites, tilemaps, the 2D world itself, never its UI. When a 2D scene is stacked over another world,
its tappable game objects take their presses as described below. (Walked on a fresh `game`: the UI
board listed the HUD's four stories; a double-click on the Ready story's title selected its `h1`,
showing `static` and `inline-block`, its handles and an in-place text field; in Play the HUD drew
over the world, a press on its panel hit the `h1` and a press beside it the three.js canvas.)

For a `canvas` root, the nearest product is Godot's 2D
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
| Inspector (Transform: x, y, rotation, scale, skew x and y in degrees) | Inspector | writes the source's JSX attribute; undo restores it. Skew sits under Scale as Godot's Node2D shows it and writes Pixi's `skew` point in radians (walked: 10 typed into Skew X wrote `skew={{ x: 0.174533, y: 0 }}` and read back 10); Godot's Node2D skew is one angle, Pixi's two |
| Move, Rotate, Scale | Move, Rotate, Scale modes | present |
| Select, with the box's eight handles and the rotate handle | Select mode, which shows the handles | present: on the 2D surface Select is the handle mode, lit when a scene opens, and the strip has no separate Transform button (walked: Select lit on a fresh open and armed 8 handles). Cmd (Ctrl)-drag rotates the selected node about its pivot and Cmd+Alt-drag scales it, wherever the press lands (walked: a Cmd-drag took Target from 0.5 to 1.1958 rad). Alt-drag moves the selected node from wherever the press lands, snapping as a plain move does (walked: a press off Target moved it +24, +15). V puts the selected node's pivot under the pointer, its position compensating so the content stays put, written to source as `pivot={{ x, y }}` (walked on Block: the pivot handle landed at the pointer and the box did not move); the pivot handle's own drag now writes on a source-backed canvas too. With smart snap on, V and the pivot's drag snap it to its own node's sides and centre line along the node's turned axes (walked on the turned Block: V 1.5 units inside the right side wrote `pivot={{ x: 60, y: 0 }}`; with smart snap off, `{ x: 58.5, y: 1.5 }`) |
| Shift while resizing from a corner, or on the Scale gizmo | Scale mode's "Shift: Scale proportionally" | present (walked: a Shift-held SE box drag wrote `scale={1.2}`, and Shift on the gizmo's x handle `scale={1.625}`) |
| Toggle smart snap | Smart snap | present: a move aligns the box's sides or centre to the parent, other nodes' sides and centres, and guides (walked: on writes 580 against a neighbour's edge, off writes the free 581.5) |
| Toggle snap (Grid Snap in 2D), Snap settings | grid snap, Snapping Options, Configure Snap | Configure Snap's fields: the grid step (8 px) and offset, which the drawn grid follows, a primary line every 8 steps, the rotation step and offset, the scale step; Use Rotation Snap, Use Scale Snap, Snap Relative (off) and Use Pixel Snap (on) as Godot keeps them; Smart Snapping's Snap to Parent, Other Nodes, Node Sides, Node Center and Guides. Walked: step 8 wrote (728, 432); step 10 with offset x 3 wrote (723, 440), the grid redrawn at 10; a free move wrote whole pixels (724, 435); Snap Relative from (724, 435) wrote (748, 451). A snapped rotation lands the angle itself on the step from the offset, as Godot's does, and steps from the start only under Snap Relative (walked: a Cmd-drag from 28.6° wrote 75°, and with a 5° offset 65°); the primary lines drew every 8 steps. Other Nodes' own switch is not walked. Partial: [minor] Node Anchor has no row: Godot's snaps to a Control's anchors, and a Pixi scene has no Control nodes; the snapped angle is the one on screen, which is Godot's local rotation only when no parent is rotated; a 2D view keeps its own Rotation Step and Scale Step, Godot's 15° and 0.1 (walked: the settings read 15 and 0.1). Remaining [minor]: pixel snap rounds even under a rotated parent, where Godot's does not |
| Rulers; guides dragged from them, moved, removed by right-click | rulers and guides | present |
| View menu: Grid (Show, When Snapping, Hide), Rulers, Guides, Origin, Viewport; Lock and Group gizmos; Center Selection, Frame Selection, Clear Guides | View | partial: these items are present, each the view's own switch (walked through the menu's clicks). The Grid submenu's three states are radio items (walked: When Snapping drew no grid with the magnet off and the grid with it on; Hide and Show), and the Gizmos submenu's Lock and Group draw a mark at each locked or grouped node's corner (walked: locking Target drew the lock at its corner; the switch removed it). The Gizmos submenu's Position hides the selected node's pivot handle and Transformation the Move, Rotate and Scale tools' axis gizmo (walked: in Move on Target, Transformation off removed the axis and kept the pivot, Position off removed the pivot, both back restored both). Every 2D surface obeys them: the world document, a prefab in isolation and an ingested canvas (the latter two not walked). Godot's Preview Canvas Scale, Preview Theme and Preview Translation are absent because the product has none of what they preview: a project declares a resolution but no content scale, no UI theme and no translations. Show Helpers is not offered: Godot's is off by default and draws helpers while dragging, which ours shows as its snap guides, and a 2D view's pivot answers only to its Position gizmo, not to the Helpers switch a 3D view flips (not walked: no 3D stage in the probe). Grid and Gizmos are submenus, in Godot's order (walked: the menu read Grid ▸, the Show switches, Gizmos ▸, then the view verbs). The grid defaults to Show When Snapping, Godot's default (measured on 4.7.1: no grid with grid snap off, the grid with it on; walked on a fresh view in a new project: no grid with the magnet off) |
| The game's viewport rectangle | View › Show Viewport | the manifest's `resolution` from the origin |
| View › Toggle Grid | View › Grid › Toggle Grid | present in the menu, Godot's home for it; the toolbar's own grid button is gone, having no home in Godot's toolbar. Godot's toggle, read from the installed 4.7.1 from both of its other states, goes from Show to Show When Snapping and from any other state to Show (When Snapping → Show → When Snapping; Hide → Show → When Snapping); ours does the same (walked: When Snapping drew no grid, Toggle Grid drew it, a second Toggle Grid returned to When Snapping; from Hide, Command+' went Hide → Show → When Snapping, Godot's path). Its Command+' is the `canvas.toggleGrid` action (walked on a workbench carrying it: Command+' drew the grid from When Snapping and a second press returned to When Snapping) |
| Frame all, Frame selection | View › Frame Selection | present; Frame all has no exact home |
| Zoom widget: Center view, zoom out, percentage (resets to 100%), zoom in | zoom widget: Center View, −, %, + | partial: our Center view puts the game's viewport rectangle in the middle of the pane at the current zoom (walked: its centre landed on the pane's, 888, 319), but Godot's own Center View target was not read from the installed product, so the behaviour is unverified against it; the scene zooms from 2% to 3200% |
| List Select mode: a click lists the selectable nodes there; Pivot mode: a click or drag puts the selected node's pivot there, snapped as V is. Both beside Pan and Ruler, and a mode stays on through the remount its own write causes. Select, Move, Rotate, Scale, List Select, Pivot, Pan and Ruler are one radio group, as Godot's are: a transform tool leaves the others, and while one of those is on no transform tool is lit and the keys do the same: the active keymap's W, E and R (and Select's, where the keymap gives it one) are this 2D view's while it is active (walked: Ruler on unlit Select; Move then lit alone and the ruler's layer was gone; with Ruler on, W lit Move and removed the ruler's layer, and E lit Rotate) | List Select, Pivot | present (walked: List Select on Target listed Block; Pivot 1.5 units inside Target's turned right side with smart snap wrote `pivot={{ x: 60, y: 0 }}` and x 752.655, y 448.7655, and the mode stayed lit). Partial: Pivot mode's Shift+click sets Godot's temporary pivot, and Shift on the Pivot button puts it at the selection's centre: a marked point a rotation turns the node around, no node's own pivot changed, cleared by Escape in Pivot mode or a new selection (walked: with the pivot set left of Target, a Cmd-drag turned Target by 0.2337 rad and moved its origin from (700, 420) to (695.65, 457.05), a turn about world (540, 420) that kept its distance, 160.01; the pivot stays drawn afterwards). A multi-selection rotates and scales as one group, as Godot's does: Cmd-drag, Cmd+Alt-drag, or any drag in Rotate or Scale mode turns or scales every selected node about the temporary pivot, else the centre of their bounds, each origin moving with it (walked with Other and Target selected: a Cmd-drag turned both by 0.2141 rad about (610.7, 420), their bounds' centre, and a Cmd+Alt-drag scaled both by 2.3497 about x 610.7; with a Shift+click temporary pivot, a Rotate-mode drag turned both about it, (611, 306); Shift on the Pivot button drew the pivot at the two nodes' centre). [minor] A single node's scale does not yet use the temporary pivot; a group shows no shared frame or handles, only the gestures, and scales on both axes only; under unequal factors a rotated member scales on its own axes while its origin moves on the world's, where Godot would skew it; a turn under a mirrored or unevenly scaled parent turns the node's own axis by the dragged angle on screen, measured in the parent's space as Godot measures it (walked: under a parent scaled -1 by 2, a Cmd-drag turning 30 degrees on screen wrote rotation 5.9854, which puts the bar's axis at 211.5 degrees on screen where the cursor ended at 210, and the bar followed the cursor up and left where adding the turn to the local rotation would have swung it down); the four sit in the tool strip after Scale, Godot's own row (walked: the strip read Select, Move, Rotate, Scale, List Select, Pivot, Pan, Ruler, then snapping; Ruler lit alone, and Select took the row back) |
| Pan mode (hand), and middle-drag, right-drag, Space-drag in any mode; wheel zooms at the cursor | Pan mode and Pan View | present (walked: a drag in Pan mode moved the origin 80 px) |
| Ruler mode: a drag reads its length in world units, its angle and its Δx, Δy | Ruler mode | present (walked before the Δ readout: 100 screen px at 153% read "65.5 px · 0.0°"). Its points snap as Godot's do, read from the installed 4.7.1 (an editor plugin armed Ruler over the same pointer: grid snap off read (1136.0, 549.0), on read (1136.0, 552.0), on the 8 px grid): the grid when the magnet is on, whole pixels under Use Pixel Snap (walked: the same drag read Δ 46.0, 13.0 free and Δ 48.0, 16.0 with grid snap) |
| Alt-hover measurement between the selection and another node | Figma's measurement | present |
| Stationary right-click: Godot's menu, "Add 2D Node Here…" and "Instantiate Scene Here…", at the point, a child of the selected node or else of the scene's root, the point snapped as a move is. Add opens Godot's Create New Node dialog with the parts the installed 4.7.1's has (Favorites and Recent beside Search with an (un)favorite button, Matches as the class tree with its Filters menu, the class's Description, Create), titled after the base class as Godot's is ("Create New Container" where Godot's reads "Create New CanvasItem"), with Up and Down walking the Matches from the search field. Its Show Custom filter lists the project's canvas components as custom classes under Container, placed through the drop door; Godot's Show Editor is absent, a Pixi project having no editor-only classes; Instantiate lists the project's canvas components, this editor's scenes. Alt+right-click: the nodes under the pointer | RMB and Alt+RMB; the Create New Node dialog; List Select mode | present (walked: with nothing selected, Add Container wrote `<pixiContainer label="Container" x={935} y={484} />` inside the scene's root, the click at world (934.50, 484.22); through the dialog, the Matches tree read Container with Sprite, Text and Graphics under it, "spr" left Sprite, its Description read "Sprite < Container: Draws one texture…", ☆ made it a Favorite, Create wrote `<pixiSprite label="Sprite" x={935} y={484} />`, and the next opening listed it in Recent; Instantiate listed Badge and wrote `<Badge x={935} y={484} />` with its import; Alt+right-click lists locked nodes too, as Godot's "including locked" does, while List Select does not (walked: with Target locked, Alt+right-click in it listed Block, and List Select at the same point listed nothing). The dialog's own additions walked too: the Matches read Container, Sprite, Text, Graphics and Badge, Show Built-in off left Badge alone, and two Down presses from the search field selected Text. The built-in classes follow Pixi's own display classes: Container, Sprite with AnimatedSprite under it, TilingSprite, NineSliceSprite, Text, BitmapText, HTMLText and Graphics (walked: creating TilingSprite wrote it with `texture={Texture.WHITE}` and the `Texture` import, and it mounted). [minor] Mesh and particle containers are not offered; Instantiate lists components rather than opening a file dialog; a right-drag pans, where Godot pans with the middle button |
| Lock / Unlock selected nodes (toolbar), a shortcut to the hierarchy's lock; Group the same | Lock, Group | present: both act on every selected node, as Godot's do (walked: Spinner and Target selected, Lock selected nodes drew two lock marks, Unlock selected nodes cleared both). Lock and Group are kept per checkout by each node's label path, through a source write's remount and into the next session (walked: Target stayed locked after an external edit and after a close and reopen), as Unity keeps scene pickability per user; Godot saves them in the scene file. A rename drops them |
| Skeleton Options menu; the selected node's type menu | Godot's 2D toolbar | absent: a Pixi scene has no skeleton or bone nodes, and no node type here carries its own conversion menu the way a Godot Sprite2D or Polygon2D does |
| Group / Ungroup selected nodes (toolbar), `grouped` beside `locked` | Group | present, kept as the lock is (walked: with the root grouped, a click on a child selected the root; ungrouped, the child) |
| The selection frame turned with a rotated node: its eight handles on the node's own box, the rotate handle above its own top edge, its own size in the label; a handle resizes along the node's axes with the opposite corner held | Select mode's frame on a rotated node | present (walked: a turned 120×120 square resized to 153×139, `scale={{ x: 1.2746, y: 1.161 }}`, its NW corner still at the same pixel after the write) |
| The origin handle (the dot at a container's `pivot`, a sprite's `anchor`), dragged | Pivot mode ("Click to change object's pivot") | in the Pixi adapter's `spatialHandles`: the drag writes the origin and compensates `position` in one undo step; not walked here |
| `2D` board: the zoom percentage opens a menu with the zoom typed as a percentage, Zoom in and out, Zoom to fit, Zoom to 50%, 100% and 200% | Figma's zoom menu | present (walked: 250 typed read 250%, Zoom to 50% read 50%, Zoom to fit framed the board). It sits at the board's top right, against the properties panel, as Figma's does (walked: the bar's right edge 8 px in from the board's, its top 8 px down). Partial: Figma's view toggles in that menu (pixel preview, layout grids) have no counterpart |
| `2D` board: its frames in the Hierarchy, each with its district beside its name | Figma's layers panel | present: the board publishes its own adapter, whose rows are the frames and whose selection is the board's (walked with two prefabs: the rows read Badge and Chip; a Chip row click made the Chip frame active and a Badge row click the Badge frame; a click on the Chip frame lit its row; the Inspector described Chip's story). Partial: frames only, not their contents, and districts are a label rather than Figma's section rows |

## Gaps, the work order

Judged against the references by an independent reviewer on 2026-09-26, ranked. Now present:
Select as the handle mode, rotation and scale snap under their own toggles, Shift for proportional
scaling, Center View and a wider zoom, the ruler's Δx and Δy, Group, and the grid's step and
offset with Snap to Other Nodes, Snap Relative and Use Pixel Snap, Alt-drag move, and V with the
pivot snapping to its node's sides and centre, Configure Snap's fields, and right-click's Add Node
with Alt+right-click's list including locked nodes, the List Select and Pivot modes in one radio
group with the transform tools, Lock and Group on every selected node, kept per checkout with their
gizmos, the View menu's Grid states and Position and Transformation gizmos, Skew in the
Inspector's Transform, and the board's frames in the Hierarchy.

Godot's 2D tool keys, read from the installed 4.7.1's shortcuts (Q Select, W Move, E Rotate, R Scale,
G Pan, M Ruler), are all bound, the `canvas.*` ones only on a canvas stage: a mounted canvas
document marks itself, so the stage reports `canvas` for it even in a world with a 3D root, and a
stage with no canvas handler (3D, the 2D board, a DOM story) leaves the keys free (walked in a world with both roots, a 3D `world` and a 2D canvas root, on a workbench carrying the
rule: on the 2D view W lit Move, Q Select, G Pan, M Ruler and a second M left it, Command+' drew the
grid and took it away, and nothing logged "did not run"; on the 3D view G changed nothing while W
armed Move. Walked before that on a canvas-only world, on an earlier form of the rule: W lit Move, Q Select, G Pan, M Ruler and a second M left it; on a 3D stage G
did nothing and logged nothing while W still armed Move). The tool strip is Godot's one row: Select to
Ruler, snapping, then Lock, Group and the View menu (walked); Frame all, with no home in Godot,
stays apart.

On the 2D board and on a canvas story document the canvas keys are left free by the same rule
(walked on the workbench carrying it: G, M and Command+' there logged nothing). The gizmo switches on
the isolation and ingest surfaces are not walked: a project reaches an isolation scene only through
its entrypoint's scene table, which the probes lack, and none is an ingested game.

A game's own standalone boot (`src/main.ts`, the template's) mounts a `canvas` root, which it used to
refuse: every `pixi.js` class is registered and the entry renders inside `<Application>`, stacked as
the editor's runtime stacks worlds: the bottom `three` or `canvas` world takes pointer input and
clears opaque, a world above it lets input fall through and clears transparent, and Pixi renders at
the device pixel ratio with `autoDensity` and antialiasing, as the editor's canvas root does. The
editor's router forwards a point to an upper world only when that world's `hitTest` claims it; a Pixi
world above claims a point only where Pixi's own hit test finds an interactive object (`eventMode`
static or dynamic) there: a tappable sprite takes the press, alone, and every other point falls through
to the world beneath, in Play (the canvas root offers its `hitTest` to the runtime's router) and
exported (the boot routes the same way). Walked in Play and in the Build Player: a press on an interactive
Pixi sprite over the 3D world logged the sprite's handler once and nothing in the world; a press
elsewhere logged the world once and not the sprite. A `three` world above the bottom one says
`pointer-events: none` on React Three Fiber's own wrapper, which otherwise sets `auto`.

Build Profiles' Build And Run (Unity's; Godot's Web export runs in a browser) builds, then opens the
Build Player document on the build's own `dist/`, which the editor server serves; what the running
build prints, and its uncaught errors, reach the editor's console prefixed `[Build Player]`, as a
Godot export run with remote debug reports into the editor, and the screenshot door photographs the
build inside the player, its canvases copied in the player's own frame (walked: a fresh game with a
3D `world` and a `canvas` layer above it built and ran; the screenshot showed the world with the layer's
TilingSprite and BitmapText over it, and the console read no errors). The document probe reaches
into the player as it reaches into a portal, and a click there lands where the page hit-tests it,
naming what it hit (walked: a press at the 2D layer's centre reached the three.js canvas beneath, its
canvas reading `pointer-events: none` at a 2096 px store for 1048 CSS px; with the 3D world moved
above, its canvas read `none` and the press reached the Pixi canvas). Build And Run always runs
`dist/` and starts no `server` configuration, and a game that renders only on demand may photograph
before its frame [minor].

Remaining partials, tagged: all [minor] — a single node's scale about the temporary pivot, a group's
shared frame and handles, single-axis group scale, rotated members under unequal group scale, Mesh and particle kinds,
Node Anchor (no Controls in Pixi), pixel snap under a rotated parent, the board's frames-only layers
and missing zoom-menu view toggles, Frame all, and the absent Preview, Skeleton and node-type menus
and Show Helpers, each with its reason in its row. Exported games add two, declared above: a demand-rendered game's photograph, and Build And
Run's fixed `dist/` with no server.
