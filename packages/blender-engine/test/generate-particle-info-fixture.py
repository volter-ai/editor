"""Native Cycles oracle for parent, child and ordinary-object Particle Random.
Run: Blender --background --factory-startup --python this.py -- output.json
"""
import bpy,json,sys,tempfile,os
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=1
scene.cycles.use_denoising=False
scene.render.resolution_x=scene.render.resolution_y=16
scene.render.resolution_percentage=100
scene.render.film_transparent=True
material=bpy.data.materials.new('Native Particle Random')
material.use_nodes=True
nodes=material.node_tree.nodes
nodes.clear()
info=nodes.new('ShaderNodeParticleInfo')
emission=nodes.new('ShaderNodeEmission')
out=nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(info.outputs['Random'],emission.inputs['Color'])
material.node_tree.links.new(emission.outputs[0],out.inputs['Surface'])
bpy.ops.mesh.primitive_cube_add(size=.1,location=(40,0,0))
source=bpy.context.object
source.name='Particle source'
source.data.materials.append(material)
bpy.ops.mesh.primitive_plane_add(size=20)
emitter=bpy.context.object
emitter.name='Emitter'
bpy.ops.object.particle_system_add()
system=emitter.particle_systems[-1]
settings=system.settings
settings.type='HAIR'
settings.count=8
settings.hair_length=.2
settings.render_type='OBJECT'
settings.instance_object=source
settings.particle_size=1
settings.child_type='SIMPLE'
settings.child_percent=1
settings.rendered_child_count=1
settings.child_radius=.5
emitter.show_instancer_for_render=False
camera=bpy.data.cameras.new('Oracle camera')
camera.type='ORTHO'
camera.ortho_scale=.01
camera_obj=bpy.data.objects.new('Oracle camera',camera)
scene.collection.objects.link(camera_obj)
scene.camera=camera_obj
scene.frame_set(1)
cases=[]
with tempfile.TemporaryDirectory() as directory:
 for mode in ['NONE','SIMPLE']:
  settings.child_type=mode
  bpy.context.view_layer.update()
  placements=[]
  for instance in bpy.context.evaluated_depsgraph_get().object_instances:
   if instance.is_instance and instance.particle_system:
    index=instance.persistent_id[0]
    placements.append({'kind':'parent' if index<len(instance.particle_system.particles) else 'child',
      'index':index,'location':list(instance.matrix_world.translation)})
  expected_kind='parent' if mode=='NONE' else 'child'
  selected=[p for p in placements if p['kind']==expected_kind][:4 if mode=='NONE' else 2]
  assert selected,placements
  if mode=='NONE':selected.insert(0,{'kind':'ordinary','index':None,'location':list(source.location)})
  for case in selected:
   center=Vector(case['location'])
   camera_obj.location=center+Vector((0,0,10))
   bpy.ops.render.render()
   path=os.path.join(directory,'result.exr')
   scene.render.image_settings.file_format='OPEN_EXR'
   scene.render.image_settings.color_depth='32'
   bpy.data.images['Render Result'].save_render(path,scene=scene)
   loaded=bpy.data.images.load(path,check_existing=False)
   pixels=list(loaded.pixels)
   bpy.data.images.remove(loaded)
   case['rgba']=pixels[(8*16+8)*4:(8*16+8)*4+4]
   assert case['rgba'][3]>.99,case
   cases.append(case)
with open(sys.argv[sys.argv.index('--')+1],'w') as f:
 json.dump({'version':bpy.app.version_string,'build':bpy.app.build_hash.decode(),'engine':'CYCLES','cases':cases},f,indent=2)
 f.write('\n')
