# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
#
# Like cube.py, this bpy script is GPL-3.0-or-later; the .blend it authors
# is your artwork, and the project's other starter source is MIT.

"""The race source for Volter Model Editor, built on Blender.

Open Track, then run through the session's Blender:
    editor.blender('blender-execute', { code: open('src/models/track.py').read() })

Only track.blend may be replaced; the session saves it. View > Play drives
its grey Cube with arrows/WASD. Move any Ramp* mesh onto the circuit to jump.
Coordinates are metres, Z is up, and local +Y is forward.
"""

import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

if Path(bpy.data.filepath).name != "track.blend":
    raise RuntimeError("Open the Track model (track.blend) first: this replaces the open model.")

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
# This file owns its entire scene, including its display collections.
for group in list(bpy.data.collections):
    if group.name != "Collection":
        bpy.data.collections.remove(group)
for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.curves):
    for data in list(collection):
        collection.remove(data)


def colour(value):
    rgb = tuple(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)


def material(name, value):
    result = bpy.data.materials.new(name=name)
    result.use_nodes = True
    rgba = (*colour(value), 1.0)
    result.diffuse_color = rgba
    result.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = rgba
    return result


# Volter's light semantic roles from brand.volter.ai/tokens.json, in linear RGB.
asphalt = material("Asphalt", "#16252c")       # surface.inverse
grass = material("Grass", "#5f9a2e")           # scene.instance
orange = material("Orange", "#ff6a1f")         # accent.orange
white = material("White", "#f3f2ec")           # text.inverse
rubber = material("Rubber", "#0f1a1f")         # surface.media
violet = material("Violet", "#6a5a92")         # scene.dynamicSoft
wood = material("Wood", "#c7641a")             # data.amber
leaves = material("Leaves", "#5f9a2e")         # scene.instance
cube_material = bpy.data.materials.new(name="Material")
cube_material.use_nodes = True


def box(name, location, dimensions, surface, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(surface)
    obj.parent = parent
    return obj


def mesh(name, vertices, faces, surface, location=(0.0, 0.0, 0.0)):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(surface)
    return obj


# A long start straight, a tight northern turn and alternating infield bends.
points = [
    (32, -30), (32, -10), (32, 10), (32, 26), (22, 36), (8, 32),
    (4, 18), (-8, 16), (-16, 28), (-30, 24), (-34, 10), (-22, 0),
    (-10, -4), (-16, -18), (-34, -28), (-30, -42), (-12, -44),
    (10, -44), (26, -40),
]


def path(index, t):
    a, b, c, d = [Vector((*points[(index + offset) % len(points)], 0)) for offset in (-1, 0, 1, 2)]
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)


samples = []
for i in range(len(points)):
    for step in range(12):
        t = step / 12
        centre = path(i, t)
        tangent = (path(i, t + 0.001) - centre).normalized()
        normal = Vector((-tangent.y, tangent.x, 0))
        samples.append((centre, tangent, normal))

vertices = []
for centre, tangent, normal in samples:
    vertices.extend([tuple(centre - normal * 5), tuple(centre + normal * 5)])
faces = []
for i in range(len(samples)):
    j = (i + 1) % len(samples)
    faces.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
mesh("Track", vertices, faces, asphalt)
# Raised just above the asphalt, with face normals up: crisp road markings.
for side in (-1, 1):
    edge = []
    for centre, tangent, normal in samples:
        edge.extend([tuple(centre + normal * (side * 4.62 - 0.09) + Vector((0, 0, 0.012))),
                     tuple(centre + normal * (side * 4.62 + 0.09) + Vector((0, 0, 0.012)))])
    mesh(f"Edge.{side}", edge, faces, white)
for i, (centre, tangent, normal) in enumerate(samples):
    if i % 4 == 0:
        line = box(f"Centre.{i}", (centre.x, centre.y, 0.015), (0.16, 1.5, 0.02), white)
        line.rotation_euler.z = math.atan2(tangent.y, tangent.x) - math.pi / 2

bpy.ops.mesh.primitive_plane_add(size=300, location=(0, -4, -0.04))
ground = bpy.context.active_object
ground.name = "Ground"
ground.data.materials.append(grass)

for i, (centre, tangent, normal) in enumerate(samples):
    if i % 3 != 0:
        continue
    for side in (-1, 1):
        at = centre + normal * (5.3 * side)
        kerb = box(f"Kerb.{i}.{side}", (at.x, at.y, 0.09), (0.6, 1.7, 0.18), white if i % 2 else orange)
        kerb.rotation_euler.z = math.atan2(tangent.y, tangent.x) - math.pi / 2
    if i % 12 == 0:
        at = centre - normal * 7.3
        for tyre in range(3):
            bpy.ops.mesh.primitive_torus_add(major_segments=12, minor_segments=6, major_radius=0.52, minor_radius=0.22, location=(at.x + tangent.x * (tyre - 1) * 1.4, at.y + tangent.y * (tyre - 1) * 1.4, 0.35))
            obj = bpy.context.active_object
            obj.name = f"Barrier.{i}.{tyre}"
            obj.data.materials.append(rubber)

# The checker line and gantry make the start readable from the chase camera.
for row in range(2):
    for column in range(10):
        box(f"Start.{row}.{column}", (27.5 + column, -24 + row * 0.5, 0.015), (1, 0.5, 0.03), white if (row + column) % 2 else asphalt)
for x in (25.8, 38.2):
    box(f"Gantry.Post.{x}", (x, -24, 3.1), (0.35, 0.5, 6.2), white)
box("Gantry.Beam", (32, -24, 6.0), (13, 0.6, 0.8), orange)
for i in range(7):
    box(f"Gantry.Check.{i}", (27.5 + i * 1.5, -24.32, 6.0), (0.75, 0.04, 0.55), white)

# A wedge's top is read by the play script, including after an editor move.
mesh("Ramp.Jump", [(-3, -4, 0), (3, -4, 0), (3, 4, 2.4), (-3, 4, 2.4), (-3, 4, 0), (3, 4, 0)],
     [(0, 1, 2, 3), (3, 2, 5, 4), (0, 3, 4), (1, 5, 2), (0, 4, 5, 1)], violet, (32, -2, 0))

for i in range(6):
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.4, radius2=0.06, depth=0.85, location=(29 + i * 1.2, 12, 0.425))
    cone = bpy.context.active_object
    cone.name = f"Cone.{i}"
    cone.data.materials.append(orange)
    box(f"ConeBase.{i}", (0, 0, -0.4), (0.8, 0.8, 0.08), rubber, cone)
for i in range(4):
    crate = box(f"Crate.{i}", (-27 + i * 1.5, -28, 0.65), (1.2, 1.2, 1.3), wood)
    box(f"CrateBand.{i}", (0, 0, 0), (1.25, 0.15, 1.35), white, crate)

for i in range(56):
    angle = math.tau * i / 56
    x, y = (53 + i % 3 * 7) * math.cos(angle), -4 + (56 + i % 4 * 4) * math.sin(angle)
    box(f"Tree.Trunk.{i}", (x, y, 1.4), (0.4, 0.4, 2.8), wood)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=2.6, location=(x, y, 4.0))
    tree = bpy.context.active_object
    tree.name = f"Tree.Crown.{i}"
    tree.scale.z = 1.35
    tree.data.materials.append(leaves if i % 2 else grass)

# Low-poly hills close the horizon without textures or a skybox.
for i in range(18):
    angle = math.tau * i / 18
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=(150 * math.cos(angle), -4 + 150 * math.sin(angle), 0))
    hill = bpy.context.active_object
    hill.name = f"Hill.{i}"
    hill.scale = (55, 55, 6 + i % 4 * 3)
    hill.data.materials.append(grass if i % 2 else leaves)
for i in range(5):
    for tier in range(3):
        box(f"Stand.{i}.{tier}", (44 + tier * 1.3, -28 + i * 5, 0.5 + tier * 0.6), (1.3, 4.5, 1 + tier * 1.2), orange if i % 2 else violet)
    box(f"Stand.Roof.{i}", (45.3, -28 + i * 5, 4.2), (5, 4.8, 0.2), white)

for i, (x, y) in enumerate(((22, 2), (42, 14), (-40, 18), (-24, -50))):
    box(f"Billboard.Post.{i}", (x, y, 1.5), (0.3, 0.4, 3), white)
    box(f"Billboard.{i}", (x, y, 3), (0.35, 6, 2), orange if i % 2 else violet)
    for stripe in range(3):
        box(f"Billboard.Stripe.{i}.{stripe}", (x + 0.2, y - 1.6 + stripe * 1.5, 3), (0.05, 0.65, 1.4), white)

# Ordered checkpoints prevent lap counts from shuttling over the start line.
for i, (x, y) in enumerate(((8, 32), (-34, 10), (-12, -44)), 1):
    checkpoint = bpy.data.objects.new(f"Checkpoint.{i}", None)
    bpy.context.collection.objects.link(checkpoint)
    checkpoint.location = (x, y, 0)

# Default cube geometry and material; its ground-level origin carries the wheels.
car = box("Cube", (32, -28, 0), (2, 2, 2), cube_material)
car.data.transform(Matrix.Translation((0, 0, 1.42)))
for name, x, y in (("Wheel.FL", -1.2, 0.78), ("Wheel.FR", 1.2, 0.78), ("Wheel.RL", -1.2, -0.78), ("Wheel.RR", 1.2, -0.78)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.57, depth=0.55, location=(x, y, 0.57), rotation=(0, math.pi / 2, 0))
    wheel = bpy.context.active_object
    wheel.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    wheel.data.materials.append(rubber)
    wheel.parent = car
    box(name + ".Spoke", (math.copysign(0.29, x), 0, 0), (0.04, 0.14, 0.85), white, wheel)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1
scene.world.use_nodes = True
scene.world.node_tree.nodes.clear()
background = scene.world.node_tree.nodes.new("ShaderNodeBackground")
output = scene.world.node_tree.nodes.new("ShaderNodeOutputWorld")
scene.world.node_tree.links.new(background.outputs[0], output.inputs[0])
sky = scene.world.node_tree.nodes.new("ShaderNodeTexSky")
# Blender 5.2 calls its Nishita successor MULTIPLE_SCATTERING; the presenter supports it.
sky.sky_type = "MULTIPLE_SCATTERING"
sky.sun_elevation = math.radians(16)
sky.sun_rotation = math.radians(225)
sky.aerosol_density = 0.0
sky.altitude = 0.0
scene.world.node_tree.links.new(sky.outputs["Color"], background.inputs["Color"])
# Separate visible sky brightness from ambient radiance, as an ordinary World shader.
light_path = scene.world.node_tree.nodes.new("ShaderNodeLightPath")
ambient = scene.world.node_tree.nodes.new("ShaderNodeBackground")
ambient.inputs["Strength"].default_value = 0.03
scene.world.node_tree.links.new(sky.outputs["Color"], ambient.inputs["Color"])
mix = scene.world.node_tree.nodes.new("ShaderNodeMixShader")
scene.world.node_tree.links.new(light_path.outputs["Is Camera Ray"], mix.inputs[0])
scene.world.node_tree.links.new(ambient.outputs["Background"], mix.inputs[1])
scene.world.node_tree.links.new(background.outputs["Background"], mix.inputs[2])
scene.world.node_tree.links.new(mix.outputs[0], output.inputs["Surface"])
background.inputs["Strength"].default_value = 0.06
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(74), 0, math.radians(-55)))
sun = bpy.context.active_object
sun.name = "Sun"
sun.data.energy = 3.0
sun.data.color = (1.0, 0.88, 0.68)
sun.data.angle = math.radians(0.5)

bpy.ops.object.camera_add(location=(39, -36, 3.8))
camera = bpy.context.active_object
camera.name = "Camera"
camera.rotation_euler = (Vector((32, -22, 1.4)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 28
scene.camera = camera
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            space = area.spaces.active
            space.shading.type = "RENDERED"
            space.region_3d.view_location = (32, -22, 1.4)
            space.region_3d.view_distance = 16
            space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()

# Collections organize Blender files; parent empties also survive as the Play hierarchy.
# Identity group transforms keep the script's Blender-space obstacle/kerb positions intact.
main = bpy.data.collections.get("Collection")
groups = {}
for name in ("Kerbs", "Cones", "Crates", "Trees", "Tyres", "Scenery", "Gantry", "Ramps"):
    group = bpy.data.objects.new(name, None)
    main.objects.link(group)
    group.empty_display_type = "PLAIN_AXES"
    group.empty_display_size = 0.5
    groups[name] = group

for obj in list(bpy.data.objects):
    if obj.parent or obj.name in groups or obj.name in {"Cube", "Track", "Ground", "Sun", "Camera"}:
        continue
    prefix = obj.name.split(".")[0]
    if prefix in {"Edge", "Centre"}:
        parent = bpy.data.objects["Track"]
    else:
        group = {
            "Kerb": "Kerbs", "Cone": "Cones", "Crate": "Crates", "Tree": "Trees",
            "Barrier": "Tyres", "Gantry": "Gantry", "Start": "Gantry", "Ramp": "Ramps",
        }.get(prefix, "Scenery")
        parent = groups[group]
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world

# Expanded object rows should name their geometry, not a primitive's .001 data.
for obj in bpy.data.objects:
    if obj.data is not None:
        obj.data.name = obj.name

# Cameras are useful for a render, but their overlay rectangle obscures the edit.
camera.hide_set(True)

bpy.ops.object.select_all(action="DESELECT")
car.select_set(True)
bpy.context.view_layer.objects.active = car
