export type WeaponKind = 'pistol' | 'rifle' | 'grenade';

export interface ArenaState {
  paused: boolean;
  kills: number;
  deaths: number;
  health: number;
  ammo: number;
  reserveAmmo: number;
  weapon: WeaponKind;
  ownedWeapons: readonly WeaponKind[];
  message: string;
  hitMarker: number;
  damagePulse: number;
  respawnRemaining: number;
  /** Whether the hostiles shoot back. Always true in ordinary play; `holdFire()`
   *  below turns it off so a collection run has a quiet arena to cross, and
   *  `resetArenaState` re-arms them. */
  enemyFire: boolean;
}

export const INITIAL_ARENA_STATE: ArenaState = Object.freeze({
  paused: false,
  kills: 0,
  deaths: 0,
  health: 100,
  ammo: 12,
  reserveAmmo: 48,
  weapon: 'pistol',
  ownedWeapons: Object.freeze(['pistol'] as WeaponKind[]),
  message: '',
  hitMarker: 0,
  damagePulse: 0,
  respawnRemaining: 0,
  enemyFire: true,
});

let snapshot: ArenaState = {
  ...INITIAL_ARENA_STATE,
  ownedWeapons: [...INITIAL_ARENA_STATE.ownedWeapons],
};

export function getArenaState(): ArenaState {
  return snapshot;
}

const listeners = new Set<() => void>();

/** Subscribe to snapshot replacement — the HUD's `useSyncExternalStore` door.
 *  Reads stay `getArenaState()`; there is no payload. */
export function subscribeArenaState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyArenaState(): void {
  for (const listener of listeners) listener();
}

export function setArenaState(patch: Partial<ArenaState>): void {
  const next = { ...snapshot, ...patch };
  if (
    (Object.keys(patch) as (keyof ArenaState)[]).every((key) => Object.is(snapshot[key], next[key]))
  )
    return;
  snapshot = next;
  notifyArenaState();
}

export function resetArenaState(): void {
  snapshot = { ...INITIAL_ARENA_STATE, ownedWeapons: [...INITIAL_ARENA_STATE.ownedWeapons] };
  notifyArenaState();
}

export function toggleArenaPause(): void {
  setArenaState({ paused: !snapshot.paused });
}

export function damagePlayer(amount: number): void {
  if (snapshot.paused || snapshot.respawnRemaining > 0 || snapshot.health <= 0) return;
  setArenaState({ health: Math.max(0, snapshot.health - amount), damagePulse: 1 });
}

export const WEAPON_CAPACITY: Record<WeaponKind, number> = {
  pistol: 12,
  rifle: 30,
  grenade: 5,
};

export const WEAPON_PICKUP_AMMO: Record<WeaponKind, number> = {
  pistol: 48,
  rifle: 90,
  grenade: 12,
};

// --- Setting up a match situation --------------------------------------------
//
// Ordinary exported functions over this module's own store, reached from the
// REPL as
// `game.run(async ({ modules }) => (await modules('src/arena-state.ts')).holdFire())`
// and from any editor contribution this game writes (`src/tools/`). Module
// scope, because they set up the MATCH, not any one component's mount.
//
// The two readings worth pulling out of `getArenaState()` are `respawnRemaining`
// and `enemyFire`: the arena prints no respawn banner at all (you are simply not
// playing, and nothing on screen says for how much longer), and a disarmed arena
// looks identical to an armed one until you stand in the open and wait to find
// out. Everything else the HUD already shows an inch above.

/** Silence the opposition — a quiet arena to cross, what a traversal or pickup
 *  pass needs. `resetArenaState()` re-arms them. */
export function holdFire(): void {
  setArenaState({ enemyFire: false, message: 'HOSTILES HOLDING FIRE' });
}

/** Re-arm the opposition. */
export function openFire(): void {
  setArenaState({ enemyFire: true, message: '' });
}

/** Spend a life through the real death path — respawn timer, fall count and
 *  all. */
export function killPlayer(): void {
  setArenaState({ health: 0 });
}
