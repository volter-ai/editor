import type { ToolAssetDocumentProps, ToolContributionSurfaces } from '@volter/editor-sdk/contributions';
import { type ComponentType, useCallback, useSyncExternalStore } from 'react';
import { AssetEditorSubject } from '@volter/editor-sdk/kit/components/AssetEditorShell';
import { contributionSurface, subscribeContributionSurfaces } from '@volter/editor-sdk/kit/contribution-surfaces';

/**
 * Registers the ordinary Asset Lab subject for a project-owned document. The
 * surface is intentionally childless: it registers a subject and draws nothing
 * of the document's own, which the document keeps rendering itself.
 */
export function ToolAssetDocumentSurface(props: ToolAssetDocumentProps) {
  return <AssetEditorSubject {...props} />;
}

const forwarders = new Map<string, ComponentType<object>>();

/**
 * Lightweight contribution boundary: the kit renders the surface a medium's integration
 * registered under `name` (`kit/contribution-surfaces`) and imports no viewport, so ToolHost
 * pulls no WebGL or model modules into Node tools and tests.
 */
function forwarder(name: string): ComponentType<object> {
  const existing = forwarders.get(name);
  if (existing) return existing;
  function ContributionSurface(props: object) {
    const read = useCallback(() => contributionSurface(name), []);
    const Surface = useSyncExternalStore(subscribeContributionSurfaces, read, read) as ComponentType<object> | null;
    if (!Surface) return <div style={{ minHeight: 240 }}>Loading {name}…</div>;
    return <Surface {...props} />;
  }
  ContributionSurface.displayName = `ContributionSurface(${name})`;
  forwarders.set(name, ContributionSurface);
  return ContributionSurface;
}

/** Stable dependency-injection value shared by every contribution mount: the kit's own surfaces,
 *  and a forwarder for each name a medium's integration adds. */
export const toolContributionSurfaces: ToolContributionSurfaces = new Proxy(
  Object.freeze({ AssetDocument: ToolAssetDocumentSurface }) as ToolContributionSurfaces,
  {
    get(target, name, receiver) {
      // A surface is a component, named like one; `then`, `toJSON` and the rest stay absent.
      if (typeof name !== 'string' || Reflect.has(target, name) || !/^[A-Z]/.test(name)) {
        return Reflect.get(target, name, receiver);
      }
      return forwarder(name);
    },
  },
);
