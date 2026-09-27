/**
 * Render-mapping cases for the canvas drawn onto the page: a small tree mounted through compat,
 * drawn into a jsdom document by `godot_canvas_draw`, read back as the elements' styles.
 */
import { createRequire } from 'node:module';
import { Group, type Object3D, Scene } from 'three';
import * as CI from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-item';
import * as CL from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-layer';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/control';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as SV from '../../capabilities/catalog/project-source/src/lib/godot-compat/sub-viewport';

// jsdom ships no type declarations; the one constructor these cases use.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { readonly JSDOM: new (html: string) => { readonly window: Window } };

export interface Drawn {
  readonly viewport: Object3D;
  readonly root: HTMLElement;
  readonly node: (kind: 'CanvasLayer' | 'Control', name: string, parent?: Object3D, mount?: (entity: Object3D) => void) => Object3D;
  readonly draw: () => void;
  readonly style: (name: string) => string;
}

/** A tree root with a 640x360 viewport and a jsdom page to draw it on. */
export function drawn(): Drawn {
  const root = new Scene();
  ST.godot_tree_set_root(root);
  const viewport = new Scene();
  N.godot_node_adopt(viewport, { kind: 'node', classes: ['SubViewport', 'Viewport', 'Node'] });
  SV.set_size(viewport, { x: 640, y: 360 });
  N.add_child(root, viewport);
  const page = new JSDOM('<!doctype html><div id="canvas"></div>');
  const element = page.window.document.getElementById('canvas') as HTMLElement;
  return {
    viewport,
    root: element,
    node: (kind, name, parent, mount) => {
      const entity = new Group();
      entity.name = name;
      if (mount !== undefined) mount(entity);
      else if (kind === 'CanvasLayer') {
        N.godot_node_adopt(entity, { kind: 'node', classes: ['CanvasLayer', 'Node'] });
        CL.godot_canvas_layer_mount(entity);
      } else C.godot_control_mount(entity, ['Control', 'CanvasItem', 'Node']);
      N.add_child(parent ?? viewport, entity);
      return entity;
    },
    draw: () => CI.godot_canvas_draw(viewport, element),
    style: (name) => (element.querySelector(`[data-godot="${name}"]`) as HTMLElement | null)?.getAttribute('style') ?? '',
  };
}
