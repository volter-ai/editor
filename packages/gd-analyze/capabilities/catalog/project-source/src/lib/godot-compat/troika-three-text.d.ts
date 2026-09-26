/** The exact `troika-three-text` surface used by Godot Label3D compatibility. */
declare module 'troika-three-text' {
  import { Mesh } from 'three';
  import type {
    BufferGeometry,
    ColorRepresentation,
    MeshBasicMaterial,
  } from 'three';

  /** Troika's native text mesh; it remains the one Three world entity. */
  export class Text extends Mesh<BufferGeometry, MeshBasicMaterial> {
    text: string;
    fontSize: number;
    fillOpacity: number;
    outlineWidth: number | string;
    color: ColorRepresentation;
    anchorX: number | string;
    anchorY: number | string;
    outlineColor: ColorRepresentation;
    outlineOpacity: number;
    sync(callback?: () => void): void;
  }
}
