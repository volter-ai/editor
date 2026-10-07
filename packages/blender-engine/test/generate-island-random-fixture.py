"""Independent Cycles Random Per Island pixels and evaluated stored topology."""
import bpy,json,os
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1
scene.cycles.pixel_filter_type='BOX';scene.cycles.filter_width=1
scene.cycles.use_denoising=False;scene.render.use_compositing=False
scene.render.resolution_x=64;scene.render.resolution_y=16;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
material=bpy.data.materials.new('Native island input');material.use_nodes=True
nodes=material.node_tree.nodes;nodes.clear();geometry=nodes.new('ShaderNodeNewGeometry');emission=nodes.new('ShaderNodeEmission');output=nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(geometry.outputs['Random Per Island'],emission.inputs['Color'])
material.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
camera_data=bpy.data.cameras.new('Control');camera_data.type='ORTHO';camera_data.ortho_scale=8
camera=bpy.data.objects.new('Control',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,5);scene.camera=camera
vertices=[];faces=[];edges=[]
for i,representative in enumerate([1,3,0,3]):
    x=-3+i*2;offset=len(vertices)
    vertices.extend([(x-.8,-.8,0),(x+.8,-.8,0),(x+.8,.8,0),(x-.8,.8,0)])
    faces.append([offset+j for j in range(4)])
    first=representative
    edges.extend([(offset+first,offset+(first+1)%4),(offset+first,offset+(first+2)%4),
                  (offset+(first+2)%4,offset+(first+3)%4)])
folder=os.environ['ISLAND_RANDOM_OUTPUT'];os.makedirs(folder,exist_ok=True)
cases=[]
for name,extra in [('separate',[]),('loose-edge-connected',[(0,4),(8,12)])]:
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,edges+extra,faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);mesh.materials.append(material)
    path=os.path.join(folder,name+'.exr');scene.render.filepath=path;bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(path,check_existing=False)
    try:
        pixels=list(image.pixels)
        values=[pixels[(8*64+x)*4:(8*64+x)*4+4] for x in [8,24,40,56]]
    finally:bpy.data.images.remove(image)
    evaluated_object=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated=evaluated_object.to_mesh();evaluated.calc_loop_triangles()
    cases.append({'name':name,'vertices':[list(v.co) for v in evaluated.vertices],
                  'edges':[list(e.vertices) for e in evaluated.edges],
                  'faces':[list(p.vertices) for p in evaluated.polygons],
                  'triangles':[list(t.loops) for t in evaluated.loop_triangles],
                  'rgba':values})
    evaluated_object.to_mesh_clear();bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh)
record={'blender':bpy.app.version_string,'build':bpy.app.build_hash.decode(),'engine':'CYCLES','samples':scene.cycles.samples,'width':64,'height':16,'cases':cases}
with open(os.path.join(folder,'island-random.json'),'w') as file:json.dump(record,file,indent=2)
print('NATIVE_ISLAND_RANDOM',json.dumps(record))
