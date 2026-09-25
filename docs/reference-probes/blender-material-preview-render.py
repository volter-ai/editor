# Blender's own render of the default cube lit by the Forest studio light, the stand-in for a
# Material Preview screenshot the editor's view is measured against (docs/VIEWPORT-STAGE.md).
#   Blender -b --factory-startup --python docs/reference-probes/blender-material-preview-render.py -- <out.png>
# The lamp is removed (Material Preview leaves scene lights out); composite the transparent result
# over the viewport grey (#3d3d3d) before comparing.
import sys
import bpy, os
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scene.render.resolution_x = 512; scene.render.resolution_y = 512
scene.render.film_transparent = True
world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
env = nt.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(bpy.utils.system_resource('DATAFILES'), 'studiolights', 'world', 'forest.exr'))
bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 1.0
out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(env.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
for ob in list(bpy.data.objects):
    if ob.type == 'LIGHT': bpy.data.objects.remove(ob)
scene.view_settings.view_transform = 'AgX'
scene.render.filepath = sys.argv[sys.argv.index('--') + 1]
bpy.ops.render.render(write_still=True)
