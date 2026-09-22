"""OUR BLENDER RENDERS WITH THREE.JS -- the ask, shipped INSIDE the Blender.

THE RENDER OVERRIDE IS NOT THE EDITOR'S. `session.py` is the editor tab's
long-lived session and carries this same override for the session it owns;
this file is the other delivery of it -- a Blender STARTUP module that ships in
the pack's resource tree (`scripts/startup/vgai_three.py`), so a bare
`blender -b ... -a` on ANY surface renders with three.js too. Blender imports
every module in `scripts/startup` and calls its `register()`.

THE ASK SHIPS WITH THE BLENDER; THE ANSWER DOES NOT. What renders is a
PRESENTER the host attached to this process (`browser/three/attach-presenter.ts`
around `browser/three/presenter.ts`): a canvas, the frame translated to
three.js, a camera, the display transform. This file only asks. The channel is
the directory protocol `session.py`'s header states, with one writer per
directory:

    <root>/ask/     THIS PROGRAM writes and unlinks; the host only reads.
    <root>/reply/   the HOST writes and unlinks; this program only reads.
    <root>/arena.bin  THIS PROGRAM writes (the export door does); host reads.

NO PRESENTER, NO OVERRIDE. `register()` asks `{"op": "hello"}` and waits two
seconds. Answered, it takes the engine ids and every render is a photograph.
Unanswered, it prints ONE line naming the root it waited at and registers
nothing at all, so Blender renders with Cycles -- correct, slow, and never
silent.

THE ENGINE IS TAKEN ON `load_post`, NOT IN `register()`, and that is a
measurement. Blender's `bpy.utils.load_scripts` registers every startup module
BEFORE it enables the add-ons, so at `register()` time `cycles.CyclesRender`
does not exist yet and taking the `CYCLES` id here would be overwritten by the
add-on moments later. Measured on the native 5.2.0 LTS oracle
(`blender -b --python-expr ...` with this module's probe in
`BLENDER_USER_SCRIPTS`): at `register()` `CYCLES` is unregistered, and the
FIRST `load_post` -- which Blender fires for the startup file itself, before
any `--python-expr` runs -- sees `<class 'cycles.CyclesRender'>`. So the
handler is where the ids are taken, and it runs again after every file load
because a load re-enables the add-ons and hands `CYCLES` back.

WHAT THIS FILE DOES NOT CARRY, deliberately: the editor session's incremental
geometry record (every frame ships in full -- `known` is always empty, so no
presenter can ever be asked about geometry it does not hold), its document,
its overlays, and its world SHADER reducer. A world here is a CONSTANT
background or nothing, named as a warning; see `_world`.
"""

import base64
import json
import os
import sys
import time

import bpy

# THE EXPORT DOOR, compiled into this Blender (`bpy_web_export.cc`): one call
# evaluates the scene and writes every column into a side arena, naming each as
# `{offset, length, dtype, count, stride}` in a small JSON frame.
import _blender_web

ROOT = os.environ.get("VGAI_PRESENTER_ROOT", "/tmp/vgai-presenter")
ASK = os.path.join(ROOT, "ask")
REPLY = os.path.join(ROOT, "reply")
# WHERE THE EXPORT DOOR LEAVES THE ARENA. The host cannot reach this program's
# linear memory, so the arena crosses as a file -- the door writes it when
# `buffer_path` is set, and the host reads it beside the ask.
EXPORT_BUFFER_PATH = os.environ.get(
    "VGAI_EXPORT_BUFFER_PATH", os.path.join(ROOT, "arena.bin")
)
# THE FRAME'S IDENTITY IS A PAIR, `(session, revision)`, and the presenter
# refuses a revision that went backwards under a name it already holds. One
# process is one session; the revision only ever counts up within it.
#
# THE PID IS NOT THE NAME, and that is measured rather than cautious. A
# presenter outlives the Blenders it serves, so two processes' names must
# differ -- and in the browser the guest's pids START OVER: the second
# `blender -b ... -a` on one page came up as the same pid, its revision
# restarted at 1 under a name the view already held at 24, and every render in
# it died on "The runtime frame is older than the displayed model" (measured
# 2026-09-20 in the substrate tab; the first run on a freshly loaded page
# always worked, which is what hid it). The start time is what makes the name
# this process's own.
SESSION = "vgai-three:%d-%d" % (os.getpid(), time.time_ns())
HELLO_TIMEOUT_SECONDS = 2.0
POLL_SECONDS = 0.002

_SEQUENCE = [0]
_REVISION = [0]
_WARNED = set()
_WARNINGS = []
def _say(line):
    """One line on Blender's own stderr, resolved at CALL TIME.

    WHERE THIS LINE COMES OUT, and it is not where a reader looks first.
    MEASURED 2026-09-20 in the substrate tab with the whole command redirected
    (`blender ... > log 2>&1`): Python's `sys.stderr` in this build is NOT the
    process's fd 2. `print(..., file=sys.stderr)` and
    `sys.stderr.buffer.write(...)` BOTH reached the terminal and NEITHER
    reached the file, while `print()` to stdout reached the file and not the
    terminal. So the one line this module ever prints -- the one that says
    Cycles is about to render -- is read on the TERMINAL; a reader who greps
    only a redirect will conclude the fallback is silent when it is not. That
    reading cost an hour and a wrong diagnosis; it is written here so it costs
    nobody else one.

    The stream is taken at call time rather than captured at import because a
    startup module is imported while Blender is still standing its streams up
    and nothing here needs the captured one. Both spellings were measured to
    work; this is the plainer.
    """
    print(line, file=sys.stderr or sys.stdout, flush=True)


def warn(what):
    """A capability this render cannot reach, named ONCE and never raised."""
    if what in _WARNED:
        return
    _WARNED.add(what)
    _WARNINGS.append(what)
    _say("@@VGAI-WARN " + what)


def _drop(path):
    try:
        os.unlink(path)
    except OSError as error:
        _say("@@VGAI-WARN vgai_three could not remove its own %s: %r" % (path, error))


def _prepare_directories():
    for directory in (ROOT, ASK, REPLY):
        try:
            os.makedirs(directory, exist_ok=True)
        except OSError as error:
            _say("@@VGAI-ERROR vgai_three cannot create %s: %r" % (directory, error))
        try:
            os.chmod(directory, 0o777)
        except OSError:
            pass


def ask(payload, timeout=None):
    """Block until the host answers. `None` when a bounded wait ran out.

    We write `ask/<n>.json` + `ask/<n>.done`, read `reply/<n>.json` once
    `reply/<n>.done` appears, and remove only our own two files; their
    disappearance is what tells the host it may retire the reply it wrote.
    `.done` goes last, both times.
    """
    name = str(_SEQUENCE[0])
    _SEQUENCE[0] += 1
    with open(os.path.join(ASK, name + ".json"), "w") as fh:
        fh.write(json.dumps(payload))
    with open(os.path.join(ASK, name + ".done"), "w") as fh:
        fh.write("1")
    marker = os.path.join(REPLY, name + ".done")
    deadline = None if timeout is None else time.time() + timeout
    while not os.path.exists(marker):
        if deadline is not None and time.time() >= deadline:
            _drop(os.path.join(ASK, name + ".json"))
            _drop(os.path.join(ASK, name + ".done"))
            return None
        time.sleep(POLL_SECONDS)
    with open(os.path.join(REPLY, name + ".json")) as fh:
        body = fh.read()
    _drop(os.path.join(ASK, name + ".json"))
    _drop(os.path.join(ASK, name + ".done"))
    return json.loads(body) if body else None


# ---------------------------------------------------------------- the frame


def _world(scene):
    """The world as radiance, for the CONSTANT cases and no others.

    The editor session reduces Blender's world node graph to the presenter's
    expression grammar (sky textures, ramps, `Is Camera Ray` splits); that
    reducer is two hundred lines and belongs to the session that ships with
    the editor. Here a world is a constant colour and strength -- Blender's
    own factory world is exactly that -- and anything else is named as a
    warning and left out, so the model stays lit by its lamps and the picture
    is never quietly wrong about which door failed.
    """
    world = scene.world
    if world is None:
        return None
    if world.node_tree is None:
        return {"color": [float(c) for c in list(world.color)[:3]], "strength": 1.0}
    outputs = [
        node
        for node in world.node_tree.nodes
        if node.bl_idname == "ShaderNodeOutputWorld" and node.is_active_output
    ]
    links = list(outputs[0].inputs["Surface"].links) if len(outputs) == 1 else []
    background = links[0].from_node if len(links) == 1 else None
    if (
        background is None
        or background.bl_idname != "ShaderNodeBackground"
        or background.inputs["Color"].is_linked
        or background.inputs["Strength"].is_linked
    ):
        warn(
            "world: this Blender's render override reduces a CONSTANT world only (one "
            "Background node with unlinked Color and Strength). This world's graph is "
            "outside that, so the photograph is taken without a world; the editor's "
            "own session (`session.py`) is what carries the full reducer."
        )
        return None
    color = background.inputs["Color"].default_value
    return {
        "color": [float(c) for c in list(color)[:3]],
        "strength": float(background.inputs["Strength"].default_value),
    }


def _export():
    """The C++ door's frame, with what the door does not describe merged in.

    `known` is ALWAYS EMPTY: this process keeps no record of what a presenter
    holds, so every frame ships its columns in full and the presenter's
    unknown-geometry refusal can never fire.
    """
    options = {
        "session": SESSION,
        "evaluate": True,
        "known": {},
        "buffer_path": EXPORT_BUFFER_PATH,
    }
    frame = json.loads(_blender_web.export_frame(json.dumps(options)))
    error = frame.get("error")
    if error:
        raise RuntimeError("Blender export door: %s" % error)
    _REVISION[0] += 1
    frame["session"] = SESSION
    frame["revision"] = _REVISION[0]
    scene = bpy.context.scene
    frame["world"] = _world(scene)
    frame["volumes"] = {}
    # THE INSPECTION OVERLAYS ARE THE EDITOR'S, and a render hides them anyway.
    frame["armatures"] = {}
    frame["weights"] = None
    warnings = list(frame.get("warnings", ()))
    warnings.extend(_WARNINGS)
    del _WARNINGS[:]
    frame["warnings"] = warnings
    return frame


def _present(capture):
    answer = ask({"frame": _export(), "capture": capture})
    if isinstance(answer, dict) and answer.get("error"):
        raise RuntimeError(answer["error"])
    return answer


# ---------------------------------------------------------------- the render engine


def _vertical_extent(cam, width, height):
    """The photograph's vertical field of view in degrees (or, for an
    orthographic camera, its vertical extent in Blender units), framed the way
    Blender frames a render: `BKE_camera_params_compute_viewplane`.

    Blender's `sensor_fit` says which sensor dimension spans which image
    dimension. HORIZONTAL: `sensor_width` spans the image width, and the
    vertical extent follows from the aspect. VERTICAL: `sensor_height` spans the
    height. AUTO: `sensor_width` spans the LARGER image dimension. Pixel aspect
    is not applied; the presenter renders square pixels."""
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
    # go out in BLENDER'S frame; the presenter converts them through the model
    # root's matrix and reports back through its inverse.
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
    # view itself -- the same table as no look at all.
    if look not in ("None", "AgX - Base Contrast"):
        render["look"] = look
    answer = _present(
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
    Blender's Z-up numbers were read as three.js world space.

    The check is exact because the conversion is exact: the model root's world
    matrix is a signed axis permutation, so a vector through it and its inverse
    is bit-identical. A mismatch is the conversion being wrong, never the check
    being too strict -- do not widen it.
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
                "frame conversion in the presenter is wrong."
                % (key, sent[key], list(got))
            )


class VgaiRenderEngine(bpy.types.RenderEngine):
    """The scene's renderer, so `write_still`, `save_render` and Render Result
    behave as Blender's own.

    Registered under the three engine ids a script names. The port has real
    Cycles compiled in, so the Cycles add-on's own engine is unregistered
    first -- otherwise `scene.render.engine = 'CYCLES'` resolves to it and
    starts a path trace nobody asked for.
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
    always absent. The subclass tree is the one true registry."""
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

    Dropping the class from `classes` makes the add-on's next
    `register()`/`unregister()` pair agree with what this module actually did,
    which is what keeps `scene.cycles` (the reason the add-on stays enabled at
    all) reachable after a factory reset.
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
    makes `scene.render.engine` resolve here. Only the Cycles ENGINE CLASS
    goes: the add-on stays enabled, because `scene.cycles` is the add-on's
    property group and a script sets `samples`, `use_denoising` and the rest
    on it.
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
            # the built-in type aside instead. A bundle without that patch
            # keeps `BLENDER_EEVEE` and `BLENDER_WORKBENCH`: a fact about the
            # build, not a warning on every boot.
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


# ---------------------------------------------------------------- registration


def _adopt():
    """Take the engine ids and point every scene at ours."""
    _register_engine()
    for scene in bpy.data.scenes:
        try:
            scene.render.engine = "VGAI_THREE"
        except (TypeError, AttributeError) as error:
            warn("scene %s kept its own render engine: %s" % (scene.name, error))


@bpy.app.handlers.persistent
def _load_post(_arg):
    # A file load re-enables every add-on, and the Cycles add-on's engine class
    # comes back under `CYCLES` while ours is gone. The ids are taken again on
    # every load -- and the FIRST of these, for the startup file, is where they
    # are taken at all (see this module's header).
    _adopt()


def register():
    _prepare_directories()
    if ask({"op": "hello"}, timeout=HELLO_TIMEOUT_SECONDS) is None:
        _say(
            "vgai: rendering with Cycles — no presenter answered at %s within 2 s"
            % ROOT
        )
        return
    bpy.app.handlers.load_post.append(_load_post)
    # BELT AND BRACES, AND NEITHER IS A GUESS. Startup modules register before
    # the add-ons are enabled, so ordinarily `CYCLES` is absent here and the
    # first `load_post` is what takes it; a host that imports this module after
    # the add-ons are up finds it present and adopts immediately.
    if _engine_class("CYCLES") is not None:
        _adopt()


def unregister():
    if _load_post in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(_load_post)
