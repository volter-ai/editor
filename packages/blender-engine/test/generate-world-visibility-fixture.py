"""Independent desktop Cycles oracle for direct world visibility; no source asset."""
import bpy, json, os

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=512
scene.cycles.max_bounces=0
scene.cycles.use_denoising=False
scene.render.resolution_x=scene.render.resolution_y=32
scene.render.resolution_percentage=100
scene.render.use_compositing=False
scene.render.image_settings.file_format='OPEN_EXR'
scene.render.image_settings.color_mode='RGBA'
scene.render.image_settings.color_depth='32'
world=bpy.data.worlds.new('White exterior');world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(1,1,1,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=1
scene.world=world
material=bpy.data.materials.new('Diffuse control');material.use_nodes=True
bsdf=material.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value=(.8,.8,.8,1)
bsdf.inputs['Roughness'].default_value=1
camera_data=bpy.data.cameras.new('Control camera');camera_data.angle=0.8726646259971648
camera_data.clip_start=.1;camera_data.clip_end=10
camera=bpy.data.objects.new('Control camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera
folder=os.environ['WORLD_VISIBILITY_OUTPUT'];os.makedirs(folder,exist_ok=True)
def capture(name):
    path=os.path.join(folder,name+'.exr');scene.render.filepath=path
    bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(path,check_existing=False)
    try:
        pixels=list(image.pixels);offset=(16*32+16)*4
        return pixels[offset:offset+4]
    finally:bpy.data.images.remove(image)
bpy.ops.mesh.primitive_cube_add(size=4)
room=bpy.context.object;room.data.materials.append(material)
closed=capture('closed')
room.hide_render=True
mesh=bpy.data.meshes.new('Open plane');mesh.from_pydata([(-2,-2,-2),(2,-2,-2),(2,2,-2),(-2,2,-2)],[],[(0,1,2,3)])
plane=bpy.data.objects.new('Open plane',mesh);scene.collection.objects.link(plane);mesh.materials.append(material)
opened=capture('open')
record={'blender':bpy.app.version_string,'build':bpy.app.build_hash.decode(),'engine':'CYCLES',
        'samples':512,'indirect_bounces':0,'width':32,'height':32,'closed':closed,'open':opened}
with open(os.path.join(folder,'native-world-visibility.json'),'w') as file:json.dump(record,file,indent=2)
print('NATIVE_WORLD_VISIBILITY',json.dumps(record))
