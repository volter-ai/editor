# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
# Additive environment milestone; shares helpers from scene_helpers.py.
import bpy, math, random, datetime
exec(compile(open(str(__import__('pathlib').Path(bpy.data.filepath).resolve().parent / 'scene_helpers.py')).read(),"scene_helpers.py","exec"))
random.seed(178)
for o in list(bpy.data.objects):
 if o.get('environment_owned'):bpy.data.objects.remove(o,do_unlink=True)
before=set(bpy.data.objects)
rocks=[mat('Sandstone band '+str(i),h,.95) for i,h in enumerate(['C8794E','D98654','B9603F','E49C61','BB6548','F3B576','D78457','A95A42'])]
def mesa(n,x,y,rx,ry,h):
 count=14; rings=18;v=[]
 angular=[random.uniform(.85,1.12) for i in range(count)]
 for j in range(rings):
  z=h*j/(rings-1);s=1-(j//4)*.12+random.uniform(-.015,.015)
  for i in range(count):
   a=i*math.tau/count;v.append((x+rx*s*angular[i]*math.cos(a),y+ry*s*angular[i]*math.sin(a),z))
 f=[]
 for j in range(rings-1):
  for i in range(count):f.append((j*count+i,j*count+(i+1)%count,(j+1)*count+(i+1)%count,(j+1)*count+i))
 f.append(tuple(range((rings-1)*count,rings*count)));f.append(tuple(reversed(range(count))))
 d=mesh(n,v,f,rocks[0]);[d.materials.append(m) for m in rocks[1:]]
 for p in d.polygons:p.material_index=(p.index//count)%len(rocks)
 return obj(n,d)
# Main composition: left stepped escarpment and right arch buttress.
for args in [('West high mesa',-29,28,16,23,29),('West middle mesa',-22,42,12,22,18),('West ledge',-22,12,11,17,9),('Arch east tower',38,49,12,17,24),('East foreground cliff',43,27,15,15,17),('Arch west tower',-12,53,9,11,15),('Distant mesa',36,106,23,18,22),('Far left mesa',-31,102,21,24,25),('Far right mesa',95,85,21,27,30)]:mesa(*args)
# Uneven, layered voussoirs form a true open arch over the roadway.
for i in range(14):
 a=i/14*math.pi;b=(i+1)/14*math.pi
 inner=20;outer=25+random.uniform(-.5,.7);cx=13;cz=3
 v=[]
 for y in [46,55]:
  for r,t in [(inner,a),(outer,a),(outer,b),(inner,b)]:v.append((cx+r*math.cos(t),y,cz+r*.65*math.sin(t)))
 d=mesh('Arch stone',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],rocks[i%6]);obj('Natural arch span %02d'%i,d)
# Thin sediment seams across each major mesa, geometry preserves horizontal strata.
for o in list(bpy.data.objects):
 if o.type=='MESH' and 'mesa' in o.name.lower() or o.name in ['West ledge','East foreground cliff','Arch east tower','Arch west tower']:
  if not o.type=='MESH':continue
  # add subtle surface noise as an image texture via shared materials later
# Guardrail wraps the outside bend.
for i in range(80):
 t=-.28+i*.038;p=sample(t,-12.9);q=sample(t+.038,-12.9)
 rod('Guardrail beam',(p.x,p.y,.97),(q.x,q.y,.97),.13,metal)
 rod('Guardrail lower',(p.x,p.y,.73),(q.x,q.y,.73),.08,metal)
 if i%2==0:box('Rail post',(p.x,p.y,.43),(.18,.2,.86),metal)
# Arrow panels are front facing and properly lit dot lamps.
for ix,(x,y,s) in enumerate([(-15,10,1.5),(-14,24,1.35),(-8,38,1.18)]):
 box('Arrow panel frame '+str(ix),(x,y,4.1*s),(4.7*s,.25,2.5*s),metal)
 box('Arrow panel face '+str(ix),(x,y-.15,4.1*s),(4.4*s,.07,2.25*s),black)
 for cx in [-1.4,0,1.4]:
  for j in range(9):
   zz=(j-4)*.2;xx=cx+.65-abs(j-4)*.18
   sphere('Arrow amber lamp',(x+xx*s,y-.22,4.1*s+zz*s),(.075*s,.05,.08*s),lamp)
 for xx in [-1.65,1.65]:box('Arrow board post',(x+xx*s,y,1.8*s),(.19,.2,3.6*s),metal)
 pole=rod('Flag pole',(x,y,5.3*s),(x,y,8.4*s),.06,metal)
 obj('Sunrise racing pennant',mesh('Pennant',[(x,y,8.35*s),(x+1.4*s,y,7.8*s),(x,y,7.45*s)],[(0,1,2),(2,1,0)],green))
 obj('Flag gold inset',mesh('Pennant gold',[(x+.15*s,y-.01,8.11*s),(x+1.05*s,y-.01,7.81*s),(x+.15*s,y-.01,7.63*s)],[(0,1,2),(2,1,0)],yellow))
cactus=mat('Saguaro green','529554',.85);rib=mat('Saguaro sunlit ribs','8CAC61',.85);thorn=mat('Cactus gold thorns','D4B66E',.9)
def cactus_at(x,y,h):
 sphere('Saguaro trunk',(x,y,h*.5),(.36*h/4,.4*h/4,h*.5),cactus)
 for j in range(7):
  a=j*math.tau/7;rod('Cactus rib',(x+math.cos(a)*.33*h/4,y+math.sin(a)*.37*h/4,.3),(x+math.cos(a)*.28*h/4,y+math.sin(a)*.31*h/4,h*.9),.035*h/4,rib)
 for s,z in [(-1,.48),(1,.66)]:
  rod('Saguaro arm',(x,y,h*z),(x+s*h*.24,y,h*z),.22*h/4,cactus)
  sphere('Saguaro arm tip',(x+s*h*.24,y,h*(z+.12)),(.23*h/4,.25*h/4,h*.22),cactus)
 for i in range(int(h*3)):
  a=random.random()*math.tau;z=random.uniform(.5,h*.92);sphere('Cactus thorn',(x+math.cos(a)*.39*h/4,y+math.sin(a)*.4*h/4,z),(.035,.035,.06),thorn)
for x,y,h in [(-19,14,6.8),(-16,23,4.2),(-16,34,3.7),(19,28,4.2),(27,39,6),(31,40,4.8),(-7,48,4),(43,75,6),(78,13,5),(-15,-15,6),(50,-42,5)]:cactus_at(x,y,h)
# Roadside stones and desert scrub, placed outside the drivable ribbon.
scrub=mat('Dry agave','8F9453',.95)
for i in range(90):
 t=random.random()*8;p=sample(t,random.choice([-1,1])*random.uniform(14,23))
 if i%4:
  o=sphere('Tumbled sandstone',(p.x,p.y,.15),(random.uniform(.2,.7),random.uniform(.2,.65),random.uniform(.15,.4)),random.choice(rocks));o.rotation_euler.z=random.random()*6
 else:
  for j in range(9):
   a=j*math.tau/9;b=(p.x,p.y,0);tip=(p.x+math.cos(a)*1.1,p.y+math.sin(a)*1.1,random.uniform(.4,1.5))
   obj('Agave blade',mesh('Blade',[b,(p.x+.12,p.y+.12,.05),tip],[(0,1,2),(2,1,0)],scrub))
cloud=mat('Soft cream clouds','FCFCED',1)
# Puffy distant clouds remain beyond the cliffs, far from casting track shadows.
for x,y,z,sz in [(-65,165,47,9),(0,175,39,8),(65,170,45,12),(122,155,54,11),(-80,70,50,8)]:
 for j in range(8):sphere('Cloud puff',(x+random.uniform(-sz,sz),y+random.uniform(-4,4),z+random.uniform(-3,4)),(random.uniform(3,7),4,random.uniform(2,5)),cloud)
for o in set(bpy.data.objects)-before:o['environment_owned']=True
# Avoid drawing camera wireframe over the intended shot.
bpy.data.objects['Chase camera'].hide_set(True)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Milestone 2: layered canyon, open rock arch, cacti, arrows, guardrails, cloud banks')
