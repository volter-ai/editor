"""The game's characters: their `.blend` documents, and the GLBs baked from them.

THE MODEL IS THE `.blend` (ARCHITECTURE-CORE §Blender north star, "A model is
Blender data"; the 2026-09-19 ruling "The shipped characters become `.blend`
sources by IMPORT"). `src/models/arena-vanguard.blend`,
`src/models/redline-breacher.blend` and `src/models/redline-overwatch.blend`
are this game's three characters. Each holds the mesh, the 65-bone armature,
its vertex groups, the flat vertex colours, the one material and the baked
clips the prefabs read — plus `bpy.data.texts['authoring-spec.json']`, the
spec the retired TypeScript body engine was given, kept so the record of how
the character was designed survives the engine that built it
(`archive/humanoid-engine-2026-09-19`).

THIS FILE IS THE BAKE, AND ONLY THE BAKE. It opens a document and writes the
game's `.glb` through the session's recording door — `scripts/bake-characters.mjs`
sends it with one `bake('<asset>')` appended, exactly as the weapon kit's
script does. To CHANGE a character, change the `.blend`: open it in the Model
workspace, or drive bpy against it through the session. There is no spec to
re-run and no generator to re-invoke.

WHAT THE GAME READS OF THESE ARTIFACTS, measured (`git grep useGLTF` +
`REQUIRED_CLIPS`): `src/prefabs/Player.tsx` and `src/prefabs/Enemy.tsx` load
each `.glb` by PATH, clone the scene, and build a clip map from
`source.animations` — then THROW by name on a missing clip.
`REQUIRED_CLIPS` is `['Idle','Walk','Run']` for the vanguard and
`['Idle','Walk']` for the two hostiles, which is exactly the 3/2/2 split the
documents carry. The clip NAMES and the PATHS are therefore the published
surface; the joint names are too, because the grip socket resolves
`mixamorigRightHand` by name. None of them may move.

THE EXPORT FLAGS ARE THE PARITY, and they are stated rather than defaulted.
`export_vertex_color='ACTIVE'` because the body's colour is a `COLOR_0` layer
and not a texture — the exporter's own default only writes one when a material
samples it through a Color Attribute node, which is a property of the node
graph rather than of the model. `export_animations` with `export_nla_strips`
False writes one glTF animation per ACTION, which is what keeps three clips
three clips. `export_force_sampling` is FALSE, and that is the flag that keeps
the clips' SHAPE: sampling re-keys every bone's translation, rotation AND
scale at every integer frame, which turned the artifacts' 53 channels into 195
and their 60 keys into 48 when it was left on. Off, the exporter writes the
F-curves the document actually holds — 52 rotations and the one hips
translation — and the published channel count survives the round trip. The
scene's FPS is the document's (30, the rate the clips were authored at); at
Blender's factory 24 the keys land on fractional frames and the exporter
rounds the tail off, shortening every clip by one frame. `export_apply` is False because the documents carry no unapplied
modifiers (the import flattened them) and evaluating them would resample the
mesh. `export_yup` maps Blender's Z-up back to the game's Y-up, so a
coordinate in the `.blend` is the coordinate the prefab sees.
"""

import os

import bpy

SHIPPED = os.path.join('public', 'models', 'generated')
DOCUMENTS = os.path.join('src', 'models')

#: The documents this file bakes, in the order the game meets them.
ASSETS = ('arena-vanguard', 'redline-breacher', 'redline-overwatch')


def bake(asset, dry_run=False):
    """Open one character document and export the game's `.glb` from it.

    `dry_run` writes to `.vgai/tmp/` instead, which is outside the project's
    shipped output root and therefore outside the ledger — the door records
    only what lands under `public/`.
    """
    if asset not in ASSETS:
        raise RuntimeError("unknown character '%s'; one of %s" % (asset, list(ASSETS)))
    blend = os.path.join(os.getcwd(), DOCUMENTS, '%s.blend' % asset)
    if not os.path.exists(blend):
        raise RuntimeError('no document at %s' % blend)
    bpy.ops.wm.open_mainfile(filepath=blend)

    out = (
        os.path.join(os.getcwd(), '.vgai', 'tmp', '%s.glb' % asset)
        if dry_run
        else os.path.join(os.getcwd(), SHIPPED, '%s.glb' % asset)
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
        export_vertex_color='ACTIVE',
        export_skins=True,
        export_animations=True,
        export_nla_strips=False,
        export_force_sampling=False,
    )
    print('%s: %d bytes -> %s' % (asset, os.path.getsize(out), out))
    return out

def session_document():
    """The `.blend` the SESSION holds, read before any bake opens its own.

    Printed rather than returned, because the caller is a driver script on the
    other side of `execute_blender_code` and text is the whole channel.
    """
    print('SESSION-DOCUMENT %s' % bpy.data.filepath)
    return bpy.data.filepath


def restore_session_document(path):
    """Reopen the session's own document, as the LAST act of a bake run.

    THE HAZARD, and it is the same one `character-import.py` carries with a
    different ending: the session opens one `.blend` at start and saves back to
    it, so a run that leaves a character's scene in memory writes THAT scene
    over the session's document at the next idle save or at shutdown. Measured
    2026-09-19 across all three examples — one document per project came back
    modified with a `.blend1` beside it, and it is a tracked BINARY, so no diff
    tells you.

    WHY THIS IS NOT A `finally` INSIDE `bake()`, which is where the import
    script puts it: the recording door reads `bpy.data.filepath` AFTER the call
    returns, to record which `.blend` the `.glb` came from. Reopening inside
    `bake()` would leave the session's own document there instead, and every
    artifact would name the wrong source — exactly the confident wrong answer
    the door was fixed to stop giving. So the restore is a SEPARATE call the
    driver makes once, after the last bake, when nothing is left to record.
    """
    if path:
        bpy.ops.wm.open_mainfile(filepath=path)
        print('restored the session document: %s' % path)
    return path
