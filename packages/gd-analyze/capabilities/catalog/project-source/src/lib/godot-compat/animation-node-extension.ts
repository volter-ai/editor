/** Godot AnimationNodeExtension processing protocol and timing helpers. */

import { registerGodotObjectIdentity } from './object';
import {
  packedFloat32Array,
  packedFloat64Array,
  type PackedFloat32Array,
  type PackedFloat64Array,
} from './packed-array';
import { bindGodotResourceProtocol } from './resource-io';

export interface GodotAnimationNodeExtensionHooks {
  _process_animation_node(playbackInfo: PackedFloat64Array, testOnly: boolean): Iterable<number>;
}

export interface GodotAnimationNodeInfo {
  readonly time: number;
  readonly length: number;
  readonly loopMode: number;
  readonly backward?: boolean;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`AnimationNodeExtension.${member} requires finite float.`);
  return value;
}

function nodeInfo(value: Iterable<number>): GodotAnimationNodeInfo {
  const data = [...value].map(Number);
  return {
    time: finite(data[0] ?? 0, 'node_info.time'),
    length: Math.max(0, finite(data[1] ?? 0, 'node_info.length')),
    loopMode: Math.trunc(data[2] ?? 0),
    backward: (data[3] ?? 0) !== 0,
  };
}

export class GodotAnimationNodeExtension {
  private lastPlaybackInfo: PackedFloat64Array = packedFloat64Array();
  private lastResult: PackedFloat32Array = packedFloat32Array();
  private lastTestOnly = false;

  constructor(private readonly hooks: GodotAnimationNodeExtensionHooks) {
    registerGodotObjectIdentity(this, 'AnimationNodeExtension');
    bindGodotResourceProtocol<GodotAnimationNodeExtension>(this, {
      createDuplicate: (source) => new GodotAnimationNodeExtension(source.hooks),
    });
  }

  _process_animation_node(playbackInfo: Iterable<number>, testOnly = false): PackedFloat32Array {
    const normalized = packedFloat64Array(playbackInfo);
    this.lastPlaybackInfo = packedFloat64Array(normalized);
    this.lastTestOnly = Boolean(testOnly);
    this.lastResult = packedFloat32Array(this.hooks._process_animation_node(normalized, this.lastTestOnly));
    return packedFloat32Array(this.lastResult);
  }

  is_looping(nodeInfoValue: Iterable<number>): boolean {
    const info = nodeInfo(nodeInfoValue);
    return info.loopMode !== 0 && info.length > 0;
  }

  get_remaining_time(nodeInfoValue: Iterable<number>, breakLoop = false): number {
    const info = nodeInfo(nodeInfoValue);
    if (info.length <= 0) return 0;
    const looping = info.loopMode !== 0 && !breakLoop;
    const time = looping
      ? ((info.time % info.length) + info.length) % info.length
      : Math.max(0, Math.min(info.length, info.time));
    return info.backward ? time : info.length - time;
  }

  get_last_playback_info(): PackedFloat64Array { return packedFloat64Array(this.lastPlaybackInfo); }
  get_last_result(): PackedFloat32Array { return packedFloat32Array(this.lastResult); }
  was_last_process_test_only(): boolean { return this.lastTestOnly; }
}

export function createGodotAnimationNodeExtension(
  hooks: GodotAnimationNodeExtensionHooks,
): GodotAnimationNodeExtension {
  return new GodotAnimationNodeExtension(hooks);
}
