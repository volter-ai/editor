# SPDX-License-Identifier: GPL-3.0-or-later
#
# THIS FILE IS GPL, AND THE REST OF YOUR PROJECT IS NOT.
#
# It drives `bpy`, Blender's Python API. The Blender Foundation's stated
# position — their licence page, under "Add-ons (Python scripts)" — is that
# the API "is an integral part of the software" and that the GPL "therefore
# requires that such scripts (if published) are being shared under a GPL
# compliant license". So a bpy script is a derivative work of Blender, and
# this one is licensed GNU General Public License version 3 or later,
# exercising Blender's own "or later".
#
# WHAT THIS DOES NOT TOUCH. `cube.blend` beside this file is YOURS, and so is
# anything you export from it — glTF, GLB, renders. That is the Foundation's
# position too, on the same page under "Your Artwork": what you make with
# Blender is your sole property, "including the .blend files and other data
# files Blender can write". Every other file the template gave you is MIT.
# This licence reaches this script and nothing else.
#
# If you would rather not carry it: delete this file. The `.blend` is the
# document — this is only the recorded source of how it was made — and
# nothing in the project reads this script at runtime. If you write your own
# bpy scripts, the Foundation's position applies to them on the same terms;
# it is not a rule of ours and is not ours to waive, because the copyright in
# Blender is Blender's authors'.
#
# Copyright 2026 Volter AI, Inc.

"""The starter model — the bpy that made `cube.blend`, and its SOURCE.

A model is Blender data: `cube.blend` beside this file is the document the
editor opens, and this is the script that authored it. Run it again and you
get the same file; edit it and re-run it, or open the `.blend` and model in
Blender's own Edit Mode — both are authoring, and the `.blend` is the truth
either way.

Run it through the session's Blender, from this project:

    npm run --silent vgai -- blender-mcp        # the transport an agent drives
    # or, in a live editor session:
    # editor.blender('blender-execute', { code: open('src/models/cube.py').read() })

The session saves the open document about a second after the last call, so a
script that models is a script that saves.

Coordinates are metres, Z is up (Blender's), and the exporter converts to the
game's Y-up on the way to glTF.
"""

import bpy

# ONE DATABLOCK, AT THE ORIGIN. A model file holds the model, not a set: the
# factory startup's Light and Camera belong to a scene, and a model that
# carries them exports them too.
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for mesh in list(bpy.data.meshes):
    bpy.data.meshes.remove(mesh)
# Materials too, or a re-run appends `Material.001` beside the one it made
# last time and the Shader Editor shows whichever slot happens to be active.
for material in list(bpy.data.materials):
    bpy.data.materials.remove(material)

# Blender opens on a cube; so does this. `size` is the full width, so 1.0 is
# a 1 m box — the starter's own scale, not the factory cube's 2 m.
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
cube = bpy.context.active_object
cube.name = "Cube"
cube.data.name = "Cube"

# AND BLENDER'S OWN DEFAULT MATERIAL, because Blender's own default cube has
# one. Without it the Shading workspace opens on `Shader Editor · No material`
# with nothing drawn and nothing a person can click to change that — its one
# control, Use Nodes, correctly refuses, because this view inspects a node
# tree and never writes one (walk 3, beat 4). `materials.new` leaves
# `use_nodes` FALSE, which is a material the header names and the canvas still
# cannot draw; setting it True is what builds the pair Blender builds —
# Principled BSDF into Material Output, 2 nodes and 37 sockets.
material = bpy.data.materials.new(name="Material")
material.use_nodes = True
cube.data.materials.append(material)
