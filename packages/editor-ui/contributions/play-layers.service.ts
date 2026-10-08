/** DOM roots offered to playing stages, independent of a product or game loop. */
import { registerProjectPlayLayers } from '@volter/sdk/kit/project-play-layers';
import { resolveDomAdapter } from '@volter/editor-game/host/roots/react-root';
import { activeRealmServices } from '@volter/editor-game/host/realm-services';
import { fetchGameManifest } from '@volter/sdk/kit/manifest-project';
export const point = 'workspace.service';
export function start(): () => void {
  return registerProjectPlayLayers(async ({ projectRoot, epoch, container, onEntries }) => {
    const manifest = await fetchGameManifest();
    const roots = manifest.roots.filter(declaration => declaration.adapter.identity === 'dom');
    const entries = roots.flatMap(declaration => declaration.entry ? [declaration.entry] : []);
    onEntries(entries);
    const realm = await activeRealmServices(projectRoot, epoch);
    const disposals: (() => void)[] = [];
    const dispose = () => { for (const end of disposals.splice(0).reverse()) end(); };
    try {
      for (const declaration of roots) {
        const layer = document.createElement('div');
        Object.assign(layer.style, { position: 'absolute', inset: '0', zIndex: String(declaration.zOrder), pointerEvents: 'none' });
        layer.dataset.rootId = declaration.id;
        container.appendChild(layer);
        disposals.push(() => layer.remove());
        const adapter = await resolveDomAdapter(declaration, realm);
        const mounted = await adapter.mount({ container: layer });
        // Stop can be a parent React commit; unmount the independent root after it.
        disposals.push(() => queueMicrotask(() => mounted.dispose()));
      }
      return { entries, dispose };
    } catch (error) { dispose(); throw error; }
  });
}
