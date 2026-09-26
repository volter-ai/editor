import type { EditorServerCompatibility } from '@volter/editor-sdk/session/editor-compatibility';
import enginePackage from '@volter/editor-project/package.json';
import { GAME_MANIFEST_VERSION } from '@volter/editor-project/manifest/schema';
// The kit's packages release in lockstep, so the SDK's version is the editor's.
import editorPackage from '../../package.json';

/** Build-time package identity shared by browser-only editor surfaces. */
export const BUNDLED_EDITOR_VERSION = editorPackage.version;
export const BUNDLED_ENGINE_VERSION = enginePackage.version;
export const BUNDLED_EDITOR_COMPATIBILITY: EditorServerCompatibility = {
  apiVersion: 1,
  engineVersion: BUNDLED_ENGINE_VERSION,
  manifestVersion: GAME_MANIFEST_VERSION,
  startedAt: 'browser-build',
  source: { state: 'current' },
};
