# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
import bpy,math,random,datetime
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
exec(compile(open(ROOT+'/src/models/scene_helpers.py').read(),'scene_helpers.py','exec'))
random.seed(38)
rock=bpy.data.materials['Continuous sandstone strata']
# Layered landforms on the return straight and inner island.
def mesa2(n,x,y,rx,ry,h):
 v=[];count=18;rings=17
 jitter=[random.uniform(.87,1.1)for _ in range(count)]
 for j in range(rings):
  z=h*j/(rings-1);s=1-(j//4)*.14
  for i in range(count):
   a=i*math.tau/count;r=s*jitter[i];v.append((x+rx*r*math.cos(a)+.16*math.sin(z+i),y+ry*r*math.sin(a),z))
 f=[(j*count+i,j*count+(i+1)%count,(j+1)*count+(i+1)%count,(j+1)*count+i)for j in range(rings-1)for i in range(count)];f+=[tuple(range((rings-1)*count,rings*count))]
 d=mesh(n,v,f,rock);o=obj(n,d);uv=d.uv_layers.new(name='Strata')
 for p in d.polygons:
  for li in p.loop_indices:
   a=d.vertices[d.loops[li].vertex_index].co;uv.data[li].uv=((a.x+a.y*.61)/18,a.z/9)
 b=o.modifiers.new('Weathered corners','BEVEL');b.width=.22;b.segments=2
 return o
for i,(x,y,rx,ry,h)in enumerate([(-40,-32,15,22,23),(-14,-59,22,12,21),(22,-62,21,12,28),(57,-56,15,12,19),(90,-34,15,20,24),(112,0,16,22,29),(112,38,13,21,24),(104,76,15,18,27),(70,106,21,15,22),(32,26,10,14,8),(38,48,9,8,5)]):mesa2('Return canyon mesa '+str(i),x,y,rx,ry,h)
for ob in list(bpy.data.objects):
 if ob.name.startswith('Distant eroded butte'):bpy.data.objects.remove(ob,do_unlink=True)
# Add fine puffs to the clouds, using one shared mesh.
cloud=bpy.data.materials['Soft cream clouds'];p=cloud.node_tree.nodes['Principled BSDF'];p.inputs['Emission Color'].default_value=(.45,.43,.38,1);p.inputs['Emission Strength'].default_value=.45
for x,y,z in [(-5,-140,40),(60,-140,42),(155,30,47)]:
 for j in range(18):sphere('Return cloud puff',(x+random.uniform(-15,15),y+random.uniform(-3,3),z+random.uniform(-3,4)),(random.uniform(2,5),3,random.uniform(2,4)),cloud)
# Visible start/finish stripe lives just behind the grid, leaving the reference shot open.
for ix in range(20):
 for iy in range(2):box('Finish line tile',(-11.4+ix*1.2,-2+iy*.6,.045),(1.2,.6,.018),white if (ix+iy)%2==0 else tire)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Return circuit scenery and finish line saved')
