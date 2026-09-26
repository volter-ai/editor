/**
 * Direct protocol transcription of Godot 3.6/4.7 PhysicsMaterial.
 *
 * The shared defaults and `computed_*` sign switches come from
 * `scene/resources/physics_material.{h,cpp}` in both engine lines. The negative value is not a
 * negative coefficient: Godot's contact-pair code interprets it as the authored side winning the
 * friction minimum, or as an absorbent bounce operand. Translation code carries only source data;
 * this copied runtime resource owns mutation, duplication and computed values.
 */
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
export interface GodotPhysicsMaterialState {
  readonly friction: number;
  readonly rough: boolean;
  readonly bounce: number;
  readonly absorbent: boolean;
}

export type GodotPhysicsMaterialListener = () => void;

export class GodotPhysicsMaterial {
  private frictionValue = 1;
  private roughValue = false;
  private bounceValue = 0;
  private absorbentValue = false;

  public constructor(initial: Partial<GodotPhysicsMaterialState> = {}) {
    registerGodotObjectIdentity(this, 'PhysicsMaterial');
    bindGodotResourceProtocol<GodotPhysicsMaterial>(this, {
      createDuplicate: (source) => new GodotPhysicsMaterial(source.state()),
    });
    if (initial.friction !== undefined) this.frictionValue = initial.friction;
    if (initial.rough !== undefined) this.roughValue = initial.rough;
    if (initial.bounce !== undefined) this.bounceValue = initial.bounce;
    if (initial.absorbent !== undefined) this.absorbentValue = initial.absorbent;
  }

  public get friction(): number {
    return this.frictionValue;
  }

  public set friction(value: number) {
    this.setFriction(value);
  }

  public setFriction(value: number): void {
    if (value === this.frictionValue) return;
    this.frictionValue = value;
    this.emitChanged('friction');
  }

  public getFriction(): number {
    return this.frictionValue;
  }

  public get rough(): boolean {
    return this.roughValue;
  }

  public set rough(value: boolean) {
    this.setRough(value);
  }

  public setRough(value: boolean): void {
    if (value === this.roughValue) return;
    this.roughValue = value;
    this.emitChanged('rough');
  }

  public isRough(): boolean {
    return this.roughValue;
  }

  public get bounce(): number {
    return this.bounceValue;
  }

  public set bounce(value: number) {
    this.setBounce(value);
  }

  public setBounce(value: number): void {
    if (value === this.bounceValue) return;
    this.bounceValue = value;
    this.emitChanged('bounce');
  }

  public getBounce(): number {
    return this.bounceValue;
  }

  public get absorbent(): boolean {
    return this.absorbentValue;
  }

  public set absorbent(value: boolean) {
    this.setAbsorbent(value);
  }

  public setAbsorbent(value: boolean): void {
    if (value === this.absorbentValue) return;
    this.absorbentValue = value;
    this.emitChanged('absorbent');
  }

  public isAbsorbent(): boolean {
    return this.absorbentValue;
  }

  public computedFriction(): number {
    return this.roughValue ? -this.frictionValue : this.frictionValue;
  }

  public computedBounce(): number {
    return this.absorbentValue ? -this.bounceValue : this.bounceValue;
  }

  public state(): GodotPhysicsMaterialState {
    return {
      friction: this.frictionValue,
      rough: this.roughValue,
      bounce: this.bounceValue,
      absorbent: this.absorbentValue,
    };
  }

  public duplicate(_deep = false): GodotPhysicsMaterial {
    return new GodotPhysicsMaterial(this.state());
  }

  public onChanged(listener: GodotPhysicsMaterialListener): () => void {
    const connection = godotResourceChangedSignal(this).connect(listener);
    return () => connection.disconnect();
  }

  private emitChanged(property: keyof GodotPhysicsMaterialState): void {
    void property;
    godotResourceEmitChanged(this);
  }
}

export function createGodotPhysicsMaterial(
  initial: Partial<GodotPhysicsMaterialState> = {},
): GodotPhysicsMaterial {
  return new GodotPhysicsMaterial(initial);
}
