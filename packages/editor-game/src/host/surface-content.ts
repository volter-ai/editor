import type * as THREE from 'three';

const RENDERABLE_DOM_TAGS = new Set([
  'canvas',
  'svg',
  'img',
  'picture',
  'video',
  'input',
  'button',
]);
const NON_RENDERING_DOM_TAGS = new Set(['script', 'style', 'template']);

function elementIsHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (typeof getComputedStyle !== 'function') return false;
  const style = getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
}

function styledBoxRenders(element: Element): boolean {
  if (typeof getComputedStyle !== 'function') return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return false;
  const hasBackground =
    style.backgroundImage !== 'none' ||
    (style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)');
  return hasBackground || style.borderTopStyle !== 'none' || style.outlineStyle !== 'none';
}

function domNodeRenders(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
  if (!(node instanceof Element)) return false;
  const tag = node.tagName.toLowerCase();
  if (NON_RENDERING_DOM_TAGS.has(tag) || elementIsHidden(node)) return false;
  if (RENDERABLE_DOM_TAGS.has(tag)) return true;
  for (const child of node.childNodes) if (domNodeRenders(child)) return true;
  return styledBoxRenders(node);
}

/** Structural DOM content test used after React has committed into a root. */
export function domHasRenderableContent(root: HTMLElement): boolean {
  for (const child of root.childNodes) if (domNodeRenders(child)) return true;
  return false;
}

function threeObjectCanRender(object: THREE.Object3D, ignoredLayer?: number): boolean {
  const candidate = object as THREE.Object3D & {
    isMesh?: boolean;
    isLine?: boolean;
    isPoints?: boolean;
    isSprite?: boolean;
    material?: THREE.Material | THREE.Material[];
  };
  if (ignoredLayer !== undefined && candidate.layers.mask >>> 0 === (1 << ignoredLayer) >>> 0) {
    return false;
  }
  if (!candidate.isMesh && !candidate.isLine && !candidate.isPoints && !candidate.isSprite) {
    return false;
  }
  const materials = Array.isArray(candidate.material)
    ? candidate.material
    : candidate.material
      ? [candidate.material]
      : [];
  return materials.length === 0 || materials.some((material) => material.visible);
}

/** Whether a Three scene can contribute pixels without editor-only helpers. */
export function threeSceneHasRenderableContent(
  scene: THREE.Scene,
  options: { readonly includeBackground?: boolean; readonly ignoredLayer?: number } = {},
): boolean {
  if (options.includeBackground !== false && scene.background !== null) return true;
  const pending: THREE.Object3D[] = [scene];
  while (pending.length > 0) {
    const object = pending.pop();
    if (!object || !object.visible) continue;
    if (object !== scene && threeObjectCanRender(object, options.ignoredLayer)) return true;
    for (let index = object.children.length - 1; index >= 0; index -= 1) {
      const child = object.children[index];
      if (child) pending.push(child);
    }
  }
  return false;
}
