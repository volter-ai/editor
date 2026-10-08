# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
import bpy,math,random,datetime
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
exec(compile(open(ROOT+'/src/models/scene_helpers.py').read(),'scene_helpers.py','exec'))
for ob in list(bpy.data.objects):
 if 'exhaust tube' in ob.name:bpy.data.objects.remove(ob,do_unlink=True)
# Wider, softer kart body with a rounded rectangular engine bumper.
for i in range(6):
 rt=bpy.data.objects['Kart.'+str(i)]
 for ob in rt.children:
  if 'bumper' in ob.name:
   ob.scale.z*=1.6;ob.scale.y*=.85
  if 'helmet stripe' in ob.name:
   for j in range(33):
    a=-2.2+4.0*j/32
    for k,x in enumerate([-.115,.115]):ob.data.vertices[j*2+k].co=(x,.06+math.sin(a)*.623,2.14+math.cos(a)*.657)
   ob.data.update()
 # Small amber brake studs and bolts provide scale and material contrast.
 for x in [-.58,.58]:sphere('K%d wing bolt'%i,(x,-1.08,1.4),(.055,.035,.035),metal,rt)
# Broader lane dashes and a more open skyline.
for ob in bpy.data.objects:
 if ob.name.startswith('Lane dash'):
  ob.scale.x*=1.8;ob.scale.y*=.7
 if ob.name.startswith('Cloud'):
  ob.scale.z*=.65;ob.location.z+=5
# Raised sand terraces put the left signs above the distant rail like the reference.
for name in ['West ledge','West middle mesa']:
 ob=bpy.data.objects[name];ob.scale.z*=.86
# Secondary sandstone shelves, forming broad irregular blocks rather than isolated cylinders.
rock=bpy.data.materials['Continuous sandstone strata']
for i,(x,y,z,sx,sy,sz) in enumerate([(-29,28,1.2,18,18,2.4),(-23,45,1.1,14,16,2.2),(28,37,.7,8,7,1.4)]):
 ob=box('Low sandstone shelf '+str(i),(x,y,z),(sx,sy,sz),rock)
 uv=ob.data.uv_layers.get('Strata') or ob.data.uv_layers.new(name='Strata')
 for p in ob.data.polygons:
  for li in p.loop_indices:
   v=ob.data.vertices[ob.data.loops[li].vertex_index].co;uv.data[li].uv=((v.x+v.y)*.5,v.z*.25)
# Hazy distant formations fill the opening below the arch.
haze=mat('Distant rose sandstone','DBA188',1)
for x,y,z,sx,sy,sz in [(23,122,5,18,13,10),(29,123,11,13,11,5),(29,123,15,8,8,3),(-3,137,6,16,16,12)]:
 sphere('Distant eroded butte',(x,y,z),(sx,sy,sz*.5),haze)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Final surface and silhouette detailing saved')
