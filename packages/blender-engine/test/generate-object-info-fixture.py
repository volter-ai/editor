"""Independent native Cycles renders of ordinary-object Object Info inputs.
Run in Blender: --background --factory-startup --python this.py -- output.json
"""
import bpy
import json
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=1
scene.cycles.use_denoising=False
scene.render.resolution_x=scene.render.resolution_y=16
scene.render.resolution_percentage=100
scene.render.film_transparent=True
bpy.ops.mesh.primitive_plane_add(size=2,location=(-.5,1.25,2))
obj=bpy.context.object
obj.color=(.125,.25,.75,.625)
obj.pass_index=7
material=bpy.data.materials.new('Native Object Info')
material.use_nodes=True
material.pass_index=11
obj.data.materials.append(material)
nodes=material.node_tree.nodes
nodes.clear()
info=nodes.new('ShaderNodeObjectInfo')
emission=nodes.new('ShaderNodeEmission')
output=nodes.new('ShaderNodeOutputMaterial')
links=material.node_tree.links
links.new(emission.outputs[0],output.inputs['Surface'])
camera=bpy.data.cameras.new('Oracle camera')
camera.type='ORTHO'
camera.ortho_scale=2
camera_obj=bpy.data.objects.new('Oracle camera',camera)
scene.collection.objects.link(camera_obj)
camera_obj.location=(-.5,1.25,7)
scene.camera=camera_obj
cases=[]
for name in ['Cube','Cube.001','Árbol','阴影']:
    obj.name=name
    values={}
    for socket in info.outputs:
        for link in list(emission.inputs['Color'].links): links.remove(link)
        links.new(socket,emission.inputs['Color'])
        bpy.ops.render.render()
        image=bpy.data.images['Render Result']
        # Native Render Result exposes scene-linear RGBA directly.
        pixels=list(image.pixels)
        if not pixels:
            # Background Cycles keeps its result on disk until loaded.
            import tempfile, os
            with tempfile.TemporaryDirectory() as directory:
                path=os.path.join(directory,'result.exr')
                previous=scene.render.image_settings.file_format
                depth=scene.render.image_settings.color_depth
                scene.render.image_settings.file_format='OPEN_EXR'
                scene.render.image_settings.color_depth='32'
                image.save_render(path,scene=scene)
                scene.render.image_settings.file_format=previous
                scene.render.image_settings.color_depth=depth
                loaded=bpy.data.images.load(path)
                pixels=list(loaded.pixels)
                bpy.data.images.remove(loaded)
        start=(8*16+8)*4
        values[socket.name]=pixels[start:start+3]
    cases.append({'name':obj.name,'color':list(obj.color),'index':obj.pass_index,
        'material_index':material.pass_index,'location':list(obj.location),'outputs':values})
with open(sys.argv[sys.argv.index('--')+1],'w') as f:
    json.dump({'version':bpy.app.version_string,'build':bpy.app.build_hash.decode(),'engine':'CYCLES','cases':cases},f,indent=2)
    f.write('\n')
