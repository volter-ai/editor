/**
 * Recognizing WHICH canvas runtime a mounted game is actually running, from
 * that realm's own public handles.
 *
 * The host never infers a library from the manifest: a canvas root says
 * `canvas`, and which of Pixi/Phaser/Babylon draws on it is a fact about the
 * live realm. These two probes read the runtimes' OWN documented registries, so
 * a game that ships neither is answered `null` — and the mount fails by name
 * rather than being presented as a library it is not, or as an editable tree
 * the editor fabricated.
 */

import type { BabylonEngineLike } from './babylon-authoring-adapter';
import type { PhaserGameLike } from './phaser-live-authoring-adapter';

export interface PhaserRealmLike {
  Phaser?: { GAMES?: PhaserGameLike[] };
  /** Phaser 3.16 predates `Phaser.GAMES`; this is its standard public handle. */
  game?: PhaserGameLike;
}

export interface BabylonRealmLike {
  BABYLON?: { Engine?: { Instances?: BabylonEngineLike[] } };
  /** Host build seam for module-bundled Babylon, where no BABYLON global exists. */
  __vgaiBabylon?: {
    engines?: BabylonEngineLike[];
    /** Optional boot promise published by a host-built classic bundle. */
    ready?: PromiseLike<unknown>;
  };
}

/** Recognize Phaser through public realm handles across old and new Phaser 3. */
export function findPhaserGame(realm: PhaserRealmLike | null): PhaserGameLike | null {
  if (typeof realm?.game?.scene?.getScenes === 'function') return realm.game;
  const games = realm?.Phaser?.GAMES;
  if (!Array.isArray(games)) return null;
  return games.find((game) => typeof game?.scene?.getScenes === 'function') ?? null;
}

/** Recognize Babylon from its public engine registry or the module-build host seam. */
export function findBabylonEngine(realm: BabylonRealmLike | null): BabylonEngineLike | null {
  const bridged = realm?.__vgaiBabylon?.engines;
  const engines = Array.isArray(bridged) ? bridged : realm?.BABYLON?.Engine?.Instances;
  if (!Array.isArray(engines)) return null;
  return (
    [...engines]
      .reverse()
      .find((engine) => Array.isArray(engine?.scenes) && engine.scenes.length > 0) ?? null
  );
}
