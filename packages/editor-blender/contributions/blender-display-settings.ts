/**
 * THE SCENE'S DISPLAY TRANSFORM AS BLENDER HOLDS IT: `scene.view_settings` (view transform, look,
 * exposure in stops, gamma) read through the RNA door, as `BlenderDisplaySettings`. The Rendered
 * areas and Play draw through it (`blender-runtime.document.tsx`), and a web export carries it so
 * the page draws through the same OCIO processor (`blender-export.command.ts`).
 */
import type { BlenderDisplaySettings } from '@volter/blender-engine/browser/three/blender-display-transform';
import { blenderRna, blenderRnaContext } from '../host/blender-runtime-host';

/** Null while Blender's session has no scene to read; throws for a display device the browser
 *  has no processor for. */
export async function readBlenderDisplaySettings(): Promise<BlenderDisplaySettings | null> {
  const context = await blenderRnaContext();
  if (!context) return null;
  const [settings, displaySettings] = await Promise.all([
    blenderRna(`${context.scene}.view_settings`),
    blenderRna(`${context.scene}.display_settings`),
  ]);
  if (settings?.kind !== 'struct' || settings.type !== 'ColorManagedViewSettings') return null;
  if (displaySettings?.kind === 'struct') {
    const device = displaySettings.groups.flatMap(group => group.rows).find(row => row.identifier === 'display_device')?.value;
    if (typeof device === 'string' && device !== 'sRGB')
      throw new Error(`Blender display device ${device} has no browser display processor yet`);
  }
  const rows = settings.groups.flatMap(group => group.rows);
  const transform = rows.find(row => row.identifier === 'view_transform')?.value;
  const stops = rows.find(row => row.identifier === 'exposure')?.value;
  const look = rows.find(row => row.identifier === 'look')?.value;
  const gamma = rows.find(row => row.identifier === 'gamma')?.value;
  return {
    transform: typeof transform === 'string' ? transform : 'AgX',
    look: typeof look === 'string' ? look : 'None',
    exposure: typeof stops === 'number' ? 2 ** stops : 1,
    gamma: typeof gamma === 'number' ? gamma : 1,
  };
}
