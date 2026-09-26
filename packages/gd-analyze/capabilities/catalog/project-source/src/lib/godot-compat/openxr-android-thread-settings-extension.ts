/** Godot OpenXR Android thread classification over a native runtime carrier. */

import { registerGodotObjectIdentity } from './object';

export const OPENXR_THREAD_TYPE_APPLICATION_MAIN = 0;
export const OPENXR_THREAD_TYPE_APPLICATION_WORKER = 1;
export const OPENXR_THREAD_TYPE_RENDERER_MAIN = 2;
export const OPENXR_THREAD_TYPE_RENDERER_WORKER = 3;

export interface GodotOpenXRAndroidThreadSettingsCarrier {
  setApplicationThreadType(threadType: number, threadId: number): boolean;
}

export class GodotOpenXRAndroidThreadSettingsExtension {
  constructor(private readonly carrier: GodotOpenXRAndroidThreadSettingsCarrier) {
    registerGodotObjectIdentity(this, 'OpenXRAndroidThreadSettingsExtension');
  }

  set_application_thread_type(threadType: number, threadId: number): boolean {
    if (!Number.isSafeInteger(threadType) || threadType < 0 || threadType > 3) {
      throw new RangeError('OpenXR Android thread_type is invalid.');
    }
    if (!Number.isSafeInteger(threadId) || threadId < 0) {
      throw new RangeError('OpenXR Android thread_id requires a non-negative integer.');
    }
    return Boolean(this.carrier.setApplicationThreadType(threadType, threadId));
  }
}

export function createGodotOpenXRAndroidThreadSettingsExtension(
  carrier: GodotOpenXRAndroidThreadSettingsCarrier,
): GodotOpenXRAndroidThreadSettingsExtension {
  return new GodotOpenXRAndroidThreadSettingsExtension(carrier);
}
