# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
import bpy,math
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
exec(compile(open(ROOT+'/src/models/scene_helpers.py').read(),'scene_helpers.py','exec'))
for i in range(6):
 root=bpy.data.objects['Kart.'+str(i)]
 if bpy.data.objects.get('K%d steering wheel'%i):continue
 wheel=torus('K%d steering wheel'%i,(0,.63,1.25),.24,.043,tire,root);wheel.rotation_euler.x=.9
 rod('K%d steering column'%i,(0,.65,.9),(0,.63,1.25),.045,metal,root)
 rod('K%d steering spoke'%i,(-.23,.63,1.25),(.23,.63,1.25),.025,metal,root)
 for x in [-.54,.54]:
  sphere('K%d headlight housing'%i,(x,1.53,.77),(.26,.17,.18),white,root)
  sphere('K%d golden headlight'%i,(x,1.66,.77),(.17,.055,.115),yellow,root)
 sphere('K%d front air intake'%i,(0,1.72,.52),(.34,.04,.09),tire,root)
 if i in [1,3]:
  for x in [-.27,.27]:
   sphere('K%d creature eye'%i,(x,.637,2.2),(.18,.06,.22),white,root)
   sphere('K%d creature pupil'%i,(x,.693,2.19),(.087,.035,.13),dark,root)
   sphere('K%d eye sparkle'%i,(x-.025,.721,2.24),(.026,.015,.036),white,root)
  sphere('K%d creature muzzle'%i,(0,.686,1.92),(.27,.11,.13),mint,root)
  sphere('K%d creature nose'%i,(0,.783,1.98),(.075,.025,.047),dark,root)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Steering controls, headlights and original creature faces saved')
