/**
 * THIS GAME'S OWN INPUT STORE — the one place its actions are declared and
 * held. Mechanics read it directly ({@link actionPressed}); the QA tester
 * actuates it ({@link setVirtualAction}); the session input door
 * reaches the SAME store by importing this running module through
 * `game.run(({ modules }) => ...)`. No vgai import anywhere — input is
 * application state, and the host merely gives the developer access to the
 * module instance the game already uses.
 *
 * The neutral scaffold declares NO actions yet: a game should not inherit a
 * control scheme before its brief supplies one. Add your actions to
 * {@link gameActions}, map keys in {@link keyActions}, and read
 * `actionPressed('jump')` from the mechanic that cares.
 */

/** Every input action this game declares. Empty until the game earns one. */
export const gameActions = [] as const satisfies readonly string[];
export type GameAction = (typeof gameActions)[number];

export type ActionValue = boolean | number | { readonly x: number; readonly y: number };

const virtual = new Map<string, ActionValue>();
const keysDown = new Set<string>();

/** Physical key code → action. Empty until {@link gameActions} has entries. */
const keyActions: Readonly<Record<string, GameAction>> = {};

export function isGameAction(value: string): value is GameAction {
  return (gameActions as readonly string[]).includes(value);
}

function requireAction(action: string): GameAction {
  if (!isGameAction(action)) {
    throw new Error(
      `Unknown input action "${action}" — this game declares ${
        gameActions.length === 0 ? 'none yet (add yours in src/input.ts)' : gameActions.join(', ')
      }.`,
    );
  }
  return action;
}

/** The tester's and the session door's write path. */
export function setVirtualAction(action: string, value: ActionValue): void {
  virtual.set(requireAction(action), value);
}

/** Let go of everything virtual — a human taking the seat back never inherits
 *  a held key. */
export function clearVirtualActions(): void {
  virtual.clear();
}

/** What a mechanic reads each frame: virtual actuation OR the real keyboard. */
export function actionPressed(action: GameAction): boolean {
  const held = virtual.get(action);
  if (held === true) return true;
  for (const [code, mapped] of Object.entries(keyActions)) {
    if (mapped === action && keysDown.has(code)) return true;
  }
  return false;
}

/**
 * Attach the physical keyboard half of the store, and hand back the detach.
 *
 * The caller is `<GameKeyboard/>` in `src/world.tsx`, whose effect cleanup runs
 * the returned function when the world unmounts. That lifetime is the whole
 * point: this used to attach at MODULE LOAD and nothing ever called the detach,
 * so every Play→stop left three window listeners behind and the editor's realm
 * audit reclaimed them with a standing console warning
 * (`Instance 1 stopped without releasing 3 window/document listeners`). A
 * listener whose owner cannot end it is a leak however small its handler is —
 * attach it from the thing that unmounts.
 *
 * `target` is a parameter (not a captured `window`) so a test can attach a fake.
 */
export function attachKeyboard(target: Window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (keyActions[event.code]) keysDown.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    keysDown.delete(event.code);
  };
  const onBlur = () => {
    keysDown.clear();
  };
  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
    keysDown.clear();
  };
}
