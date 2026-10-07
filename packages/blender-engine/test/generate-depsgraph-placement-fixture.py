"""Run in native Blender, with -- <output.json>. Metadata oracle, no mesh codec."""
import bpy,json,sys,struct
bpy.ops.wm.read_factory_settings(use_empty=True)
s=bpy.context.scene
library=bpy.data.collections.new('Library')
s.collection.children.link(library)
bpy.ops.mesh.primitive_cube_add(location=(100,100,100))
source=bpy.context.object
source.name='SourceCube'
for collection in list(source.users_collection): collection.objects.unlink(source)
library.objects.link(source)
library.instance_offset=(100,100,100)
source.pass_index=7
source.color=(.2,.3,.4,.6)
bpy.ops.curve.primitive_bezier_curve_add(location=(100,100,100))
curve=bpy.context.object;curve.name='ConvertedCurve';curve.data.bevel_depth=.1
for collection in list(curve.users_collection):collection.objects.unlink(curve)
library.objects.link(curve)
for i in range(3):
 owner=bpy.data.objects.new('Placed.%d'%i,None)
 s.collection.objects.link(owner)
 owner.instance_type='COLLECTION';owner.instance_collection=library
 owner.location=(i*3,1,0);owner.rotation_euler=(0,0,i*.3);owner.scale=(1+i*.2,1,1)
nested=bpy.data.collections.new('Nested')
s.collection.children.link(nested)
inner=bpy.data.objects.new('Inner',None);nested.objects.link(inner)
inner.instance_type='COLLECTION';inner.instance_collection=library
inner.location=(200,200,200);nested.instance_offset=(200,200,200)
outer=bpy.data.objects.new('Outer',None);s.collection.objects.link(outer)
outer.instance_type='COLLECTION';outer.instance_collection=nested;outer.location=(-3,4,2)
bpy.ops.mesh.primitive_plane_add(size=6)
emitter=bpy.context.object;emitter.name='Emitter'
bpy.ops.object.particle_system_add()
ps=emitter.particle_systems[-1];ps.seed=19
ps.settings.type='HAIR';ps.settings.count=7;ps.settings.hair_length=1
ps.settings.render_type='OBJECT';ps.settings.instance_object=source
emitter.show_instancer_for_viewport=False;emitter.show_instancer_for_render=False
# Source library is excluded, while its visible placements remain drawable.
bpy.context.view_layer.layer_collection.children['Library'].exclude=True
s.frame_set(1)
bpy.context.view_layer.update()
rows=[{'id':o.name,'name':o.name,'type':o.type,'mesh':o.data.name if o.type=='MESH' else o.name if o.type=='CURVE' else None,
       'visible':True,'render_visible':not o.hide_render,'hide_render':o.hide_render,
       'is_instancer':o.is_instancer,'show_instancer_for_render':o.show_instancer_for_render,'materials':[],'parent':o.parent.name if o.parent else None,
       'selected':o.select_get(),'matrix':[list(r) for r in o.matrix_world],
       'object_info':{'color':list(o.color),'index':o.pass_index,'random':0}} for o in s.objects]
native=[]
for i in bpy.context.evaluated_depsgraph_get().object_instances:
 native.append({'source':i.object.original.name,'owner':i.parent.original.name if i.parent else None,
                'is_instance':i.is_instance,'show_self':i.show_self,'persistent_id':list(i.persistent_id),
                'data_pointer':i.object.data.as_pointer() if i.object.data else None,
                'source_data_pointer':i.instance_object.data.as_pointer() if i.instance_object and i.instance_object.data else None,
                'random_id':i.random_id,'color':list(i.object.color),'matrix':[list(r) for r in i.matrix_world],
                'random':struct.unpack('f',struct.pack('f',(i.random_id & 0xffffffff)/4294967296))[0]})
# Only native pointer equality matters to this oracle. Normalize process-local
# addresses to deterministic tokens before saving the fixture.
pointers={}
for row in native:
 for key in ('data_pointer','source_data_pointer'):
  pointer=row[key]
  if pointer is not None:
   if pointer not in pointers:pointers[pointer]=len(pointers)+1
   row[key]=pointers[pointer]
out=sys.argv[sys.argv.index('--')+1]
with open(out,'w') as f: json.dump({'source':bpy.app.version_string+' '+bpy.app.build_hash.decode(),'objects':rows,'native':native,
 'instance_geometry':{i['source']:i['data_pointer'] for i in native if i['is_instance'] and i['source']=='ConvertedCurve'}},f,indent=2)
print('FIXTURE',out,'placements',sum(i['is_instance'] for i in native))
