"""Native RNA regression: run with Blender --factory-startup -b --python this-file."""
import ast
from pathlib import Path

import bpy


source = Path(__file__).parent.parent / "browser/session.py"
engine = next(node for node in ast.parse(source.read_text()).body
              if isinstance(node, ast.ClassDef) and node.name == "VolterRenderEngine")
namespace = {"bpy": bpy}
exec(compile(ast.Module(body=[engine], type_ignores=[]), str(source), "exec"), namespace)
engine_class = namespace["VolterRenderEngine"]
scene = bpy.context.scene
previous_engine = scene.render.engine
view = next(area.spaces.active for area in bpy.context.screen.areas
            if area.type == "VIEW_3D")
previous_shading = view.shading.type
bpy.utils.register_class(engine_class)
try:
    scene.render.engine = engine_class.bl_idname
    for mode in ("SOLID", "MATERIAL", "RENDERED", "WIREFRAME", "RENDERED"):
        view.shading.type = mode
        assert view.shading.type == mode, (mode, view.shading.type)
    print("PASS: presenter engine retains every native viewport shading mode")
finally:
    scene.render.engine = previous_engine
    view.shading.type = previous_shading
    bpy.utils.unregister_class(engine_class)
