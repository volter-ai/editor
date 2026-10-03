# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
#
# Like `cube.py`, this bpy script is GPL-3.0-or-later; the `.blend` it
# authors is your artwork, and the project's other starter source is MIT.

"""The starter race — run this through the session's Blender.

Open the starter cube, then execute this source through `blender-execute`:

    editor.blender('blender-execute', { code: open('src/models/track.py').read() })

This replaces the open scene and saves `track.blend` beside its named file.
Open that Model document and choose View > Play to run `track.play.ts`.
Coordinates are metres, Z is up, and the car's nose is local +Y.
"""

import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

if not bpy.data.filepath:
    raise RuntimeError("Open a saved model before making the starter track.")
destination = str(Path(bpy.data.filepath).with_name("track.blend"))

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for mesh in list(bpy.data.meshes):
    bpy.data.meshes.remove(mesh)
for material in list(bpy.data.materials):
    bpy.data.materials.remove(material)
for light in list(bpy.data.lights):
    bpy.data.lights.remove(light)
for camera in list(bpy.data.cameras):
    bpy.data.cameras.remove(camera)


def material(name, colour):
    value = bpy.data.materials.new(name=name)
    value.use_nodes = True
    rgb = tuple(int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    linear = tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)
    value.diffuse_color = (*linear, 1.0)
    value.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*linear, 1.0)
    return value


# Base colours from brand.volter.ai/tokens.json's light semantic roles:
# surface.inverse, status.healthy.base, accent.orange, text.inverse,
# surface.media and scene.dynamicSoft. No textures or shader effects.
asphalt = material("Asphalt", "#16252c")
grass = material("Grass", "#3f7a55")
paint = material("Paint", "#ff6a1f")
stripe = material("Stripe", "#f3f2ec")
rubber = material("Rubber", "#0f1a1f")
glass = material("Cabin", "#dcd5e9")


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


# ONE CLOSED MESH, wound upwards so a downward ray meets its front face.
segments = 128
vertices = []
faces = []
for i in range(segments):
    angle = math.tau * i / segments
    for radius in (24.0, 36.0):
        vertices.append((radius * math.cos(angle), radius * math.sin(angle), 0.0))
for i in range(segments):
    j = (i + 1) % segments
    faces.append((2 * i, 2 * i + 1, 2 * j + 1, 2 * j))
mesh = bpy.data.meshes.new("Track")
mesh.from_pydata(vertices, [], faces)
mesh.update()
track = bpy.data.objects.new("Track", mesh)
bpy.context.collection.objects.link(track)
track.data.materials.append(asphalt)

bpy.ops.mesh.primitive_plane_add(size=100.0, location=(0.0, 0.0, -0.03))
ground = bpy.context.active_object
ground.name = "Ground"
ground.data.name = "Ground"
ground.data.materials.append(grass)

for i in range(64):
    angle = math.tau * i / 64
    for radius, side in ((23.5, "Inner"), (36.5, "Outer")):
        kerb = box(
            f"Kerb.{side}.{i:02d}",
            (radius * math.cos(angle), radius * math.sin(angle), 0.08),
            (0.6, 1.6, 0.16), stripe if i % 2 == 0 else paint,
        )
        kerb.rotation_euler.z = angle

for row in range(2):
    for column in range(12):
        box(
            f"Start.{row}.{column}", (24.5 + column, -5.0 + row * 0.5, 0.01),
            (1.0, 0.5, 0.02), stripe if (row + column) % 2 == 0 else asphalt,
        )

# THE CAR'S ORIGIN IS ON THE ROAD; its body geometry stands above it.
car = box("Car", (0.0, 0.0, 0.0), (1.8, 4.0, 0.7), paint)
car.data.transform(Matrix.Translation((0.0, 0.0, 0.75)))
box("Cabin", (0.0, -0.25, 1.3), (1.5, 1.9, 0.5), glass, car)
box("Nose", (0.0, 1.65, 1.12), (1.3, 0.25, 0.06), stripe, car)

for name, x, y in (
    ("Wheel.FL", -1.0, 1.3), ("Wheel.FR", 1.0, 1.3),
    ("Wheel.RL", -1.0, -1.3), ("Wheel.RR", 1.0, -1.3),
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=16, radius=0.42, depth=0.32, location=(x, y, 0.42),
        rotation=(0.0, math.pi / 2, 0.0),
    )
    wheel = bpy.context.active_object
    wheel.name = name
    wheel.data.name = name
    # Bake the cylinder's axle into its mesh: local X spins, local Z steers.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    wheel.data.materials.append(rubber)
    wheel.parent = car
    box(name + ".Spoke", (math.copysign(0.17, x), 0.0, 0.0), (0.04, 0.08, 0.65), stripe, wheel)

car.location = (30.0, 0.0, 0.0)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

bpy.ops.object.light_add(type="SUN", rotation=(0.4, -0.6, -0.3))
sun = bpy.context.active_object
sun.name = "Sun"
sun.data.energy = 3.0

bpy.ops.object.camera_add(location=(30.0, -10.0, 6.0))
camera = bpy.context.active_object
camera.name = "Camera"
camera.rotation_euler = (Vector((30.0, 2.0, 0.8)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 35.0
scene.camera = camera

bpy.ops.object.select_all(action="DESELECT")
car.select_set(True)
bpy.context.view_layer.objects.active = car
bpy.ops.wm.save_as_mainfile(filepath=destination)
