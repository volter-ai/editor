# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
import bpy, math, datetime
from mathutils import Vector
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
exec(compile(open(ROOT+'/src/models/scene_helpers.py').read(),'scene_helpers.py','exec'))
# One world for the camera, neutral diffuse illumination for the scene.
w=bpy.context.scene.world;ns=w.node_tree.nodes;ls=w.node_tree.links;ns.clear();out=ns.new('ShaderNodeOutputWorld');mix=ns.new('ShaderNodeMixShader');path=ns.new('ShaderNodeLightPath');ambient=ns.new('ShaderNodeBackground');back=ns.new('ShaderNodeBackground');ambient.inputs[0].default_value=(.72,.76,.79,1);ambient.inputs[1].default_value=.8;back.inputs[0].default_value=(.15,.70,.82,1);back.inputs[1].default_value=1
ls.new(path.outputs['Is Camera Ray'],mix.inputs[0]);ls.new(ambient.outputs[0],mix.inputs[1]);ls.new(back.outputs[0],mix.inputs[2]);ls.new(mix.outputs[0],out.inputs[0])
bpy.data.lights['Afternoon sun'].energy=3.0
# Correct signed wrapping of the closed spline at its seam.
for ob in bpy.data.objects:
 if ob.type!='MESH':continue
 if ob.name=='Circuit asphalt':bounds=(-12,12)
 elif ob.name.startswith('Ivory shoulder'):s=int(ob.name.rsplit(' ',1)[1]);bounds=(s*12,s*12.5)
 elif ob.name.startswith('Turquoise racing edge'):s=int(ob.name.rsplit(' ',1)[1]);bounds=(s*11.45,s*12)
 else:continue
 for i in range(512):
  for j,off in enumerate(bounds):
   p=sample(i*8/512,off);ob.data.vertices[i*2+j].co.x=p.x;ob.data.vertices[i*2+j].co.y=p.y
 ob.data.update()
# Photo-like micrograin with UVs in metres, never screen-space decoration.
def texture(m,file):
 # The textures stay files in src/textures/, referenced relative to the .blend rather than packed.
 im=bpy.data.images.load(ROOT+'/src/textures/'+file,check_existing=True);im.filepath='//../textures/'+file;im.colorspace_settings.name='sRGB'
 n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;m.node_tree.links.new(n.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 return n
texture(bpy.data.materials['Granular warm asphalt'],'asphalt.png')
o=bpy.data.objects['Circuit asphalt'];uv=o.data.uv_layers.new(name='Metre UV')
for poly in o.data.polygons:
 for li in poly.loop_indices:
  v=o.data.vertices[o.data.loops[li].vertex_index].co;uv.data[li].uv=(v.x/5,v.y/5)
rock=mat('Continuous sandstone strata','D58454',.95);texture(rock,'sandstone.png')
rocknames=['West high mesa','West middle mesa','West ledge','Arch east tower','East foreground cliff','Arch west tower','Distant mesa','Far left mesa','Far right mesa']
for name in rocknames:
 ob=bpy.data.objects[name];ob.data.materials.clear();ob.data.materials.append(rock)
 for p in ob.data.polygons:p.material_index=0
 uv=ob.data.uv_layers.new(name='Sandstone strata')
 for p in ob.data.polygons:
  for li in p.loop_indices:
   v=ob.data.vertices[ob.data.loops[li].vertex_index].co;uv.data[li].uv=((v.x+v.y*.61)/18,v.z/9)
for name,dx,dy,sz in [('West ledge',-12,6,.6),('West middle mesa',-9,8,1),('West high mesa',-11,8,1),('Arch west tower',-5,0,1)]:
 ob=bpy.data.objects[name];ob.location.x+=dx;ob.location.y+=dy;ob.scale.z=sz
# A continuous naturally uneven arch, with no radial masonry pattern.
for ob in list(bpy.data.objects):
 if ob.name.startswith('Natural arch span'):bpy.data.objects.remove(ob,do_unlink=True)
v=[];N=48
for i in range(N+1):
 a=i*math.pi/N;outer=28+math.sin(i*1.7)*.7;inner=20+math.sin(i*2.3)*.35
 for y,r in [(46,inner),(46,outer),(55,outer),(55,inner)]:v.append((13+r*math.cos(a),y,3+r*.65*math.sin(a)))
f=[]
for i in range(N):
 for j in range(4):f.append((i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4,(i+1)*4+j))
f+=[(3,2,1,0),(N*4,N*4+1,N*4+2,N*4+3)]
d=mesh('Eroded arch strata',v,f,rock);o=obj('Natural sandstone arch',d);o['environment_owned']=True
uv=d.uv_layers.new(name='Arch strata')
for p in d.polygons:
 for li in p.loop_indices:
  a=d.vertices[d.loops[li].vertex_index].co;uv.data[li].uv=((a.x+a.y*.61)/18,a.z/9)
# Rear three-quarter silhouettes aligned to reference landmarks.
bpy.data.objects['Kart.1'].location=(-6.2,2.7,0)
bpy.data.objects['Kart.2'].location=(4.8,6,0)
bpy.data.objects['Kart.3'].location=(-1.5,24,0)
bpy.data.objects['Kart.4'].location=(1,31,0)
bpy.data.objects['Kart.5'].location=(7,41,0)
cam=bpy.data.objects['Chase camera'];cam.location=(0,-10.7,4.7);cam.rotation_euler=(Vector((0,18,.05))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=23.25
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Refined textures, neutral fill, arch, seam and chase framing')
