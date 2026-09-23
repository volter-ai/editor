"""The editor tab's Blender session, INSIDE real Blender.

THE BLENDER IN THE TAB IS BLENDER (ARCHITECTURE-CORE, owner ruling
2026-09-17). Blender 5.2 LTS is compiled to WebAssembly and started
`--background --factory-startup --python <this file>`; `main()` never returns
because this script does not return, so the module's Blender pthread stays
alive and holds ONE `bpy.data` for as long as the worker does. That is the
session: `execute(code) -> {stdout, error}`, plus the same `get_scene_info` /
`get_object_info` the MCP door has always carried, plus the EXPORT that feeds
the presenter.

THE CHANNEL IS A DIRECTORY, NOT STDIN, and that is a measurement rather than a
preference (2026-09-17, node, the v0.1.1 release): the build's
`FS_stdin_getChar` runs on the BLENDER PTHREAD -- `isMainThread=false` -- where
node's `process.stdin.fd` is `undefined` and a browser pthread has no
`window.prompt`, so stdin is not a channel the page can write into. WasmFS
keeps its file table in the shared wasm memory, so a FILE is: the worker's own
thread writes `in/<id>.json` then `in/<id>.done`, this loop sees it, and the
answer goes back as `out/<id>.json` + `out/<id>.done`. Measured round trip on
that same run: 5 ms idle, 30 ms for a cube, 436 ms for a subdivide-and-apply.

THE CHANNEL HAS ONE WRITER PER DIRECTORY, and on the WALI skew that rule is
what keeps a session alive for more than a few dozen calls:

    in/     the PAGE writes and unlinks; this file only ever READS it.
    out/    THIS FILE writes and unlinks; the page only reads.
    ask/    THIS FILE writes and unlinks; the page only reads.
    reply/  the PAGE writes and unlinks; this file only ever READS it.

Under WALI the page and this program are two snapshot-backed views of one
tree, reconciled by patches, and the host REFUSES a patch whose base no longer
matches what it holds -- then terminates the program. A path can only
disagree if someone other than the patch's author moved it, so disjoint
writer sets leave the assertion nothing to fire on. Measured 2026-09-19: with
the page unlinking this loop's `out/<id>.*` after every answer, a render loop
in one session died at call 37 and at call 14, with no guest exit path run.

THE ACK IS THE OTHER SIDE'S REQUEST FILE DISAPPEARING, which costs no file and
no extra write. The page unlinks `in/<id>.json` and then `in/<id>.done` only
after it has read `out/<id>.json`, so `in/<id>.done` gone means the answer was
taken and this loop may remove its own `out/<id>.*` -- read straight out of
the `listdir(IN)` the loop already does every pass. Symmetrically, `ask` waits
for `reply/<id>.done`, reads `reply/<id>.json`, and then removes its OWN
`ask/<id>.*`; the page watches those vanish and retires the reply it wrote.
`.done` is unlinked last on both sides, because `.done` is the token the other
side watches.

THE DIRECTORIES FOLLOW THEIR CONTENTS' OWNER: this file creates `out` and
`ask` and never `in` or `reply` (`blender-engine.mts`'s
`PAGE_OWNED_DIRECTORIES` makes those before the program starts). A `mkdir` or
`chmod` on a path the other side has already touched is the same crossing
edit at a smaller scale.

THE LOAD HANDLER IS `@persistent` because Blender clears every non-persistent
handler on file load, and `open_mainfile` is an ordinary thing for a script
here to do.

THE EXPORT IS THE C++ DOOR, not Python. `_blender_web.export_frame` evaluates
the scene, takes its revisions from the depsgraph's own update record, and
writes every column into a side ARENA in wasm memory; the JSON frame names each
one by `{offset, length, dtype, count, stride}`; the worker reads those bytes
through the one door its skew has (`BlenderEngine.readArena`: the module heap
where the host can reach it, the `buffer_path` file where it cannot). Nothing
large crosses as JSON. What this file still describes is what the door
does not: the WORLD's shader expression and the CAMERAS a photograph is framed
through.

THE REVISION SIGNAL IS THE DEPSGRAPH'S OWN UPDATE RECORD, accumulated by the
door's C callbacks on BOTH `depsgraph_update_post` and `frame_change_post` (a
`frame_set` fires only the second), with a render's own evaluation skipped.

THE SESSION HAS A DOCUMENT, and it is a `.blend` Blender itself writes.
`blender-start` names it (project-relative, `models/model.blend` by default);
an existing one is OPENED at start and an absent one starts empty. The session
saves it through `bpy.ops.wm.save_as_mainfile` -- never a codec of ours, and
never a mutation of the script's own datablocks. A SCRIPT'S DATABLOCKS ARE THE
SCRIPT'S: the session does not rewrite the paths a script loaded its images
from in order to save. Where a document reopens from is a question the script
answers when it loads its files, by loading them through project-relative
paths; `save_as_mainfile`'s own Save-As semantics are the whole of what the
session applies (see `save_document`).

WHO CARRIES THE DOCUMENT OUT, and why it is not this loop's job: the save
writes into the module filesystem, which mirrors the project at the SAME
absolute path but is not the disk. Python cannot push it out on its own --
`ask` is only served from inside a request's poll loop
(`blender-engine.mts::serveAsks`), so an `ask` raised from this idle loop
would never be answered and would wedge the Blender pthread forever. So the
DEBOUNCE LIVES IN THE TAB: a present that leaves the document stale says so
(`saveDue` beside the frame), the worker waits out an idle second, calls
`save-document` as an ordinary request, and carries the bytes to the project
(`worker.ts`). Every step is an explicit call; nothing polls.
"""

import array
import base64
import hashlib
import io
import json
import math
import os
import re
import sys
import time
import traceback
from contextlib import redirect_stdout

import bpy
# Blender's own linear-algebra types. The rig/clip doors compose a pose
# channel's basis with its rest-relative matrix (`rna_action_clip`), which is a
# matrix product and a decompose — Blender's own, never a re-implementation.
import mathutils

# THE EXPORT DOOR, compiled into this Blender (`bpy_web_export.cc`): one call
# reads the scene out as typed columns in a side arena the worker reads
# through `BlenderEngine.readArena` -- see EXPORT_BUFFER_PATH below.
import _blender_web

# The presenter's refusals, spelled in
# `packages/mesh/contributions/blender-runtime-frame.ts`. This is the only
# place Python reads them, and `Session.present` is what answers them.
_UNKNOWN_GEOMETRY = "RUNTIME_FRAME_UNKNOWN_GEOMETRY"
_UNKNOWN_IMAGE = "RUNTIME_FRAME_UNKNOWN_IMAGE"

ROOT = os.environ.get("VGAI_SESSION_ROOT", "/work/.vgai-session")
IN = os.path.join(ROOT, "in")
OUT = os.path.join(ROOT, "out")
ASK = os.path.join(ROOT, "ask")
REPLY = os.path.join(ROOT, "reply")
# WHERE THE CALLER WANTS THE EXPORT ARENA, if it wants it anywhere.
#
# The export door offers TWO ways to read the arena it fills, and has since
# `bpy_web_export.cc` was written: the C exports that name it in linear
# memory, and a `buffer_path` option that also writes the same bytes to a file
# -- "natively the path is the caller's own string". Which door the caller
# uses is the caller's business, and this file does not know its toolchain: it
# states the path it was given, or states nothing.
#
# EMPTY UNLESS THE ENGINE SETS IT, and that is the point. The standalone skew
# reads the arena straight off the module heap and must not pay a
# megabyte-scale file write per present. The engine that sets it is the one
# whose host cannot reach the module's memory at all
# (`blender-wali-engine.mts`), where the file is not a fallback but the
# native door onto the same bytes.
EXPORT_BUFFER_PATH = os.environ.get("VGAI_EXPORT_BUFFER_PATH", "")
_real_stderr = sys.stderr


def _say(line):
    print(line, file=_real_stderr, flush=True)


def _prepare_directories():
    """Directories created through the module's JS door come out non-writable;
    the session owns its own root from here, so it takes the mode it needs.

    ONLY THE TWO DIRECTORIES THIS FILE WRITES INTO. `in` and `reply` belong to
    the page and are made before this program starts; creating or chmodding
    them here would put a guest edit on a page-owned path."""
    for parent in ("/work", ROOT):
        try:
            os.makedirs(parent, exist_ok=True)
        except OSError:
            pass
        try:
            os.chmod(parent, 0o777)
        except OSError:
            pass
    for directory in (OUT, ASK):
        try:
            os.mkdir(directory)
        except FileExistsError:
            pass
        except OSError as error:
            _say("@@VGAI-ERROR cannot create %s: %r" % (directory, error))
        try:
            os.chmod(directory, 0o777)
        except OSError:
            pass


# ---------------------------------------------------------------- file load

@bpy.app.handlers.persistent
def _load_post(_arg):
    # The DOOR resets its own revision table on LOAD_POST (it holds ID pointers
    # into the Main that just went away); this is the session's half.
    SESSION.forget()
    # A factory reset reloads every add-on (`bpy.utils.load_scripts(reload_scripts=True)`
    # runs inside `read_factory_settings`), and the Cycles add-on's own engine
    # class comes back under `CYCLES` while ours is gone -- measured in the tab:
    # after the battery's opening reset, `scene.render.engine = 'CYCLES'`
    # resolved to `cycles.CyclesRender`, every render was a real path trace
    # in wasm (35 s at 1280x720, 48 samples) and `_photograph` never ran. The
    # engine ids are taken again on every load.
    ENGINES[:], UNAVAILABLE_ENGINES[:] = _register_engine()
    HISTORY.reset()


# ---------------------------------------------------------------- warnings

_WARNED = set()
_WARNINGS = []


def warn(what):
    """A capability this export cannot reach, named ONCE and never raised.

    The rule: `_export` runs while a frame is being presented and
    while a script's observations are being written, so raising here loses the
    whole call's output. The warning names the mechanism; the material or mesh
    falls back to what it would have had.
    """
    if what in _WARNED:
        return
    _WARNED.add(what)
    _WARNINGS.append(what)
    _say("@@VGAI-WARN " + what)


# ---------------------------------------------------------------- the world

_RAMP_SAMPLES = 257


def _ramp(ramp):
    """One colour ramp, SAMPLED rather than described: 257 evaluations through
    `color_ramp.evaluate`, so every value is the one Blender's own evaluator
    returns; positions `i/256` are exact. CONSTANT is carried as a flag."""
    samples = [ramp.evaluate(i / 256) for i in range(_RAMP_SAMPLES)]
    return {
        "ramp_color": [[float(sample[0]), float(sample[1]), float(sample[2])] for sample in samples],
        "ramp_interpolate": ramp.interpolation != "CONSTANT",
    }


_SCALAR_KINDS = frozenset(("separate", "map_range", "math", "to_float"))


def _is_scalar(expression):
    if isinstance(expression, (int, float)):
        return True
    return isinstance(expression, dict) and (
        expression["kind"] in _SCALAR_KINDS
        or (expression["kind"] == "gradient" and expression["output"] == "Fac")
    )


def _describe_expression(expression):
    if isinstance(expression, dict):
        return "a %s node, which is not a float" % expression["kind"]
    if isinstance(expression, list):
        return "a colour/vector of %d components" % len(expression)
    return "%s, which is not a float" % type(expression).__name__


def _surface_backgrounds(node):
    """World Surface as `(what the camera sees, what lights the scene)`; a
    world that is one Background is both and the second is None. A Mix Shader
    by Light Path `Is Camera Ray` is how a scene gets a bright backdrop and a
    restrained fill from one sky (the tram stop): input 2 is the camera's,
    input 1 lights the scene."""
    kind = node.bl_idname
    if kind == "ShaderNodeBackground":
        return node, None
    if kind != "ShaderNodeMixShader":
        raise NotImplementedError("World Surface must connect to Background; it connects to %s" % kind)
    factor = list(node.inputs[0].links)
    if (len(factor) != 1 or factor[0].from_node.bl_idname != "ShaderNodeLightPath"
            or factor[0].from_socket.name != "Is Camera Ray"):
        source = ("%s.%s" % (factor[0].from_node.bl_idname, factor[0].from_socket.name)
                  if len(factor) == 1 else "a constant")
        raise NotImplementedError(
            "World Mix Shader is mixed by %s; only Light Path 'Is Camera Ray' separates "
            "the camera's world from the lighting one" % source)
    branches = []
    for index in (2, 1):
        links = list(node.inputs[index].links)
        if len(links) != 1 or links[0].from_node.bl_idname != "ShaderNodeBackground":
            raise NotImplementedError(
                "World Mix Shader needs a Background on each side; input %d has %d" % (index, len(links)))
        branches.append(links[0].from_node)
    return branches[0], branches[1]


def _describe_world_socket(root_socket, camera_ray):
    """A World input as the presenter's expression (its grammar
    is `blender-runtime-lighting.ts`'s `worldExpression`); anything outside it
    is refused BY NAME through NotImplementedError."""
    visiting = set()

    def value(socket):
        links = list(socket.links)
        if links:
            source = links[0].from_socket
            expression = output(links[0].from_node, source.name)
            if socket.type == "VALUE" and source.type in ("RGBA", "VECTOR"):
                return {"kind": "to_float", "source_type": source.type, "value": expression}
            return expression
        default = socket.default_value
        return float(default) if isinstance(default, (float, int)) else [float(c) for c in list(default)[:3]]

    def output(node, socket):
        key = (id(node), socket)
        if key in visiting:
            raise NotImplementedError("World shader contains a cycle")
        visiting.add(key)
        try:
            kind = node.bl_idname
            if kind == "ShaderNodeLightPath" and socket == "Is Camera Ray":
                return 1.0 if camera_ray else 0.0
            if (kind == "ShaderNodeMixRGB" and socket == "Color") or (kind == "ShaderNodeMix" and socket == "Result"):
                legacy = kind == "ShaderNodeMixRGB"
                if not legacy and node.data_type != "RGBA":
                    raise NotImplementedError("World Mix data type %s" % node.data_type)
                if node.blend_type != "MIX":
                    raise NotImplementedError("World color blend %s" % node.blend_type)
                factor = value(node.inputs["Fac" if legacy else "Factor"])
                clamp_factor = True if legacy else bool(node.clamp_factor)
                clamp_result = bool(node.use_clamp if legacy else node.clamp_result)
                a = node.inputs["Color1" if legacy else "A"]
                b = node.inputs["Color2" if legacy else "B"]
                if isinstance(factor, (int, float)) and clamp_factor:
                    factor = max(0.0, min(1.0, factor))
                if isinstance(factor, (int, float)) and factor in (0.0, 1.0):
                    selected = value(a if factor == 0.0 else b)
                    if not clamp_result:
                        return selected
                    first = second = selected
                else:
                    first, second = value(a), value(b)
                return {"kind": "mix_color", "factor": factor, "a": first, "b": second,
                        "clamp_factor": clamp_factor, "clamp_result": clamp_result}
            if kind == "ShaderNodeTexCoord" and socket == "Generated":
                return {"kind": "direction"}
            if kind == "ShaderNodeTexCoord" and socket == "Window":
                return {"kind": "window"}
            if kind == "ShaderNodeTexGradient" and socket in ("Fac", "Factor", "Color"):
                vector = node.inputs["Vector"]
                return {"kind": "gradient", "gradient_type": node.gradient_type,
                        "output": "Fac" if socket == "Factor" else socket,
                        "vector": value(vector) if vector.links else {"kind": "direction"}}
            if kind == "ShaderNodeMath" and socket == "Value":
                return {"kind": "math", "operation": node.operation, "clamp": bool(node.use_clamp),
                        "inputs": [value(s) for s in node.inputs]}
            if kind == "ShaderNodeVectorMath" and socket == "Value" and node.operation == "DOT_PRODUCT":
                vectors = [value(node.inputs[i]) for i in range(2)]
                products = [
                    {"kind": "math", "operation": "MULTIPLY", "clamp": False,
                     "inputs": [{"kind": "separate", "vector": vector, "axis": axis} for vector in vectors]}
                    for axis in range(3)]
                return {"kind": "math", "operation": "ADD", "clamp": False,
                        "inputs": [{"kind": "math", "operation": "ADD", "clamp": False,
                                    "inputs": products[:2]}, products[2]]}
            if kind == "ShaderNodeMapping" and socket == "Vector":
                for name in ("Location", "Rotation", "Scale"):
                    if node.inputs[name].links:
                        raise NotImplementedError("Linked World Mapping " + name)
                return {"kind": "mapping", "vector_type": node.vector_type,
                        "vector": value(node.inputs["Vector"]),
                        "location": [float(c) for c in node.inputs["Location"].default_value],
                        "rotation": [float(c) for c in node.inputs["Rotation"].default_value],
                        "scale": [float(c) for c in node.inputs["Scale"].default_value]}
            if kind == "ShaderNodeMapRange" and socket == "Result":
                if node.data_type != "FLOAT":
                    raise NotImplementedError("World Map Range data type %s" % node.data_type)
                steps = node.inputs.get("Steps")
                return {"kind": "map_range", "interpolation": node.interpolation_type,
                        "clamp": bool(node.clamp) and node.interpolation_type not in ("SMOOTHSTEP", "SMOOTHERSTEP"),
                        "value": value(node.inputs["Value"]),
                        "from_min": value(node.inputs["From Min"]), "from_max": value(node.inputs["From Max"]),
                        "to_min": value(node.inputs["To Min"]), "to_max": value(node.inputs["To Max"]),
                        "steps": value(steps) if steps is not None else 0.0}
            if kind == "ShaderNodeSeparateXYZ" and socket in ("X", "Y", "Z"):
                return {"kind": "separate", "vector": value(node.inputs["Vector"]), "axis": ("X", "Y", "Z").index(socket)}
            if kind == "ShaderNodeValToRGB" and socket == "Color":
                factor = value(node.inputs["Fac"])
                if not _is_scalar(factor):
                    raise NotImplementedError(
                        "World ColorRamp needs a scalar factor; this one is fed by " + _describe_expression(factor))
                ramp = _ramp(node.color_ramp)
                return {"kind": "ramp", "factor": factor, "colors": ramp["ramp_color"],
                        "interpolate": ramp["ramp_interpolate"]}
            if kind in ("ShaderNodeRGB", "ShaderNodeValue"):
                default = node.outputs[socket].default_value
                return float(default) if isinstance(default, (float, int)) else [float(c) for c in list(default)[:3]]
            if kind == "ShaderNodeTexSky" and socket == "Color":
                model = node.sky_type
                if model != "MULTIPLE_SCATTERING":
                    raise NotImplementedError(
                        "World Sky Texture: sky_type %r is not implemented (MULTIPLE_SCATTERING is)" % model)
                vector = node.inputs.get("Vector")
                if vector is not None and vector.links:
                    raise NotImplementedError("Linked World Sky Texture Vector")
                return {"kind": "sky", "sun_elevation": float(node.sun_elevation),
                        "sun_rotation": float(node.sun_rotation), "altitude": float(node.altitude),
                        "air_density": float(node.air_density), "aerosol_density": float(node.aerosol_density),
                        "ozone_density": float(node.ozone_density)}
            if kind == "NodeReroute":
                return value(node.inputs[0])
            raise NotImplementedError("World shader %r: %s.%s" % (node.name, kind, socket))
        finally:
            visiting.remove(key)

    return value(root_socket)


def _describe_background(background, camera_ray):
    color = _describe_world_socket(background.inputs["Color"], camera_ray)
    strength = _describe_world_socket(background.inputs["Strength"], camera_ray)
    # The field evaluator already implements an unclamped color mix. Mixing
    # black with radiance at factor strength is exact multiplication, including
    # spatially varying strength, with no second shader implementation.
    if not isinstance(strength, (int, float)):
        color = {"kind": "mix_color", "factor": strength, "a": [0.0, 0.0, 0.0],
                 "b": color, "clamp_factor": False, "clamp_result": False}
        strength = 1.0
    return {"color": [float(c) for c in list(background.inputs["Color"].default_value)[:3]],
            "strength": float(strength), "shader": color}


def _describe_world_volume(socket, weight=1.0, visiting=None):
    """Volume closures and their authored inputs, not a guessed fog color.
    Mix/Add preserve individual scatter lobes rather than averaging anisotropy."""
    links = list(socket.links)
    if not links:
        return []
    node = links[0].from_node
    visiting = set() if visiting is None else visiting
    key = node.as_pointer()
    if key in visiting:
        raise NotImplementedError("World volume contains a cycle")
    visiting.add(key)
    try:
        kind = node.bl_idname
        if kind == "NodeReroute":
            return _describe_world_volume(node.inputs[0], weight, visiting)
        if kind == "ShaderNodeAddShader":
            return sum((_describe_world_volume(s, weight, visiting) for s in node.inputs), [])
        if kind == "ShaderNodeMixShader":
            factor = _describe_world_socket(node.inputs[0], False)
            factor = {"kind": "math", "operation": "MULTIPLY", "clamp": True, "inputs": [factor, 1.0]}
            first = {"kind": "math", "operation": "SUBTRACT", "clamp": False, "inputs": [1.0, factor]}
            return sum((_describe_world_volume(node.inputs[i + 1],
                {"kind": "math", "operation": "MULTIPLY", "clamp": False, "inputs": [weight, f]}, visiting)
                for i, f in enumerate((first, factor))), [])
        kinds = {"ShaderNodeVolumeAbsorption": "absorption", "ShaderNodeVolumeScatter": "scatter",
                 "ShaderNodeVolumePrincipled": "principled", "ShaderNodeEmission": "emission"}
        if kind not in kinds:
            raise NotImplementedError("World volume shader %s" % kind)
        def read(name, default):
            value = node.inputs.get(name)
            return _describe_world_socket(value, False) if value is not None else default
        return [{"kind": kinds[kind], "weight": weight,
                 "phase": getattr(node, "phase", "HENYEY_GREENSTEIN"), "alpha": read("Alpha", 0.0),
                 "color": read("Color", [1.0, 1.0, 1.0]), "density": read("Density", 0.0),
                 "anisotropy": read("Anisotropy", 0.0), "absorption_color": read("Absorption Color", [0.0, 0.0, 0.0]),
                 "emission_color": read("Emission Color", [1.0, 1.0, 1.0]),
                 "emission_strength": read("Strength" if kinds[kind] == "emission" else "Emission Strength", 0.0),
                 "blackbody_intensity": read("Blackbody Intensity", 0.0), "temperature": read("Temperature", 1000.0),
                 "blackbody_tint": read("Blackbody Tint", [1.0, 1.0, 1.0])}]
    finally:
        visiting.remove(key)


def _describe_world(world):
    outputs = [n for n in world.node_tree.nodes if n.bl_idname == "ShaderNodeOutputWorld" and n.is_active_output]
    if len(outputs) != 1:
        raise NotImplementedError("World rendering needs one active World Output")
    surface = list(outputs[0].inputs["Surface"].links)
    volume = _describe_world_volume(outputs[0].inputs["Volume"])
    if not surface:
        return {"color": [0.0, 0.0, 0.0], "strength": 0.0, "volume": volume}
    background, lighting = _surface_backgrounds(surface[0].from_node)
    described = _describe_background(background, camera_ray=True)
    lighting_data = _describe_background(lighting or background, camera_ray=False)
    if lighting_data != described:
        described["lighting"] = lighting_data
    if volume:
        described["volume"] = volume
    # Only a wholly constant background can drop the expression: linked
    # Strength may carry spatial radiance even when Color itself is constant.
    if not any(background.inputs[name].is_linked for name in ("Color", "Strength")):
        described.pop("shader", None)
    if "lighting" in described and not any(
            (lighting or background).inputs[name].is_linked for name in ("Color", "Strength")):
        described["lighting"].pop("shader", None)
    return described


def draw_world(scene):
    """The world as the presenter's radiance: a constant, or the node graph as
    the expression grammar the presenter evaluates. A graph outside the grammar is a
    standing warning naming the node, and no world -- the model stays visible
    while it is being built."""
    world = scene.world
    if world is None:
        return None
    if world.node_tree is None:
        return {"color": [float(c) for c in list(world.color)[:3]], "strength": 1.0}
    try:
        return _describe_world(world)
    except NotImplementedError as refusal:
        warn("world: %s" % refusal)
        return None


def draw_camera(obj):
    """What the presenter needs to frame a photograph through this camera."""
    camera = obj.data
    return {
        "name": obj.name,
        "type": camera.type,
        "lens": float(camera.lens),
        "sensor_width": float(camera.sensor_width),
        "sensor_height": float(camera.sensor_height),
        "sensor_fit": camera.sensor_fit,
        "angle": float(camera.angle),
        "angle_y": float(camera.angle_y),
        "ortho_scale": float(camera.ortho_scale),
        "clip_start": float(camera.clip_start),
        "clip_end": float(camera.clip_end),
        "shift_x": float(camera.shift_x),
        "shift_y": float(camera.shift_y),
        "matrix": [[float(v) for v in row] for row in obj.matrix_world],
    }


# ------------------------------------------------------- the material graphs

# THE MATERIAL GRAPH, for a surface whose inputs are more than constants.
#
# The export door reduces each material to what a three.js standard material
# holds -- a constant or one image per input. A LINKED input of a Principled
# BSDF or an Emission is instead shipped as the node graph that drives it, and
# the presenter compiles that graph with Blender's own node GLSL
# (`three/blender-node-graph.ts`, `three/blender-node-glsl.generated.ts`). The
# door is told which materials those are (`graph_materials`), so it stays quiet
# about reducing them, and which images their graphs sample (`graph_images`),
# so it ships those pictures with the same revisions as every other.
#
# The graph is flattened here: reroutes and muted nodes are followed the way
# Blender's own node tree evaluation follows them, and group nodes are inlined
# (their nodes keyed by the group path), so the presenter sees one acyclic
# list of Blender nodes. What reaches the presenter is Blender's own data:
# every input socket in declaration order with its GPU type and value, every
# output socket's GPU type, and the node's own RNA properties.

# The node types the presenter compiles. A graph reaching any other type is
# not shipped; the door's reduction stands and a warning names the node.
_GRAPH_NODES = frozenset((
    "ShaderNodeTexCoord", "ShaderNodeUVMap", "ShaderNodeValue", "ShaderNodeRGB",
    "ShaderNodeTexImage", "ShaderNodeMapping", "ShaderNodeMath", "ShaderNodeVectorMath",
    "ShaderNodeMix", "ShaderNodeMixRGB", "ShaderNodeValToRGB", "ShaderNodeInvert",
    "ShaderNodeSeparateXYZ", "ShaderNodeCombineXYZ", "ShaderNodeTexNoise",
    "ShaderNodeTexVoronoi", "ShaderNodeTexChecker",
))
# The surfaces whose inputs map onto the presenter's standard material, and
# the inputs of each the presenter reads from a graph.
_GRAPH_SURFACES = {
    "ShaderNodeBsdfPrincipled": ("Base Color", "Metallic", "Roughness", "Alpha",
                                 "Emission Color", "Emission Strength"),
    "ShaderNodeEmission": ("Color", "Strength"),
}
# Procedural textures whose unlinked Vector is Generated coordinates.
_GENERATED_BY_DEFAULT = frozenset(("ShaderNodeTexNoise", "ShaderNodeTexVoronoi", "ShaderNodeTexChecker"))
# RNA properties every node has, which describe the node's place in the editor
# rather than what it computes.
_NODE_BASE_PROPERTIES = frozenset(p.identifier for p in bpy.types.ShaderNode.bl_rna.properties)


def _gpu_type(socket):
    """Blender's `node_gpu_stack_from_data`: the GLSL type a socket is passed
    as, or None for a socket GPU codegen leaves out of the call."""
    kind = socket.type
    if kind in ("VALUE", "INT", "BOOLEAN"):
        return "float"
    if kind == "VECTOR":
        return "vec%d" % len(socket.default_value) if hasattr(socket, "default_value") else "vec3"
    if kind in ("RGBA", "ROTATION"):
        return "vec4"
    if kind == "SHADER":
        return "closure"
    return None


def _socket_value(socket, gpu):
    """An unlinked socket's value in its GPU type (`nodestack_get_vec`)."""
    if not hasattr(socket, "default_value"):
        return 0.0 if gpu == "float" else [0.0] * int(gpu[3:])
    value = socket.default_value
    if gpu == "float":
        return float(value)
    values = [float(v) for v in value]
    if socket.type == "ROTATION":
        # A rotation socket's value is an Euler; codegen carries it as a vec4.
        values = values + [0.0]
    return values


def _node_properties(node):
    """The node's own RNA properties: enums, flags and numbers, plus the two
    data-block values a compiled node reads (its colour ramp, its image)."""
    props = {}
    for prop in node.bl_rna.properties:
        name = prop.identifier
        if name in _NODE_BASE_PROPERTIES:
            continue
        if prop.type in ("ENUM", "BOOLEAN", "INT", "FLOAT", "STRING") and not getattr(prop, "is_array", False):
            value = getattr(node, name)
            props[name] = sorted(value) if isinstance(value, set) else value
    if node.bl_idname == "ShaderNodeValToRGB":
        ramp = node.color_ramp
        props["color_ramp"] = {
            "interpolation": ramp.interpolation,
            "color_mode": ramp.color_mode,
            "elements": [[float(e.position)] + [float(c) for c in e.color] for e in ramp.elements],
            # The table Blender's GPU path samples (BKE_colorband_evaluate_table_rgba),
            # read through Blender's own evaluator.
            "table": [[float(c) for c in ramp.evaluate(i / 256)] for i in range(_RAMP_SAMPLES)],
        }
    if node.bl_idname == "ShaderNodeTexImage":
        image = node.image
        props["image"] = image.name if image is not None else None
        if image is not None:
            # What decides the Color output's alpha handling
            # (`node_shader_gpu_tex_image`): the image's alpha mode, and
            # whether its colour space is data.
            props["image_alpha_mode"] = image.alpha_mode
            props["image_is_data"] = bool(image.colorspace_settings.is_data)
    if node.bl_idname in ("ShaderNodeValue", "ShaderNodeRGB"):
        # These nodes' value is their OUTPUT socket's (`set_value`/`set_rgba`
        # of a uniform in Blender's GPU path).
        props["value"] = _socket_value(node.outputs[0], _gpu_type(node.outputs[0]))
    return props


def _refusal(node):
    """What of a supported node type the presenter does not compile yet, or None."""
    kind = node.bl_idname
    if kind == "ShaderNodeTexImage":
        image = node.image
        if node.projection != "FLAT":
            return "%s projects %s; only Flat is compiled" % (node.name, node.projection)
        if node.interpolation in ("Cubic", "Smart"):
            return "%s samples %s; Linear and Closest are compiled" % (node.name, node.interpolation)
        if image is not None and image.source not in ("FILE", "GENERATED"):
            return "%s's image is a %s source" % (node.name, image.source)
    if kind == "ShaderNodeTexCoord" and node.object is not None:
        return "%s reads object coordinates of %s" % (node.name, node.object.name)
    return None


class _GraphRefusal(Exception):
    pass


class _MaterialGraph:
    """One material's graph, flattened. `nodes` is keyed by group path."""

    def __init__(self, material):
        self.material = material
        self.nodes = {}
        self.images = set()
        self._building = set()
        # Whether the graph reads Generated coordinates: Texture Coordinate's
        # first output, or a procedural texture's unlinked Vector, which
        # Blender defaults to Generated (`node_shader_gpu_default_tex_coord`).
        self.generated = False

    # A socket is addressed inside a STACK of group nodes; the empty stack is
    # the material's own tree.

    def source(self, stack, socket):
        """An input socket's value: `{"value": v}` or `{"link": [node, output]}`."""
        gpu = _gpu_type(socket)
        links = [link for link in socket.links if link.is_valid and not link.is_muted]
        if not links:
            return {"value": _socket_value(socket, gpu)}
        return self.output(stack, links[0].from_node, links[0].from_socket, gpu)

    def output(self, stack, node, socket, wanted):
        kind = node.bl_idname
        if kind == "NodeReroute":
            return self.source(stack, node.inputs[0])
        if node.mute:
            for link in node.internal_links:
                if link.to_socket == socket:
                    return self.source(stack, link.from_socket)
            return {"value": 0.0 if wanted == "float" else [0.0] * int(wanted[3:])}
        if kind == "ShaderNodeGroup":
            tree = node.node_tree
            if tree is None:
                raise _GraphRefusal("group %s has no node tree" % node.name)
            outputs = [n for n in tree.nodes if n.bl_idname == "NodeGroupOutput"]
            active = next((n for n in outputs if n.is_active_output), outputs[0] if outputs else None)
            if active is None:
                raise _GraphRefusal("group %s has no Group Output" % tree.name)
            inner = next(s for s in active.inputs if s.identifier == socket.identifier)
            return self.source(stack + [node], inner)
        if kind == "NodeGroupInput":
            if not stack:
                raise _GraphRefusal("a Group Input outside a group")
            outer = stack[-1]
            outer_socket = next(s for s in outer.inputs if s.identifier == socket.identifier)
            return self.source(stack[:-1], outer_socket)
        if kind not in _GRAPH_NODES:
            raise _GraphRefusal("%s (%s) is not compiled by the presenter" % (node.name, kind))
        refusal = _refusal(node)
        if refusal is not None:
            raise _GraphRefusal(refusal)
        key = "/".join([group.name for group in stack] + [node.name])
        if key not in self.nodes:
            if key in self._building:
                raise _GraphRefusal("%s is part of a cycle" % node.name)
            self._building.add(key)
            self.nodes[key] = self._describe(stack, node)
            self._building.discard(key)
        index = next(i for i, s in enumerate(node.outputs) if s == socket)
        if kind == "ShaderNodeTexCoord" and index == 0:
            self.generated = True
        return {"link": [key, index]}

    def _describe(self, stack, node):
        if node.bl_idname in _GENERATED_BY_DEFAULT and not any(
                l.is_valid and not l.is_muted for l in node.inputs[0].links):
            self.generated = True
        props = _node_properties(node)
        if props.get("image"):
            self.images.add(props["image"])
        return {
            "type": node.bl_idname,
            "props": props,
            "inputs": [
                dict(self.source(stack, s), id=s.identifier, gpu=_gpu_type(s), enabled=s.enabled)
                for s in node.inputs if _gpu_type(s) not in (None, "closure")
            ],
            "outputs": [{"id": s.identifier, "gpu": _gpu_type(s)} for s in node.outputs],
        }


def _surface_node(tree):
    """The shader node Surface reaches, through reroutes and groups, or None."""
    outputs = [n for n in tree.nodes
               if n.bl_idname == "ShaderNodeOutputMaterial" and n.target in ("ALL", "EEVEE")]
    output = next((n for n in outputs if n.is_active_output), outputs[0] if outputs else None)
    if output is None:
        return None, None
    socket, stack = output.inputs["Surface"], []
    while True:
        links = [link for link in socket.links if link.is_valid and not link.is_muted]
        if not links:
            return None, None
        node, out = links[0].from_node, links[0].from_socket
        if node.bl_idname == "NodeReroute":
            socket = node.inputs[0]
        elif node.bl_idname == "ShaderNodeGroup" and node.node_tree is not None:
            inner = [n for n in node.node_tree.nodes if n.bl_idname == "NodeGroupOutput"]
            if not inner:
                return None, None
            stack = stack + [node]
            socket = next(s for s in inner[0].inputs if s.identifier == out.identifier)
        elif node.bl_idname == "NodeGroupInput" and stack:
            socket = next(s for s in stack[-1].inputs if s.identifier == out.identifier)
            stack = stack[:-1]
        else:
            return stack, node


def material_graph(material):
    """The graph the presenter compiles for this material, or None when the
    door's reduction describes it fully (or the surface is not one the graph
    covers). A graph outside `_GRAPH_NODES` is a warning naming the node."""
    if not material.use_nodes or material.node_tree is None:
        return None
    stack, surface = _surface_node(material.node_tree)
    if surface is None or surface.bl_idname not in _GRAPH_SURFACES:
        return None
    sockets = [surface.inputs[name] for name in _GRAPH_SURFACES[surface.bl_idname]]
    if not any(any(l.is_valid and not l.is_muted for l in s.links) for s in sockets):
        return None
    # The door is quiet about a material whose graph ships, so a linked input
    # the graph does not carry is named here. Normal stays the door's: it
    # reduces an image through a Normal Map node.
    for other in surface.inputs:
        linked = any(l.is_valid and not l.is_muted for l in other.links)
        if not linked or other in sockets:
            continue
        if other.name == "Normal" and other.links[0].from_node.bl_idname == "ShaderNodeNormalMap":
            continue
        warn("%s: %s is linked; only its constant is drawn" % (material.name, other.name))
    graph = _MaterialGraph(material)
    try:
        inputs = {s.name: graph.source(stack, s) for s in sockets}
    except _GraphRefusal as refusal:
        warn("%s: its graph is drawn as constants; %s" % (material.name, refusal))
        return None
    return {
        "surface": surface.bl_idname,
        "inputs": inputs,
        "nodes": graph.nodes,
        "images": sorted(graph.images),
        "generated": graph.generated,
    }


def material_graphs(scene):
    """Every graph the scene's materials need, by material name."""
    graphs = {}
    for obj in scene.objects:
        for slot in getattr(obj, "material_slots", ()):
            material = slot.material
            if material is not None and material.name not in graphs:
                graphs[material.name] = material_graph(material)
    # GENERATED COORDINATES ON A DEFORMED MESH: Blender maps them from the
    # undeformed mesh (orco), which the export does not carry; the presenter
    # maps the evaluated one. Named, never drawn silently different.
    for obj in scene.objects:
        if obj.type != "MESH" or not (obj.modifiers or getattr(obj.data, "shape_keys", None)):
            continue
        for slot in obj.material_slots:
            graph = graphs.get(slot.material.name) if slot.material is not None else None
            if graph is not None and graph["generated"]:
                warn("%s: %s reads Generated coordinates, which are drawn from the deformed mesh; "
                     "Blender maps them from the undeformed one" % (obj.name, slot.material.name))
    return {name: graph for name, graph in graphs.items() if graph is not None}


# ------------------------------------------------------------- the overlays
#
# INSPECTION OVERLAYS, READ OFF THE ENGINE (ARCHITECTURE-CORE §Blender north
# star, "Inspection parity, not editing parity"; WORK.md §Blender in the tab
# is Blender, "Inspection parity", I4). Blender's overlay ENGINE
# (`source/blender/draw/engines/overlay/`) is never run, ported or recorded
# here: what these answer is the DATA its draw functions read -- a bone's
# display matrix, a vertex's weight -- and a three.js presenter draws it
# (`blender-runtime-armature.ts`, `blender-runtime-weights.ts`).
#
# THEY RIDE IN THE FRAME, beside the world and the cameras, for the reason
# those do (`Session._export`): the C++ export door describes geometry and
# materials and nothing else, both of these are per-scene, and a second door
# would be a second round trip per present with no way to stay in step with
# the frame it decorates.


def _armature_bones(obj, locked_groups):
    """Every bone of one armature object, as `overlay_armature.cc` draws it.

    THE MATRIX IS THE POSE MATRIX, always.
    `draw_bone_update_disp_matrix_default` (`overlay_armature.cc:990-1020`)
    takes `pchan->pose_mat` for a pose bone and rescales it uniformly by
    `pchan_bone->length`; an armature in OBJECT mode is drawn through that same
    pose path, because the rest pose IS a pose. `PoseBone.matrix` is that
    `pose_mat`, in the armature object's own space, so the presenter parents
    the drawing to the armature's presented object and needs no second
    transform.

    The LENGTH rides beside the matrix rather than being multiplied into it, so
    the number sent is the engine's own -- `bpy.data.objects[...].pose.bones
    [...].matrix` in the RNA door reads back identical -- and the presenter
    scales the unit shape itself."""
    armature = obj.data
    active = getattr(armature.bones, "active", None)
    active_name = active.name if active is not None else None
    bones = []
    for pchan in obj.pose.bones:
        bone = pchan.bone
        bones.append({
            "name": bone.name,
            "parent": bone.parent.name if bone.parent is not None else None,
            # `draw_points` draws the ROOT sphere only for a bone that is not
            # connected to its parent (`overlay_armature.cc:1338`), because a
            # connected bone's head IS its parent's tail.
            "connected": bool(bone.use_connect),
            "hide": bool(bone.hide),
            "length": float(bone.length),
            "matrix": [[float(v) for v in row] for row in pchan.matrix],
            # BONE_SELECTED / BONE_DRAW_ACTIVE, the two flags
            # `get_pchan_color_wire` branches on (`:760-795`).
            #
            # SELECTION IS THE POSE CHANNEL'S, and that is a MEASUREMENT rather
            # than a preference: at this pin `Bone` carries `hide` and
            # `hide_select` and NO `select` — `rna_def_bone_common`
            # (`rna_armature.cc:1305`) declares none and `:1913` puts one on
            # `EditBone` alone, so `bone.select` is an AttributeError. Asked of
            # the engine itself, a `Bone`'s sel/hide properties are
            # `['hide', 'hide_select']` and a `PoseBone`'s are
            # `['hide', 'select']`. It is the same BIT either way — both write
            # `Bone.flag`'s `BONE_SELECTED`, which is what the overlay's
            # `bone.flag() & BONE_SELECTED` reads.
            "select": bool(pchan.select),
            "active": bone.name == active_name,
            # BONE_DRAW_LOCKED_WEIGHT, set in weight-paint mode for every bone
            # whose SAME-NAMED vertex group on the painted object is locked
            # (`overlay_armature.cc:2059-2084`); it shades both the solid and
            # the wire toward `bone_locked_weight`.
            "lockedWeight": bone.name in locked_groups,
        })
    return bones


def _locked_weight_groups(view_layer):
    """The vertex groups `BONE_DRAW_LOCKED_WEIGHT` is read from.

    `overlay_armature.cc:2059-2084`: only in weight paint, and only from the
    ACTIVE object's own deform groups -- `dg->flag & DG_LOCK_WEIGHT`, which is
    `VertexGroup.lock_weight`."""
    obj = view_layer.objects.active
    if obj is None or "WEIGHT_PAINT" not in obj.mode:
        return frozenset()
    groups = getattr(obj, "vertex_groups", None) or ()
    return frozenset(group.name for group in groups if group.lock_weight)


def _armatures(view_layer):
    """Every armature the view layer shows, with its display type and pose.

    `display_type` is `bArmature.drawtype`, whose enum is `prop_drawtype_items`
    (`rna_armature.cc:2146-2168`): OCTAHEDRAL, STICK, BBONE, ENVELOPE, WIRE.
    `show_in_front` is `Object.dtx & OB_DRAW_IN_FRONT` (`rna_object.cc:
    3646-3648`), which is what puts an armature in the overlay's IN-FRONT
    layer -- the one whose depth buffer is cleared before it draws
    (`Instance::object_is_in_front`, `overlay_instance.cc:1110-1115`)."""
    locked = _locked_weight_groups(view_layer)
    armatures = {}
    for obj in view_layer.objects:
        if obj.type != "ARMATURE" or obj.data is None:
            continue
        armatures[obj.name] = {
            "object": obj.name,
            "displayType": obj.data.display_type,
            "showInFront": bool(obj.show_in_front),
            # `Object.mode`: POSE is what turns the wire colours from
            # `theme.vertex` into the pose colours (`get_bone_wire_color`'s
            # `ARM_DRAW_MODE_*` switch, `:906-936`).
            "mode": obj.mode,
            "bones": _armature_bones(obj, locked),
        }
    return armatures


def _weights(scene, view_layer, frame, known):
    """PER-VERTEX WEIGHT for the active object's active vertex group.

    Blender's own evaluation, `evaluate_vertex_weight`
    (`draw/intern/mesh_extractors/extract_mesh_vbo_weights.cc:20-67`), in the
    default state -- no Multi-Paint, no Lock-Relative -- so the weight is
    `BKE_defvert_find_weight(dvert, active)` clamped to [0,1], and a vertex the
    group does not weight is the ALERT value the fragment shader paints
    `TH_VERTEX_UNREFERENCED` over. WHICH vertices alert is
    `scene.tool_settings.vertex_group_user` (`rna_scene.cc:3428-3434`, default
    ACTIVE): ACTIVE alerts a vertex with no weight in the ACTIVE group, ALL only
    one with no weight in ANY group, NONE never.

    THE ARRAY IS A REFERENCE WHEN NOTHING MOVED, the same contract the meshes
    have (`blender-runtime-frame.ts`): it is the size of a vertex column and
    every mutation presents, so it ships only when its CONTENT has changed since
    the frame this session last sent.

    ITS OWN DIGEST, NOT THE MESH'S REVISION, and that is a measurement rather
    than a preference. The first shape of this function keyed the reference on
    the mesh's export revision -- the number the geometry itself ships under --
    and MEASURED live 2026-09-19: writing 640 deform weights through
    `VertexGroup.add()` does not move it, because the door's revision follows
    the depsgraph's GEOMETRY update record and a deform layer is not geometry.
    So the array shipped once, all zeros, and every later present said
    "unchanged" while the engine held a full ramp. The walk is unavoidable
    either way -- an honest answer has to read every vertex -- so what the
    reference saves is the TRANSFER, and a digest of the bytes is the only key
    that cannot lie about them."""
    obj = view_layer.objects.active
    if obj is None or obj.type != "MESH" or obj.data is None:
        return None
    group = getattr(getattr(obj, "vertex_groups", None), "active", None)
    if group is None:
        return None
    mesh = obj.data
    index = int(group.index)
    count = len(mesh.vertices)
    alert_mode = scene.tool_settings.vertex_group_user
    weights = bytearray(4 * count)
    alerts = bytearray(count)
    view = memoryview(weights).cast("f")
    for i, vertex in enumerate(mesh.vertices):
        value = 0.0
        found = False
        any_group = False
        for element in vertex.groups:
            any_group = True
            if element.group == index:
                value = float(element.weight)
                found = True
        if (not found) or value == 0.0:
            if alert_mode == "ACTIVE":
                alerts[i] = 1
            elif alert_mode == "ALL" and not any_group:
                alerts[i] = 1
        view[i] = 0.0 if value < 0.0 else (1.0 if value > 1.0 else value)
    digest = hashlib.sha1(bytes(weights) + bytes(alerts)).hexdigest()
    header = {"object": obj.name, "group": group.name, "groupIndex": index,
              "count": count, "digest": digest, "alertMode": alert_mode}
    key = "weights:%s:%s" % (obj.name, group.name)
    if known.get(key) == digest:
        header["unchanged"] = True
        return header
    header["weightsBase64"] = base64.b64encode(bytes(weights)).decode("ascii")
    header["alertBase64"] = base64.b64encode(bytes(alerts)).decode("ascii")
    return header


# ---------------------------------------------------------------- the session

class Session:
    def __init__(self):
        self.session = "blender-%d" % int(time.time() * 1000)
        self.revision = 0
        self.project = "/project"
        # What the presenter already holds, in the door's own key space
        # (`mesh:<geometry key>` / `image:<name>`) at the revision it holds:
        # a mesh it has ships as a reference, a picture it has does not ship.
        self._known = {}
        # The last frame's accounting (`_present`), read by `dispatch`.
        self.last_shipped = None
        # THE SESSION'S DOCUMENT: the `.blend` it opens at start and saves back
        # into. Absolute (the module filesystem mirrors the project at its own
        # host path) plus the project-relative spelling the tab needs to name
        # the destination. None until `blender-start` states one.
        self.document = None
        self.document_relative = None
        # Set by a present that left the document behind the model; cleared by
        # the save. The tab reads it as `saveDue` beside the frame.
        self.save_due = False
        # WHAT THE PRESENTER LAST REPORTED HOLDING, as an instrument: the
        # `(session, revision)` it held BEFORE the last frame, None when it
        # held nothing, and the string "unreported" for a presenter that does
        # not answer with one. `_reconcile_with_presenter` is what reads it as
        # a fact; this field is what makes that fact visible from outside
        # (`dispatch`'s `present` answers it).
        self.presenter_held = "unreported"

    def forget(self):
        self._known.clear()

    # -- the export

    def _export(self):
        """THE EXPORT IS THE C++ DOOR (`bpy_web_export.cc`).

        One call evaluates the scene, walks the depsgraph's own update record
        for the revisions, reads Blender's arrays straight into a side arena
        and answers a small JSON frame that names each column by
        `{offset, length, dtype, count, stride}`; the worker copies those bytes
        off the module heap (`session-frame.mts`). Nothing large crosses as
        JSON and nothing is staged through the filesystem.

        WHAT THE DOOR DOES NOT DESCRIBE is reduced here and merged in: the
        WORLD, whose sky/gradient graph becomes the presenter's world
        expression (`draw_world`), the CAMERAS a photograph is framed
        through (`draw_camera`), and the INSPECTION OVERLAYS -- the armatures'
        bones and the active vertex group's weights (`_armatures`,
        `_weights`). All per-scene, none of them geometry.
        """
        scene = bpy.context.scene
        graphs = material_graphs(scene)
        options = {"session": self.session, "evaluate": True, "known": self._known,
                   "graph_materials": sorted(graphs),
                   "graph_images": sorted({i for g in graphs.values() for i in g["images"]})}
        # THE ARENA IS WRITTEN BEFORE THE ASK, and on a skew whose channel is
        # an ordered stream of filesystem patches that is the whole
        # correctness argument: whatever carries `ask/<id>.done` out of this
        # process carried the arena's bytes with it or before it, so a caller
        # that can see the ask can read the file.
        if EXPORT_BUFFER_PATH:
            options["buffer_path"] = EXPORT_BUFFER_PATH
        frame = json.loads(_blender_web.export_frame(json.dumps(options)))
        error = frame.get("error")
        if error:
            raise RuntimeError("Blender export door: %s" % error)
        # THE SESSION OWNS BOTH HALVES OF ITS IDENTITY. The presenter reads
        # `(session, revision)` as a PAIR and refuses outright a frame whose
        # revision went backwards under a name it already holds ("The runtime
        # frame is older than the displayed model"). The door's own counter is
        # per-`Main` -- it starts over on every file read, which is what its
        # per-datablock revisions must do -- while the session name does not, so
        # leaving the two in different hands splits the pair the moment a script
        # opens a .blend. MEASURED 2026-09-18 through the editor tab:
        # `read_factory_settings` took the door's counter from 40 back to 1 and
        # nine of 17-workshop-interior's 63 calls died on that refusal.
        self.revision += 1
        frame["revision"] = self.revision
        # THE GRAPHS JOIN THE DOOR'S MATERIALS, each image a graph samples
        # named at the revision the door holds it at (`graph_images`, which is
        # the session's to read and not part of the presenter's frame).
        revisions = frame.pop("graph_images", {})
        for name, graph in graphs.items():
            if name not in frame["materials"]:
                continue
            for node in graph["nodes"].values():
                image = node["props"].get("image")
                if image is not None:
                    node["props"]["image"] = {"name": image, "revision": int(revisions.get(image, 0))}
            del graph["images"]
            del graph["generated"]
            frame["materials"][name]["graph"] = graph
        # A MANUAL TEXTURE SPACE, which Generated coordinates map through; the
        # automatic one is the evaluated bounds the presenter already holds.
        if graphs:
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for row in frame["objects"]:
                if not any(m in graphs for m in row["materials"] if m is not None):
                    continue
                obj = scene.objects.get(row["name"])
                data = obj.evaluated_get(depsgraph).data if obj is not None else None
                if getattr(data, "use_auto_texspace", True) is False:
                    row["texspace"] = [[float(v) for v in data.texspace_location],
                                       [float(v) for v in data.texspace_size]]
        frame["world"] = draw_world(scene)
        frame["cameras"] = {
            obj.name: draw_camera(obj) for obj in scene.objects if obj.type == "CAMERA"
        }
        frame["volumes"] = {}
        # THE OVERLAYS, after the door's frame stands: `_weights` reads the
        # mesh's own revision out of it (see there), so it cannot run before.
        view_layer = bpy.context.view_layer
        frame["armatures"] = _armatures(view_layer)
        frame["weights"] = _weights(scene, view_layer, frame, self._known)
        warnings = list(frame.get("warnings", ()))
        warnings.extend(_WARNINGS)
        del _WARNINGS[:]
        frame["warnings"] = warnings
        return frame

    def present(self, capture=None):
        """Hand the tab a frame, and give back whatever it answered with.

        A render's photograph comes back through this same door, which is why
        it blocks: `bpy.ops.render.render()` is waiting on the pixels.

        THE PRESENTER IS THE AUTHORITY ON WHAT IT HOLDS, and it says so by
        name: a page that reloaded under a still-running session holds none of
        this session's geometry while `_known` says it was sent. The record is
        dropped and the frame goes out again IN FULL -- the same answer
        `runtime_session.present` gives, for the same reason.
        """
        try:
            return self._present(capture)
        except RuntimeError as error:
            if _UNKNOWN_GEOMETRY not in str(error) and _UNKNOWN_IMAGE not in str(error):
                raise
            self._known.clear()
            return self._present(capture)

    def _present(self, capture=None):
        known = dict(self._known)
        frame = self._export()
        self._drop_unreachable_textures(frame)
        # WHAT THIS FRAME SHIPPED, for the session's own accounting: the ids
        # whose columns crossed, and the ids that went as a reference. The
        # export's whole revision rule is visible here and nowhere else.
        self.last_shipped = {
            "revision": self.revision,
            "columns": sorted(k for k, v in frame["meshes"].items() if "columns" in v),
            "unchanged": sorted(k for k, v in frame["meshes"].items() if v.get("unchanged")),
            "images": sorted(frame["images"].keys()),
            # How many COLUMN BYTES this frame actually shipped: a move ships
            # zero, a vertex edit one mesh's worth.
            "bytes": int(_blender_web.buffer_size()),
            # Blender's `is_dirty` is instrumentation, not our save predicate:
            # its value also depends on native undo initialization/checkpoints.
            "dirty": bool(bpy.data.is_dirty),
        }
        # A PRESENT IS WHAT LEAVES THE DOCUMENT STALE, and the predicate is the
        # present itself rather than what the frame shipped. `columns`/`images`
        # above count BYTES THAT CROSSED, which is a different question: a MOVE
        # ships zero columns (the comment above says so) and a DELETION ships
        # nothing at all, yet both are changes a document that loses them is
        # wrong. The cost this predicate could waste is bounded by the tab's
        # one-save-per-idle-second debounce, and `save_document` still asks
        # Blender whether anything actually changed before it writes.
        if self.document is not None:
            self.save_due = True
        for key, mesh in frame["meshes"].items():
            self._known["mesh:" + key] = mesh["revision"]
        for name, image in frame["images"].items():
            self._known["image:" + name] = image["revision"]
        # The weight array follows the meshes' own rule: recorded as sent, so
        # the next present ships a reference instead of the bytes.
        weights = frame.get("weights")
        if weights is not None:
            self._known["weights:%s:%s" % (weights["object"], weights["group"])] = (
                weights["digest"])
        request = {"frame": frame}
        if capture:
            request["capture"] = capture
        # BESIDE the frame, never inside it: the frame's schema is the
        # presenter's and this is the session's own housekeeping.
        if self.save_due:
            request["saveDue"] = True
        try:
            answer = ask(request)
        except BaseException:
            self._known = known
            raise
        if isinstance(answer, dict) and answer.get("error"):
            # Recorded only once the presenter has taken the frame.
            self._known = known
            raise RuntimeError(answer["error"])
        self._reconcile_with_presenter(answer, frame)
        return answer

    def _drop_unreachable_textures(self, frame):
        """A picture the export could not read is a WARNING, not a refusal.

        The door writes an image by reading its ibuf; an image it cannot read
        is named by the door (`image <name> has no readable pixels`) and left
        out of the frame -- while the MATERIAL still carries the texture
        reference. The presenter then refuses BY NAME
        (`RUNTIME_FRAME_UNKNOWN_IMAGE`), and that refusal cannot be satisfied:
        re-sending the frame in full re-exports the same unreadable image, so
        the second present dies the same way and the whole call fails.

        WHY an image is unreadable is the EXPORT DOOR's question and is not
        answered here, so this says only what it observed. Three mechanisms
        that would explain it were measured in the tab on 2026-09-18 and all
        three SHIP correctly, so none of them is it: a `images.new` image
        filled through `pixels.foreach_set`; a PNG written with `image.save()`
        and read back with `images.load`; and the same PNG written and read
        through a `replay_fs`-style symlinked run directory.

        MEASURED 2026-09-18: the five-model battery's `17-workshop-interior`,
        `18-riverside-bridge`, `19-tram-stop` and `20-rigged-courier` each got
        ZERO calls, refused inside `blender-start` -- `bind_document` opened
        the document the previous model wrote, whose textures live OUTSIDE the
        project (`/Volumes/PeakSSD/volter-work/blender-scene-battery/...`) and
        are in no fresh worker's filesystem.

        THE PRESENTER'S REFUSAL IS RIGHT AND STAYS. It answers "the record says
        I hold this and I do not", which is the desync `_reconcile_with_presenter`
        exists for. What is wrong is asking it about a picture the session
        NEVER SENT AND CANNOT SEND. So a texture reference naming an image that
        is in neither this frame nor `_known` is dropped here, and the
        mechanism is named once (`warn`) -- the material falls back to its own
        socket colour, which is this file's stated rule for a capability the
        export cannot reach.

        A name `_known` still holds is left alone: that IS the desync case, and
        the refusal it raises is the signal that clears the tables and re-ships.
        """
        carried = frame.get("images") or {}
        for material in (frame.get("materials") or {}).values():
            for slot in ("texture", "roughness_texture", "normal_texture"):
                reference = material.get(slot)
                if not isinstance(reference, dict):
                    continue
                name = (reference.get("image") or {}).get("name")
                if name is None or name in carried or ("image:" + name) in self._known:
                    continue
                del material[slot]
                # THE TWO CAUSES THIS WARNING HAS HAD, and the one line that
                # tells them apart -- because the text names `write_image` and
                # a reader reasonably concludes the EXPORT is broken, which
                # twice it was not. `write_image` says "no readable pixels"
                # when `BKE_image_acquire_ibuf` hands back nothing, and the
                # image is usually the thing at fault, not the export:
                #
                #   1. THE IMAGE NEVER LOADED. `source == 'FILE'` and the
                #      filepath does not resolve inside the program -- a
                #      relative path saved against a directory the guest
                #      filesystem does not carry is the worked case. Measured
                #      2026-09-19 (WS-W): a probe's `models/model.blend`
                #      raised 18 of these, and every one of its images read
                #      `has_data False, size (0, 0), len(pixels) 0`.
                #   2. THE PROGRAM WAS OUT OF MEMORY. Measured 2026-09-19 on
                #      the WALI skew: `16-market-courtyard` raised eight of
                #      these while the module was linked
                #      `-Wl,--max-memory=1073741824`, and raising that link to
                #      4 GiB made all eight vanish -- same recording, same
                #      staged textures, same door, 95/95 calls and a silent
                #      console.
                #
                # So before suspecting the export, ask the images:
                #   for im in bpy.data.images:
                #       print(im.name, im.source, tuple(im.size), im.has_data,
                #             im.filepath)
                # (0, 0) with has_data False is cause 1 or 2, never the export.
                warn("material %s: the export could not read the picture %s, so this "
                     "frame draws the material without it. The image is in neither "
                     "this frame nor the presenter's record, so nothing can be "
                     "re-sent to satisfy it; the export door is what knows why "
                     "(`bpy_web_export.cc::write_image`)."
                     % (material.get("name", "?"), name))

    def _reconcile_with_presenter(self, answer, frame):
        """THE PRESENTER'S REPORT OUTRANKS THE SESSION'S RECORD.

        `_known` is what this session BELIEVES the tab holds, accumulated one
        present at a time. The presenter is what actually holds it, and the two
        come apart with neither side failing: the worker and this Python
        session belong to the TAB (`blender-runtime-host.ts` keeps one
        `BlenderRuntime`), while the presenter belongs to the Model DOCUMENT --
        so rebuilding that document (closing and reopening it, a play stall
        that remounts it) leaves a view holding nothing under a session whose
        tables say everything crossed. Every later frame then ships references
        to bytes that are gone.

        MEASURED 2026-09-18, the battery's `19-tram-stop` and `20-rigged-courier`:
        both got zero calls, refused at `blender-start` with
        `RUNTIME_FRAME_UNKNOWN_IMAGE: the presenter does not hold runtime image
        wood_planks_roughness.png@roughness(...) (revision 1)`.

        So every present's answer carries `held` -- what the presenter held
        BEFORE this frame (`protocol.ts`) -- and a holding that is not this
        session's means the accumulated record describes a presenter that is
        gone. What survives is exactly what THIS frame carried: a mesh whose
        columns crossed and every image in it (there is no unchanged-image
        form). A mesh that went as a reference did not cross and is dropped.

        An ABSENT `held` is not a report and is judged as nothing: an older
        presenter must not be read as "holds nothing" on every frame.

        `_known` is only ever narrowed here, never widened, so the correction
        costs one re-ship and can never suppress one.
        """
        if not isinstance(answer, dict) or "held" not in answer:
            self.presenter_held = "unreported"
            return
        held = answer["held"]
        self.presenter_held = held
        if isinstance(held, dict) and held.get("session") == self.session:
            return
        self._known = {}
        for key, mesh in frame["meshes"].items():
            if not mesh.get("unchanged"):
                self._known["mesh:" + key] = mesh["revision"]
        for name, image in frame["images"].items():
            self._known["image:" + name] = image["revision"]
        weights = frame.get("weights")
        if weights is not None and not weights.get("unchanged"):
            self._known["weights:%s:%s" % (weights["object"], weights["group"])] = (
                weights["digest"])

    # -- the document

    def bind_document(self, relative_path):
        """Name the session's document and OPEN it when the project has one.

        One session holds one document. The path is stated at start and never
        moves afterwards: a script's own `save_as_mainfile` to somewhere else
        is an ordinary thing for a script to do and is left alone -- it retargets
        Blender's `bpy.data.filepath`, not this.

        `open_mainfile` runs the session's `_load_post` like any other load
        (the export door's revision table is reset, the render engine ids are
        retaken), and the one present afterwards is what puts the reopened
        model on the tab's screen.
        """
        self.document_relative = relative_path
        self.document = os.path.join(self.project, relative_path)
        if not os.path.exists(self.document):
            return {"document": relative_path, "opened": False}
        bpy.ops.wm.open_mainfile(filepath=self.document)
        self.present()
        # The load did not dirty anything: what is in memory IS the file.
        self.save_due = False
        return {"document": relative_path, "opened": True,
                "objects": len(bpy.data.objects),
                "size": os.path.getsize(self.document)}

    def save_document(self):
        """Write the document -- Blender's own format, by Blender's own operator.

        ONE WRITE, AND IT DOES NOT TOUCH THE SCRIPT'S DATABLOCKS. The save used
        to run `bpy.ops.file.make_paths_relative()` and then write a second
        time, so that a document would reopen on another machine. That rewrote
        the filepath of every image in `bpy.data` -- datablocks the SCRIPT
        owns and did not ask to have moved. MEASURED 2026-09-18,
        `16-market-courtyard` seq 10: the model loads its textures from an
        absolute host path the harness maps into the sandbox, the first idle
        save at seq ~8 turned those filepaths into `//../../..` relative to
        `/project/models/`, and the next texture write resolved against the
        document's directory instead and died in Emscripten's FS with
        `ErrnoError`. Nine of the courtyard's 95 calls ran. The document the
        run left behind then named images that no longer resolved, so the three
        models that opened it afterwards got zero calls apiece.

        `relative_remap` IS FALSE, and that is a measurement rather than a
        reading of the operator's documentation. `save_as_mainfile`'s
        `relative_remap` is described as remapping RELATIVE paths so they stay
        valid from a new location; on this build it also rewrites ABSOLUTE
        ones. MEASURED 2026-09-18 in the tab, four cells, one image loaded from
        `/Volumes/PeakSSD/volter-work/wsh-outside/textures/wsh_abs.png`:

          relative_remap  use_relative_paths  img.filepath after the save
          False           True                /Volumes/.../wsh_abs.png
          False           False               /Volumes/.../wsh_abs.png
          True            False               //../../../wsh-outside/.../wsh_abs.png
          True            True                //../../../wsh-outside/.../wsh_abs.png

        `relative_remap` alone decides it and the preference does not enter.
        So True is the same rewrite `make_paths_relative` was, arriving through
        a different door, and False is the only value that leaves a script's
        paths as the script wrote them. "Reopens on another machine" is served
        by a script loading its project files through project-relative paths in
        the first place, which is the script's choice to make.

        `copy` IS SET, and it is what makes "the session mutates nothing" true
        of the save as a whole rather than only of the path flag above. Without
        it `save_as_mainfile` MOVES the file: `bpy.data.filepath` becomes the
        document, so a script that saved to its own path has been retargeted,
        and every RELATIVE path it wrote now resolves from the document's
        directory instead of the one the script chose.

        MEASURED 2026-09-18 on `18-riverside-bridge`, which is an ordinary
        thing for a script to do: seq 26 is
        `save_as_mainfile(filepath=os.path.join(ITEM, 'model.blend'))`, which
        left its nine textures as `//inputs/<name>.png` relative to ITEM, and
        seq 27-34 call `save_mainfile()` again. With the session's save moving
        `bpy.data.filepath` to `models/model.blend` in between, those paths
        resolved to `models/inputs/` — nothing — and each later save rebased
        the already-relative path again, compounding to
        `//../../probes/probes/ws-h-probe/models/inputs/bark_color.png`. Every
        one of the bridge's pictures was unreadable from there, so the export
        could not write them and the model presented untextured.

        The two flags are one rule, and neither alone is it: `relative_remap`
        False is what leaves an ABSOLUTE path absolute, and `copy` is what
        leaves a RELATIVE one resolving from the base the script gave it.

        What this costs, stated: a script's own `bpy.ops.wm.save_mainfile()`
        writes where the SCRIPT pointed it, not the session's document. That is
        the script's choice to make, which is the whole of the rule.

        `compress` IS stated, and that is the whole reason it appears here.
        MEASURED 2026-09-18 in the tab: the operator's own RNA default is
        False, but `save_as_mainfile` takes its value from
        `preferences.filepaths.use_file_compression`, which is True in this
        build -- so the first documents this lane wrote came out Zstandard
        (`file` says "Zstandard compressed data", `head -c 12` is not
        `BLENDER`). Blender reads either back, so nothing was broken; what was
        wrong is that the BYTES of a file the project commits depended on a
        per-machine preference. A document states its own format.
        """
        self.save_due = False
        if self.document is None:
            return {"saved": False, "reason": "no-document"}
        # `bpy.data.is_dirty` IS NOT A PREDICATE HERE, and this is the measurement
        # rather than a preference. Before native undo initialization it stayed
        # False even after a script built fourteen objects; with explicit undo
        # checkpoints it can stay True across read-only operations. It is not
        # a reliable change detector for this request-driven background session.
        #
        # It was briefly used to skip a redundant write, and it froze the
        # document after its first save -- a reopened session could model all
        # day and never write again. The predicate is `_present`'s instead: a
        # present is what leaves the document stale. Coarser (a read-only
        # script rewrites the file once), bounded by the tab's idle-second
        # debounce, and it cannot miss a change. The reading still rides in the
        # answer, as an instrument.
        dirty = bool(bpy.data.is_dirty)
        existed = os.path.exists(self.document)
        directory = os.path.dirname(self.document)
        if directory:
            try:
                os.makedirs(directory, exist_ok=True)
            except OSError:
                pass
            try:
                os.chmod(directory, 0o777)
            except OSError:
                pass
        bpy.ops.wm.save_as_mainfile(
            filepath=self.document, compress=False, relative_remap=False, copy=True)
        return {"saved": True, "path": self.document,
                "document": self.document_relative,
                "size": os.path.getsize(self.document),
                "revision": self.revision,
                # The instruments a reader needs to judge the save: what
                # Blender thought of the file's state, and whether this was the
                # first write.
                "dirty": dirty, "existed": existed}


SESSION = Session()


# ---------------------------------------------------------------- asking the tab

_ASK_SEQUENCE = [0]


def _drop(path):
    """Remove one of THIS side's own channel files. A failure here means the
    ownership rule was broken by the other side, so it is named rather than
    swallowed -- and named where `vgai console` reads it, not into a log."""
    try:
        os.unlink(path)
    except OSError as error:
        _say("@@VGAI-WARN the session could not remove its own %s: %r" % (path, error))


def ask(payload):
    """Block until the tab answers. The worker's own thread is free while this
    waits; only the Blender pthread is held, which is where the operator is.

    THE REQUEST IS OURS AND THE REPLY IS THE PAGE'S -- see the header's
    ownership table. We write `ask/<n>.json` + `ask/<n>.done`, read the page's
    `reply/<n>.json` once `reply/<n>.done` appears, and then remove only our
    own two files; their disappearance is what tells the page it may retire
    the reply it wrote. `.done` goes last, both times."""
    _ASK_SEQUENCE[0] += 1
    name = str(_ASK_SEQUENCE[0])
    with open(os.path.join(ASK, name + ".json"), "w") as fh:
        fh.write(json.dumps(payload))
    with open(os.path.join(ASK, name + ".done"), "w") as fh:
        fh.write("1")
    marker = os.path.join(REPLY, name + ".done")
    while not os.path.exists(marker):
        time.sleep(0.002)
    with open(os.path.join(REPLY, name + ".json")) as fh:
        body = fh.read()
    _drop(os.path.join(ASK, name + ".json"))
    _drop(os.path.join(ASK, name + ".done"))
    return json.loads(body) if body else None


# ---------------------------------------------------------------- the render engine

def _vertical_extent(cam, width, height):
    """The photograph's vertical field of view in degrees (or, for an
    orthographic camera, its vertical extent in Blender units), framed the way
    Blender frames a render: `BKE_camera_params_compute_viewplane`.

    Blender's `sensor_fit` says which sensor dimension spans which image
    dimension. HORIZONTAL: `sensor_width` spans the image width, and the
    vertical extent follows from the aspect. VERTICAL: `sensor_height` spans the
    height. AUTO: `sensor_width` spans the LARGER image dimension. The previous
    line sent `camera.angle_y`, which Blender derives from `sensor_height`
    alone, so under AUTO or HORIZONTAL fit a 36x24 sensor photographed 1.5x too
    wide a view -- measured on the ten-model battery (2026-09-18): every hero
    image differed across ~100% of pixels by exactly the 36/24 ratio, and
    `sensor_height = 36` made rendered/analytic 0.9991. Pixel aspect is not
    applied; the presenter renders square pixels."""
    import math
    landscape = width >= height
    fit = cam.sensor_fit
    if fit == "VERTICAL" or (fit == "AUTO" and not landscape):
        extent = float(cam.sensor_height if fit == "VERTICAL" else cam.sensor_width)
    else:
        extent = float(cam.sensor_width) * height / max(width, 1)
    if cam.type == "ORTHO":
        # `ortho_scale` spans the same dimension `sensor_fit` names.
        if fit == "VERTICAL" or (fit == "AUTO" and not landscape):
            return float(cam.ortho_scale)
        return float(cam.ortho_scale) * height / max(width, 1)
    return math.degrees(2.0 * math.atan(extent / (2.0 * float(cam.lens))))


def _photograph(depsgraph, width, height):
    """three.js IS the renderer: the render is a photograph of the scene the
    engine holds, taken through the scene's own camera at `scene.render`'s
    exact resolution. `bpy.ops.render.render` semantics are the contract."""
    scene = depsgraph.scene if hasattr(depsgraph, "scene") else bpy.context.scene
    camera = scene.camera
    if camera is None:
        raise RuntimeError("The scene has no camera, so there is nothing to render")
    matrix = camera.matrix_world
    rotation = matrix.to_quaternion()
    vector = __import__("mathutils").Vector
    position = [float(v) for v in matrix.translation]
    forward = rotation @ vector((0.0, 0.0, -1.0))
    target = [position[i] + float(forward[i]) for i in range(3)]
    # THE CAMERA'S ROLL, which position and target cannot express. A top-down
    # render is the everyday case: looking straight down, "up" is a free choice
    # and the photograph is wrong by an arbitrary rotation without it. All three
    # go out in BLENDER'S frame; the tab converts them through the model root's
    # matrix (`blender-runtime-host.ts`).
    up = [float(v) for v in rotation @ vector((0.0, 1.0, 0.0))]
    view = scene.view_settings
    look = getattr(view, "look", "None") or "None"
    transform = {
        "Standard": "none",
        "AgX": "agx",
        "Filmic": "filmic",
        "Khronos PBR Neutral": "neutral",
    }.get(view.view_transform)
    if transform is None:
        raise RuntimeError(
            "Blender view transform %s has no curve in the renderer" % view.view_transform
        )
    render = {
        "width": int(width),
        "height": int(height),
        "fov": _vertical_extent(camera.data, int(width), int(height)),
        "toneMapping": transform,
        "exposure": float(2.0 ** view.exposure),
        "orthographic": camera.data.type == "ORTHO",
        "transparent": bool(scene.render.film_transparent),
    }
    # The renderer keys its baked look tables by the config's FULL name
    # (`AgX - Medium High Contrast`), and `AgX - Base Contrast` is the AgX base
    # view itself -- the same table as no look at all. Send the full name for a
    # non-identity look and nothing for the identity; a look with no table is
    # refused BY NAME on the other side (`blender-runtime-host.ts`).
    if look not in ("None", "AgX - Base Contrast"):
        render["look"] = look
    answer = SESSION.present(
        {"position": position, "target": target, "up": up, "render": render}
    )
    if not isinstance(answer, dict) or "base64" not in answer:
        raise RuntimeError("The renderer did not answer with a photograph")
    _assert_photographed_from(answer.get("camera"), position, target, up)
    return base64.b64decode(answer["base64"]), render


def _assert_photographed_from(reported, position, target, up):
    """The photograph answers with the pose it ACTUALLY used, back in Blender's
    frame, and it must be the pose that was sent -- exactly, with no tolerance.

    This is an instrument, not a nicety. A render's image is allowed to differ
    from Cycles (three.js is the renderer), so a camera placed in the wrong
    frame produces a picture nobody can call wrong: the lane shipped for its
    whole life photographing the model's underside from below the floor because
    Blender's Z-up numbers were read as three.js world space, and every hero
    image the battery graded came from that camera.

    The check is exact because the conversion is exact: the model root's world
    matrix is a signed axis permutation (`blender-runtime-view.ts` sets the
    matrix outright rather than a float quarter turn), so a vector through it
    and its inverse is bit-identical. A mismatch is the conversion being wrong,
    never the check being too strict -- do not widen it.
    """
    sent = {"position": position, "target": target, "up": up}
    if not isinstance(reported, dict):
        raise RuntimeError(
            "The renderer did not say which camera it photographed from, so the "
            "render cannot be attributed to the scene camera %r" % (sent,)
        )
    for key in ("position", "target", "up"):
        got = reported.get(key)
        if not isinstance(got, (list, tuple)) or len(got) != 3:
            raise RuntimeError(
                "The renderer reported no %s for the camera it photographed from" % key
            )
        if [float(v) for v in got] != [float(v) for v in sent[key]]:
            raise RuntimeError(
                "The photograph was taken from a different camera than the scene's: "
                "%s was sent as %r and came back as %r. The Blender-to-document "
                "frame conversion in blender-runtime-host.ts is wrong."
                % (key, sent[key], list(got))
            )


class VgaiRenderEngine(bpy.types.RenderEngine):
    """The scene's renderer, so `write_still`, `save_render` and Render Result
    behave as Blender's own.

    Registered under the three engine ids a script names. The port has real
    Cycles compiled in, so the Cycles add-on's own engine is unregistered
    first -- otherwise `scene.render.engine = 'CYCLES'` resolves to it and
    starts a path trace nobody asked for inside the tab.
    """

    bl_idname = "VGAI_THREE"
    bl_label = "three.js"
    bl_use_preview = False

    def render(self, depsgraph):
        scene = depsgraph.scene
        scale = scene.render.resolution_percentage / 100.0
        width = max(1, int(scene.render.resolution_x * scale))
        height = max(1, int(scene.render.resolution_y * scale))
        try:
            png, _render = _photograph(depsgraph, width, height)
        except Exception as error:  # noqa: BLE001 - reported to Blender as a render error
            self.report({"ERROR"}, str(error))
            return
        path = os.path.join(ROOT, "render-%d.png" % int(time.time() * 1000))
        with open(path, "wb") as fh:
            fh.write(png)
        result = self.begin_result(0, 0, width, height)
        try:
            result.layers[0].load_from_file(path)
        except (RuntimeError, AttributeError) as error:
            self.report({"ERROR"}, "Render result could not take the photograph: %s" % error)
        self.end_result(result)
        try:
            os.unlink(path)
        except OSError:
            pass


def _engine_class(identifier):
    """The registered RenderEngine class holding `identifier` as its `bl_idname`.

    A Python-registered engine is exposed on `bpy.types` under its CLASS name
    (`bpy.types.CyclesRender`), never under its id, so `bpy.types.CYCLES` is
    always absent -- looking there found nothing and left the add-on's engine
    in place. The subclass tree is the one true registry."""
    pending = list(bpy.types.RenderEngine.__subclasses__())
    while pending:
        cls = pending.pop()
        if getattr(cls, "bl_idname", None) == identifier and getattr(cls, "is_registered", False):
            return cls
        pending.extend(cls.__subclasses__())
    return None


def _release_from_owning_addon(existing):
    """Take the class out of its OWNING ADD-ON's registration list as well.

    `unregister_class(existing)` is only half the gesture. The add-on that
    registered the class still holds it in its module-level `classes`, and
    Blender tears every add-on down again on `read_factory_settings` and on
    each `open_mainfile` -- so the add-on's own `unregister()` calls
    `unregister_class` on a class that is already gone and raises
    `RuntimeError: missing bl_rna attribute`. `addon_utils.disable` catches
    that and prints a full traceback, and the remainder of that add-on's
    `unregister()` never runs.

    MEASURED 2026-09-18 through the editor tab, running Blender's own
    `tests/python` suites against the bundle: 25 of 43 suites printed
    `Exception in module unregister(): '/bw/scripts/addons_core/cycles/
    __init__.py'`, and the native oracle at the same pin (5.2.0 LTS,
    fbe6228777e7) printed it in NONE of them -- the add-on is intact there
    because nothing took its engine id. Dropping the class from `classes`
    makes the add-on's next `register()`/`unregister()` pair agree with what
    this session actually did, which is what keeps `scene.cycles` (the reason
    the add-on stays enabled at all) reachable after a factory reset.
    """
    module = sys.modules.get(getattr(existing, "__module__", ""))
    classes = getattr(module, "classes", None)
    if isinstance(classes, tuple):
        if existing in classes:
            module.classes = tuple(cls for cls in classes if cls is not existing)
    elif isinstance(classes, list):
        while existing in classes:
            classes.remove(existing)


def _register_engine():
    """Take the three engine ids a script can name.

    Blender refuses two classes with one `bl_idname`, so the add-on's engine
    class is unregistered first and the bundle's patched registration sets a
    built-in type aside; `bpy.utils.register_class` on a subclass whose
    `bl_idname` is `CYCLES` (or `BLENDER_EEVEE`, the factory default) then
    makes `scene.render.engine` resolve here. `BLENDER_EEVEE` is the factory engine's id in 5.x (measured on the
    oracle: the enum holds exactly that name; `BLENDER_EEVEE_NEXT` was 4.2's). Only the Cycles ENGINE CLASS goes: the add-on stays enabled, because
    `scene.cycles` is the add-on's property group and a script sets `samples`,
    `use_denoising` and the rest on it (disabling the add-on removed it, and
    every workshop render died on `'Scene' object has no attribute 'cycles'`
    before it reached the photograph).
    """
    made, unavailable = [], []
    for identifier, label in (
        ("CYCLES", "Cycles"),
        ("BLENDER_EEVEE", "EEVEE"),
        ("BLENDER_WORKBENCH", "Workbench"),
    ):
        existing = _engine_class(identifier)
        if existing is not None and issubclass(existing, VgaiRenderEngine):
            made.append(identifier)
            continue
        if existing is not None:
            try:
                bpy.utils.unregister_class(existing)
            except Exception:  # noqa: BLE001
                pass
            else:
                _release_from_owning_addon(existing)
        engine = type(
            "Vgai" + identifier.title().replace("_", ""),
            (VgaiRenderEngine,),
            {"bl_idname": identifier, "bl_label": label, "bl_use_preview": False},
        )
        try:
            bpy.utils.register_class(engine)
            made.append(identifier)
        except Exception:  # noqa: BLE001
            # Upstream Blender refuses to let a Python engine take a BUILT-IN
            # id ("is built-in"); the shipped bundle carries a patch that sets
            # the built-in type aside instead, since headless has no GPU for it
            # to render with, so all three ids are taken there (measured
            # 2026-09-17). A bundle without that patch keeps `BLENDER_EEVEE`
            # and `BLENDER_WORKBENCH`: that is a fact about the build, stated
            # in the start reply and refused by name at the render, never a
            # warning on every boot.
            unavailable.append(identifier)
    # `VGAI_THREE` is the engine under its own name, registered ONCE: this runs
    # again after every file load (the ids have to be retaken), and Blender
    # refuses a class it already holds -- which is not a capability anyone
    # lost, so it is not a warning.
    if _engine_class(VgaiRenderEngine.bl_idname) is None:
        try:
            bpy.utils.register_class(VgaiRenderEngine)
        except Exception as error:  # noqa: BLE001
            warn("could not register the three.js engine: %s" % error)
    if _engine_class(VgaiRenderEngine.bl_idname) is not None:
        made.append(VgaiRenderEngine.bl_idname)
    return made, unavailable


# ---------------------------------------------------------------- native document history

class NativeHistory:
    """Blender owns the snapshots. These ids only address its steps from Code-OSS.

    Background mode supports explicit undo_push (ed_undo_push_exec). Initialize
    after opening the document, then checkpoint at the request boundary, including
    scripts that mutate and subsequently fail. Never replay a script to redo it.
    """
    def __init__(self):
        self.epoch = 0
        self.serial = 0
        self.steps = []
        self.cursor = 0
        self.events = []
        self.initialized = False
        self.group_depth = 0
        self.group_label = None
        self.mutation_serial = 0
        self.moving = False

    def changed(self):
        self.mutation_serial += 1

    def native_moved(self):
        # A script can invoke Blender's undo directly. It must not leave our
        # tokens addressing a different native cursor. Host-owned moves retain
        # their ledger; external moves invalidate it and start a fresh baseline.
        if not self.moving:
            self.reset()

    def reset(self):
        self.epoch += 1
        self.steps = []
        self.cursor = 0
        self.initialized = False
        self.group_depth = 0
        self.group_label = None
        self.events = [{"reset": True}]

    def begin(self):
        if self.initialized:
            return
        preferences = bpy.context.preferences.edit
        preferences.use_global_undo = True
        # Native eviction may exhaust history before our address ledger. poll()
        # below then refuses instead of claiming a restoration. Bound memory in
        # the browser worker; retaining hundreds of full scenes can exhaust wasm.
        preferences.undo_steps = 32
        preferences.undo_memory_limit = 256
        if "FINISHED" not in bpy.ops.ed.undo_push(message="Open document"):
            raise RuntimeError("Blender could not initialize native undo; the edit was not started")
        self.initialized = True

    def commit(self, label):
        self.begin()
        if self.group_depth:
            self.group_label = self.group_label or label
            return
        bpy.context.view_layer.update()
        if "FINISHED" not in bpy.ops.ed.undo_push(message=label[:63]):
            raise RuntimeError("Blender could not checkpoint this edit in native undo")
        self.serial += 1
        token = "%s:%s:%s" % (SESSION.session, self.epoch, self.serial)
        self.steps[self.cursor:] = [token]
        # Blender keeps at most undo_steps native states, including the baseline.
        if len(self.steps) > 31:
            del self.steps[:-31]
        self.cursor = len(self.steps)
        self.events.append({"id": token, "label": label,
                            "resource": SESSION.document_relative})

    def move(self, token, direction):
        if self.group_depth:
            raise RuntimeError("Finish the current Blender gesture before undo or redo")
        index = self.cursor - 1 if direction == "undo" else self.cursor
        if index < 0 or index >= len(self.steps) or self.steps[index] != token:
            raise RuntimeError("Blender history expired or changed outside this edit; no other step was restored")
        operator = bpy.ops.ed.undo if direction == "undo" else bpy.ops.ed.redo
        if not operator.poll():
            raise RuntimeError("Blender cannot %s this native step in the current context" % direction)
        self.moving = True
        try:
            if "FINISHED" not in operator():
                raise RuntimeError("Blender did not finish %s" % direction)
        finally:
            self.moving = False
        self.cursor += -1 if direction == "undo" else 1
        # Native undo replaces datablocks. Both revision caches must forget their
        # old pointers before the restored scene is exported to the presenter.
        _blender_web.session_reset()
        SESSION.forget()
        SESSION.present()
        return {"moved": True}


HISTORY = NativeHistory()


@bpy.app.handlers.persistent
def _history_post(_arg):
    HISTORY.native_moved()

# ---------------------------------------------------------------- the MCP tools

def get_scene_info():
    scene = bpy.context.scene
    info = {
        "name": scene.name,
        "object_count": len(scene.objects),
        "objects": [],
        "materials_count": len(bpy.data.materials),
    }
    for i, obj in enumerate(scene.objects):
        if i >= 10:
            break
        info["objects"].append({
            "name": obj.name,
            "type": obj.type,
            "location": [round(float(obj.location.x), 2), round(float(obj.location.y), 2),
                         round(float(obj.location.z), 2)],
        })
    return info


def _aabb(obj):
    import mathutils

    corners = [mathutils.Vector(corner) for corner in obj.bound_box]
    world = [obj.matrix_world @ corner for corner in corners]
    return [[*mathutils.Vector(map(min, zip(*world)))], [*mathutils.Vector(map(max, zip(*world)))]]


def get_object_info(name):
    obj = bpy.data.objects.get(name)
    if not obj:
        raise ValueError("Object not found: %s" % name)
    info = {
        "name": obj.name,
        "type": obj.type,
        "location": [obj.location.x, obj.location.y, obj.location.z],
        "rotation": [obj.rotation_euler.x, obj.rotation_euler.y, obj.rotation_euler.z],
        "scale": [obj.scale.x, obj.scale.y, obj.scale.z],
        "visible": obj.visible_get(),
        "materials": [],
    }
    if obj.type == "MESH":
        info["world_bounding_box"] = _aabb(obj)
    for slot in obj.material_slots:
        if slot.material:
            info["materials"].append(slot.material.name)
    if obj.type == "MESH" and obj.data:
        info["mesh"] = {
            "vertices": len(obj.data.vertices),
            "edges": len(obj.data.edges),
            "polygons": len(obj.data.polygons),
        }
    return info


def execute(code):
    """Run one script in a namespace of its own, `{"bpy": bpy}`, which is what
    the Blender MCP add-on gives every call. A helper one call defines reaches
    a later call only through `bpy.app.driver_namespace`, and a name a later
    call binds never reaches an earlier call's closure: with one dict shared
    across calls, the courtyard's render helper (defined at seq 29) found its
    `sc` rebound to a tuple by seq 35 and failed where the recording did not."""
    namespace = {"bpy": bpy}
    captured = io.StringIO()
    error = None
    try:
        with redirect_stdout(captured):
            exec(compile(code, "<blender-mcp>", "exec"), namespace)
    except BaseException as thrown:  # noqa: BLE001 - the script's failure is the answer
        error = "%s: %s" % (type(thrown).__name__, thrown)
        traceback.print_exc(file=_real_stderr)
    return {"executed": error is None, "result": captured.getvalue(), "error": error}


# CAPABILITIES COMPILED OUT OF THIS BUILD, refused BY NAME at the door. Blender
# built without them keeps their operators registered and reports success while
# doing nothing: measured on `06-cable-gripper` (2026-09-18),
# `bpy.ops.rigidbody.world_add()` returned {'FINISHED'} with `scene.rigidbody_world`
# still None, and the script died three lines later on the None. That is the
# silent degrade the rulings forbid. The build option is Blender's own fact
# (`bpy.app.build_options`); the keyword is the operator namespace a script
# reaches the capability through. Same shape as the render-engine refusal above.
_ABSENT_CAPABILITIES = (
    ("bullet", "rigidbody", "rigid body physics (Bullet)"),
    ("fluid", "bpy.ops.fluid", "fluid simulation (Mantaflow)"),
    ("alembic", "alembic", "Alembic import/export"),
)


def _absent_capability(code):
    options = bpy.app.build_options
    for option, keyword, capability in _ABSENT_CAPABILITIES:
        if keyword in code and not getattr(options, option, True):
            return ("CapabilityUnavailable: %s is not compiled into this Blender build, so "
                    "`%s` operators are refused rather than reported as done with nothing "
                    "created. (bpy.app.build_options.%s is False.)" % (capability, keyword, option))
    return _absent_essentials_assets(code)


# THE ESSENTIALS ASSET LIBRARY is not a build option, so it cannot be refused
# from `bpy.app.build_options` like the three above -- it is a PAYLOAD fact, and
# the only honest predicate is the directory itself.
#
# MEASURED 2026-09-18 in the tab: `bpy.utils.system_resource('DATAFILES')` is
# `/bw/datafiles` and holds exactly `['colormanagement', 'fonts']`, because the
# preload payload ships those two and nothing else from `release/datafiles`
# (recipe/blender_web_headless.cmake). So
# `system_resource('DATAFILES', path='assets')` answers `''`, and Blender
# reports the empty string back to the caller verbatim:
#
#   bpy.ops.object.shade_auto_smooth(use_auto_smooth=True)
#   RuntimeError: Error: No asset found at path ""
#
# Running Blender's own suites against the bundle, that one absence is every
# failing assertion in `object_edit` (1) and `sculpt_paint/brush_asset_test`
# (4) -- both clean on the native oracle at the same pin. A message naming the
# empty path is not something an author can act on; naming the library is.
_ESSENTIALS_KEYWORDS = ("shade_auto_smooth", "asset_activate", "ESSENTIALS")


def _absent_essentials_assets(code):
    if not any(keyword in code for keyword in _ESSENTIALS_KEYWORDS):
        return None
    try:
        present = bool(bpy.utils.system_resource("DATAFILES", path="assets"))
    except Exception:  # noqa: BLE001
        present = False
    if present:
        return None
    return ("CapabilityUnavailable: Blender's ESSENTIALS asset library is not in this "
            "build's preload payload, so the bundled .blend assets behind Smooth by "
            "Angle and the essentials brushes cannot be linked. Operators that reach "
            "for them are refused here rather than failing on Blender's own "
            "`No asset found at path \"\"`, which names nothing an author can act on. "
            "(bpy.utils.system_resource('DATAFILES', path='assets') is empty.)")


# ------------------------------------------------------------------ the RNA door
#
# EVERYTHING BLENDER SHOWS ABOUT A DATABLOCK, READ THROUGH RNA (ARCHITECTURE-CORE
# §Blender north star, "Inspection parity, not editing parity"; WORK.md §Blender
# in the tab is Blender, "Inspection parity", I1). Blender's UI layer is never
# run, ported or recorded here: what this answers is `bl_rna.properties` --
# Blender's own introspection of its own data -- as typed rows, and what our
# panels draw is those rows.
#
# THE ADDRESS IS THE ENGINE'S OWN. A datablock is named the way Blender names it
# to itself: `bpy.data.objects["Cube"]`,
# `bpy.data.objects["Rig"].pose.bones["spine"]`, `bpy.data.materials["Mat"]`,
# `bpy.data.objects["Cube"].modifiers["Subdivision"]`. Resolution is
# `bpy.data.path_resolve` -- RNA's OWN resolver, never `eval` -- and every
# address this door EMITS is built from `path_from_id()`, which is that same
# resolver's round trip, so an address that came out of here goes back in.
#
# BIG DATABLOCKS ARE COUNTED, NEVER SERIALISED: a collection answers its length
# and at most _RNA_COLLECTION_NAMES names (and no names at all when its item
# type has no `name` property -- a mesh's 100k `vertices` is a count), and an
# array longer than _RNA_ARRAY_LIMIT answers its length instead of its values.

_RNA_COLLECTION_NAMES = 16
_RNA_ARRAY_LIMIT = 32
_RNA_STRING_LIMIT = 4096
# `rna_type` is RNA's metadata pointer, not data about the datablock: every
# struct carries it and it points at the struct's own type.
_RNA_SKIP = ("rna_type",)

# BLENDER'S PYTHON LAYER ADDS PROPERTIES RNA DOES NOT KNOW. `bl_rna.properties`
# is RNA's own list, and `scripts/modules/bpy_types.py` puts ordinary Python
# `property` descriptors on top of the generated classes -- `Object.children`,
# `Object.users_collection`, `Object.users_scene`, `Bone.children`. They are
# part of the API Blender's OWN panels read: `properties_object.py:201` draws
# the Collections panel straight out of `obj.users_collection`, which is why
# that panel came up EMPTY here until the door answered them (measured
# 2026-09-19; `users_collection` appears nowhere under `source/blender/makesrna`
# at the pin, so nothing in the RNA iteration could ever have found it).
#
# SKIPPED BY A RULE, NOT A LIST: a name ending `_recursive` is Blender's own
# spelling for a walker that re-derives a whole subtree on every read
# (`children_recursive`, `parent_recursive`), and what it holds is one drill
# away through the plain property beside it.
_PY_PROPERTY_SUFFIX_SKIP = ("_recursive",)

_ID_COLLECTIONS = None
_RNA_GROUPS = {}
_PY_PROPERTIES = {}


def _id_collections():
    """`bpy.data`'s ID collections keyed by the RNA struct each one holds --
    `Object` -> `objects`, `Mesh` -> `meshes` -- read off `bpy.data`'s own RNA
    rather than written down, so a build with more ID types needs no edit."""
    table = {}
    for prop in bpy.data.bl_rna.properties:
        if prop.type != "COLLECTION":
            continue
        fixed = getattr(prop, "fixed_type", None)
        if fixed is not None:
            table.setdefault(fixed.identifier, prop.identifier)
    return table


def _id_collection_for(datablock):
    global _ID_COLLECTIONS
    if _ID_COLLECTIONS is None:
        _ID_COLLECTIONS = _id_collections()
    rna = datablock.bl_rna
    # `bpy.data.lights` holds `Light` while a point lamp's own struct is
    # `PointLight`, so this is a walk up the RNA base chain, not a lookup.
    while rna is not None:
        name = _ID_COLLECTIONS.get(rna.identifier)
        if name:
            return name
        rna = getattr(rna, "base", None)
    return None


def _rna_address(struct):
    """Blender's own address for `struct`, or None when it has none.

    An ID is `bpy.data.<collection>["<name>"]`; anything else is its owning
    ID's address plus RNA's own `path_from_id()`."""
    if struct is None:
        return None
    if isinstance(struct, bpy.types.ID):
        collection = _id_collection_for(struct)
        if collection is None:
            return None
        return 'bpy.data.%s["%s"]' % (collection, bpy.utils.escape_identifier(struct.name))
    owner = getattr(struct, "id_data", None)
    if owner is None:
        return None
    base = _rna_address(owner)
    if base is None:
        return None
    try:
        inner = struct.path_from_id()
    except Exception:  # noqa: BLE001
        return None
    return base if not inner else "%s.%s" % (base, inner)


def _rna_resolve(path):
    """The datablock at an address. `bpy.data.path_resolve` is RNA's own
    resolver -- no `eval` -- and an unresolvable address raises with the
    address in the message."""
    if not isinstance(path, str) or not path.startswith("bpy.data."):
        raise ValueError(
            "An RNA path is the engine's own address and starts with `bpy.data.` -- "
            'bpy.data.objects["Cube"], bpy.data.objects["Rig"].pose.bones["spine"], '
            'bpy.data.objects["Cube"].modifiers["Subdivision"]. Got %r' % (path,))
    return bpy.data.path_resolve(path[len("bpy.data."):])


def _rna_group(struct_rna, identifier):
    """WHICH RNA STRUCT DECLARES THIS PROPERTY -- the only grouping RNA itself
    exposes, and a real one: `Object`'s own properties read apart from the `ID`
    fields every datablock carries. It is NOT Blender's panel layout. Which
    properties a Properties panel draws, and in what order, lives in
    `scripts/startup/bl_ui/properties_*.py`, which the ruling forbids running,
    porting or recording; our own curated panels are I2 and name their RNA
    themselves. Cached per struct -- the base chain is walked once."""
    cached = _RNA_GROUPS.get(struct_rna.identifier)
    if cached is None:
        cached = {}
        for prop in struct_rna.properties:
            declaring = struct_rna
            base = getattr(struct_rna, "base", None)
            while base is not None:
                if prop.identifier in base.properties:
                    declaring = base
                base = getattr(base, "base", None)
            cached[prop.identifier] = (declaring.identifier, declaring.name)
        _RNA_GROUPS[struct_rna.identifier] = cached
    return cached.get(identifier, (struct_rna.identifier, struct_rna.name))


def _rna_pointer_row(value):
    return {
        "path": _rna_address(value),
        "name": getattr(value, "name", None),
        "type": value.bl_rna.identifier,
    }


def _rna_flatten(value):
    """A `bpy_prop_array` of any dimension as one flat sequence, row-major --
    the order `PropertyRNA.array_length` already counts (a 4x4 matrix is 16)."""
    out = []
    for item in value:
        if hasattr(item, "__len__") and not isinstance(item, (str, bytes)):
            out.extend(_rna_flatten(item))
        else:
            out.append(item)
    return out


def _rna_scalar(item, kind):
    if kind == "BOOLEAN":
        return bool(item)
    if kind == "INT":
        return int(item)
    return float(item)


def _rna_value(target, prop):
    """One property's CURRENT value, in the shape its type earns."""
    kind = prop.type
    if kind == "COLLECTION":
        value = getattr(target, prop.identifier)
        row = {"count": len(value)}
        fixed = getattr(prop, "fixed_type", None)
        # A mesh's `vertices` has no `name`, and asking 100k of them for one is
        # exactly the serialisation this door refuses -- so the question is
        # asked of the TYPE, once, off its own RNA.
        if fixed is not None and "name" in fixed.properties:
            row["names"] = [item.name for item in value[:_RNA_COLLECTION_NAMES]]
        return row
    value = getattr(target, prop.identifier)
    if kind == "POINTER":
        return None if value is None else _rna_pointer_row(value)
    if kind == "STRING":
        text = str(value)
        return text if len(text) <= _RNA_STRING_LIMIT else text[:_RNA_STRING_LIMIT]
    if kind == "ENUM":
        return sorted(value) if prop.is_enum_flag else value
    if getattr(prop, "array_length", 0):
        # A MATRIX IS AN ARRAY OF ROWS, not of numbers. `bpy_prop_array` is
        # multi-dimensional wherever `PropertyRNA.array_dimension > 1` --
        # `Bone.matrix` is 3x3, `matrix_local` and `Object.matrix_world` 4x4 --
        # and iterating one yields `Vector`s, which `float()` refuses by name
        # ("could not convert string to float: Vector((1.0, 0.0, 0.0))").
        # Measured live 2026-09-19 on the Bone tab's Transform panel, which is
        # where a matrix first got named. Flattened in ROW-MAJOR order, which
        # is how `array_length` already counts it (9 and 16, not 3 and 4).
        return [_rna_scalar(item, kind) for item in _rna_flatten(value)]
    if kind == "BOOLEAN":
        return bool(value)
    if kind == "INT":
        return int(value)
    if kind == "FLOAT":
        return float(value)
    return value


def _rna_readonly(target, prop):
    """BOTH HALVES OF "BLENDER SAYS SO": the property is declared read-only, or
    this particular datablock refuses the write (library-linked, override
    locked). `is_property_readonly` is the engine's own answer to the second."""
    if bool(prop.is_readonly):
        return True
    try:
        return bool(target.is_property_readonly(prop.identifier))
    except Exception:  # noqa: BLE001
        return False


def _rna_row(target, prop):
    """One `bl_rna` property as a typed row."""
    group, group_name = _rna_group(target.bl_rna, prop.identifier)
    length = int(getattr(prop, "array_length", 0) or 0)
    row = {
        "identifier": prop.identifier,
        "name": prop.name,
        "type": prop.type,
        "subtype": prop.subtype,
        "description": prop.description,
        "group": group,
        "groupName": group_name,
        "arrayLength": length,
        "readonly": _rna_readonly(target, prop),
        # `PropertyRNA.is_hidden` -- RNA's own PROP_HIDDEN flag
        # (`rna_rna.cc:795-799`, `prop->flag & PROP_HIDDEN`), which is how
        # Blender says "this exists but no UI draws it": `ID.original`
        # (`rna_ID.cc:2440-2448`), `ViewLayer.depsgraph`
        # (`rna_layer.cc:733`, through
        # `RNA_def_property_flag_hide_from_ui_workaround`), the NLA tweak
        # storage (`rna_animation.cc:1701,1713`). Reported here and FILTERED
        # by the presentation, so the door stays the whole surface.
        "hidden": bool(prop.is_hidden),
    }
    # UNDRAWN STATE -- the second standing rule, ruled on after I2 measured it
    # (WORK.md §Blender in the tab is Blender, "Inspection parity", I2, "The two
    # standing rules"). `rna_define.cc:1311-1312` gives every property
    # `prop->name = identifier` and `prop->description = ""` at definition, and
    # `RNA_def_property_ui_text` is what replaces them -- so a property whose
    # NAME is still its identifier and whose description is still empty is one
    # Blender never gave UI text to. That is what the modifier panel-open
    # booleans are (`rna_def_modifier_panel_open_prop`, `:2694-2705`, which sets
    # `PROP_NO_DEG_UPDATE` and an sdna bit and no flag at all, so the
    # PROP_HIDDEN rule above does not catch them): state a panel's open/closed
    # arrow writes, not data about the datablock. Reported here and FILTERED by
    # the generic view, exactly as `hidden` is; a curated list names none of
    # them because `bl_ui` draws none of them.
    if prop.name == prop.identifier and not prop.description:
        row["undrawn"] = True
    if prop.type in ("INT", "FLOAT"):
        row["softMin"] = float(prop.soft_min)
        row["softMax"] = float(prop.soft_max)
        row["hardMin"] = float(prop.hard_min)
        row["hardMax"] = float(prop.hard_max)
        row["step"] = float(prop.step)
        if prop.type == "FLOAT":
            row["precision"] = int(prop.precision)
    if prop.type == "STRING":
        row["lengthMax"] = int(getattr(prop, "length_max", 0) or 0)
    if prop.type == "ENUM":
        row["isFlag"] = bool(prop.is_enum_flag)
        try:
            items = prop.enum_items
        except Exception:  # noqa: BLE001
            items = getattr(prop, "enum_items_static", ())
        row["items"] = [
            {"identifier": item.identifier, "name": item.name,
             "description": item.description, "icon": item.icon}
            for item in items
        ]
    if prop.type in ("POINTER", "COLLECTION"):
        fixed = getattr(prop, "fixed_type", None)
        if fixed is not None:
            row["itemType"] = fixed.identifier
    if length > _RNA_ARRAY_LIMIT:
        row["valueOmitted"] = "%d values" % length
    else:
        try:
            row["value"] = _rna_value(target, prop)
        except Exception as thrown:  # noqa: BLE001
            row["valueError"] = "%s: %s" % (type(thrown).__name__, thrown)
    return row


def _py_properties(cls):
    """Every Python `property` descriptor on this type that RNA does not
    declare, with the class that declares it -- walked once per type.

    `bl_rna.properties` is RNA's list; `type(x).__mro__` is where
    `bpy_types.py`'s additions live. A name RNA already carries is left to
    RNA (the Python side would be the same value read a slower way)."""
    cached = _PY_PROPERTIES.get(cls.__name__)
    if cached is not None:
        return cached
    found = []
    seen = set()
    rna = getattr(cls, "bl_rna", None)
    declared = set(rna.properties.keys()) if rna is not None else set()
    for base in cls.__mro__:
        for name, member in vars(base).items():
            if name.startswith("_") or name in seen or name in declared:
                continue
            if not isinstance(member, property):
                continue
            if name.endswith(_PY_PROPERTY_SUFFIX_SKIP):
                continue
            seen.add(name)
            found.append((name, member, base.__name__))
    found.sort(key=lambda entry: entry[0])
    _PY_PROPERTIES[cls.__name__] = found
    return found


def _py_row(target, name, descriptor, owner):
    """One Python-level property as a row of the SAME shape RNA's are, typed
    from what it answers -- an ID is a POINTER, a sequence of them a
    COLLECTION with its count and names, a scalar its scalar. A value no RNA
    type covers is not invented into one: the property is dropped, and
    nothing here is a vgai field over Blender's data."""
    row = {
        "identifier": name,
        "name": name,
        "subtype": "NONE",
        "description": (descriptor.__doc__ or "").strip(),
        "group": "py:%s" % owner,
        "groupName": "%s (Python API)" % owner,
        "arrayLength": 0,
        # A descriptor with no setter cannot be written, and `rna_set` refuses
        # it anyway (it is not in `bl_rna.properties`).
        "readonly": descriptor.fset is None,
        "hidden": False,
    }
    try:
        value = getattr(target, name)
    except Exception as thrown:  # noqa: BLE001
        row["type"] = "STRING"
        row["valueError"] = "%s: %s" % (type(thrown).__name__, thrown)
        return row
    if value is None:
        row["type"] = "POINTER"
        row["value"] = None
        return row
    if isinstance(value, bpy.types.bpy_struct):
        row["type"] = "POINTER"
        row["value"] = _rna_pointer_row(value)
        row["itemType"] = value.bl_rna.identifier
        return row
    if isinstance(value, bool):
        row["type"] = "BOOLEAN"
        row["value"] = value
        return row
    if isinstance(value, int):
        row["type"] = "INT"
        row["value"] = int(value)
        return row
    if isinstance(value, float):
        row["type"] = "FLOAT"
        row["value"] = float(value)
        return row
    if isinstance(value, str):
        row["type"] = "STRING"
        row["value"] = value[:_RNA_STRING_LIMIT]
        return row
    if isinstance(value, (tuple, list, bpy.types.bpy_prop_collection)):
        members = list(value[:_RNA_COLLECTION_NAMES])
        row["type"] = "COLLECTION"
        held = {"count": len(value)}
        names = [getattr(item, "name", None) for item in members]
        if names and all(isinstance(item, str) for item in names):
            held["names"] = names
        row["value"] = held
        if members and isinstance(members[0], bpy.types.bpy_struct):
            row["itemType"] = members[0].bl_rna.identifier
        return row
    # A mathutils value (`Bone.center` is a `Vector`, `Bone.matrix` a
    # `Matrix`): a fixed-length run of numbers, flattened row-major the same
    # way `_rna_value` flattens a `bpy_prop_array`.
    try:
        flat = _rna_flatten(value)
    except Exception:  # noqa: BLE001
        return None
    if flat and all(isinstance(item, (int, float)) and not isinstance(item, bool)
                    for item in flat):
        row["type"] = "FLOAT"
        row["arrayLength"] = len(flat)
        if len(flat) > _RNA_ARRAY_LIMIT:
            row["valueOmitted"] = "%d values" % len(flat)
        else:
            row["value"] = [float(item) for item in flat]
        return row
    return None


def _rna_member(collection_path, item, index):
    """One member of a collection, ADDRESSED.

    `path_from_id()` is the first answer and the right one -- but it is not
    always an answer: a `VertexGroup` has no RNA path back to its object (the
    three groups of a skinned mesh came out with `path: null` on the first
    live walk, 2026-09-19), while `bpy.data.path_resolve` resolves
    `objects["X"].vertex_groups["chest"]` perfectly well. So where the struct
    cannot say where it lives, the COLLECTION says it: this path plus the
    member's own key. Index for a member with no name -- a mesh vertex -- which
    is also how `path_from_id` would spell it."""
    address = _rna_address(item)
    name = getattr(item, "name", None)
    if address is None:
        address = ('%s["%s"]' % (collection_path, bpy.utils.escape_identifier(name))
                   if name else "%s[%d]" % (collection_path, index))
    return {"name": name, "path": address, "type": item.bl_rna.identifier}


def rna_view(path, names=_RNA_COLLECTION_NAMES):
    """A datablock's whole RNA surface, grouped as RNA groups it -- or, when the
    address names a COLLECTION (`...modifiers`, `...vertex_groups`, `...bones`),
    its members with their own addresses, so the caller can open one."""
    target = _rna_resolve(path)
    if isinstance(target, bpy.types.bpy_prop_collection):
        return {
            "path": path,
            "kind": "collection",
            "count": len(target),
            "items": [_rna_member(path, item, index)
                      for index, item in enumerate(target[:names])],
        }
    order = []
    grouped = {}
    count = 0

    def add(row):
        if row["group"] not in grouped:
            grouped[row["group"]] = {"id": row["group"], "label": row["groupName"], "rows": []}
            order.append(row["group"])
        grouped[row["group"]]["rows"].append(row)

    for prop in target.bl_rna.properties:
        if prop.identifier in _RNA_SKIP:
            continue
        add(_rna_row(target, prop))
        count += 1
    # AND THEN WHAT BLENDER'S PYTHON LAYER ADDS (see _PY_PROPERTY_SUFFIX_SKIP):
    # `Object.users_collection` and its siblings are real parts of the API
    # Blender's own panels read, and RNA has never heard of them. Last, in
    # their own group, so RNA's answer is never displaced by one.
    for name, descriptor, owner in _py_properties(type(target)):
        row = _py_row(target, name, descriptor, owner)
        if row is not None:
            add(row)
            count += 1
    return {
        "path": path,
        "kind": "struct",
        "type": target.bl_rna.identifier,
        "typeName": target.bl_rna.name,
        "name": getattr(target, "name", None),
        "count": count,
        # RNA's own order within a group and first-appearance order between
        # groups -- the engine's ordering, not a sort of ours.
        "groups": [grouped[group] for group in order],
    }


def rna_set(path, identifier, value, index=None):
    """ONE property, written through bpy. A read-only property is refused BY
    NAME rather than written and lost."""
    target = _rna_resolve(path)
    prop = target.bl_rna.properties.get(identifier)
    if prop is None:
        raise ValueError("%s has no RNA property %r" % (path, identifier))
    if _rna_readonly(target, prop):
        raise ValueError(
            "%s.%s is read-only in Blender's own RNA, so nothing was written."
            % (path, identifier))
    if index is None:
        if prop.type == "ENUM" and prop.is_enum_flag:
            setattr(target, identifier, set(value))
        elif prop.type == "POINTER":
            setattr(target, identifier, None if value is None else _rna_resolve(value))
        else:
            setattr(target, identifier, value)
    else:
        getattr(target, identifier)[index] = value
    HISTORY.changed()
    return {"path": path, "property": identifier, "value": _rna_value(target, prop)}


# ---- the context the Properties tabs key on --------------------------------
#
# MIRRORED FROM `source/blender/editors/space_buttons/buttons_context.cc`, read
# at the engine's own pin (Blender 5.2.0, `fbe6228777e7`) -- not guessed, and
# not transcribed from a screenshot. A tab exists exactly when
# `buttons_context_path(<tab>)` can build a path to it, and the rail's ORDER is
# `ED_buttons_tabs_list` (`space_buttons.cc:201-256`). Each condition below
# cites the function it mirrors, and every value read is the ENGINE's own
# state -- the active bone is `armature.bones.active`, the active modifier is
# `object.modifiers.active` -- never a list of ours.
#
# THE CALLER'S OBJECT IS THE ACTIVE ONE. `buttons_context_path_object` reads
# `BKE_view_layer_active_object_get`; here the caller may NAME the object it is
# looking at instead, because the person's selection happens in our viewport
# and reading it must not WRITE the engine's active object -- that is a
# mutation, and the document would save it. Given no name, the engine's own
# active object answers.

# `buttons_context_path_modifier`: `ELEM(ob->type, OB_EMPTY, OB_MESH,
# OB_CURVES_LEGACY, OB_FONT, OB_SURF, OB_LATTICE, OB_GREASE_PENCIL, OB_CURVES,
# OB_POINTCLOUD, OB_VOLUME)`, in `Object.type`'s own enum spellings.
_MODIFIER_OBJECT_TYPES = ("EMPTY", "MESH", "CURVE", "FONT", "SURFACE", "LATTICE",
                          "GREASEPENCIL", "GPENCIL", "CURVES", "POINTCLOUD", "VOLUME")


def _rna_active_object(name):
    if name:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise ValueError("The engine holds no object named %r" % (name,))
        return obj
    return bpy.context.view_layer.objects.active


def _named(value, path=None):
    if value is None:
        return None
    return {"name": getattr(value, "name", None),
            "path": path if path is not None else _rna_address(value),
            "type": value.bl_rna.identifier}


def _tab(identifier, label, icon, paths):
    return {"id": identifier, "label": label, "icon": icon,
            "paths": [{"label": name, "path": path} for name, path in paths if path]}


def _layer_collection_path(view_layer_path, root, target):
    """A `LayerCollection` HAS NO `path_from_id()` -- measured live 2026-09-19,
    the same shape as I1's `VertexGroup` finding, and it made
    `COLLECTION_PT_viewlayer_flags`'s datablock unaddressable so the View Layer
    sub-panel drew nothing. Its address is its POSITION in the view layer's
    tree, which the tree itself can spell."""
    if target is None:
        return None

    def walk(node, path):
        if node == target:
            return path
        for child in node.children:
            found = walk(child, '%s.children["%s"]'
                         % (path, bpy.utils.escape_identifier(child.name)))
            if found is not None:
                return found
        return None

    return walk(root, "%s.layer_collection" % view_layer_path)


def _texture_slot_users(users, owner, slots, label, name=None):
    """Blender's `buttons_texture_user_mtex_add`: one user per FILLED slot."""
    for index, slot in enumerate(slots or ()):
        texture = getattr(slot, "texture", None)
        if texture is None:
            continue
        users.append({"label": label,
                      "name": name if name else getattr(owner, "name", None),
                      "path": _rna_address(slot),
                      "property": "texture",
                      "texture": _named(texture)})


def _texture_node_users(users, tree, label):
    """`buttons_texture_users_find_nodetree`: every node in the tree whose
    `texture` pointer is filled."""
    if tree is None:
        return
    for node in getattr(tree, "nodes", ()):
        prop = node.bl_rna.properties.get("texture")
        if prop is None or prop.type != "POINTER":
            continue
        texture = getattr(node, "texture", None)
        if texture is None:
            continue
        users.append({"label": label, "name": node.name,
                      "path": _rna_address(node), "property": "texture",
                      "texture": _named(texture)})


def _texture_users(scene, view_layer, obj):
    """WHO USES A TEXTURE, mirrored from
    `space_buttons/buttons_texture.cc::buttons_texture_users_from_context`
    (`:244-366`) at the engine's pin -- in ITS order, because
    `buttons_texture_context_compute` (`:369`) takes `ct->index` (0 unless a
    person picks another) and the Texture tab then shows THAT user's texture.

    The C walks, in order: the scene's compositing node tree ("Compositor"),
    the active line style's slots and node tree ("Line Style"), the object's
    modifiers via `BKE_modifiers_foreach_tex_link` ("Modifiers"), the ACTIVE
    particle system's `part.mtex[]` ("Particles"), the object's force field
    when `forcefield == PFIELD_TEXTURE` ("Fields"), and the active paint
    brush's own two slots ("Brush").

    NOTE, because it is easy to assume otherwise from older Blenders: a LIGHT
    is not a texture user at this pin. `buttons_texture_users_from_context`
    does not look at `ob->data` at all -- lamp textures went with 2.8's
    renderer rewrite. Measured, not remembered."""
    users = []
    _texture_node_users(users, getattr(scene, "compositing_node_group", None), "Compositor")

    freestyle = getattr(view_layer, "freestyle_settings", None)
    linesets = getattr(freestyle, "linesets", None)
    linestyle = getattr(getattr(linesets, "active", None), "linestyle", None)
    if linestyle is not None:
        _texture_slot_users(users, linestyle, getattr(linestyle, "texture_slots", None),
                            "Line Style")
        _texture_node_users(users, getattr(linestyle, "node_tree", None), "Line Style")

    if obj is not None:
        for modifier in obj.modifiers:
            for prop in modifier.bl_rna.properties:
                if prop.type != "POINTER":
                    continue
                fixed = getattr(prop, "fixed_type", None)
                if fixed is None or fixed.identifier != "Texture":
                    continue
                texture = getattr(modifier, prop.identifier, None)
                if texture is None:
                    continue
                users.append({"label": "Modifiers", "name": modifier.name,
                              "path": _rna_address(modifier),
                              "property": prop.identifier,
                              "texture": _named(texture)})
        systems = getattr(obj, "particle_systems", None)
        active_system = getattr(systems, "active", None) if systems is not None else None
        settings = getattr(active_system, "settings", None)
        if settings is not None:
            _texture_slot_users(users, settings, getattr(settings, "texture_slots", None),
                                "Particles", name=active_system.name)
        field = getattr(obj, "field", None)
        if field is not None and getattr(field, "type", None) == "TEXTURE" \
                and getattr(field, "texture", None) is not None:
            users.append({"label": "Fields", "name": "Texture Field",
                          "path": _rna_address(field), "property": "texture",
                          "texture": _named(field.texture)})

    # `BKE_paint_brush(BKE_paint_get_active_from_context(C))`. Headless has no
    # paint mode, so this is whichever tool settings hold a brush at all --
    # asked of every `Paint` the tool settings carry rather than of a mode.
    tools = getattr(bpy.context, "tool_settings", None)
    for member in ("image_paint", "sculpt", "vertex_paint", "weight_paint",
                   "gpencil_paint", "curves_sculpt"):
        paint = getattr(tools, member, None)
        brush = getattr(paint, "brush", None)
        if brush is None:
            continue
        for slot, prop in (("texture_slot", "texture"), ("mask_texture_slot", "mask_texture")):
            holder = getattr(brush, slot, None)
            texture = getattr(brush, prop, None)
            if holder is None or texture is None:
                continue
            users.append({"label": "Brush", "name": brush.name,
                          "path": _rna_address(holder), "property": "texture",
                          "texture": _named(texture)})
    return users


def rna_context(object_name=None, collection_path=None):
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    scene_path = _rna_address(scene)
    view_layer_path = '%s.view_layers["%s"]' % (
        scene_path, bpy.utils.escape_identifier(view_layer.name))
    obj = _rna_active_object(object_name)
    object_path = _rna_address(obj) if obj is not None else None
    data_path = _rna_address(obj.data) if obj is not None and obj.data is not None else None

    # `buttons_context_path_collection`: the view layer's active collection, and
    # NOT the scene's master collection ("Do not show collection tab for master
    # collection").
    #
    # THE CALLER'S COLLECTION IS THE ACTIVE ONE, exactly as the caller's object
    # is (see the header). Clicking a collection row in Blender's Outliner calls
    # `BKE_layer_collection_activate` (`tree_element_layer_collection_activate`,
    # `outliner_select.cc:812-821`) and the Properties editor's Collection tab
    # then shows THAT collection. Activating it here would be a mutation the
    # document saves, so the row's own address arrives as a parameter and stands
    # in for `view_layer.active_layer_collection` for this read alone.
    active_layer_collection = getattr(view_layer, "active_layer_collection", None)
    if collection_path:
        named = _rna_resolve(collection_path)
        if not isinstance(named, bpy.types.LayerCollection):
            raise ValueError(
                "%r is a %s, and the Properties editor's Collection tab is built around a "
                "LayerCollection (`buttons_context_path_collection`)."
                % (collection_path, named.bl_rna.identifier))
        active_layer_collection = named
    collection = getattr(active_layer_collection, "collection", None)
    if collection is not None and collection == scene.collection:
        collection = None

    bone = None
    pose_bone = None
    if obj is not None and obj.type == "ARMATURE" and obj.data is not None:
        # `buttons_context_path_bone`: the EDIT bone in edit mode, the
        # armature's active bone otherwise. `buttons_context_path_pose_bone`
        # refuses in edit mode and finds the pose channel of that same bone.
        if obj.mode == "EDIT":
            bone = _named(obj.data.edit_bones.active)
        else:
            active = obj.data.bones.active
            bone = _named(active)
            if active is not None:
                pose_bone = _named(obj.pose.bones.get(active.name))

    material = None
    if obj is not None and obj.data is not None and hasattr(obj.data, "materials"):
        # `buttons_context_path_material`: the ACTIVE SLOT's material
        # (`BKE_object_material_get(ob, ob->actcol)`). The tab stands for an
        # object whose data supports materials even when the slot is empty --
        # `OB_TYPE_SUPPORT_MATERIAL` is asked here as "does this data hold a
        # `materials` collection", which is the same set, read off RNA.
        slot_index = max(int(getattr(obj, "active_material_index", 0)), 0)
        slots = obj.material_slots
        slot = slots[slot_index] if slot_index < len(slots) else None
        held = slot.material if slot is not None else None
        material = {"index": slot_index, "slots": len(slots),
                    "name": None, "path": None, "type": None}
        if held is not None:
            material.update(_named(held))

    modifier = None
    vertex_group = None
    shape_key = None
    constraint = None
    particle_system = None
    if obj is not None:
        if obj.type in _MODIFIER_OBJECT_TYPES:
            modifier = _named(getattr(obj.modifiers, "active", None))
        groups = getattr(obj, "vertex_groups", None)
        if groups is not None and getattr(groups, "active", None) is not None:
            vertex_group = {"index": int(groups.active_index)}
            vertex_group.update(_named(groups.active))
        shape_key = _named(getattr(obj, "active_shape_key", None))
        constraint = _named(getattr(obj.constraints, "active", None))
        systems = getattr(obj, "particle_systems", None)
        if systems is not None:
            particle_system = _named(getattr(systems, "active", None))

    # ED_buttons_tabs_list (`space_buttons.cc:218-252`), in its own order. The
    # TOOL tab is Blender's active-tool settings and has no reader here; SHADERFX
    # (Effects), STRIP and STRIP_MODIFIER likewise.
    # A TAB'S PATHS ARE THE DATABLOCKS ITS PANELS READ. `properties_*.py` is
    # the statement of which: `RENDER_PT_eevee_*` draw off `scene.eevee`,
    # `RENDER_PT_color_management` off `scene.view_settings`, `SCENE_PT_unit`
    # off `scene.unit_settings`. So the sub-struct is named here beside the
    # datablock, the way the Output tab already named `image_settings`, and a
    # curated panel says which it reads with `from`.
    world_path = _rna_address(scene.world) if scene.world else None
    tabs = [
        _tab("render", "Render", "properties-render",
             [("Render", "%s.render" % scene_path), ("Scene", scene_path),
              ("EEVEE", "%s.eevee" % scene_path),
              ("Raytracing", "%s.eevee.ray_tracing_options" % scene_path),
              ("Workbench", "%s.display" % scene_path),
              ("Workbench Shading", "%s.display.shading" % scene_path),
              ("Grease Pencil", "%s.grease_pencil_settings" % scene_path),
              ("View Settings", "%s.view_settings" % scene_path),
              ("Display Device", "%s.display_settings" % scene_path)]),
        _tab("output", "Output", "properties-output",
             [("Output", "%s.render" % scene_path),
              ("Image", "%s.render.image_settings" % scene_path),
              ("Scene", scene_path),
              ("FFmpeg", "%s.render.ffmpeg" % scene_path)]),
        _tab("view_layer", "View Layer", "properties-view-layer",
             [("View Layer", view_layer_path),
              ("EEVEE", "%s.eevee" % view_layer_path),
              # VIEWLAYER_PT_layer draws `rd.use_single_layer` beside the
              # layer's own `use` (`properties_view_layer.py:96-97`).
              ("Render", "%s.render" % scene_path)]),
        _tab("scene", "Scene", "properties-scene",
             [("Scene", scene_path),
              ("Units", "%s.unit_settings" % scene_path),
              ("EEVEE", "%s.eevee" % scene_path),
              # `SCENE_PT_rigid_body_world`'s sub-panels are `RigidBodySubPanel`,
              # whose poll is `scene.rigidbody_world` -- so an absent world is an
              # absent path, and the panels do not draw.
              ("Rigid Body World", _rna_address(scene.rigidbody_world)
               if scene.rigidbody_world is not None else None)]),
        # `buttons_context_path_world` answers true from the scene alone, so the
        # tab stands even when the scene holds no world.
        _tab("world", "World", "properties-world",
             [("World", world_path),
              ("Mist", "%s.mist_settings" % world_path if world_path else None)]),
    ]
    if collection is not None:
        layer_collection_path = _layer_collection_path(
            view_layer_path, view_layer.layer_collection, active_layer_collection)
        tabs.append(_tab("collection", "Collection", "properties-collection",
                         [("Collection", _rna_address(collection)),
                          # COLLECTION_PT_viewlayer_flags reads
                          # `view_layer.active_layer_collection`, not the
                          # collection (`properties_collection.py:47-62`).
                          ("View Layer Collection", layer_collection_path)]))
    if obj is not None:
        tabs.append(_tab("object", "Object", "properties-object", [("Object", object_path)]))
        if obj.type in _MODIFIER_OBJECT_TYPES:
            paths = [("Modifiers", "%s.modifiers" % object_path)]
            if modifier:
                paths.append(("Active", modifier["path"]))
            tabs.append(_tab("modifier", "Modifiers", "properties-modifiers", paths))
        # `buttons_context_path_particle`: `ob->type == OB_MESH`.
        if obj.type == "MESH":
            paths = [("Particle Systems", "%s.particle_systems" % object_path)]
            if particle_system:
                paths.append(("Active", particle_system["path"]))
                # `particle_get_settings(context)` is `psys.settings`
                # (`properties_particle.py:40-46`), a ParticleSettings ID, and
                # it is what nearly every panel on this tab draws -- `part` in
                # every one of their draw functions. The system itself carries
                # only a handful (`seed`, `parent`, the vertex-group names).
                systems_active = getattr(systems, "active", None)
                settings = getattr(systems_active, "settings", None)
                if settings is not None:
                    paths.append(("Settings", _rna_address(settings)))
                    cloth = getattr(systems_active, "cloth", None)
                    if cloth is not None:
                        # PARTICLE_PT_hair_dynamics reads `psys.cloth.settings`
                        # and `.collision_settings` (`:390-404`, `:463-470`).
                        paths.append(("Hair Dynamics",
                                      _rna_address(getattr(cloth, "settings", None))))
                        paths.append(("Hair Collisions",
                                      _rna_address(getattr(cloth, "collision_settings", None))))
            tabs.append(_tab("particle", "Particles", "properties-particles", paths))
        # `buttons_context_path_object` answers Physics and Constraints both.
        #
        # WHICH SIMULATIONS THIS OBJECT HAS is exactly the question
        # `PHYSICS_PT_add` answers with its add/remove buttons
        # (`properties_physics_common.py:55-110`): a sim is present when its
        # DATA is (`obj.rigid_body`, `obj.field`) or when a modifier of its
        # type is in the stack (`physics_add(col, context.cloth, …)` -- Blender's
        # `context.cloth` IS the ClothModifier). The panels then read the
        # modifier's own settings structs, so those are what is named here; an
        # absent sim is an absent path and its panels do not draw, which is the
        # same answer the polls give.
        physics = [(label, "%s.%s" % (object_path, field))
                   for label, field in (("Rigid Body", "rigid_body"),
                                        ("Rigid Body Constraint", "rigid_body_constraint"),
                                        ("Soft Body", "soft_body"),
                                        ("Collision", "collision"),
                                        ("Force Field", "field"))
                   if getattr(obj, field, None) is not None]
        for label, kind, members in (("Cloth", "CLOTH",
                                      # The MODIFIER as well as its settings:
                                      # `point_cache_ui(self, md.point_cache, …)`
                                      # is the cache panel's datablock
                                      # (`properties_physics_cloth.py:269`), and
                                      # that lives on the modifier, not on
                                      # `md.settings`. Measured live 2026-09-19:
                                      # the Cache panel drew nothing without it.
                                      (("Cloth Modifier", None),
                                       ("Cloth", "settings"),
                                       ("Cloth Collisions", "collision_settings"))),
                                     ("Soft Body", "SOFT_BODY",
                                      (("Soft Body Modifier", None),)),
                                     ("Fluid", "FLUID",
                                      (("Fluid", None),
                                       ("Fluid Domain", "domain_settings"),
                                       ("Fluid Flow", "flow_settings"),
                                       ("Fluid Effector", "effector_settings"))),
                                     ("Dynamic Paint", "DYNAMIC_PAINT",
                                      (("Dynamic Paint", None),
                                       ("Dynamic Paint Canvas", "canvas_settings"),
                                       ("Dynamic Paint Brush", "brush_settings")))):
            modifier = next((item for item in obj.modifiers if item.type == kind), None)
            if modifier is None:
                continue
            for name, member in members:
                target = modifier if member is None else getattr(modifier, member, None)
                physics.append((name, _rna_address(target)))
        tabs.append(_tab("physics", "Physics", "properties-physics",
                         physics or [("Object", object_path)]))
        paths = [("Constraints", "%s.constraints" % object_path)]
        if constraint:
            paths.append(("Active", constraint["path"]))
        tabs.append(_tab("constraint", "Object Constraints", "properties-constraints", paths))
        if data_path is not None:
            # `buttons_context_path_data`: the object's own data. Bones and
            # vertex groups ride with it because Blender's Object Data tab is
            # where an armature's bones and a mesh's vertex groups are drawn.
            paths = [("Object Data", data_path)]
            if obj.type == "ARMATURE":
                paths.append(("Bones", "%s.bones" % data_path))
            if getattr(obj, "vertex_groups", None) is not None and len(obj.vertex_groups):
                paths.append(("Vertex Groups", "%s.vertex_groups" % object_path))
            keys = getattr(obj.data, "shape_keys", None)
            if keys is not None:
                paths.append(("Shape Keys", _rna_address(keys)))
            tabs.append(_tab("data", "Object Data", "properties-data", paths))
        if bone is not None:
            paths = [("Bone", bone["path"])]
            if pose_bone is not None:
                paths.append(("Pose Bone", pose_bone["path"]))
            tabs.append(_tab("bone", "Bone", "properties-bone", paths))
            if pose_bone is not None:
                tabs.append(_tab("bone_constraint", "Bone Constraints",
                                 "properties-constraints",
                                 [("Constraints", "%s.constraints" % pose_bone["path"])]))
        if material is not None:
            paths = [("Material Slots", "%s.material_slots" % object_path)]
            if material.get("path"):
                paths.insert(0, ("Material", material["path"]))
            tabs.append(_tab("material", "Material", "properties-material", paths))
    # Blender's Texture tab is `buttons_texture_context_compute`'s search for a
    # texture USER, now mirrored in `_texture_users` -- in the C's own order,
    # with user 0 the active one (`ct->index`). The tab stands when that search
    # finds a user, or (as `buttons_context_path_texture` does through the
    # pinned-ID branch) when the file holds textures at all.
    texture_users = _texture_users(scene, view_layer, obj)
    active_texture_user = texture_users[0] if texture_users else None
    if texture_users or len(bpy.data.textures):
        paths = []
        if active_texture_user is not None:
            paths.append(("Texture", (active_texture_user["texture"] or {}).get("path")))
            paths.append(("User", active_texture_user["path"]))
        paths.append(("Textures", "bpy.data.textures"))
        tabs.append(_tab("texture", "Texture", "properties-texture", paths))

    return {
        "scene": scene_path,
        "viewLayer": view_layer_path,
        "world": _rna_address(scene.world) if scene.world else None,
        "collection": _rna_address(collection) if collection is not None else None,
        # `context.engine`, which is what every `COMPAT_ENGINES` poll in
        # `bl_ui` tests (`RenderEngine`'s id; `properties_render.py:28-48`
        # draws it from `scene.render.engine`). The curated panels that
        # Blender shows only under one engine read THIS rather than a copy of
        # the condition -- see `BlenderCuratedPanel.engine`.
        "engine": scene.render.engine,
        "mode": obj.mode if obj is not None else None,
        "active": None if obj is None else {
            "name": obj.name,
            "type": obj.type,
            "path": object_path,
            "dataPath": data_path,
            "dataType": obj.data.bl_rna.identifier if obj.data is not None else None,
        },
        "activeBone": bone,
        "activePoseBone": pose_bone,
        "activeMaterial": material,
        "activeModifier": modifier,
        "activeVertexGroup": vertex_group,
        "activeShapeKey": shape_key,
        "activeConstraint": constraint,
        "activeParticleSystem": particle_system,
        "textureUsers": texture_users,
        "activeTextureUser": active_texture_user,
        "tabs": tabs,
    }



# ---- the outliner tree ------------------------------------------------------
#
# MIRRORED FROM `space_outliner/tree/tree_display_view_layer.cc` -- Blender's
# VIEW LAYER display mode, the one its Outliner opens on -- and from the
# per-datablock expansions beside it: `tree_element_id_object.cc` (the order an
# object expands in), `tree_element_id_mesh.cc`, `tree_element_id_armature.cc`,
# `tree_element_pose.cc`, `tree_element_modifier.cc`, `tree_element_defgroup.cc`
# and `tree_element_particle_system.cc`, all read at the engine's pin (Blender
# 5.2.0, `fbe6228777e7`). Blender's UI layer is never run, ported or recorded:
# what this answers is the TREE those functions build, as rows, and OUR
# hierarchy panel draws it (ARCHITECTURE-CORE §Blender north star, "Inspection
# parity, not editing parity"; WORK.md §Blender in the tab is Blender,
# "Inspection parity", I3).
#
# THE ADDRESS IS THE ENGINE'S OWN, exactly as `rna_view`'s is: a row's `path` is
# `_rna_address` (or a collection's address plus the member's key, I1's
# answer for a struct that cannot say where it lives), so a row opens in the
# RNA door with no translation. `id` is the row's IDENTITY in the tree, and it
# IS the path in every ordinary case -- the two differ only where Blender
# itself draws one datablock twice (an object linked into two collections, and
# the `TE_CHILD_NOT_IN_COLLECTION` duplicate
# `make_object_parent_hierarchy_collections` adds), where an ordinal keeps the
# rows distinct while `path` stays the engine's own address for both.
#
# WHAT IS OPEN AT REST. A fresh tree-store element is CLOSED
# (`outliner_tree.cc:139`, `tselem->flag = TSE_CLOSED`); the Scene Collection
# (`tree_display_view_layer.cc:130`) and every editable layer collection
# (`:167`) clear that flag and NOTHING else does -- so a collection is open and
# an OBJECT is closed, its data, modifiers and groups with it.
#
# BIG LISTS ARE PAGED, the way `rna_view`'s collections are counted: a child
# list longer than _OUTLINER_PAGE answers its first page and says how many more
# there are, so a scene of 20,000 objects cannot turn one read into a
# 20,000-row payload.

_OUTLINER_PAGE = 64

# `tree_element_get_icon_from_id` (`outliner_draw.cc:2479-2610`) as a table off
# the RNA struct the datablock IS -- the C's `switch (GS(id->name))`, whose
# cases are ID codes and whose two sub-switches (a light's lamp type, a light
# probe's) are values RNA answers directly. Names are Blender's own icon names
# WITHOUT the `ICON_` prefix, which is how `EnumPropertyItem.icon` spells them
# and therefore how every icon this door already emits is spelled.
_OUTLINER_ID_ICONS = {
    "Scene": "SCENE_DATA",
    "Mesh": "OUTLINER_DATA_MESH",
    "SurfaceCurve": "OUTLINER_DATA_SURFACE",
    "TextCurve": "OUTLINER_DATA_FONT",
    "Curve": "OUTLINER_DATA_CURVE",
    "MetaBall": "OUTLINER_DATA_META",
    "Lattice": "OUTLINER_DATA_LATTICE",
    "Material": "MATERIAL_DATA",
    "Texture": "TEXTURE_DATA",
    "Image": "IMAGE_DATA",
    "Speaker": "OUTLINER_DATA_SPEAKER",
    "Sound": "OUTLINER_DATA_SPEAKER",
    "Armature": "OUTLINER_DATA_ARMATURE",
    "Camera": "OUTLINER_DATA_CAMERA",
    "Key": "SHAPEKEY_DATA",
    "World": "WORLD_DATA",
    "Action": "ACTION",
    "Collection": "OUTLINER_COLLECTION",
    "Curves": "OUTLINER_DATA_CURVES",
    "PointCloud": "OUTLINER_DATA_POINTCLOUD",
    "Volume": "OUTLINER_DATA_VOLUME",
    "GreasePencilv3": "OUTLINER_DATA_GREASEPENCIL",
    "GreasePencil": "OUTLINER_DATA_GREASEPENCIL",
    "FreestyleLineStyle": "LINE_DATA",
    "Brush": "BRUSH_DATA",
    "ParticleSettings": "PARTICLES",
    "ShaderNodeTree": "NODETREE",
    "NodeTree": "NODETREE",
    "Palette": "COLOR",
    "VectorFont": "FILE_FONT",
    "MovieClip": "SEQUENCE",
    "Mask": "MOD_MASK",
    "Text": "FILE_TEXT",
    "Library": "LIBRARY_DATA_DIRECT",
    "WorkSpace": "WORKSPACE",
    "Screen": "WORKSPACE",
}

# The two the table cannot hold, because the C keys them on a VALUE rather than
# on the struct (`outliner_draw.cc:2508-2521`, `:2578-2589`).
_OUTLINER_LIGHT_ICONS = {"POINT": "LIGHT_POINT", "SUN": "LIGHT_SUN",
                         "SPOT": "LIGHT_SPOT", "AREA": "LIGHT_AREA"}
_OUTLINER_PROBE_ICONS = {"SPHERE": "LIGHTPROBE_SPHERE", "PLANE": "LIGHTPROBE_PLANE",
                         "VOLUME": "LIGHTPROBE_VOLUME"}


def _enum_icon(target, identifier):
    """The icon RNA'S OWN enum item carries for this property's current value.

    `rna_enum_object_type_items` (`rna_object.cc:218-240`) is item for item
    `ui::icon_from_object_type`'s answer; `rna_enum_object_modifier_type_items`
    carries the `ModifierTypeInfo::icon` that `tree_element_get_icon` reads
    (`outliner_draw.cc:2773-2785`); `rna_enum_constraint_type_items` carries
    that function's own constraint switch. Reading the engine's enum is reading
    the table the Outliner draws from, rather than transcribing it."""
    prop = target.bl_rna.properties.get(identifier)
    if prop is None:
        return None
    item = prop.enum_items.get(getattr(target, identifier, None))
    return (getattr(item, "icon", None) or None) if item is not None else None


def _outliner_object_icon(obj):
    """`ui::icon_from_object_type` (`interface_icons.cc:2188-2237`): the type's
    own enum icon, with the three EMPTY overrides the C spells out (`:2218-2229`
    -- a collection instance, an image empty, a force field)."""
    if obj.type == "EMPTY":
        if obj.instance_collection is not None and obj.instance_type == "COLLECTION":
            return "OUTLINER_OB_GROUP_INSTANCE"
        if getattr(obj, "empty_display_type", None) == "IMAGE":
            return "OUTLINER_OB_IMAGE"
        field = getattr(obj, "field", None)
        if field is not None and getattr(field, "type", "NONE") != "NONE":
            return "OUTLINER_OB_FORCE_FIELD"
    return _enum_icon(obj, "type") or "OBJECT_DATA"


def _outliner_id_icon(datablock):
    """`tree_element_get_icon_from_id` for anything that is not an object."""
    if datablock is None:
        return "DOT"
    if isinstance(datablock, bpy.types.Light):
        return _OUTLINER_LIGHT_ICONS.get(getattr(datablock, "type", None),
                                         "OUTLINER_DATA_LIGHT")
    if isinstance(datablock, bpy.types.LightProbe):
        return _OUTLINER_PROBE_ICONS.get(getattr(datablock, "type", None),
                                         "LIGHTPROBE_SPHERE")
    rna = datablock.bl_rna
    while rna is not None:
        icon = _OUTLINER_ID_ICONS.get(rna.identifier)
        if icon:
            return icon
        rna = getattr(rna, "base", None)
    return "DOT"


def _outliner_unique(path, seen):
    """A row's IDENTITY -- the address, unless this tree already drew that
    datablock (see the header)."""
    count = seen.get(path, 0) + 1
    seen[path] = count
    return path if count == 1 else "%s@%d" % (path, count)


def _outliner_row(path, name, kind, icon, seen, **extra):
    row = {"id": _outliner_unique(path, seen), "path": path, "name": name,
           "type": kind, "icon": icon, "expanded": False, "children": []}
    row.update(extra)
    return row


def _outliner_page(members):
    """A child list, capped. The page, and how many were left behind."""
    members = list(members)
    if len(members) <= _OUTLINER_PAGE:
        return members, 0
    return members[:_OUTLINER_PAGE], len(members) - _OUTLINER_PAGE


def _outliner_key(collection_path, name):
    return '%s["%s"]' % (collection_path, bpy.utils.escape_identifier(name))


def _outliner_constraint(con, owner_path, seen, owner_object):
    path = _outliner_key("%s.constraints" % owner_path, con.name)
    return _outliner_row(
        path, con.name, "TSE_CONSTRAINT", _enum_icon(con, "type") or "DOT", seen,
        object=owner_object,
        # `outliner_draw_restrictbuts`: a constraint's one column is HIDE, and
        # what it holds is `Constraint.enabled` (`outliner_draw.cc:1387-1408`).
        restrict={"hide": not con.enabled})


def _outliner_bone(bone, armature_path, seen):
    """One `TSE_BONE` and its children -- `outliner_add_bone`
    (`tree_element_id_armature.cc`), which nests the armature's bones by parent.
    The glyph is `ICON_BONE_DATA` for every bone (`outliner_draw.cc:2649-2651`)."""
    path = _outliner_key("%s.bones" % armature_path, bone.name)
    row = _outliner_row(path, bone.name, "TSE_BONE", "BONE_DATA", seen)
    page, more = _outliner_page(bone.children)
    row["children"] = [_outliner_bone(child, armature_path, seen) for child in page]
    if more:
        row["more"] = more
    return row


def _outliner_pose_bone(pchan, object_path, seen, owner_object):
    """`TSE_POSE_CHANNEL`, its own constraints under it, and its child channels
    -- `TreeElementPoseBase::expand` (`tree_element_pose.cc`), which nests the
    channels by `pchan->parent` the way the bone tree nests bones."""
    path = _outliner_key("%s.pose.bones" % object_path, pchan.name)
    row = _outliner_row(path, pchan.name, "TSE_POSE_CHANNEL", "BONE_DATA", seen,
                        object=owner_object,
                        restrict={"viewport": bool(pchan.bone.hide)})
    children = []
    if len(pchan.constraints):
        base = _outliner_row("%s.constraints" % path, "Constraints", "TSE_CONSTRAINT_BASE",
                             "CONSTRAINT", seen, object=owner_object)
        base["children"] = [_outliner_constraint(con, path, seen, owner_object)
                            for con in pchan.constraints]
        children.append(base)
    children.extend(_outliner_pose_bone(child, object_path, seen, owner_object)
                    for child in pchan.children)
    row["children"] = children
    return row


def _outliner_modifier(md, obj, object_path, seen):
    """`TSE_MODIFIER`, whose icon is `ModifierTypeInfo::icon`
    (`outliner_draw.cc:2773-2785`) and whose columns are `show_viewport` /
    `show_render` (`:1409-1450`). `TreeElementModifier::expand` hangs the
    modifier's own pointer under it -- the armature/lattice/curve/hook OBJECT, a
    nodes modifier's node group, and a particle system modifier's SYSTEM, which
    is the only place the Outliner shows particles at all."""
    path = _outliner_key("%s.modifiers" % object_path, md.name)
    row = _outliner_row(path, md.name, "TSE_MODIFIER", _enum_icon(md, "type") or "DOT", seen,
                        object=obj.name,
                        restrict={"viewport": not md.show_viewport,
                                  "render": not md.show_render})
    children = []
    for member, kind, icon in (("object", "TSE_LINKED_OB", "OBJECT_DATA"),
                               ("node_group", "TSE_LINKED_NODE_TREE", "NODETREE")):
        linked = getattr(md, member, None)
        if linked is None:
            continue
        linked_path = _rna_address(linked) or "%s.%s" % (path, member)
        children.append(_outliner_row(linked_path, linked.name, kind, icon, seen))
        break
    system = getattr(md, "particle_system", None)
    if system is not None:
        children.append(_outliner_row(
            _outliner_key("%s.particle_systems" % object_path, system.name),
            system.settings.name, "TSE_LINKED_PSYS", "PARTICLES", seen, object=obj.name))
    row["children"] = children
    return row


def _outliner_data(obj, seen):
    """THE OBJECT'S DATA and what its own expansion adds: a mesh's shape keys
    and materials (`tree_element_id_mesh.cc`), an armature's BONES and bone
    collections (`tree_element_id_armature.cc` -- and not its bones while the
    object is in POSE mode, where the Pose row carries the channels instead)."""
    data = obj.data
    path = _rna_address(data)
    row = _outliner_row(path, data.name, "TSE_SOME_ID", _outliner_id_icon(data), seen,
                        object=obj.name, struct=data.bl_rna.identifier)
    children = []
    keys = getattr(data, "shape_keys", None)
    if keys is not None:
        keys_path = _rna_address(keys)
        base = _outliner_row(keys_path, keys.name, "TSE_SHAPE_KEY_BASE", "SHAPEKEY_DATA", seen,
                             object=obj.name)
        page, more = _outliner_page(keys.key_blocks)
        base["children"] = [
            _outliner_row(_outliner_key("%s.key_blocks" % keys_path, block.name), block.name,
                          "TSE_SHAPE_KEY_BLOCK", "SHAPEKEY_DATA", seen, object=obj.name)
            for block in page]
        if more:
            base["more"] = more
        children.append(base)
    if isinstance(data, bpy.types.Armature):
        if obj.mode != "POSE":
            page, more = _outliner_page([bone for bone in data.bones if bone.parent is None])
            children.extend(_outliner_bone(bone, path, seen) for bone in page)
            if more:
                row["more"] = more
        collections = getattr(data, "collections", None)
        if collections is not None and len(collections):
            base = _outliner_row("%s.collections" % path, "Bone Collections",
                                 "TSE_BONE_COLLECTION_BASE", "GROUP_BONE", seen)
            page, more = _outliner_page(collections)
            base["children"] = [
                _outliner_row(_outliner_key("%s.collections" % path, item.name), item.name,
                              "TSE_BONE_COLLECTION", "GROUP_BONE", seen)
                for item in page]
            if more:
                base["more"] = more
            children.append(base)
    for material in getattr(data, "materials", ()) or ():
        if material is None:
            continue
        children.append(_outliner_row(_rna_address(material), material.name, "TSE_SOME_ID",
                                      "MATERIAL_DATA", seen, object=obj.name, struct="Material"))
    row["children"] = children
    return row


def _outliner_object(obj, view_layer, seen, chosen, active):
    """ONE OBJECT ROW and everything `TreeElementIDObject::expand`
    (`tree_element_id_object.cc:33-45`) hangs under it, IN ITS ORDER: animation
    data, pose, data, materials, constraints, modifiers, vertex groups and the
    instanced collection. Its child OBJECTS are added afterwards, by the parent
    walk `ObjectsChildrenBuilder` does."""
    path = _rna_address(obj)
    row = _outliner_row(
        path, obj.name, "TSE_SOME_ID", _outliner_object_icon(obj), seen,
        struct="Object", objectType=obj.type, object=obj.name,
        selected=obj.name in chosen, active=obj.name == active,
        # The two columns Blender's Outliner draws for an object by default
        # (`space_outliner.cc:399` sets `show_restrict_flags` to
        # ENABLE|HIDE|RENDER and ENABLE is collections-only): the EYE is the
        # view layer BASE's `hide_viewport` (`outliner_draw.cc:1291-1317`,
        # which is what `Object.hide_get()` reads), the camera is the object's
        # own `hide_render` (`:1363-1384`).
        restrict={"hide": bool(obj.hide_get(view_layer=view_layer)),
                  "render": bool(obj.hide_render)})
    children = []
    if obj.animation_data is not None:
        children.append(_outliner_row("%s.animation_data" % path, "Animation", "TSE_ANIM_DATA",
                                      "ANIM_DATA", seen, object=obj.name))
    if obj.pose is not None:
        pose = _outliner_row("%s.pose" % path, "Pose", "TSE_POSE_BASE", "ARMATURE_DATA", seen,
                             object=obj.name)
        # `TreeElementPoseBase::expand`: the channels exist only IN POSE MODE
        # ("channels undefined in editmode, but we want the 'tenla' pose icon
        # itself"), so outside it this row is the label alone -- which is
        # exactly what Blender draws.
        if obj.mode == "POSE":
            page, more = _outliner_page([pchan for pchan in obj.pose.bones
                                         if pchan.parent is None])
            pose["children"] = [_outliner_pose_bone(pchan, path, seen, obj.name)
                                for pchan in page]
            if more:
                pose["more"] = more
        children.append(pose)
    if obj.data is not None:
        children.append(_outliner_data(obj, seen))
    for slot in obj.material_slots:
        if slot.material is None:
            continue
        children.append(_outliner_row(_rna_address(slot.material), slot.material.name,
                                      "TSE_SOME_ID", "MATERIAL_DATA", seen, object=obj.name,
                                      struct="Material"))
    if len(obj.constraints):
        base = _outliner_row("%s.constraints" % path, "Constraints", "TSE_CONSTRAINT_BASE",
                             "CONSTRAINT", seen, object=obj.name)
        base["children"] = [_outliner_constraint(con, path, seen, obj.name)
                            for con in obj.constraints]
        children.append(base)
    if len(obj.modifiers):
        base = _outliner_row("%s.modifiers" % path, "Modifiers", "TSE_MODIFIER_BASE",
                             "MODIFIER_DATA", seen, object=obj.name)
        base["children"] = [_outliner_modifier(md, obj, path, seen) for md in obj.modifiers]
        children.append(base)
    groups = getattr(obj, "vertex_groups", None)
    if groups is not None and len(groups):
        # `expand_vertex_groups`: mesh, lattice and grease pencil only, which is
        # the same set as "this object carries a `vertex_groups` collection".
        base_path = "%s.vertex_groups" % path
        base = _outliner_row(base_path, "Vertex Groups", "TSE_DEFGROUP_BASE", "GROUP_VERTEX",
                             seen, object=obj.name)
        page, more = _outliner_page(groups)
        base["children"] = [
            _outliner_row(_outliner_key(base_path, group.name), group.name, "TSE_DEFGROUP",
                          "GROUP_VERTEX", seen, object=obj.name)
            for group in page]
        if more:
            base["more"] = more
        children.append(base)
    if obj.instance_collection is not None and obj.instance_type == "COLLECTION":
        # `expand_duplicated_group`.
        children.append(_outliner_row(_rna_address(obj.instance_collection),
                                      obj.instance_collection.name, "TSE_SOME_ID",
                                      "OUTLINER_COLLECTION", seen, struct="Collection"))
    row["children"] = children
    return row


# ---- the node editor's tree ------------------------------------------------
#
# THE ONE READ A NODE VIEW NEEDS. The generic `rna_view` door answers every one
# of these facts -- `bpy.data.materials["M"].node_tree.nodes` is a collection it
# opens, and each member is a struct it describes -- but it answers them ONE
# STRUCT AT A TIME, and a node tree's drawing is a fact about the WHOLE tree:
# the default Principled material is 2 nodes and 37 sockets, so drawing it
# through the generic door is 40 round trips at the door's own ~100 ms median.
# This door answers the same facts in one, and answers NOTHING the generic view
# could not: every field below is a `bl_rna` property of `Node`, `NodeSocket` or
# `NodeLink`, named here so a reader can check it against `rna_nodetree.cc`.
#
# IT IS A READ AND ONLY A READ (ARCHITECTURE-CORE "Inspection parity, not
# editing parity"): there is no node-tree writer beside it, because a gesture
# that moved a node or retyped a value would be editing, and editing parity is
# not the program. `rna_set` remains the one writer, and it refuses a node's
# `location` the same way it refuses anything else RNA declares read-only --
# which `location` is not, so the VIEW is what refuses, by name, in its own
# status line.
_NODE_SOCKET_VALUE_MAX = 4


def _node_socket_value(socket):
    """A socket's `default_value`, flattened the way `_rna_flatten` flattens an
    array property -- and OMITTED where the socket has none (a shader socket,
    a geometry socket) or Blender itself would not draw it (`hide_value`)."""
    if not hasattr(socket, "default_value"):
        return None
    value = socket.default_value
    if isinstance(value, str):
        return value
    if hasattr(value, "__len__"):
        items = list(value)
        if len(items) > _NODE_SOCKET_VALUE_MAX:
            return None
        return [float(item) for item in items]
    if isinstance(value, bool):
        return bool(value)
    if isinstance(value, (int, float)):
        return float(value)
    # A POINTER-valued socket (an Object, an Image, a Material): its name is
    # what the inline widget shows.
    return getattr(value, "name", None)


def _node_socket(socket, index):
    """One socket, as the node editor draws it.

    Every field is a `NodeSocket` RNA property (`rna_node_socket.cc`): `type`
    is the `SOCK_*` that picks the socket's COLOUR
    (`std_node_socket_colors[]`, `drawnode.cc:987-1013`), `display_shape` the
    `SOCK_DISPLAY_SHAPE_*` that picks its MARK (`rna_node_socket.cc:793-802`),
    and `enabled`/`hide` together are `node_draw.cc`'s own
    `is_socket_available` test -- an unavailable socket occupies no row."""
    return {
        "identifier": socket.identifier,
        "name": socket.name,
        "label": socket.label or None,
        "type": socket.type,
        "shape": socket.display_shape,
        "enabled": bool(socket.enabled),
        "hide": bool(socket.hide),
        "hideValue": bool(getattr(socket, "hide_value", False)),
        "linked": bool(socket.is_linked),
        "multiInput": bool(getattr(socket, "is_multi_input", False)),
        "index": index,
        "value": _node_socket_value(socket),
        # THE SLIDER'S RANGE. A scalar socket whose `default_value` property
        # carries a BOUNDED soft range is drawn by Blender as a NUMBER SLIDER
        # -- `ui_but_is_slider`'s `UI_BTYPE_NUM_SLIDER`, whose back is filled to
        # the value's proportion of that range (`widget_numslider`,
        # `interface_widgets.cc`). Without the range a view can only draw the
        # flat NUM field, which is what ours did: Roughness at 0.5 read as a
        # text box where Blender's reads half-filled at a glance.
        #
        # `soft_min`/`soft_max` are the UI range and `min`/`max` the hard one;
        # Blender sliders against the SOFT pair. An unbounded property (a
        # location, an IOR with an open top) reports `inf` here and the view
        # draws no fill, which is also what Blender does.
        **_node_socket_range(socket),
    }


def _node_socket_range(socket):
    """The soft range of a scalar socket drawn as a SLIDER, when it is one.

    BEING BOUNDED IS NOT THE TEST, and the reference frame is what says so.
    A first pass here reported the range for every bounded scalar, and the view
    drew IOR (soft range 1..3) half-filled at 1.500 -- while Blender's own
    shader editor leaves IOR FLAT and fills only Roughness and Alpha. The
    separating property is the SUBTYPE: `PROP_FACTOR` is what
    `uiItemR`/`node_socket_button_default` pass `UI_ITEM_R_SLIDER` for, so a
    factor draws as `UI_BTYPE_NUM_SLIDER` with a filled back and every other
    number draws as a plain `UI_BTYPE_NUM`.

    Absent for everything else -- a vector, a colour, a string, a pointer, a
    boolean, a non-factor scalar, or a factor whose soft range is open. The
    view's rule stays exactly "a `softMin`/`softMax` pair means draw a
    slider"."""
    try:
        prop = socket.bl_rna.properties["default_value"]
    except (AttributeError, KeyError):
        return {}
    if getattr(prop, "type", None) not in ("FLOAT", "INT"):
        return {}
    if getattr(prop, "array_length", 0):
        return {}
    if getattr(prop, "subtype", None) != "FACTOR":
        return {}
    low = getattr(prop, "soft_min", None)
    high = getattr(prop, "soft_max", None)
    if low is None or high is None:
        return {}
    if not (math.isfinite(low) and math.isfinite(high)) or high <= low:
        return {}
    return {"softMin": float(low), "softMax": float(high)}


def _node_row(node):
    """One node, as the node editor draws it.

    `colorTag` is `Node.color_tag` (`rna_nodetree.cc:9480-9484`), which RNA
    reads from `bke::node_color_tag(*node)` -- the very value
    `node_get_colorid` (`node_draw.cc:1388-1434`) switches on to pick a header
    colour. So the header hue is a READ of the engine, not a table of ours.

    `panels` is `Node.panel_states` (`rna_nodetree.cc:9430-9434`): per panel,
    the declaration's `persistent_uid` and `is_collapsed`, and NOTHING ELSE --
    no label, and no way to ask which sockets belong to it. That membership
    lives in the node's C++ declaration, which `node_update_basis_from_
    declaration` (`node_draw.cc:1086-1218`) walks and bpy does not expose.
    Measured 2026-09-19 on Blender 5.2.0 in the tab: `ShaderNodeBsdfPrincipled`
    answers 8 panel states (uids 9, 11, 18, 25, 27, 33, 37, 40), all collapsed,
    and not one of its 32 `NodeSocket`s carries a panel field.

    RULED 2026-09-19: the MEMBERSHIP is traced from Blender's own `declare()`
    bodies instead, so what this door owes is the COLLAPSED STATE the trace
    cannot know -- per node, live, and changed under the person's hand. The
    states arrive IN ORDER, because Blender indexes `panel_states_array` by
    the declaration's panel INDEX (`node_draw.cc:1037`) and RNA's collection
    IS that array; the uid rides along so a disagreement is visible rather
    than silently mis-joined.

    THE TRACE IS THE CONSUMER'S, NOT THIS PACKAGE'S, and the split is the
    point: `@volter/editor-blender`'s `blender-node-panels.source.mjs` reads a Blender
    CHECKOUT at the engine's pin and writes `blender.node-panels.json` beside
    the view that draws with it. Nothing of it belongs here -- this package is
    the engine and its wire, and it answers what the RUNNING engine knows.

    `showOptions` is `Node.show_options` -> `NODE_OPTIONS`, the flag
    `add_flat_items_for_layout` (`node_draw.cc:739-746`) returns early on."""
    return {
        "name": node.name,
        "idname": node.bl_idname,
        "type": node.type,
        "typeLabel": node.bl_label,
        "label": node.label or None,
        "colorTag": getattr(node, "color_tag", "NONE"),
        # `Node.location` is the tree-space corner Blender lays out from
        # (`node_update_basis`: `dy = loc.y`, `node_draw.cc:1297`); `width` is
        # the value `NODE_WIDTH(node)` scales (`node_intern.hh:337`).
        "location": [float(node.location[0]), float(node.location[1])],
        "width": float(node.width),
        "collapsed": bool(node.hide),
        "muted": bool(node.mute),
        "selected": bool(node.select),
        "useCustomColor": bool(node.use_custom_color),
        "color": [float(channel) for channel in node.color],
        "parent": node.parent.name if node.parent is not None else None,
        # `NODE_DO_OUTPUT` through its one RNA spelling: `node_get_colorid`
        # gives an OUTPUT-class node the output colour only when it is the
        # active output (`node_draw.cc:1395-1401`).
        "activeOutput": bool(getattr(node, "is_active_output", False)),
        "panelCount": len(getattr(node, "panel_states", ())),
        "panels": [{"identifier": int(state.identifier),
                    "collapsed": bool(state.is_collapsed)}
                   for state in getattr(node, "panel_states", ())],
        "showOptions": bool(getattr(node, "show_options", True)),
        "inputs": [_node_socket(socket, index) for index, socket in enumerate(node.inputs)],
        "outputs": [_node_socket(socket, index) for index, socket in enumerate(node.outputs)],
    }


def _node_tree_of(path, material):
    """WHICH TREE. Either an explicit RNA address (so a `vgai eval` can open a
    world's or a group's tree with the engine's own spelling), or a material by
    name, or -- given neither -- the active object's active material, which is
    what Blender's own Shading header resolves (`space_node.py:89-93`,
    `template_ID(ob, "active_material")`)."""
    if path:
        return _rna_resolve(path), path, None
    if material:
        mat = bpy.data.materials.get(material)
        if mat is None:
            raise ValueError("The engine holds no material named %r" % (material,))
    else:
        obj = bpy.context.view_layer.objects.active
        mat = getattr(obj, "active_material", None) if obj is not None else None
    if mat is None:
        return None, None, None
    if not mat.use_nodes:
        return None, None, mat
    return mat.node_tree, '%s.node_tree' % (_rna_address(mat),), mat


def rna_node_tree(path=None, material=None):
    """ONE NODE TREE, as the node editor would draw it."""
    tree, tree_path, mat = _node_tree_of(path, material)
    if tree is None:
        # NOT AN ERROR. Blender's node editor with no tree draws its flat
        # `TH_BACK` clear and nothing else -- `node_draw_space`'s whole else
        # branch is one `draw_nodespace_back_pix` call with no text in it
        # (`node_draw.cc:4849-4853`) -- so "no tree" is a state, not a failure.
        return {
            "path": None,
            "material": mat.name if mat is not None else None,
            "useNodes": bool(mat.use_nodes) if mat is not None else None,
            "nodes": [],
            "links": [],
        }
    active = tree.nodes.active
    return {
        "path": tree_path,
        "type": tree.bl_idname,
        "typeLabel": tree.bl_label,
        "material": mat.name if mat is not None else None,
        "useNodes": True,
        "active": active.name if active is not None else None,
        "nodes": [_node_row(node) for node in tree.nodes],
        # A LINK NAMES ITS SOCKETS BY IDENTIFIER, not by index: a node's socket
        # list is stable under `enabled`, so the identifier is what survives a
        # node changing mode. `is_muted` is `NodeLink.is_muted`.
        "links": [{"fromNode": link.from_node.name,
                   "fromSocket": link.from_socket.identifier,
                   "toNode": link.to_node.name,
                   "toSocket": link.to_socket.identifier,
                   "muted": bool(link.is_muted),
                   "valid": bool(link.is_valid)}
                  for link in tree.links],
    }


def _uv_object_of(object_name):
    """WHOSE UVs. The named object, or -- given none -- the view layer's ACTIVE
    object, which is what Blender's UV editor draws
    (`MeshUVs::begin_sync` takes `state.object_mode` and the edit-mode object
    set; outside edit mode the active object is the only subject there is).
    A non-mesh active object is not an error: it is the empty state."""
    if object_name:
        obj = bpy.data.objects.get(object_name)
        if obj is None:
            raise ValueError("The engine holds no object named %r" % (object_name,))
    else:
        obj = bpy.context.view_layer.objects.active
    if obj is None or obj.type != "MESH":
        return None
    return obj


def rna_uv_layout(object_name=None, uv_layer=None):
    """ONE MESH'S UV LAYOUT, as Blender's UV editor would draw it.

    WHY A DOOR AND NOT THE GENERIC VIEW. `rna_view` answers a struct at a time
    and reports a collection as a COUNT, and a UV layout is
    `len(mesh.loops)` two-float corners plus a triangulation -- 8,008 corners
    over 31 meshes in `arena-weapons.blend`, measured 2026-09-19. The
    per-corner arrays therefore cross as BASE64 typed-array bytes, exactly as
    I4's weights do, and every scalar beside them is a `bl_rna` property the
    generic door also answers.

    WHAT IT IS NOT GATED ON. Blender draws UVs only when
    `space_mode_is_uv && object_mode_is_edit` (`overlay_mesh.hh:593`), and both
    halves of that are its UI layer's -- a space this engine has none of, and a
    mode an inspection surface does not enter (orchestrator ruling 1,
    2026-09-19: "inspection is not mode-gated"). So this reads the DATA in
    whatever mode the engine is in and reports `mode` beside it, and the view
    names the Blender mode the same picture would need.

    THE SELECTION FLAGS ARE REPORTED WHERE THE DATA CARRIES THEM, and at this
    pin an evaluated mesh usually carries none: `MeshUVLoopLayer`
    (`rna_mesh.cc:2380-2456`) declares `uv`, `pin`, `name`, `active`,
    `active_render` and `active_clone` -- and NO vertex or edge selection,
    because UV selection lives in the BMesh an edit-mode session holds. `pin`
    IS declared, so it is answered; everything else draws unselected, which is
    the second half of the same ruling.
    """
    obj = _uv_object_of(object_name)
    if obj is None:
        return {"object": None, "mesh": None, "layers": [], "active": None,
                "mode": bpy.context.mode, "loops": 0, "polygons": 0}
    mesh = obj.data
    layers = [layer.name for layer in mesh.uv_layers]
    if uv_layer:
        layer = mesh.uv_layers.get(uv_layer)
        if layer is None:
            raise ValueError("%r has no UV map named %r -- it has: %s"
                             % (obj.name, uv_layer, ", ".join(layers) or "none"))
    else:
        layer = mesh.uv_layers.active
    header = {
        "object": obj.name,
        "mesh": mesh.name,
        "path": _rna_address(mesh),
        "layers": layers,
        "active": layer.name if layer is not None else None,
        "mode": bpy.context.mode,
        "loops": len(mesh.loops),
        "polygons": len(mesh.polygons),
        "materials": [m.name if m else None for m in mesh.materials],
    }
    if layer is None:
        return header
    corners = len(mesh.loops)
    uvs = array.array("f", bytes(corners * 8))
    layer.uv.foreach_get("vector", uvs)
    # THE TRIANGULATION IS BLENDER'S OWN. `calc_loop_triangles` is what the
    # draw extraction uses, and `loop_triangles[i].loops` indexes the same
    # corner array the UVs came from -- so a triangle is three UVs with no
    # fan of ours in the middle. An n-gon's fan is Blender's, not a guess.
    mesh.calc_loop_triangles()
    tris = array.array("I", bytes(len(mesh.loop_triangles) * 12))
    mesh.loop_triangles.foreach_get("loops", tris)
    # THE FACE LOOPS, so an EDGE can be drawn. A polygon's corners are
    # contiguous (`loop_start` .. `loop_start + loop_total`), which is what
    # makes a face's UV outline a walk rather than a lookup.
    starts = array.array("I", bytes(len(mesh.polygons) * 4))
    totals = array.array("I", bytes(len(mesh.polygons) * 4))
    mesh.polygons.foreach_get("loop_start", starts)
    mesh.polygons.foreach_get("loop_total", totals)
    pins = None
    try:
        raw = array.array("b", bytes(corners))
        layer.pin.foreach_get("value", raw)
        if any(raw):
            pins = base64.b64encode(raw.tobytes()).decode("ascii")
    except Exception:  # noqa: BLE001
        pins = None
    us = uvs[0::2]
    vs = uvs[1::2]
    header.update({
        "uvBase64": base64.b64encode(uvs.tobytes()).decode("ascii"),
        "triangleBase64": base64.b64encode(tris.tobytes()).decode("ascii"),
        "loopStartBase64": base64.b64encode(starts.tobytes()).decode("ascii"),
        "loopTotalBase64": base64.b64encode(totals.tobytes()).decode("ascii"),
        "triangles": len(mesh.loop_triangles),
        "pinBase64": pins,
        # SELECTION, named rather than assumed: what the data carries.
        "selection": None,
        "bounds": [min(us), min(vs), max(us), max(vs)] if corners else [0.0, 0.0, 1.0, 1.0],
        # THE IMAGE BEHIND THE TILE is the active material's image texture, and
        # `buttons_texture.cc`'s own walk is the precedent for asking the node
        # tree rather than the material: `TEX_IMAGE` is where an image is.
        "image": _uv_backdrop_image(obj),
    })
    return header


def _uv_backdrop_image(obj):
    """THE IMAGE THE UV EDITOR WOULD SHOW BEHIND THE TILE, if any. Blender's
    own header resolves it from the space (`SpaceImage.image`) and the UV
    editor's auto-set picks the active material's active image texture node
    (`ED_space_image_auto_set`, `space_image.cc:60-101`). There is no
    `SpaceImage` here, so the second half is the whole rule: the active
    material's node tree's active `TEX_IMAGE`."""
    mat = getattr(obj, "active_material", None)
    if mat is None or not mat.use_nodes or mat.node_tree is None:
        return None
    nodes = [n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image is not None]
    if not nodes:
        return None
    node = mat.node_tree.nodes.active
    chosen = node if node in nodes else nodes[0]
    image = chosen.image
    return {"name": image.name, "width": image.size[0], "height": image.size[1],
            "source": image.source, "hasData": bool(image.has_data)}


# ------------------------------------------------------- the rig and its clip
#
# WE VISUALIZE WITH THREE.JS, NOT BLENDER (owner rule, 2026-09-20). Blender
# holds the animation as DATA; three.js PLAYS it. A Timeline that asked Blender
# to re-evaluate the depsgraph and re-export the columns once per frame would
# be the wrong architecture -- so these two doors hand the tab everything it
# needs to build a `THREE.SkinnedMesh` + `Skeleton` + `AnimationMixer` ONCE,
# and the scrub, the playback and the frame counter after that are three.js's
# with ZERO calls back into this process.
#
# WHAT THE BIND POSE IS, and why it is not the rest pose. The export door runs
# with `evaluate: True`, so the mesh columns the presenter already holds are
# the EVALUATED mesh -- the armature modifier included -- which means they are
# the deformed mesh at whatever frame Blender is sitting on. Binding a skeleton
# whose bones are in that SAME pose makes the skinning an identity there
# (`skinMatrix = sum(w_i * B_i * B_i^-1) = I`), so the picture at the bind
# frame is byte-for-byte the frame Blender presented, and every other frame is
# three.js's own evaluation of the same skin. That is what lets Blender's
# `frame_current` stand still for the whole of playback.


def _rig_armature_of(obj):
    """The armature that deforms this mesh, through `Object.find_armature()` --
    which is Blender's own answer (`BKE_modifiers_is_deformed_by_armature`
    plus the ARMATURE-parent case), not a modifier walk of ours."""
    if obj is None or obj.type != "MESH" or obj.data is None:
        return None
    return obj.find_armature()


def _pose_bones_parents_first(arm_obj):
    """Every pose bone, parents before children. `Object.pose.bones` is already
    in hierarchy order at this pin, but three.js's `Skeleton` is built by
    INDEX and a child whose parent has no index yet cannot be parented, so the
    order is made explicit rather than assumed."""
    order = []
    seen = set()

    def walk(pchan):
        if pchan.name in seen:
            return
        parent = pchan.parent
        if parent is not None:
            walk(parent)
        if pchan.name in seen:
            return
        seen.add(pchan.name)
        order.append(pchan)

    for pchan in arm_obj.pose.bones:
        walk(pchan)
    return order


def _matrix_rows(matrix):
    return [[float(v) for v in row] for row in matrix]


def rna_rig(object_name=None):
    """EVERY SKIN BINDING THE SCENE NEEDS -- or one named mesh's.

    A LIST, not a singleton, and that is what the PRESENTER's question is: a
    presented frame carries every object at once, and the presenter has to know
    which of its meshes are `THREE.SkinnedMesh`es before it builds them. Asking
    per object would be one round trip per mesh; asking by NAME stays available
    for a `vgai eval` that wants to read one.
    """
    scene_frame = int(bpy.context.scene.frame_current)
    if object_name:
        obj = bpy.data.objects.get(object_name)
        if obj is None:
            raise ValueError("The engine holds no object named %r" % (object_name,))
        subjects = [obj]
    else:
        subjects = [obj for obj in bpy.context.view_layer.objects
                    if obj.type == "MESH" and obj.data is not None
                    and obj.find_armature() is not None]
    return {"frame": scene_frame, "named": object_name,
            "rigs": [_rig_of(obj) for obj in subjects]}


def _rig_of(obj):
    """ONE MESH'S SKIN BINDING: the armature's bones, and up to four weighted
    bone influences per Blender vertex.

    WHY A DOOR AND NOT THE GENERIC VIEW, the same answer `rna_uv_layout` gives:
    `rna_view` reports a collection as a COUNT, and a skin binding is
    `len(mesh.vertices)` x 4 pairs -- 1,152 vertices is 4,608 of them on the
    smallest probe. They cross as base64 typed-array bytes, the shape I4's
    weights established: `skinIndexBase64` Uint16 (`vertices * 4`) and
    `skinWeightBase64` Float32 (`vertices * 4`), normalized so the four sum to
    one.

    THE INDICES ARE BLENDER VERTEX INDICES, not drawn-vertex ones. The draw
    splits a Blender vertex into as many drawn vertices as its corners need,
    and `DrawArrays.sourceVertex` is the map -- so the presenter EXPANDS these
    arrays through it (`blender-runtime-skin.ts`), exactly as I4's weight
    overlay expands its ramp.

    TWO MATRICES PER BONE, both in the armature OBJECT's space and row-major as
    four rows: `rest` is `Bone.matrix_local` (the armature's rest pose, what
    `pose.bones[...]` is measured against) and `pose` is `PoseBone.matrix` --
    `pchan->pose_mat`, the SAME matrix I4's bone overlay draws. `pose` is the
    BIND pose, because it is the pose the exported columns were evaluated at.
    """
    if obj is None or obj.type != "MESH" or obj.data is None:
        return {"object": obj.name if obj is not None else None, "armature": None,
                "bones": [], "vertexCount": 0,
                "reason": "Only a mesh object carries a skin binding."}
    mesh = obj.data
    arm_obj = _rig_armature_of(obj)
    header = {
        "object": obj.name,
        "mesh": mesh.name,
        "vertexCount": len(mesh.vertices),
        "frame": int(bpy.context.scene.frame_current),
        "mode": bpy.context.mode,
    }
    if arm_obj is None:
        header.update({"armature": None, "bones": [],
                       "reason": "%r is deformed by no armature -- `Object.find_armature()` "
                                 "answers none, so it presents as an ordinary Mesh." % (obj.name,)})
        return header
    order = _pose_bones_parents_first(arm_obj)
    index_of = {pchan.name: i for i, pchan in enumerate(order)}
    header.update({
        "armature": arm_obj.name,
        "armatureData": arm_obj.data.name,
        # THE CONSTRAINT COUNT IS REPORTED because the CLIP is derived from the
        # F-Curves alone (`rna_action_clip`) while this bind pose is read live
        # off `PoseBone.matrix`. For a constraint-free rig the two agree by
        # construction; a constrained bone's pose is Blender's solver's and the
        # clip cannot reproduce it, so the view says so rather than drifting.
        "constrainedBones": sorted(p.name for p in order if len(p.constraints)),
        "bones": [{
            "name": pchan.name,
            "parent": pchan.parent.name if pchan.parent is not None else None,
            "rest": _matrix_rows(pchan.bone.matrix_local),
            "pose": _matrix_rows(pchan.matrix),
            "length": float(pchan.bone.length),
            "deform": bool(pchan.bone.use_deform),
            "connected": bool(pchan.bone.use_connect),
        } for pchan in order],
    })
    group_to_bone = {}
    unmapped = []
    for group in obj.vertex_groups:
        bone = index_of.get(group.name)
        if bone is None:
            unmapped.append(group.name)
        else:
            group_to_bone[int(group.index)] = bone
    count = len(mesh.vertices)
    # FOUR INFLUENCES, which is three.js's `skinIndex`/`skinWeight` shape and
    # also glTF's; a vertex with more is truncated to its four heaviest and
    # RENORMALIZED, and the count of such vertices is reported rather than
    # quietly dropped.
    indices = array.array("H", bytes(count * 8))
    weights = array.array("f", bytes(count * 16))
    truncated = 0
    unweighted = 0
    most = 0
    for i, vertex in enumerate(mesh.vertices):
        pairs = []
        for element in vertex.groups:
            bone = group_to_bone.get(int(element.group))
            if bone is None:
                continue
            value = float(element.weight)
            if value > 0.0:
                pairs.append((value, bone))
        most = max(most, len(pairs))
        if len(pairs) > 4:
            truncated += 1
            pairs.sort(reverse=True)
            pairs = pairs[:4]
        total = sum(value for value, _ in pairs)
        if total <= 0.0:
            unweighted += 1
            continue
        for slot, (value, bone) in enumerate(pairs):
            indices[i * 4 + slot] = bone
            weights[i * 4 + slot] = value / total
    header.update({
        "skinIndexBase64": base64.b64encode(indices.tobytes()).decode("ascii"),
        "skinWeightBase64": base64.b64encode(weights.tobytes()).decode("ascii"),
        "maxInfluences": most,
        "truncatedVertices": truncated,
        "unweightedVertices": unweighted,
        "unmappedGroups": unmapped,
    })
    return header


def _action_channelbag(action, slot_handle):
    """THE LAYERED ACTION'S F-CURVES. At this pin an `Action` HAS NO
    `.fcurves` -- measured 2026-09-19 and again here: `hasattr(action,
    'fcurves')` is False. They live at
    `action.layers[i].strips[j].channelbags[k].fcurves`, and WHICH channelbag
    is decided by the SLOT the animated object uses
    (`Object.animation_data.action_slot`). The legacy attribute is still read
    first for a build where it exists, which is the same two-branch shape the
    rest of this file uses for a moved API."""
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        return list(legacy), "legacy"
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            for bag in (getattr(strip, "channelbags", None) or ()):
                if slot_handle is None or int(getattr(bag, "slot_handle", -1)) == int(slot_handle):
                    return list(bag.fcurves), "layered"
    return [], "none"


_BONE_PATH = re.compile(r'^pose\.bones\["(.+)"\]\.(location|rotation_quaternion|'
                        r'rotation_euler|rotation_axis_angle|scale)$')


def _key_columns(curves):
    """THE SUMMARY ROW'S COLUMNS for one set of F-Curves: the union of every
    curve's key frames, which is what `summary_to_keylist`
    (`keyframes_keylist.cc:1019`) merges. Each column carries its TYPE
    (`Keyframe.type`, the shape's size multiplier, `keyframes_draw.cc:62-85`)
    and whether any contributing key is selected (`ActKeyColumn.sel`) --
    Blender's two colour axes for a diamond."""
    columns = {}
    for fcurve in curves:
        for key in fcurve.keyframe_points:
            frame = round(float(key.co[0]), 4)
            record = columns.setdefault(frame, {"frame": frame, "type": key.type, "select": False})
            record["select"] = record["select"] or bool(key.select_control_point)
            # EXTREME wins over KEYFRAME the way Blender's own merge does:
            # `nupdate_ak_bezt` keeps the "most significant" type
            # (`keyframes_keylist.cc`, `KEYFRAME_STATE` ordering).
            if _KEY_TYPE_RANK.get(key.type, 0) > _KEY_TYPE_RANK.get(record["type"], 0):
                record["type"] = key.type
    return columns


def _summary_objects():
    """EVERY ANIMATED OBJECT IN THE VIEW LAYER, with its own key columns and
    whether it is SELECTED -- which is the whole of what a Timeline's
    `show_keys_from_selected_only` filter decides between.

    Blender's Timeline takes its only-selected flag from the SCENE
    (`ac->scene->flag & SCE_KEYS_NO_SELONLY`, `anim_filter.cc:254-270`) rather
    than from the dope sheet, and the test it then applies per object is
    `(ADS_FILTER_ONLYSEL) && !(base.flag & BASE_SELECTED) -> skip`
    (`anim_filter.cc:2307`). `Object.select_get()` is that base flag through
    RNA.

    THE DOOR REPORTS, THE VIEW DECIDES. Which side of the filter a Timeline is
    on is VIEW state (a headless Blender has no `SpaceDopeSheet`, and no scene
    flag we would be entitled to write), so this ships BOTH halves -- every
    animated object's columns and its selection -- and the view draws the union
    it wants. One round trip either way.
    """
    out = []
    for obj in bpy.context.view_layer.objects:
        adt = getattr(obj, "animation_data", None)
        action = getattr(adt, "action", None) if adt is not None else None
        if action is None:
            continue
        slot = getattr(adt, "action_slot", None)
        curves, _shape = _action_channelbag(action, getattr(slot, "handle", None))
        columns = _key_columns(curves)
        out.append({
            "object": obj.name,
            "action": action.name,
            "selected": bool(obj.select_get()),
            "keyframes": [columns[frame] for frame in sorted(columns)],
        })
    return out


def rna_action_clip(object_name=None, bake=True):
    """ONE ACTION AS A THREE.JS CLIP: per bone, the LOCAL transform it has at
    every integer frame of the action's own range.

    WHAT CROSSES, and why it is a BAKE rather than the raw keys. Blender's
    channels are `PoseBone.location/rotation_*/scale` in the bone's own REST
    space (`pchan->chan_mat`), while three.js's `Bone` carries a LOCAL
    transform relative to its PARENT BONE. The relation is
    `local = (parent.matrix_local^-1 @ bone.matrix_local) @ basis`, so no
    per-channel re-labelling can turn one into the other -- the matrices have
    to be composed. Composing them per KEY would then also have to reproduce
    Blender's Bezier handles between keys, so the honest, one-code-path answer
    is to SAMPLE at every integer frame and ship LINEAR tracks: exact at every
    frame a Timeline can scrub to, linear in between, and stated as the
    justified difference rather than implied.

    THE FRAME IS NEVER MOVED to do it. `FCurve.evaluate(frame)` reads the curve
    without touching `scene.frame_current` or the depsgraph, which is what
    makes this door cheap and what keeps bpy's own frame where the person left
    it.

    A CONSTANT TRACK IS TWO KEYS. A rig's channels are overwhelmingly still --
    an untouched bone contributes three tracks of identical samples -- so a
    track whose every sample equals its first is shipped as its first and last
    only. Measured on the probe below.
    """
    if object_name:
        obj = bpy.data.objects.get(object_name)
        if obj is None:
            raise ValueError("The engine holds no object named %r" % (object_name,))
    else:
        obj = bpy.context.view_layer.objects.active
    arm_obj = obj if (obj is not None and obj.type == "ARMATURE") else _rig_armature_of(obj)
    if arm_obj is None:
        # THE ACTIVE OBJECT NEED NOT BE THE ANIMATED ONE, and Blender's own
        # Timeline says so: its summary row is the DOPE SHEET's filtered set,
        # which is every selected object's animation. With nothing rigged
        # selected, the one armature in the view layer is the honest subject
        # and there is no guessing to do when there is exactly one.
        rigged = [one for one in bpy.context.view_layer.objects
                  if one.type == "ARMATURE" and one.animation_data is not None
                  and one.animation_data.action is not None]
        if len(rigged) == 1:
            arm_obj = rigged[0]
    scene = bpy.context.scene
    fps = float(scene.render.fps) / float(scene.render.fps_base or 1.0)
    header = {
        "object": obj.name if obj is not None else None,
        "armature": arm_obj.name if arm_obj is not None else None,
        # THE SCENE'S NAME, because the ONE write the Timeline makes
        # (`scene.frame_current`, on pause and at scrub-end) goes through
        # `rna_set`, and an RNA path there is the engine's own address: it
        # starts at `bpy.data.` and `bpy.context.scene` is refused by name.
        "scene": scene.name,
        "frameCurrent": int(scene.frame_current),
        "frameStart": int(scene.frame_start),
        "frameEnd": int(scene.frame_end),
        "fps": fps,
        "action": None,
        "slot": None,
        "tracks": [],
        "keyframes": [],
        # EVERY ANIMATED OBJECT AND ITS SELECTION, unconditionally -- the
        # Timeline's summary row is filtered by SELECTION in Blender
        # (`show_keys_from_selected_only`) and the view is what decides which
        # side of that filter it is on, so the door answers both halves even
        # when the subject below turns out to be nothing at all.
        "summary": _summary_objects(),
    }
    if arm_obj is None or arm_obj.animation_data is None or arm_obj.animation_data.action is None:
        header["reason"] = ("Nothing here carries an action: the Timeline draws the scene range "
                            "and an empty summary row, which is Blender's own empty state.")
        return header
    adt = arm_obj.animation_data
    action = adt.action
    slot = getattr(adt, "action_slot", None)
    curves, shape = _action_channelbag(action, getattr(slot, "handle", None))
    header.update({
        "action": action.name,
        "slot": getattr(slot, "name_display", None),
        "channels": shape,
        "fcurves": len(curves),
        "keys": sum(len(fc.keyframe_points) for fc in curves),
    })
    if not curves:
        header["reason"] = ("%r holds no F-Curves for this object's slot, so there is nothing to "
                            "play." % (action.name,))
        return header
    columns = _key_columns(curves)
    header["keyframes"] = [columns[frame] for frame in sorted(columns)]
    if not bake:
        return header
    frames = sorted(columns)
    first = int(math.floor(frames[0]))
    last = int(math.ceil(frames[-1]))
    if last <= first:
        last = first + 1
    header["clipStart"] = first
    header["clipEnd"] = last
    channels = {}
    for fcurve in curves:
        match = _BONE_PATH.match(fcurve.data_path)
        if match is None:
            continue
        bone, prop = match.group(1), match.group(2)
        channels.setdefault((bone, prop), {})[int(fcurve.array_index)] = fcurve
    if not channels:
        header["reason"] = ("%r animates no pose bone -- every F-Curve is on a data path this "
                            "door does not play (object transform, shape keys, a material). The "
                            "Timeline still draws its keys." % (action.name,))
        return header
    rest_relative = {}
    for pchan in _pose_bones_parents_first(arm_obj):
        local = pchan.bone.matrix_local
        parent = pchan.parent
        rest_relative[pchan.name] = (parent.bone.matrix_local.inverted_safe() @ local
                                     if parent is not None else local.copy())
    times = [(frame - first) / fps for frame in range(first, last + 1)]
    tracks = []
    unplayed = []
    for bone in sorted({name for name, _ in channels}):
        pchan = arm_obj.pose.bones.get(bone)
        if pchan is None:
            unplayed.append(bone)
            continue
        rest = rest_relative[bone]
        rotation_mode = pchan.rotation_mode
        positions, quaternions, scales = [], [], []
        previous = None
        for frame in range(first, last + 1):
            location = _sample(channels.get((bone, "location")), pchan.location, frame)
            scale = _sample(channels.get((bone, "scale")), pchan.scale, frame, default=1.0)
            if rotation_mode == "QUATERNION":
                quat = mathutils.Quaternion(
                    _sample(channels.get((bone, "rotation_quaternion")),
                            pchan.rotation_quaternion, frame, size=4, default=None,
                            identity=(1.0, 0.0, 0.0, 0.0)))
            elif rotation_mode == "AXIS_ANGLE":
                raw = _sample(channels.get((bone, "rotation_axis_angle")),
                              pchan.rotation_axis_angle, frame, size=4, default=None,
                              identity=(0.0, 0.0, 1.0, 0.0))
                quat = mathutils.Quaternion(raw[1:4], raw[0])
            else:
                quat = mathutils.Euler(
                    _sample(channels.get((bone, "rotation_euler")), pchan.rotation_euler, frame),
                    rotation_mode).to_quaternion()
            basis = mathutils.Matrix.LocRotScale(mathutils.Vector(location), quat,
                                                 mathutils.Vector(scale))
            position, rotation, scaling = (rest @ basis).decompose()
            # QUATERNION CONTINUITY, and it is not cosmetic: three's
            # `QuaternionLinearInterpolant` takes the shorter arc between
            # NEIGHBOURING samples, so one sign flip in the middle of a bake
            # spins the bone the long way round for a frame.
            if previous is not None and rotation.dot(previous) < 0.0:
                rotation.negate()
            previous = rotation.copy()
            positions.extend((position.x, position.y, position.z))
            quaternions.extend((rotation.x, rotation.y, rotation.z, rotation.w))
            scales.extend((scaling.x, scaling.y, scaling.z))
        tracks.extend(_track(bone, "position", times, positions, 3))
        tracks.extend(_track(bone, "quaternion", times, quaternions, 4))
        tracks.extend(_track(bone, "scale", times, scales, 3))
    header.update({
        "tracks": tracks,
        "duration": (last - first) / fps,
        "sampled": len(times),
        "unplayedBones": unplayed,
    })
    return header


# `Keyframe.type`'s significance order, mirrored from the `KEYFRAME_STATE`
# merge in `keyframes_keylist.cc` -- a column drawn from several curves takes
# the most significant type any of them carries.
_KEY_TYPE_RANK = {"JITTER": 1, "GENERATED": 2, "MOVING_HOLD": 3, "BREAKDOWN": 4,
                  "KEYFRAME": 5, "EXTREME": 6}


def _sample(group, current, frame, size=3, default=0.0, identity=None):
    """One channel's value at `frame`: each component's own F-Curve where there
    is one, and the pose channel's CURRENT value where there is not -- which is
    what Blender does too (an unkeyed component simply keeps its value)."""
    fallback = list(identity) if identity is not None else [
        (current[i] if current is not None and i < len(current) else default) for i in range(size)]
    if identity is not None and current is not None and group is not None:
        fallback = [float(v) for v in current]
    if group is None:
        return fallback
    out = list(fallback)
    for index, fcurve in group.items():
        if 0 <= index < len(out):
            out[index] = float(fcurve.evaluate(frame))
    return out


def _track(bone, prop, times, values, stride):
    """One three.js keyframe track, or two keys when nothing moves.

    The arrays cross as base64 Float32 (`timeBase64`, `valueBase64`), the shape
    every large payload in this file takes."""
    count = len(times)
    constant = True
    for i in range(1, count):
        for c in range(stride):
            if abs(values[i * stride + c] - values[c]) > 1e-6:
                constant = False
                break
        if not constant:
            break
    if constant:
        if count == 0:
            return []
        times = [times[0], times[-1]]
        values = values[0:stride] * 2
    return [{
        "bone": bone,
        "property": prop,
        "stride": stride,
        "count": len(times),
        "constant": constant,
        "timeBase64": base64.b64encode(array.array("f", times).tobytes()).decode("ascii"),
        "valueBase64": base64.b64encode(array.array("f", values).tobytes()).decode("ascii"),
    }]


def rna_outliner(selected=None):
    """BLENDER'S VIEW LAYER TREE for the session's scene.

    `TreeDisplayViewLayer::build_tree` under the default filters: one Scene
    Collection row, the view layer's layer collections nested under it, each
    collection's objects, and then the object parent hierarchy folded in
    (`add_view_layer`, `add_layer_collections_recursive`,
    `add_layer_collection_objects`, `ObjectsChildrenBuilder`).

    `selected` is the CALLER'S selection -- our viewport's, by object name --
    for the same reason `rna_context` takes the object it is looking at:
    reading a selection must never WRITE the engine's, which is a mutation the
    document would save."""
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    scene_path = _rna_address(scene)
    view_layer_path = '%s.view_layers["%s"]' % (
        scene_path, bpy.utils.escape_identifier(view_layer.name))
    root = view_layer.layer_collection
    chosen = set(selected or ())
    engine_active = view_layer.objects.active
    active = engine_active.name if engine_active is not None else None
    seen = {}
    # Every object row, with the row it sits under and the COLLECTION row it
    # belongs to -- what `ObjectsChildrenBuilder`'s map holds, and what the
    # parent walk below moves.
    placements = {}

    def place(obj, row, collection_row):
        placements.setdefault(obj.name, []).append([row, collection_row, collection_row])

    def collection_row(lc, path):
        collection = lc.collection
        row = _outliner_row(
            path, collection.name, "TSE_LAYER_COLLECTION", "OUTLINER_COLLECTION", seen,
            data=_rna_address(collection),
            # Open at rest: `tree_display_view_layer.cc:167` clears TSE_CLOSED
            # for every editable layer collection.
            expanded=True,
            # `outliner_draw_restrictbuts`' collection block
            # (`outliner_draw.cc:1620-1700`): EXCLUDE and the eye come off the
            # LAYER collection, the render camera off the collection itself.
            restrict={"exclude": bool(lc.exclude), "hide": bool(lc.hide_viewport),
                      "render": bool(collection.hide_render)})
        children = [collection_row(child,
                                   _outliner_key("%s.children" % path, child.collection.name))
                    for child in lc.children]
        # `add_layer_collections_recursive`: an EXCLUDED collection's objects
        # are not added at all -- it is not in the view layer.
        if not lc.exclude:
            page, more = _outliner_page(collection.objects)
            for obj in page:
                object_row = _outliner_object(obj, view_layer, seen, chosen, active)
                place(obj, object_row, row)
                children.append(object_row)
            if more:
                row["more"] = more
        row["children"] = children
        return row

    scene_collection = _outliner_row(
        "%s.collection" % scene_path, "Scene Collection", "TSE_VIEW_COLLECTION_BASE",
        "OUTLINER_COLLECTION", seen,
        # `tree_display_view_layer.cc:130` clears TSE_CLOSED unconditionally.
        expanded=True)
    children = [collection_row(child,
                               _outliner_key("%s.layer_collection.children" % view_layer_path,
                                             child.collection.name))
                for child in root.children]
    page, more = _outliner_page(root.collection.objects)
    for obj in page:
        object_row = _outliner_object(obj, view_layer, seen, chosen, active)
        place(obj, object_row, scene_collection)
        children.append(object_row)
    if more:
        scene_collection["more"] = more
    scene_collection["children"] = children

    # `ObjectsChildrenBuilder::make_object_parent_hierarchy_collections`, parents
    # before children: a child object is MOVED out of its collection's row and
    # under its parent's when both are in that same collection; when they are
    # not, Blender adds the child under the parent ANYWAY and leaves it
    # unexpanded (`TE_CHILD_NOT_IN_COLLECTION`, whose row also draws no restrict
    # columns at all -- `outliner_draw.cc:1282-1286`).
    ordered = []
    placed = set()

    def order(obj):
        if obj.parent is not None:
            order(obj.parent)
        if obj.name not in placed:
            placed.add(obj.name)
            ordered.append(obj)

    for name in list(placements):
        order(bpy.data.objects[name])
    for obj in ordered:
        if obj.parent is None:
            continue
        parents = placements.get(obj.parent.name)
        mine = placements.get(obj.name)
        if not parents or not mine:
            continue
        for parent_row, _parent_owner, parent_collection in parents:
            moved = False
            for entry in mine:
                row, owner, _collection = entry
                if owner is not parent_collection:
                    continue
                owner["children"].remove(row)
                parent_row["children"].append(row)
                entry[1] = parent_row
                moved = True
                break
            if moved:
                continue
            duplicate = _outliner_row(
                _rna_address(obj), obj.name, "TSE_SOME_ID", _outliner_object_icon(obj), seen,
                struct="Object", objectType=obj.type, object=obj.name,
                selected=obj.name in chosen, active=obj.name == active, notInCollection=True)
            parent_row["children"].append(duplicate)
            mine.append([duplicate, parent_row, parent_collection])

    return {
        "scene": scene_path,
        "viewLayer": view_layer_path,
        # `context.mode` is what a `poll` tests; `Object.mode` is what the
        # Outliner's own pose rows key on. Both, because the Outliner needs the
        # object's and the rest of the editor needs the context's.
        "mode": bpy.context.mode,
        "objectMode": engine_active.mode if engine_active is not None else None,
        "active": active,
        "rows": [scene_collection],
    }


def outliner_set(path, column, value):
    """ONE RESTRICTION COLUMN, written.

    Not `rna_set`, and for one reason: the EYE on an object row is the view
    layer BASE's `hide_viewport` (`outliner_draw.cc:1291-1317`), and a `Base` is
    not a datablock `bpy.data` can address -- Blender's own Python door onto
    exactly that flag is `Object.hide_get()/hide_set()`. Every other column IS
    an ordinary RNA property, and the table below is
    `outliner_draw_restrictbuts`' own `props` struct (`:1182-1206`) row for row.
    A column Blender does not draw on this row type is refused BY NAME rather
    than written somewhere near it."""
    target = _rna_resolve(path)
    value = bool(value)
    if isinstance(target, bpy.types.Object):
        if column == "hide":
            target.hide_set(value, view_layer=bpy.context.view_layer)
            HISTORY.changed()
            return {"path": path, "column": column, "value": bool(target.hide_get())}
        if column == "render":
            target.hide_render = value
            HISTORY.changed()
            return {"path": path, "column": column, "value": bool(target.hide_render)}
        if column == "viewport":
            target.hide_viewport = value
            HISTORY.changed()
            return {"path": path, "column": column, "value": bool(target.hide_viewport)}
    if isinstance(target, bpy.types.LayerCollection):
        if column in ("exclude", "hide"):
            member = "exclude" if column == "exclude" else "hide_viewport"
            setattr(target, member, value)
            HISTORY.changed()
            return {"path": path, "column": column, "value": bool(getattr(target, member))}
        if column == "render":
            target.collection.hide_render = value
            HISTORY.changed()
            return {"path": path, "column": column, "value": bool(target.collection.hide_render)}
    if isinstance(target, bpy.types.Modifier):
        member = {"render": "show_render", "viewport": "show_viewport"}.get(column)
        if member is not None:
            setattr(target, member, not value)
            HISTORY.changed()
            return {"path": path, "column": column, "value": not getattr(target, member)}
    if isinstance(target, bpy.types.Constraint) and column == "hide":
        target.enabled = not value
        HISTORY.changed()
        return {"path": path, "column": column, "value": not target.enabled}
    raise ValueError(
        "Blender's Outliner draws no %r column on a %s, so nothing was written -- the columns "
        "it draws per row type are `outliner_draw_restrictbuts`' own (%s)."
        % (column, target.bl_rna.identifier, path))


def dispatch(request):
    op = request.get("op")
    if op == "history-begin":
        HISTORY.begin()
        HISTORY.group_depth += 1
        return None
    if op == "history-end":
        if HISTORY.group_depth == 0:
            raise RuntimeError("No Blender gesture is open")
        HISTORY.group_depth -= 1
        if HISTORY.group_depth == 0 and HISTORY.group_label:
            label, HISTORY.group_label = HISTORY.group_label, None
            HISTORY.commit(label)
        return None
    if op == "history-events":
        events, HISTORY.events = HISTORY.events, []
        return events
    if op == "history-step":
        if request["direction"] not in ("undo", "redo"):
            raise ValueError("Unknown history direction")
        return HISTORY.move(request["token"], request["direction"])
    mutation = op in ("execute", "rna-set", "outliner-set") and request.get("history", True)
    if not mutation:
        return _dispatch(request)
    HISTORY.begin()
    before = HISTORY.mutation_serial
    epoch = HISTORY.epoch
    try:
        return _dispatch(request)
    finally:
        # Loading a file resets Blender's native stack. Its final state cannot
        # serve as both the before and after of an invented undo checkpoint.
        if HISTORY.epoch == epoch and HISTORY.mutation_serial != before:
            HISTORY.commit(request.get("label") or {
                "execute": "Blender Python", "rna-set": "Set " + request.get("property", "property"),
                "outliner-set": "Set " + request.get("column", "visibility"),
            }[op])


def _dispatch(request):
    op = request.get("op")
    if op == "execute":
        engine = bpy.context.scene.render.engine
        if engine in UNAVAILABLE_ENGINES and "render.render" in request["code"]:
            return {"executed": False, "result": "",
                    "error": "RenderEngineUnavailable: %s is compiled into this Blender build and "
                             "cannot be replaced by the three.js engine, so it has no renderer "
                             "here. Set scene.render.engine to one of %s."
                             % (engine, ", ".join(ENGINES))}
        absent = _absent_capability(request["code"])
        if absent is not None:
            return {"executed": False, "result": "", "error": absent}
        # Arbitrary Python can partially mutate before throwing. Once execution
        # starts it needs a checkpoint; capability refusals above do not.
        HISTORY.changed()
        answer = execute(request["code"])
        # Every mutation is presented, the rule: the Model
        # document is what the agent is looking at.
        try:
            SESSION.present()
        except Exception as thrown:  # noqa: BLE001
            # LOUD, because a present that fails leaves the Model document
            # showing the state BEFORE this call and nothing else says so.
            # `@@VGAI-PRESENT-FAILED` was not one of the prefixes the engines
            # escalate (`blender-emscripten-engine.mts:159`,
            # `blender-wali-engine.mts:266` raise `@@VGAI-WARN`/`@@VGAI-ERROR`
            # to the console and nothing else), so it logged at `log` level and
            # reached no counter -- measured 2026-09-19 (I4), when a throw in
            # the overlay walk froze the viewport through a dozen successful
            # `blender-execute` calls with `vgai console` silent throughout.
            _say("@@VGAI-ERROR the present after this call failed, so the Model document is "
                 "showing the state before it: " + repr(thrown))
        return answer
    if op == "scene-info":
        return get_scene_info()
    if op == "object-info":
        return get_object_info(request["name"])
    if op == "present":
        SESSION.present(request.get("capture"))
        return {"presented": True, "revision": SESSION.revision,
                "shipped": SESSION.last_shipped,
                # What the presenter itself said it was holding before this
                # frame -- the other side of `shipped`, and the only reading
                # that distinguishes "the tab has it" from "we sent it once".
                "presenterHeld": SESSION.presenter_held}
    if op == "rna":
        return rna_view(request["path"], request.get("names", _RNA_COLLECTION_NAMES))
    if op == "rna-context":
        return rna_context(request.get("object"), request.get("collection"))
    if op == "node-tree":
        return rna_node_tree(request.get("path"), request.get("material"))
    if op == "uv-layout":
        return rna_uv_layout(request.get("object"), request.get("uvLayer"))
    # THE RIG AND CLIP DOORS (the Timeline): both READS, so neither presents
    # and neither owes a derivation. There is deliberately no writer beside
    # them -- keying, moving a key and setting a range are edits.
    if op == "rig":
        return rna_rig(request.get("object"))
    if op == "action-clip":
        return rna_action_clip(request.get("object"), request.get("bake", True))
    if op == "outliner":
        return rna_outliner(request.get("selected"))
    if op == "outliner-set":
        answer = outliner_set(request["path"], request["column"], request["value"])
        # A COLUMN IS A WRITE, and a write presents -- the same rule `rna-set`
        # follows: hiding an object in the Outliner must change what the
        # viewport shows in the same gesture.
        try:
            SESSION.present()
        except Exception as thrown:  # noqa: BLE001
            # LOUD, because a present that fails leaves the Model document
            # showing the state BEFORE this call and nothing else says so.
            # `@@VGAI-PRESENT-FAILED` was not one of the prefixes the engines
            # escalate (`blender-emscripten-engine.mts:159`,
            # `blender-wali-engine.mts:266` raise `@@VGAI-WARN`/`@@VGAI-ERROR`
            # to the console and nothing else), so it logged at `log` level and
            # reached no counter -- measured 2026-09-19 (I4), when a throw in
            # the overlay walk froze the viewport through a dozen successful
            # `blender-execute` calls with `vgai console` silent throughout.
            _say("@@VGAI-ERROR the present after this call failed, so the Model document is "
                 "showing the state before it: " + repr(thrown))
        return answer
    if op == "rna-set":
        answer = rna_set(request["path"], request["property"], request["value"],
                         request.get("index"))
        # A WRITE IS PRESENTED, exactly as `execute` presents: the Model
        # document is what the person is looking at while they drag the field.
        try:
            SESSION.present()
        except Exception as thrown:  # noqa: BLE001
            # LOUD, because a present that fails leaves the Model document
            # showing the state BEFORE this call and nothing else says so.
            # `@@VGAI-PRESENT-FAILED` was not one of the prefixes the engines
            # escalate (`blender-emscripten-engine.mts:159`,
            # `blender-wali-engine.mts:266` raise `@@VGAI-WARN`/`@@VGAI-ERROR`
            # to the console and nothing else), so it logged at `log` level and
            # reached no counter -- measured 2026-09-19 (I4), when a throw in
            # the overlay walk froze the viewport through a dozen successful
            # `blender-execute` calls with `vgai console` silent throughout.
            _say("@@VGAI-ERROR the present after this call failed, so the Model document is "
                 "showing the state before it: " + repr(thrown))
        return answer
    if op == "save-document":
        return SESSION.save_document()
    if op == "start":
        SESSION.project = request.get("project", SESSION.project)
        try:
            os.chdir(SESSION.project)
        except OSError:
            pass
        answer = {"session": SESSION.session, "python": sys.version,
                  "blender": bpy.app.version_string, "engines": ENGINES,
                  "unavailableEngines": UNAVAILABLE_ENGINES}
        document = request.get("document")
        if document:
            answer.update(SESSION.bind_document(document))
        return answer
    raise ValueError("Unknown session op %r" % (op,))


# ---------------------------------------------------------------- the loop

_prepare_directories()
bpy.app.handlers.load_post.append(_load_post)
bpy.app.handlers.undo_post.append(_history_post)
bpy.app.handlers.redo_post.append(_history_post)
ENGINES, UNAVAILABLE_ENGINES = _register_engine()
_say("@@VGAI-READY " + json.dumps({"blender": bpy.app.version_string, "engines": ENGINES,
                                   "unavailableEngines": UNAVAILABLE_ENGINES}))

# Markers already dispatched, and the answers whose `out/` files this loop
# still owes a cleanup. Both are pruned as the page acks, so neither grows
# with the session.
def _channel_loop():
    """Serve the directory channel until the program ends.

    A FUNCTION SO ITS DEATH HAS A NAME. Everything here below the per-request
    `try` is the CHANNEL itself, and an exception in it used to fall off the
    end of this script: Blender then finishes `--python` and exits 0 through
    its ordinary path, so the page is told "Blender exited 0" and nothing
    anywhere says why. MEASURED 2026-09-19 -- from outside, a channel death is
    indistinguishable from a clean shutdown, and the traceback goes to stderr,
    which is page output rather than a console condition. The caller below
    makes it one.
    """
    # Markers already dispatched, and the answers whose `out/` files this loop
    # still owes a cleanup. Both are pruned as the page acks, so neither grows
    # with the session.
    seen = set()
    unacked = []
    while True:
        # A FAILED LISTING IS NOT AN EMPTY ONE. This swallowed every OSError
        # into "no requests", so the one failure that matters -- the process
        # out of file descriptors -- turned the session DEAF: it kept looping
        # at full speed, answered nothing ever again, and the page waited on a
        # call with a live program and no error anywhere (measured
        # 2026-09-19, 1,008 s). The directory is the page's and is made before
        # the program starts, so its absence is the only benign reading;
        # anything else is named and ends the loop through the guard below.
        try:
            markers = set(n for n in os.listdir(IN)
                          if n.endswith(".done") and n[: -len(".done")].isdigit())
        except FileNotFoundError:
            markers = set()
        # THE PAGE'S ACK IS ITS OWN REQUEST FILE BEING GONE: it unlinks
        # `in/<id>.done` only after reading `out/<id>.json`, so anything
        # missing from this listing has been taken and the answer is ours to
        # remove. This is the whole of the page's former four-unlink cleanup,
        # moved to the side that wrote the files (see the header's ownership
        # table).
        if unacked:
            still_owed = []
            for rid in unacked:
                if rid + ".done" in markers:
                    still_owed.append(rid)
                    continue
                _drop(os.path.join(OUT, rid + ".done"))
                _drop(os.path.join(OUT, rid + ".json"))
                seen.discard(rid + ".done")
            unacked = still_owed
        # Numerically, not lexicographically: "10.done" sorts before "2.done"
        # as a string, and a request answered out of order is a wrong answer.
        names = sorted((n for n in markers if n not in seen),
                       key=lambda n: int(n[: -len(".done")]))
        if not names:
            time.sleep(0.002)
            continue
        for marker in names:
            seen.add(marker)
            rid = marker[: -len(".done")]
            body = {"id": rid}
            try:
                with open(os.path.join(IN, rid + ".json")) as fh:
                    request = json.loads(fh.read())
                body["result"] = dispatch(request)
            except BaseException as thrown:  # noqa: BLE001
                body["error"] = "%s: %s" % (type(thrown).__name__, thrown)
                traceback.print_exc(file=_real_stderr)
            with open(os.path.join(OUT, rid + ".json"), "w") as fh:
                fh.write(json.dumps(body))
            with open(os.path.join(OUT, rid + ".done"), "w") as fh:
                fh.write("1")
            unacked.append(rid)


try:
    _channel_loop()
except BaseException as _thrown:  # noqa: BLE001
    # The one place a channel death can still be named. Without this the
    # program ends 0 and the page reports only that Blender is gone.
    _say("@@VGAI-ERROR the session's channel loop raised %s: %s -- the session is over and "
         "every outstanding call will go unanswered. %s"
         % (type(_thrown).__name__, _thrown, traceback.format_exc().replace("\n", " | ")))
    raise
