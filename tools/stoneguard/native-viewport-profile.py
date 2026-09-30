import bpy, gpu, json, time, statistics, traceback
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector
import sys
D=Path(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else Path.cwd()
pose=json.loads((D/'ceiling-camera.json').read_text())
world=Matrix([pose['nativeCameraWorld'][i:i+4] for i in range(0,16,4)]).transposed()
if pose.get('cameraIncludesNavigationStep'): world=world@Quaternion((0,1,0),-.0005).to_matrix().to_4x4()
projection=Matrix([pose['projection'][i:i+4] for i in range(0,16,4)]).transposed()
phase=0; area=None; window=None; handler=None; start=None; readings=[]; layout=[]; attempts=0

def close():
 global handler
 if handler: bpy.types.SpaceView3D.draw_handler_remove(handler,'WINDOW');handler=None
 bpy.ops.wm.quit_blender()

def on_draw():
 global start
 if start is None or bpy.context.area!=area: return
 before=time.perf_counter()
 gpu.state.active_framebuffer_get().read_color(0,0,1,1,4,0,'UBYTE')
 done=time.perf_counter()
 readings.append({'ms':(done-start)*1000,'submitMs':(before-start)*1000,'completionWaitMs':(done-before)*1000})
 start=None

def tick():
 global phase,area,window,handler,start,attempts
 try:
  if window is None:
   if not bpy.context.window_manager.windows:return .2
   window=bpy.context.window_manager.windows[0];window.scene=bpy.data.scenes[pose['scene']];window.scene.frame_set(pose['frame'])
   area=next(a for a in window.screen.areas if a.type=='VIEW_3D')
  region=next(r for r in area.regions if r.type=='WINDOW')
  with bpy.context.temp_override(window=window,area=area,region=region):
   if phase<2:
    direction='VERTICAL' if phase==0 else 'HORIZONTAL'
    size=region.width if phase==0 else region.height
    target=pose['width'] if phase==0 else pose['height']
    gap=(area.width-region.width) if phase==0 else (area.height-region.height)
    full=area.width if phase==0 else area.height
    if size!=target:
     old=set(a.as_pointer() for a in window.screen.areas)
     bpy.ops.screen.area_split(direction=direction,factor=(target+gap)/full)
     candidates=[a for a in window.screen.areas if a.type=='VIEW_3D']
     area=min(candidates,key=lambda a:abs((a.width if phase==0 else a.height)-(target+gap)))
     for a in candidates:
      if a!=area:a.type='INFO'
    phase+=1;return .1
   if phase==2:
    layout.append({'area':[area.x,area.y,area.width,area.height],'region':[region.width,region.height]})
    if [region.width,region.height]!=[pose['width'],pose['height']]:
     attempts+=1
     if attempts>6:raise RuntimeError('Cannot obtain exact viewport dimensions: '+str(layout))
     if region.width!=pose['width']:
      bpy.ops.screen.area_move(x=area.x+area.width,y=area.y+area.height//2,delta=pose['width']-region.width)
     else:bpy.ops.screen.area_move(x=area.x+area.width//2,y=area.y+area.height,delta=pose['height']-region.height)
     return .1
    space=area.spaces.active;space.overlay.show_overlays=False;space.show_gizmo=False
    space.shading.type='MATERIAL';space.shading.use_scene_lights=False;space.shading.use_scene_world=False
    space.shading.studio_light='forest.exr';space.shading.studiolight_intensity=1;space.shading.studiolight_rotate_z=0
    window.scene.render.preview_pixel_size='1'
    space.clip_start=pose['near'];space.clip_end=pose['far']
    r3d=space.region_3d;r3d.view_perspective='PERSP';r3d.view_matrix=world.inverted()
    window.view_layer.update();bpy.ops.wm.redraw_timer(type='DRAW',iterations=1)
    phase=3;return .1
   if phase==3:
    space=area.spaces.active;r3d=space.region_3d
    space.lens*=projection[0][0]/r3d.window_matrix[0][0]
    bpy.ops.wm.redraw_timer(type='DRAW',iterations=1)
    view_error=max(abs(r3d.view_matrix[i][j]-world.inverted()[i][j]) for i in range(4) for j in range(4))
    projection_error=max(abs(r3d.window_matrix[i][j]-projection[i][j]) for i in range(4) for j in range(4))
    meta={'version':bpy.app.version_string,'build':bpy.app.build_hash.decode(),'scene':window.scene.name,'frame':window.scene.frame_current,'region':[region.width,region.height],'viewError':view_error,'projectionError':projection_error,'backend':gpu.platform.backend_type_get(),'device':gpu.platform.renderer_get(),'taaSamples':window.scene.eevee.taa_samples,'previewPixelSize':window.scene.render.preview_pixel_size,'lens':space.lens,'layout':layout,'method':'Actual UI DRAW redraw; POST_PIXEL one-pixel active framebuffer read completes this viewport frame.','limitations':['Native EEVEE and forest HDR differ from Three material preview.','Native original detail versus browser navigation LOD.']}
    (D/'native-ceiling-ui-ready.json').write_text(json.dumps(meta,indent=2))
    if view_error>1e-4 or projection_error>1e-4:raise RuntimeError('Camera mismatch: '+str(meta))
    handler=bpy.types.SpaceView3D.draw_handler_add(on_draw,(),'WINDOW','POST_PIXEL');phase=4;return .1
   space=area.spaces.active
   for i in range(12):
    space.region_3d.view_matrix=(world@Quaternion((0,1,0),(i+1)*.0005).to_matrix().to_4x4()).inverted()
    start=time.perf_counter();before_count=len(readings)
    bpy.ops.wm.redraw_timer(type='DRAW',iterations=1)
    if len(readings)!=before_count+1:raise RuntimeError('Draw callback missing or repeated')
   selected=readings[5:]
   result={k:statistics.median(r[k] for r in selected) for k in selected[0]};result['frames']=selected;result['warmupFrames']=5
   (D/'native-ceiling-ui-reading.json').write_text(json.dumps(result,indent=2));print('@@NATIVE_UI_RESULT',json.dumps(result),flush=True)
  close();return None
 except Exception:
  (D/'native-ceiling-ui-error.log').write_text(traceback.format_exc());print(traceback.format_exc(),flush=True);close();return None
bpy.app.timers.register(tick,first_interval=.2)
