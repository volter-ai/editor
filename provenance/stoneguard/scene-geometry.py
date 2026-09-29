import bpy, array, hashlib, base64, json, os, time
scene_path=os.environ.get('STONEGUARD_SCENE','/work/scene.blend')
bpy.ops.wm.open_mainfile(filepath=scene_path)
if scene_path.startswith('/work/'):
 os.chmod('/work',0o777);os.unlink(scene_path)
bpy.context.window.scene=bpy.data.scenes['Stoneguard Bridge']
dg=bpy.context.evaluated_depsgraph_get()
seen_pointers={};seen_geometry={};total_bytes=0;total_vertices=0;objects=0

def column(collection, prop, size, kind='f'):
 a=array.array(kind,[0])*size;collection.foreach_get(prop,a);raw=a.tobytes()
 return {'kind':kind,'values':size,'sha256':hashlib.sha256(raw).hexdigest(),'raw':raw}

def emit_mesh(mesh, key):
 global total_bytes
 mesh.calc_loop_triangles()
 fields={
 'positions':column(mesh.vertices,'co',len(mesh.vertices)*3),
 'triangles':column(mesh.loop_triangles,'vertices',len(mesh.loop_triangles)*3,'i'),
 'edges':column(mesh.edges,'vertices',len(mesh.edges)*2,'i'),
 'corners':column(mesh.loops,'vertex_index',len(mesh.loops),'i'),
 'faceStarts':column(mesh.polygons,'loop_start',len(mesh.polygons),'i'),
 'normals':column(mesh.corner_normals,'vector',len(mesh.corner_normals)*3),
 }
 for uv in mesh.uv_layers:fields['uv:'+uv.name]=column(uv.uv,'vector',len(uv.uv)*2)
 signature=hashlib.sha256(json.dumps([(k,v['sha256']) for k,v in fields.items()]).encode()).hexdigest()
 if signature in seen_geometry:return seen_geometry[signature]
 seen_geometry[signature]=key
 for name,data in fields.items():
  raw=data.pop('raw');total_bytes+=len(raw)
  if total_bytes>1024**3:raise RuntimeError('geometry evidence exceeded 1 GiB bound')
  print('@@SCENE_ARRAY',json.dumps({'mesh':key,'field':name,**data,'bytes':base64.b64encode(raw).decode()},separators=(',',':')),flush=True)
 return key

for o in sorted(bpy.context.scene.objects,key=lambda o:o.name):
 e=o.evaluated_get(dg);mesh_key=None;verts=0
 if o.type=='MESH':
  m=e.data;ptr=m.as_pointer();verts=len(m.vertices);total_vertices+=verts
  if ptr not in seen_pointers:seen_pointers[ptr]=emit_mesh(m,o.name)
  mesh_key=seen_pointers[ptr]
 print('@@SCENE_OBJECT',json.dumps({'name':o.name,'type':o.type,'mesh':mesh_key,'vertices':verts,'matrix':[v for row in e.matrix_world for v in row]},separators=(',',':')),flush=True)
 objects+=1
 if objects%1000==0:print('@@SCENE_PROGRESS',objects,len(seen_pointers),len(seen_geometry),total_bytes,flush=True)
print('@@SCENE_DONE',json.dumps({'objects':objects,'meshPointers':len(seen_pointers),'distinctGeometry':len(seen_geometry),'totalVertices':total_vertices,'evidenceBytes':total_bytes}),flush=True)
