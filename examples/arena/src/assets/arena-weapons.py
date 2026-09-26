"""The arena's weapon family, authored in Blender's own Python.

This file IS the source of the three generated models under
`public/models/generated/` — `arena-pistol.glb`, `arena-rifle.glb` and
`arena-grenade-launcher.glb` — and of `src/models/arena-weapons.blend`, the
tracked Blender document the editor's Model workspace opens. It is read and
executed inside the editor's Blender (5.2 LTS, headless in the tab's worker)
by `scripts/bake-arena-weapons.mjs`, which appends one `bake('<asset>')` line
per asset; Blender's own glTF exporter writes the `.glb`, and the bytes reach
`public/` through the session's recording door. See that script's header.

Read it as a MODEL, not as a program: every builder below is a list of
Blender primitives with their dimensions, materials and placement, in the
order the weapon reads on screen.

WHAT THE GAME READS OF THESE ARTIFACTS, measured before a line was written
(`git grep getObjectByName`, and the three paths): `src/prefabs/WeaponModel.tsx`
loads each `.glb` by PATH, clones the whole scene and walks it for meshes. It
reads no node name, no custom property and no material name. The node names
below are still exactly the previous bake's, because a name that has been
shipped is a surface whether or not today's code reads it — but the PATHS are
the contract, and they are the one thing that may never move.

CONVENTIONS, four of them, because everything else follows:

1.  **Numbers are stated in the GAME's frame** — three.js/glTF, Y up,
    -Z forward, and every weapon points down -Z — and `at()` maps them into
    Blender's Z-up world. Blender's glTF exporter maps them back on the way
    out, so a coordinate written here is the coordinate the prefab sees.
    `spin()` does the same for a rotation, in degrees, composed X then Y
    then Z.

2.  **A group is an Empty.** `group()` parents its children to a plain Empty
    with `matrix_parent_inverse` left at identity, so a child's location is
    read in its parent's space exactly as a scene graph reads it.

3.  **Modifiers are applied here, not at export.** `bpy.ops.export_scene.gltf`
    does not evaluate them by default. Each helper applies its own, in the
    order the shape needs: ARRAY BEFORE BEVEL, so a run of ribs is bevelled
    as one mesh and not as five that happen to touch.

4.  **`cylinder()` takes `(top, bottom)`, in that order** — the order the
    scene graph's own cylinder took, because these numbers were transcribed
    from it. Cinematic-story's `sky-city-kit.py` documents the OPPOSITE order
    for its own helper of the same name; if you copy a call between the two
    files, swap the pair. The one asymmetric cylinder here is
    `LauncherBore` (0.145 at the breech end, 0.165 at the muzzle), and the
    way that was settled was by reading the ring radii out of the shipped
    `.glb`, not by reasoning about the rotation.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix

# --------------------------------------------------------------- the frame

#: Every arena weapon points down native three.js -Z. Carried out as the
#: root node's `extras`, where the previous bake put it.
ARENA_WEAPON_FORWARD = (0.0, 0.0, -1.0)


def at(position):
    """A game-frame (x, y, z) as a Blender location.

    Blender's glTF exporter writes Blender (x, y, z) out as (x, z, -y); this
    is that map read backwards, so what is written here is what lands.
    """
    return (position[0], -position[2], position[1])


def spin(rotation):
    """A game-frame XYZ Euler in DEGREES as a Blender rotation.

    Composed as an explicit product of three elementary rotations rather than
    handed to `mathutils.Euler`, because "XYZ" names a different composition
    order in Blender than it does in a scene graph, and a silently transposed
    pair of angles is not a difference anyone would see until the weapon was
    in the player's hands. The basis change is the same one `at()` applies.
    """
    rx, ry, rz = (math.radians(angle) for angle in rotation)
    game = (
        Matrix.Rotation(rx, 4, 'X')
        @ Matrix.Rotation(ry, 4, 'Y')
        @ Matrix.Rotation(rz, 4, 'Z')
    )
    basis = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    return (basis.inverted() @ game @ basis).to_euler()


def place(obj, name, position=None, rotation=None):
    obj.name = name
    if obj.data is not None:
        obj.data.name = name
    if position is not None:
        obj.location = at(position)
    if rotation is not None:
        obj.rotation_euler = spin(rotation)
    return obj


def group(name, children=(), position=None, rotation=None):
    """The scene graph's group: an Empty with the children parented under it."""
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = 0.1
    bpy.context.collection.objects.link(empty)
    for child in children:
        child.parent = empty
        child.matrix_parent_inverse = Matrix.Identity(4)
    if position is not None:
        empty.location = at(position)
    if rotation is not None:
        empty.rotation_euler = spin(rotation)
    return empty


# ----------------------------------------------------------- the materials
#
# Base colours are LINEAR — the exact `baseColorFactor` triples the previous
# bake wrote — so Blender's Principled node and the glTF material agree to the
# last digit and the palette survives the move unchanged. The hex each one
# came from is in the comment; do NOT re-derive these from the hex.

PALETTE = {
    # '#4b5056'
    'gunmetal': dict(
        base=(0.07036009568874305, 0.08021982030622662, 0.09305896283800832),
        metallic=0.36, roughness=0.27,
    ),
    # '#282d33'
    'graphite': dict(
        base=(0.02121901037134225, 0.026241221889696346, 0.033104766565152086),
        metallic=0.26, roughness=0.34,
    ),
    # '#a5a7a5'
    'ceramic': dict(
        base=(0.37626212298046485, 0.3864294337766795, 0.37626212298046485),
        metallic=0.08, roughness=0.48,
    ),
    # '#ed821b'
    'orange': dict(
        base=(0.8468732315065057, 0.22322795730611386, 0.010960094003125918),
        metallic=0.06, roughness=0.48,
    ),
    # '#f4c172', emissive '#b64d08' at strength 0.16
    'sight': dict(
        base=(0.9046611743890203, 0.5332764040016892, 0.16826940017946088),
        metallic=0.02, roughness=0.42,
        emission=(0.46778379610254284, 0.07421356837213867, 0.002428215868235294),
        emission_strength=0.16,
    ),
}

_MATERIALS = {}


def material(key):
    if key in _MATERIALS:
        return _MATERIALS[key]
    spec = PALETTE[key]
    mat = bpy.data.materials.new(key)
    mat.use_nodes = True
    # SINGLE-SIDED, like every weapon material ever was: the previous bake's
    # glTF carries no `doubleSided`, which means false. Blender's default is
    # the opposite, and a double-sided receiver lights its own interior
    # through the ejection port.
    mat.use_backface_culling = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*spec['base'], 1.0)
    bsdf.inputs['Metallic'].default_value = spec['metallic']
    bsdf.inputs['Roughness'].default_value = spec['roughness']
    if 'emission' in spec:
        bsdf.inputs['Emission Color'].default_value = (*spec['emission'], 1.0)
        bsdf.inputs['Emission Strength'].default_value = spec['emission_strength']
    _MATERIALS[key] = mat
    return mat


# ---------------------------------------------------------- the primitives


def _select(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _apply(obj, modifier):
    _select(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def _smooth_by_angle(obj, degrees):
    """Shade smooth, then mark every edge over the angle sharp.

    Blender 4.1+ ships Smooth by Angle as a bundled geometry-nodes ASSET, and
    this build's payload carries no asset library, so the operator refuses by
    name — and the refusal is a TEXT SCAN of the submitted code, so naming it
    in a comment refuses just as readily. The operator pair below is what that
    asset does and needs nothing outside the mesh.
    """
    _select(obj)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.select_mode(type='EDGE')
    bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(degrees))
    bpy.ops.mesh.mark_sharp()
    bpy.ops.object.mode_set(mode='OBJECT')


def _shade_curved(obj, flat_ngons=True):
    """Smooth the round part of a primitive and keep its caps flat.

    Blender's primitive operators build flat-shaded geometry; a barrel drawn
    that way reads faceted at the length the view model holds it. The cap of a
    cylinder is the one face that must stay flat, and it is the one face that
    is an n-gon — so that, rather than an angle threshold, is the test.
    """
    mesh = obj.data
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if flat_ngons:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        for face in bm.faces:
            if len(face.verts) > 4:
                face.smooth = False
                for edge in face.edges:
                    edge.smooth = False
        bm.to_mesh(mesh)
        bm.free()
    return obj


def _finish(obj, name, key, position=None, rotation=None):
    obj.data.materials.append(material(key))
    return place(obj, name, position, rotation)


def beveled_box(name, size, radius, key, position=None, rotation=None):
    """A box with every edge chamfered — the kit's workhorse.

    ONE bevel segment: the flat chamfer the previous bake drew. A rounded
    profile here would change every silhouette in the game, and silhouette is
    what a weapon is read by at pickup distance.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.object
    obj.data.transform(Matrix.Diagonal((size[0], size[2], size[1], 1.0)))
    bevel = obj.modifiers.new('Bevel', 'BEVEL')
    bevel.width = radius
    bevel.segments = 1
    bevel.limit_method = 'NONE'
    _apply(obj, bevel)
    _smooth_by_angle(obj, 34.0)
    return _finish(obj, name, key, position, rotation)


def ribs(name, count, offset, key, position=None, rotation=None):
    """A run of grip ribs: one 0.29 x 0.035 x 0.035 bar, arrayed by a constant
    offset, then bevelled and smoothed AS ONE MESH.

    The array comes first for a reason: bevelling each bar separately and then
    repeating it gives the same silhouette but a different vertex count, and
    the previous bake's 480-vertex slide ribs are five bars bevelled together.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.object
    obj.data.transform(Matrix.Diagonal((0.29, 0.035, 0.035, 1.0)))
    array = obj.modifiers.new('Array', 'ARRAY')
    array.count = count
    array.use_relative_offset = False
    array.use_constant_offset = True
    array.constant_offset_displace = at(offset)
    _apply(obj, array)
    bevel = obj.modifiers.new('Bevel', 'BEVEL')
    bevel.width = 0.007
    bevel.segments = 1
    bevel.limit_method = 'NONE'
    _apply(obj, bevel)
    _smooth_by_angle(obj, 34.0)
    return _finish(obj, name, key, position, rotation)


def cylinder(name, radii, height, key, segments=32, position=None, rotation=None):
    """A truncated cone standing on the game's Y axis. `radii` is (TOP, BOTTOM)
    — see convention 4 in this file's header."""
    top, bottom = radii
    bpy.ops.mesh.primitive_cone_add(
        radius1=bottom, radius2=top, depth=height, vertices=segments,
    )
    return _finish(_shade_curved(bpy.context.object), name, key, position, rotation)


def torus(name, radius, tube, key, radial_segments=12, tubular_segments=48,
          position=None, rotation=None):
    """Blender's torus lies in its XY plane, which the exporter turns into the
    game's XZ plane; a scene-graph torus stands in XY. The quarter turn below
    is that one difference, paid once here rather than at every call site.
    `radial_segments` goes around the TUBE, `tubular_segments` around the ring
    — the scene graph's names, which are Blender's minor/major reversed."""
    bpy.ops.mesh.primitive_torus_add(
        major_radius=radius, minor_radius=tube,
        major_segments=tubular_segments, minor_segments=radial_segments,
    )
    obj = bpy.context.object
    obj.data.transform(Matrix.Rotation(math.radians(90.0), 4, 'X'))
    return _finish(_shade_curved(obj, flat_ngons=False), name, key, position, rotation)


def pipe(name, points, radius, key, radial_segments=10, tubular_segments=64,
         position=None, rotation=None):
    """A round rail through the given points: a BEZIER curve on AUTOMATIC
    handles with a round bevel, converted to a mesh.

    Blender's own curve bevel is the mechanism, so the profile is quantised to
    multiples of four around the tube (`bevel_resolution` counts QUARTER
    subdivisions) where the scene graph's tube took any count. The ends are
    left OPEN, as the previous bake's were — this kit's one rail is a trigger
    guard whose ends are buried inside the frame and the grip.
    """
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for index, point in enumerate(points):
        knot = spline.bezier_points[index]
        knot.co = at(point)
        knot.handle_left_type = 'AUTO'
        knot.handle_right_type = 'AUTO'
    curve.resolution_u = max(2, tubular_segments // max(1, len(points) - 1))
    curve.bevel_depth = radius
    curve.bevel_resolution = max(0, radial_segments // 4)
    curve.use_fill_caps = False
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    _select(obj)
    bpy.ops.object.convert(target='MESH')
    obj = _shade_curved(bpy.context.object)
    return _finish(obj, name, key, position, rotation)


def muzzle_assembly(name, radius, length, z):
    """Barrel plus collar — the shape every weapon here ends in."""
    return group(name, [
        cylinder(f'{name}Barrel', (radius * 0.68, radius * 0.68), length, 'graphite',
                 segments=20, position=(0, 0, z), rotation=(90, 0, 0)),
        torus(f'{name}Collar', radius, radius * 0.18, 'gunmetal',
              radial_segments=8, tubular_segments=24,
              position=(0, 0, z - length / 2), rotation=(90, 0, 0)),
    ])


def finish_weapon(root, kind):
    """The two custom properties the root carried out as glTF `extras`."""
    root['weaponKind'] = kind
    root['forward'] = list(ARENA_WEAPON_FORWARD)
    return root


# ------------------------------------------------------------- the weapons


def build_arena_pistol():
    """Compact sidearm: clean slide, undercut frame, guarded trigger,
    readable orange grip."""
    root = group('ArenaPistol', [
        beveled_box('PistolSlide', (0.23, 0.17, 0.64), 0.025, 'gunmetal',
                    position=(0, 0.08, -0.1)),
        beveled_box('PistolFrame', (0.2, 0.14, 0.46), 0.024, 'ceramic',
                    position=(0, -0.07, 0.01)),
        beveled_box('PistolGrip', (0.17, 0.43, 0.21), 0.032, 'orange',
                    position=(0, -0.31, 0.14), rotation=(-10, 0, 0)),
        muzzle_assembly('PistolMuzzle', 0.055, 0.22, -0.49),
        pipe('PistolTriggerGuard', [
            (-0.085, -0.12, -0.04),
            (-0.085, -0.25, -0.04),
            (-0.085, -0.27, 0.12),
            (-0.085, -0.13, 0.18),
        ], 0.018, 'graphite', radial_segments=7, tubular_segments=24),
        beveled_box('PistolRearSight', (0.13, 0.055, 0.055), 0.01, 'sight',
                    position=(0, 0.19, 0.12)),
        beveled_box('PistolFrontSight', (0.045, 0.05, 0.045), 0.008, 'sight',
                    position=(0, 0.19, -0.35)),
        ribs('PistolSlideRibs', 5, (0, 0, 0.045), 'ceramic',
             position=(0, 0.155, 0.04)),
    ])
    return finish_weapon(root, 'pistol')


def build_arena_rifle():
    """Mid-range rifle with a strong stock/receiver/handguard hierarchy and no
    sci-fi glow."""
    root = group('ArenaRifle', [
        beveled_box('RifleReceiver', (0.28, 0.25, 0.77), 0.035, 'gunmetal',
                    position=(0, 0.02, -0.05)),
        beveled_box('RifleHandguard', (0.3, 0.22, 0.62), 0.04, 'ceramic',
                    position=(0, 0.01, -0.71)),
        muzzle_assembly('RifleMuzzle', 0.065, 0.68, -1.34),
        beveled_box('RifleStock', (0.26, 0.28, 0.56), 0.045, 'ceramic',
                    position=(0, -0.015, 0.59), rotation=(-3, 0, 0)),
        beveled_box('RifleButtPad', (0.29, 0.34, 0.1), 0.025, 'graphite',
                    position=(0, -0.01, 0.91)),
        beveled_box('RifleGrip', (0.17, 0.42, 0.2), 0.032, 'orange',
                    position=(0, -0.31, 0.17), rotation=(-11, 0, 0)),
        beveled_box('RifleMagazine', (0.2, 0.46, 0.29), 0.035, 'graphite',
                    position=(0, -0.34, -0.23), rotation=(-8, 0, 0)),
        beveled_box('RifleCarryRail', (0.18, 0.075, 0.7), 0.014, 'graphite',
                    position=(0, 0.2, -0.18)),
        cylinder('RifleOptic', (0.075, 0.075), 0.29, 'graphite', segments=20,
                 position=(0, 0.3, -0.23), rotation=(90, 0, 0)),
        torus('RifleOpticLens', 0.061, 0.012, 'sight',
              radial_segments=8, tubular_segments=24,
              position=(0, 0.3, -0.385), rotation=(90, 0, 0)),
        ribs('RifleHandguardRibs', 7, (0, 0, 0.07), 'ceramic',
             position=(0, 0.13, -0.91)),
    ])
    return finish_weapon(root, 'rifle')


def build_arena_grenade_launcher():
    """Heavy launcher: oversized bore and drum make its role legible at pickup
    distance."""
    root = group('ArenaGrenadeLauncher', [
        beveled_box('LauncherReceiver', (0.36, 0.34, 0.72), 0.055, 'ceramic',
                    position=(0, 0.02, 0.06)),
        cylinder('LauncherDrum', (0.25, 0.25), 0.34, 'gunmetal', segments=24,
                 position=(0, -0.02, -0.2), rotation=(0, 0, 90)),
        # The bore FLARES toward the muzzle: 0.145 at the breech (the game's
        # +Y end of the cylinder, which the 90-degree X turn points backward)
        # and 0.165 at the mouth. Read out of the shipped `.glb`'s end rings,
        # not inferred — see convention 4.
        cylinder('LauncherBore', (0.145, 0.165), 0.72, 'graphite', segments=24,
                 position=(0, 0.08, -0.65), rotation=(90, 0, 0)),
        torus('LauncherMuzzleCollar', 0.18, 0.035, 'orange',
              radial_segments=10, tubular_segments=28,
              position=(0, 0.08, -1.03), rotation=(90, 0, 0)),
        beveled_box('LauncherStock', (0.32, 0.31, 0.53), 0.05, 'gunmetal',
                    position=(0, -0.01, 0.67)),
        beveled_box('LauncherButtPad', (0.35, 0.38, 0.1), 0.028, 'orange',
                    position=(0, -0.01, 0.99)),
        beveled_box('LauncherGrip', (0.19, 0.44, 0.23), 0.036, 'orange',
                    position=(0, -0.34, 0.24), rotation=(-10, 0, 0)),
        beveled_box('LauncherTopRail', (0.2, 0.07, 0.62), 0.014, 'graphite',
                    position=(0, 0.25, -0.03)),
        beveled_box('LauncherFrontSight', (0.07, 0.11, 0.06), 0.012, 'sight',
                    position=(0, 0.3, -0.43)),
        ribs('LauncherStockRibs', 5, (0, 0, 0.075), 'ceramic',
             position=(0, 0.14, 0.5)),
    ])
    return finish_weapon(root, 'grenade')


def build_arena_weapon_kit():
    """The complete family at matching scale — the subject of
    `src/models/arena-weapons.blend`, which is what the editor's Model
    workspace opens. This is the view the deleted Arena Weapon Kit document
    used to draw, and it is now an ordinary Blender document."""
    root = group('ArenaWeaponKit', [
        place(build_arena_pistol(), 'ArenaPistol', position=(-1.2, 0.26, 0)),
        place(build_arena_rifle(), 'ArenaRifle', position=(0, 0.26, 0)),
        place(build_arena_grenade_launcher(), 'ArenaGrenadeLauncher',
              position=(1.35, 0.26, 0)),
    ])
    root['forward'] = list(ARENA_WEAPON_FORWARD)
    return root


ASSETS = {
    'arena-pistol': build_arena_pistol,
    'arena-rifle': build_arena_rifle,
    'arena-grenade-launcher': build_arena_grenade_launcher,
}

#: The one tracked Blender document, under `src/models/` with the rest of a
#: project's SOURCE. (`models/` at the project root is the live session's own
#: scratch save and is gitignored — M1's convention.)
DOCUMENT = 'arena-weapons'


def _reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATERIALS.clear()


def bake(asset, dry_run=False):
    """Build one weapon into an empty scene and export it where the prefabs
    already look for it. Called by `scripts/bake-arena-weapons.mjs`.

    `dry_run` writes to `.vgai/tmp/` instead, which is outside the project's
    shipped output root and therefore outside the ledger — the door only
    records what lands under `public/`, so a build being iterated on does not
    leave a trail of superseded records behind it.
    """
    _reset()
    ASSETS[asset]()
    out = (
        os.path.join(os.getcwd(), '.vgai', 'tmp', f'{asset}.glb')
        if dry_run
        else os.path.join(os.getcwd(), 'public', 'models', 'generated', f'{asset}.glb')
    )
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=False,
        export_apply=False,
        export_extras=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f'{asset}: {os.path.getsize(out)} bytes -> {out}')
    return out


def document(dry_run=False):
    """Save the whole family as the project's tracked Blender document.

    A `.blend` is not a shipped artifact, so it does not go through the
    recording door and carries no ledger entry — the same rule the models
    starter's `src/models/cube.blend` follows.
    """
    _reset()
    build_arena_weapon_kit()
    out = (
        os.path.join(os.getcwd(), '.vgai', 'tmp', f'{DOCUMENT}.blend')
        if dry_run
        else os.path.join(os.getcwd(), 'src', 'models', f'{DOCUMENT}.blend')
    )
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=False)
    print(f'{DOCUMENT}: {os.path.getsize(out)} bytes -> {out}')
    return out
