# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
# Shared by the milestone scripts after circuit.py: materials, mesh helpers and the circuit spline.
import bpy, math, random
from mathutils import Vector
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
col=bpy.data.collections["Canyon Comet"]
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
