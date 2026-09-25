/**
 * BLENDER'S WORLD STUDIO LIGHTS: the eight HDRIs Blender ships for Material Preview
 * (`datafiles/studiolights/world`, copied from Blender 5.2), registered as environment images
 * (`@volter/editor-sdk/kit/environment-images`) so a view can light by one and draw it behind
 * the scene. Material Preview opens on Forest. All CC0, by Greg Zaal (Poly Haven); the terms
 * and each original are in `studiolights/world/license.txt`.
 */
import type { EnvironmentImageSet } from '@volter/editor-sdk/kit/environment-images';
import city from './studiolights/world/city.exr?url';
import courtyard from './studiolights/world/courtyard.exr?url';
import forest from './studiolights/world/forest.exr?url';
import interior from './studiolights/world/interior.exr?url';
import night from './studiolights/world/night.exr?url';
import studio from './studiolights/world/studio.exr?url';
import sunrise from './studiolights/world/sunrise.exr?url';
import sunset from './studiolights/world/sunset.exr?url';

export const point = 'workspace.environment';
export const environment: EnvironmentImageSet = {
  id: 'blender-studiolights-world',
  source: "Blender's world studio lights, CC0 (Poly Haven); studiolights/world/license.txt",
  images: [
    { id: 'blender:forest', title: 'Forest', url: forest, format: 'exr' },
    { id: 'blender:city', title: 'City', url: city, format: 'exr' },
    { id: 'blender:courtyard', title: 'Courtyard', url: courtyard, format: 'exr' },
    { id: 'blender:interior', title: 'Interior', url: interior, format: 'exr' },
    { id: 'blender:night', title: 'Night', url: night, format: 'exr' },
    { id: 'blender:studio', title: 'Studio', url: studio, format: 'exr' },
    { id: 'blender:sunrise', title: 'Sunrise', url: sunrise, format: 'exr' },
    { id: 'blender:sunset', title: 'Sunset', url: sunset, format: 'exr' },
  ],
};
