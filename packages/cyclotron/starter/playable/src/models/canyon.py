# SPDX-License-Identifier: GPL-3.0-or-later
#
# THE bpy SCRIPTS ARE GPL, AND THE REST OF YOUR PROJECT IS NOT.
#
# This file and the step scripts beside it drive `bpy`, Blender's Python API.
# The Blender Foundation's stated position — their licence page, under
# "Add-ons (Python scripts)" — is that the API "is an integral part of the
# software" and that the GPL "therefore requires that such scripts (if
# published) are being shared under a GPL compliant license". So a bpy script
# is a derivative work of Blender, and these are licensed GNU General Public
# License version 3 or later, exercising Blender's own "or later".
#
# WHAT THIS DOES NOT TOUCH. `canyon.blend` beside this file is YOURS, and so
# is anything you export from it — glTF, GLB, renders. That is the
# Foundation's position too, on the same page under "Your Artwork": what you
# make with Blender is your sole property, "including the .blend files and
# other data files Blender can write". The play script, the race state, the
# textures and the React UI the template gave you are MIT. This licence
# reaches the bpy scripts and nothing else.
#
# If you would rather not carry them: delete them. The `.blend` is the
# document — these are only the recorded source of how it was made — and
# nothing in the project reads them at runtime. If you write your own bpy
# scripts, the Foundation's position applies to them on the same terms; it is
# not a rule of ours and is not ours to waive, because the copyright in
# Blender is Blender's authors'.
#
# Copyright 2026 Volter AI, Inc.

"""Canyon Comet's authoring entry: the record of how `canyon.blend` was made.

The saved `canyon.blend` is the document, and it is authoritative: this script
never rebuilds existing artwork. Run on a file without the `Canyon Comet`
collection, it runs the milestone scripts beside it in order (the circuit,
six karts and chase camera, then the canyon, textures from `src/textures/`,
polish and details, and last `scenery_ao.py`, which bakes ambient occlusion
into the static scenery), each saving `src/models/canyon.blend`.

Run it through the session's Blender, from this project:

    exec(open("<project root>/src/models/canyon.py").read())

Coordinates are metres, Z is up. At Play, `canyon.play.ts` drives the six
`Kart.N` empties around the circuit that `course.ts` shares with these scripts.
"""
import bpy
from pathlib import Path
ROOT=Path(bpy.data.filepath).resolve().parents[2]
if bpy.data.collections.get('Canyon Comet'):
    print('Canyon Comet is already authored. Existing geometry and manual edits preserved.')
else:
    # Each step runs in its own namespace: they all name their own ROOT and helpers.
    for step in ['circuit','environment','refine','polish','detail','complete_environment','kart_finish','driver_details','finish_scene','scenery_ao']:
        source=ROOT/'src'/'models'/(step+'.py')
        exec(compile(source.read_text(),step+'.py','exec'),{'__name__':'__main__','__file__':str(source)})
