# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
import bpy,math,random,datetime
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
exec(compile(open(ROOT+'/src/models/scene_helpers.py').read(),'scene_helpers.py','exec'))
# More road in the foreground and a distant outside verge, matching the open bend.
for ob in bpy.data.objects:
 if ob.type!='MESH':continue
 if ob.name=='Circuit asphalt':bounds=(-12,12)
 elif ob.name.startswith('Ivory shoulder'):s=int(ob.name.rsplit(' ',1)[1]);bounds=(s*12,s*12.5)
 elif ob.name.startswith('Turquoise racing edge'):s=int(ob.name.rsplit(' ',1)[1]);bounds=(s*11.45,s*12)
 else:continue
 for i in range(512):
  t=i*8/512;p=center(t);wide=17*math.exp(-max(0,p.y)/28) if t<2.4 or t>7.3 else 0
  for j,off in enumerate(bounds):
   if off<0:off-=wide
   q=sample(t,off);ob.data.vertices[i*2+j].co.x=q.x;ob.data.vertices[i*2+j].co.y=q.y
 ob.data.update()
 if ob.name=='Circuit asphalt':
  uv=ob.data.uv_layers.active
  for p in ob.data.polygons:
   for li in p.loop_indices:
    v=ob.data.vertices[ob.data.loops[li].vertex_index].co;uv.data[li].uv=(v.x/9,v.y/9)
for o in bpy.data.objects:
 if o.name.startswith('Lane dash'):o.location.x-=4
# Remove nearby rail, leaving the broad distant guardrail seen in the target.
for ob in list(bpy.data.objects):
 if ob.name.startswith(('Guardrail','Rail post')):bpy.data.objects.remove(ob,do_unlink=True)
for i in range(65):
 if i<23:
  p=Vector((-58+i*2,24));q=Vector((-56+i*2,24))
 else:p=sample(.92+(i-23)*.04,-13);q=sample(.92+(i-22)*.04,-13)
 rod('Guardrail beam',(p.x,p.y,.98),(q.x,q.y,.98),.14,metal)
 rod('Guardrail lower',(p.x,p.y,.75),(q.x,q.y,.75),.08,metal)
 if i%2==0:box('Rail post',(p.x,p.y,.43),(.18,.25,.86),metal)
# Move each complete sign assembly consistently according to original coordinates.
for ob in bpy.data.objects:
 if ob.name.startswith(('Arrow','Flag','Sunrise racing pennant')):
  # Flags store their absolute points in the mesh; all other parts have absolute locations.
  if ob.name.startswith(('Flag gold','Sunrise')):
   if ob.type=='MESH':
    cx=sum(v.co.x for v in ob.data.vertices)/len(ob.data.vertices);cy=sum(v.co.y for v in ob.data.vertices)/len(ob.data.vertices)
   else:continue
  else:cx,cy=ob.location.x,ob.location.y
  idx=min(range(3),key=lambda k:abs(cy-[10,24,38][k]))
  dx,dy,dz=[(-4,12,2.1),(-3,10,.5),(-1,10,0)][idx]
  ob.location.x+=dx;ob.location.y+=dy;ob.location.z+=dz
# The arch opening occupies the right half and leaves a broad cyan sky above it.
ob=bpy.data.objects['Natural sandstone arch'];ob.location.x+=6;ob.location.y+=9;ob.scale.z=.88
ob=bpy.data.objects['Arch east tower'];ob.location.x+=4
ob=bpy.data.objects['Distant mesa'];ob.location.x+=14;ob.scale.z=.8
# Directional afternoon shadows fall towards the camera's lower left.
bpy.data.objects['Afternoon sun'].rotation_euler=(-.52,.62,0)
bpy.data.lights['Afternoon sun'].color=(1,.91,.79)
bpy.data.lights['Afternoon sun'].energy=3.2
# Broader rear bodies, fitted lamps, twin chrome pipes and inset mechanical details.
for i in range(6):
 rt=bpy.data.objects['Kart.'+str(i)]
 for ob in list(rt.children):
  if 'sculpted chassis' in ob.name:ob.scale.x*=1.08;ob.scale.z*=.92
  if 'red lamp' in ob.name:ob.location.y=-1.37
  if 'lamp glint' in ob.name:ob.location.y=-1.44
  if 'white rear pod' in ob.name:ob.location.x*=1.02
  if 'rear cream stripe' in ob.name:ob.scale.z*=1.2
 # Decorative engine ventilation and lower diffuser behind the driver.
 for x in [-.42,-.21,0,.21,.42]:box('K%d rear grille'%i,(x,-1.45,.55),(.11,.02,.08),tire,rt)
 for x in [-.17,.17]:
  rod('K%d exhaust tube'%i,(x,-1.4,.34),(x,-1.7,.34),.13,metal,rt)
# Add small cream cloud banks in the open sky.
cloud=bpy.data.materials['Soft cream clouds'];random.seed(821)
for x,y,z,s in [(-6,150,39,8),(40,170,40,12),(62,185,54,8),(-41,170,50,7)]:
 for j in range(12):sphere('Cloud bank',(x+random.uniform(-s,s),y+random.uniform(-4,4),z+random.uniform(-2,4)),(random.uniform(2,5),3,random.uniform(2,4)),cloud)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Polished verge, signs, karts, shadows and clouds')
