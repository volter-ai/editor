import { readFileSync } from 'node:fs';
import { InputMapFileSchema } from '@volter/game-runtime/input/schema';

/**
 * Content validation for the project's structured input-map asset. Models,
 * materials, animation, images, and audio use their ecosystem-native formats
 * and are validated by their own loaders/tooling rather than vgai JSON schemas.
 */
export const ASSET_CONTENT_EXTENSIONS = ['.inputmap.json'] as const;

export function validateAssetContentFile(path: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (reason) {
    return [`${path}: invalid JSON — ${reason instanceof Error ? reason.message : String(reason)}`];
  }

  if (!path.endsWith('.inputmap.json')) {
    throw new Error(
      `validateAssetContentFile: "${path}" is not a supported structured asset (${ASSET_CONTENT_EXTENSIONS.join(', ')})`,
    );
  }
  const result = InputMapFileSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${path}: ${issue.path.join('.')}: ${issue.message}`);
}
