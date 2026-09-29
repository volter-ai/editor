/**
 * @godot-class Control
 * @role PROTOCOL
 *
 * The text a Control's element shows (a Label's, a Button's): the element's own first text node,
 * which its scene renders before its child elements, so a Label's children stay as they are when
 * its text changes. Shared by `label.ts` and `button.ts`.
 */

import { godot_node_entity } from './node';

/**
 * The element of a Control that shows text.
 *
 * @godot Control (protocol)
 * @source scene/gui/label.cpp:1526
 */
export function godot_dom_text_element(self: object, member: string): HTMLElement {
  const entity = godot_node_entity(self) as unknown;
  if (typeof HTMLElement === 'undefined' || !(entity instanceof HTMLElement)) throw new Error(`godot-compat: ${member} on a node that is not a Control's element`);
  return entity;
}

/**
 * The element's own text: its first text node's.
 *
 * @godot Control (protocol)
 * @source scene/gui/label.cpp:1000
 */
export function godot_dom_text_get(element: HTMLElement): string {
  const node = [...element.childNodes].find((child) => child.nodeType === 3);
  return node?.nodeValue ?? '';
}

/**
 * Sets the element's own text, in its first text node, made before its child elements where it has none.
 *
 * @godot Control (protocol)
 * @source scene/gui/label.cpp:987
 */
export function godot_dom_text_set(element: HTMLElement, text: string): void {
  const node = [...element.childNodes].find((child) => child.nodeType === 3);
  if (node !== undefined) {
    if (node.nodeValue !== text) node.nodeValue = text;
    return;
  }
  // A checkbox's box comes before its text (`data-part`).
  const after = [...element.children].filter((child) => (child as HTMLElement).dataset['part'] !== undefined).at(-1);
  const made = element.ownerDocument.createTextNode(text);
  if (after !== undefined) after.after(made);
  else element.prepend(made);
}
