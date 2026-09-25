# Blender's factory 3D-viewport shading, read from the installed Blender (docs/VIEWPORT-STAGE.md).
#   Blender -b --factory-startup --python docs/reference-probes/blender-view3d-shading.py
# Prints the Material Preview defaults the editor's `blender-material-preview` view transcribes:
# studio light, its strength and rotation, World Opacity and blur, World Space Lighting, and
# whether scene lights and the scene world are used.
import bpy

for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            shading = area.spaces[0].shading
            print('studio_light', shading.studio_light)
            print('studiolight_intensity', shading.studiolight_intensity)
            print('studiolight_rotate_z', shading.studiolight_rotate_z)
            print('studiolight_background_alpha', shading.studiolight_background_alpha)
            print('studiolight_background_blur', shading.studiolight_background_blur)
            print('use_studiolight_view_rotation (World Space Lighting)', shading.use_studiolight_view_rotation)
            print('use_scene_lights', shading.use_scene_lights)
            print('use_scene_world', shading.use_scene_world)
            raise SystemExit
