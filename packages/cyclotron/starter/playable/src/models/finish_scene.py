# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
import bpy,math,datetime
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
for name in ['West high mesa','West middle mesa','West ledge','Arch east tower','East foreground cliff','Arch west tower','Distant mesa','Far left mesa','Far right mesa','Natural sandstone arch']:
 o=bpy.data.objects[name]
 if not o.get('eroded'):
  for v in o.data.vertices:
   v.co.x+=.22*math.sin(v.co.z*1.3+v.co.y*.7);v.co.y+=.16*math.sin(v.co.z*2.1+v.co.x*.5)
  b=o.modifiers.new('Weathered sandstone edges','BEVEL');b.width=.28;b.segments=3;o['eroded']=True
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Weathered sandstone edges saved')
