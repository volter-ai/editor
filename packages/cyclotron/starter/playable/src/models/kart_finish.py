# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
import bpy,math,bmesh
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
exec(compile(open(ROOT+'/src/models/scene_helpers.py').read(),'scene_helpers.py','exec'))
# Reusable rounded rear bumper and flat-tread racing tyre geometry.
verts=[];profile=[(-.225,.27),(-.225,.39),(-.18,.465),(.18,.465),(.225,.39),(.225,.27)]
for x,r in profile:
 for i in range(32):a=i*math.tau/32;verts.append((x,r*math.cos(a),r*math.sin(a)))
faces=[]
for j in range(len(profile)):
 for i in range(32):faces.append((j*32+i,j*32+(i+1)%32,((j+1)%len(profile))*32+(i+1)%32,((j+1)%len(profile))*32+i))
d=mesh('Rounded racing tire',verts,faces,tire);bm=bmesh.new();bm.from_mesh(d);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(d);bm.free()
for p in d.polygons:p.use_smooth=True
for i in range(6):
 root=bpy.data.objects['Kart.'+str(i)]
 for ob in root.children:
  if ' tire' in ob.name:ob.data=d;ob.rotation_euler=(0,0,0)
  if ' bumper' in ob.name and not ob.get('rounded_final'):
   ob.data=box('Temporary bumper mesh',(0,0,0),(.88,.29,.48),white).data.copy()
   temp=bpy.data.objects['Temporary bumper mesh'];bpy.data.objects.remove(temp,do_unlink=True)
   # Box helper stores unit corners; bake its dimensions into the mesh.
   for v in ob.data.vertices:v.co.x*=.44;v.co.y*=.145;v.co.z*=.24
   ob.location=(0,-1.47,.48);ob.scale=(1,1,1)
   m=ob.modifiers.new('Rounded bumper corners','BEVEL');m.width=.11;m.segments=4
   ob['rounded_final']=True
 # Tail reflector directly over the chrome pipes.
 if not bpy.data.objects.get('K%d bumper reflector'%i):box('K%d bumper reflector'%i,(0,-1.622,.59),(.31,.012,.065),red,root)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Reusable flat-tread tyres and rounded rear bumpers saved')
