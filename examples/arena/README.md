# First Person Arena

A premium first-person arena sample built as VGAI's counterpart to Unreal's
First Person template and Arena Shooter variant. It is intentionally a complete,
bright game slice rather than a mechanics test room.

The sample includes responsive mouse/gamepad movement, sprinting, jumping and
jump pads; pistol, rifle, and grenade-launcher pickups; a player character
derived from the humanoid seed (the Arena Vanguard — spec data in
`src/assets/player-character.ts`, fielded as a shadow avatar: the first-person
player is visible as its animated cast shadow, full-visible in edit mode);
the Redline enemy squad (breacher + overwatch variants derived from the
humanoid seed — spec data in `src/assets/enemy-characters.ts`) with
independently mixed locomotion and upper-body combat layers; combat,
damage, death, and respawn; and a React HUD driven through the engine game-state
bridge.

Open the project in the editor and enter Play mode:

```bash
npm run dev
```

Playtest it live: direct the resident tester by goal from the session
(`vgai eval 'return game.command("bot.goal", "<behavior>")'` — the
repertoire lives in `src/bot/behaviors.ts`), arrange situations with the
declared cheats, and read the emitted events. Play exercises ordinary
gameplay through the real input bindings and writes the persisted play log
(`logs/play-*.jsonl`).

Use `npm run dev:standalone` only for the standalone player view. Run `npm run typecheck`,
`npm run validate-manifest`, and `npm run validate-scenes` for project-local
validation.
