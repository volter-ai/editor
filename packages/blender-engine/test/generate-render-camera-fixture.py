"""Native Blender oracle: blender -b --python SCRIPT -- SESSION_PY OUTPUT."""
import ast
import base64
import bpy
import json
import sys

session, output = sys.argv[sys.argv.index('--') + 1:]
tree = ast.parse(open(session).read())
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and
             n.name in ('_vertical_extent', '_photograph', '_assert_photographed_from')]
class Capture:
    def photograph(self, depsgraph, request):
        return {'base64': '', 'camera': {k: request[k] for k in ('position', 'target', 'up')}}
scope = {'base64': base64, 'SESSION': Capture(), 'bpy': bpy}
exec(compile(ast.Module(body=functions, type_ignores=[]), session, 'exec'), scope)
bpy.ops.wm.read_factory_settings(use_empty=True)
camera = bpy.data.cameras.new('ProjectionOracle')
obj = bpy.data.objects.new('ProjectionOracle', camera)
bpy.context.scene.collection.objects.link(obj)
bpy.context.scene.camera = obj
cases = []
for name, kind, fit, width, height, shift_x, shift_y in [
    ('courtyard', 'PERSP', 'AUTO', 715, 402, 0, .07099999487400055),
    ('portrait', 'PERSP', 'AUTO', 400, 900, -.17, .23),
    ('vertical', 'PERSP', 'VERTICAL', 900, 400, .12, -.18),
    ('ortho-landscape', 'ORTHO', 'HORIZONTAL', 900, 400, .2, -.1),
    ('ortho-portrait', 'ORTHO', 'AUTO', 400, 900, -.2, .1),
]:
    camera.type = kind
    camera.sensor_fit = fit
    camera.lens = 25.5
    camera.sensor_width = 36
    camera.sensor_height = 24
    camera.ortho_scale = 8
    camera.clip_start = 1.119999885559082
    camera.clip_end = 50
    camera.shift_x = shift_x
    camera.shift_y = shift_y
    bpy.context.view_layer.update()
    _, render, _ = scope['_photograph'](bpy.context.evaluated_depsgraph_get(), width, height)
    matrix = obj.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(), x=width, y=height)
    cases.append({'name': name, 'render': render,
                  'projection': [[float(v) for v in row] for row in matrix]})
with open(output, 'w') as file:
    json.dump({'blender': bpy.app.version_string, 'build': bpy.app.build_hash.decode(),
               'oracle': 'Object.calc_matrix_camera', 'cases': cases}, file, indent=2)
    file.write('\n')
