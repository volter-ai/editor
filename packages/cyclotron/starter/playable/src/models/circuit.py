# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
# Milestone 1 of canyon.py: the circuit, six karts, sky, sun and chase camera.
import bpy, math, random, datetime
from mathutils import Vector
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
random.seed(71)
# Rebuild only owned scene content, preserving reference, notes and manual objects.
for o in list(bpy.data.objects):
 if (o.get('canyon_owned') or o.name=='Cube') and not any(c.name in ['References','Notes'] for c in o.users_collection): bpy.data.objects.remove(o,do_unlink=True)
col=bpy.data.collections.get('Canyon Comet') or bpy.data.collections.new('Canyon Comet')
if col.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(col)
def own(o): o['canyon_owned']=True; col.objects.link(o); return o
def lin(c): return c/12.92 if c<.04045 else ((c+.055)/1.055)**2.4
def mat(n,h,rough=.55,metal=0):
 m=bpy.data.materials.get(n) or bpy.data.materials.new(n); m.use_nodes=True
 rgb=[lin(int(h[i:i+2],16)/255) for i in (0,2,4)]; m.diffuse_color=(*rgb,1)
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*rgb,1); p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 return m
sand=mat('Warm peach sand','EBA76B'); road=mat('Granular warm asphalt','777970',.98); white=mat('Ivory enamel','EDF1E7',.28); teal=mat('Lagoon turquoise','13C8CF',.25,.15); yellow=mat('Golden yellow','F5C62B',.3); purple=mat('Violet racer','773FDC',.28); green=mat('Apple racer','59BC37',.28); blue=mat('Sky racer','319BBE',.27); coral=mat('Coral racer','F05C33',.3); tire=mat('Graphite rubber','202A29',.9); metal=mat('Brushed aluminum','A3AFAA',.3,.55); dark=mat('Ink blue helmet','203D58',.28); red=mat('Ruby tail lamps','BA291D',.22); orange=mat('Tangerine trim','F68B25',.3); mint=mat('Mint creature','38CCAC',.4); edge=mat('Mint track paint','5AF1B9',.8); black=mat('Sign charcoal','343B32',.8); lamp=mat('Amber lamps','FFF399',.4)
lamp.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(1,.72,.15,1);lamp.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=1.2
cache={}
def mesh(n,v,f,m):
 d=bpy.data.meshes.new(n);d.from_pydata(v,[],f);d.materials.append(m);d.update();return d
def obj(n,d,loc=(0,0,0),scale=(1,1,1),parent=None):
 o=own(bpy.data.objects.new(n,d));o.location=loc;o.scale=scale;o.parent=parent;return o
def sphere(n,loc,scale,m,parent=None):
 key=('sphere',m.name)
 if key not in cache:
  v=[(math.sin(math.pi*j/16)*math.cos(2*math.pi*i/28),math.sin(math.pi*j/16)*math.sin(2*math.pi*i/28),math.cos(math.pi*j/16)) for j in range(17) for i in range(28)]
  f=[(j*28+i,j*28+(i+1)%28,(j+1)*28+(i+1)%28,(j+1)*28+i) for j in range(16) for i in range(28)]
  # Sphere param runs north to south, winding outward.
  d=mesh('Smooth '+m.name,v,[tuple(reversed(a)) for a in f],m)
  for p in d.polygons:p.use_smooth=True
  cache[key]=d
 return obj(n,cache[key],loc,scale,parent)
def box(n,loc,s,m,parent=None):
 key=('box',m.name)
 if key not in cache:
  v=[(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]
  cache[key]=mesh(m.name+' block',v,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],m)
 return obj(n,cache[key],loc,tuple(a/2 for a in s),parent)
def rod(n,a,b,r,m,parent=None):
 mid=(Vector(a)+Vector(b))/2;o=sphere(n,mid,(r,r,(Vector(b)-Vector(a)).length/2+r),m,parent);o.rotation_euler=(Vector(b)-Vector(a)).to_track_quat('Z','Y').to_euler();return o
def torus(n,loc,R,r,m,parent=None):
 key=('torus',R,r,m.name)
 if key not in cache:
  v=[((R+r*math.cos(j*math.tau/12))*math.cos(i*math.tau/28),(R+r*math.cos(j*math.tau/12))*math.sin(i*math.tau/28),r*math.sin(j*math.tau/12)) for i in range(28) for j in range(12)]
  f=[(i*12+j,((i+1)%28)*12+j,((i+1)%28)*12+(j+1)%12,i*12+(j+1)%12) for i in range(28) for j in range(12)]
  d=mesh(n,v,f,m)
  for p in d.polygons:p.use_smooth=True
  cache[key]=d
 return obj(n,cache[key],loc,parent=parent)
POINTS=[(0,0),(0,25),(12,55),(42,70),(68,45),(65,5),(40,-25),(8,-25)]
def center(t):
 k=math.floor(t)%8;u=t%1;p0=Vector(POINTS[(k-1)%8]);p1=Vector(POINTS[k]);p2=Vector(POINTS[(k+1)%8]);p3=Vector(POINTS[(k+2)%8]);return .5*((2*p1)+(-p0+p2)*u+(2*p0-5*p1+4*p2-p3)*u*u+(-p0+3*p1-3*p2+p3)*u*u*u)
def sample(t,offset=0):
 p=center(t);d=(center(t+.001)-center(t-.001)).normalized();return p+Vector((d.y,-d.x))*offset
N=512
def ribbon(n,left,right,z,m):
 v=[]
 for i in range(N):
  for off in [left,right]:
   p=sample(i*8/N,off);v.append((p.x,p.y,z))
 f=[(2*i,2*i+1,2*((i+1)%N)+1,2*((i+1)%N)) for i in range(N)]
 return obj(n,mesh(n,v,f,m))
box('Desert floor',(30,20,-.3),(360,360,.5),sand)
ribbon('Circuit asphalt',-12,12,0,road)
for side in [-1,1]:
 ribbon('Ivory shoulder '+str(side),side*12,side*12.5,.015,white)
 ribbon('Turquoise racing edge '+str(side),side*11.45,side*12,.028,edge)
for i in range(90):
 t=i*8/90;p=sample(t);q=sample(t+.015);d=q-p
 o=box('Lane dash %03d'%i,(p.x,p.y,.035),(.28,2.1,.015),white);o.rotation_euler.z=-math.atan2(d.x,d.y)
def kart(index,pos,color,character):
 root=own(bpy.data.objects.new('Kart.%d'%index,None));root.location=pos
 sphere('K%d sculpted chassis'%index,(0,0,.64),(1.05,1.5,.52),color,root)
 sphere('K%d cockpit'%index,(0,.12,1.01),(.73,.8,.19),tire,root)
 sphere('K%d nose'%index,(0,1,.67),(.9,.75,.35),color,root)
 for x in [-1,1]:
  for y in [-.88,.88]:
   o=torus('K%d tire'%index,(x,y,.46),.31,.16,tire,root);o.rotation_euler.y=math.pi/2
   sphere('K%d gold wheel'%index,(x*1.145,y,.46),(.07,.28,.28),yellow,root)
   sphere('K%d wheel hub'%index,(x*1.2,y,.46),(.025,.13,.13),tire,root)
  sphere('K%d white rear pod'%index,(x*.8,-.85,.85),(.23,.53,.44),white,root)
  sphere('K%d red lamp'%index,(x*.83,-1.28,.98),(.14,.065,.23),red,root)
  sphere('K%d lamp glint'%index,(x*.8,-1.34,1.06),(.045,.017,.085),orange,root)
  rod('K%d wing strut'%index,(x*.6,-.84,1.1),(x*.6,-.84,1.4),.055,metal,root)
 sphere('K%d rounded wing'%index,(0,-.96,1.4),(.88,.18,.09),color,root)
 box('K%d rear cream stripe'%index,(0,-1.46,.72),(.32,.018,.45),white,root)
 sphere('K%d bumper'%index,(0,-1.43,.46),(.48,.16,.22),metal,root)
 for x in [-.17,.17]:
  o=torus('K%d exhaust rim'%index,(x,-1.66,.34),.12,.042,metal,root);o.rotation_euler.x=math.pi/2
  sphere('K%d exhaust bore'%index,(x,-1.65,.34),(.105,.02,.105),tire,root)
 sphere('K%d driver suit'%index,(0,.05,1.36),(.43,.34,.48),orange if index==0 else coral,root)
 for x in [-.37,.37]:rod('K%d driver arm'%index,(x,0,1.49),(x,.55,1.18),.14,white,root)
 if character=='helmet':
  sphere('K%d helmet rim'%index,(0,.05,1.82),(.64,.6,.28),tire,root)
  sphere('K%d helmet'%index,(0,.06,2.14),(.67,.61,.65),white,root)
  sphere('K%d face visor'%index,(0,.55,2.11),(.5,.14,.32),dark,root)
  # Orange stripe follows the curved helmet from brow to neck.
  v=[];f=[]
  for j in range(33):
   a=-math.pi*.48+math.pi*1.05*j/32
   for x in [-.115,.115]:v.append((x,.06+math.sin(a)*.623,2.14+math.cos(a)*.657))
  for j in range(32):f.append((j*2,j*2+1,j*2+3,j*2+2))
  obj('K%d helmet stripe'%index,mesh('Stripe',v,f,orange),parent=root)
  sphere('K%d scarf'%index,(0,-.28,1.49),(.38,.12,.14),coral,root)
 elif character=='miso':
  sphere('K%d mint head'%index,(0,.06,2.03),(.77,.66,.65),mint,root)
  for x in [-.73,.73]:sphere('K%d rounded ears'%index,(x,.05,2.17),(.28,.21,.28),mint,root)
  for x in [-.28,.28]:sphere('K%d coral crest'%index,(x,.02,2.67),(.14,.25,.28),orange,root)
 else:
  sphere('K%d navy helmet'%index,(0,.06,2.1),(.68,.62,.64),dark,root)
  for x in [-.66,.66]:
   sphere('K%d orange earcup'%index,(x,0,2.04),(.15,.28,.3),orange,root)
   sphere('K%d earcup metal'%index,(x*1.14,0,2.04),(.025,.17,.19),metal,root)
  rod('K%d headband'%index,(-.52,.04,2.56),(.52,.04,2.56),.08,metal,root)
  sphere('K%d visor'%index,(0,.6,2.12),(.48,.13,.28),teal,root)
 return root
kart(0,(0,0,0),teal,'helmet');kart(1,(-5.4,1.3,0),yellow,'miso');kart(2,(4.8,4.4,0),purple,'nova');kart(3,(-1.5,17,0),green,'miso');kart(4,(1,23,0),blue,'helmet');kart(5,(7,30,0),coral,'nova')
# Sunlight and a sky dome use the actual authored scene in Edit and Play.
world=bpy.context.scene.world or bpy.data.worlds.new('Canyon sky');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.23,.65,.8,1);world.node_tree.nodes['Background'].inputs[1].default_value=.7
sky=mat('Cyan sky','6AD9ED',1);p=sky.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(*[lin(a/255) for a in (106,217,237)],1);p.inputs['Emission Strength'].default_value=.8
light=bpy.data.lights.new('Afternoon sun','SUN');light.energy=3;light.angle=.08;l=own(bpy.data.objects.new('Afternoon sun',light));l.rotation_euler=(.5,-.5,-.5)
c=bpy.data.cameras.new('Chase camera');c.lens=24;c.sensor_width=36;cam=own(bpy.data.objects.new('Chase camera',c));cam.location=(0,-9,5.1);cam.rotation_euler=(Vector((0,18,1.6))-cam.location).to_track_quat('-Z','Y').to_euler();bpy.context.scene.camera=cam
bpy.context.scene.render.resolution_x=1672;bpy.context.scene.render.resolution_y=941
bpy.context.scene.view_settings.view_transform='Standard'
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Milestone 1: circuit, six rounded karts and chase camera saved')
