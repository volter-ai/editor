---
name: vgai-music
description: Compose this game's music as code the person edits with you in the editor's DAW, render it to seamless OGG loops, section loops, stems and stingers, and play them in the game. Use when asked to write, arrange, revise or deliver music or a stinger.
---

# Compose the game's music

A piece is a TypeScript module under `src/music/` whose default export renders
`@volter/dawproject` elements. The editor opens it as a document laid out like Bitwig
Studio: arranger, clip editor (notes, velocity, automation), device chain and mixer. Every
save re-mounts it, so the person watches it appear and hears it on the next loop, and every
gesture they make rewrites the literal it touched in this same file.

## Set up once

1. `npm run --silent vgai -- add music`: adds `@volter/dawproject` (the elements) and
   `@volter/editor-dawproject` (the document, the renderer, the checks) and copies
   `src/lib/music/music-player.ts`.
2. In `vgai.adapter.ts`, add the finder to the document table:
   `{ finder: 'piecesFromModules', include: ['src/music/**/*.tsx'] }`.
3. The instruments are General MIDI presets of the MuseScore General SoundFont (MIT):
   `curl -L -o sounds/MuseScore_General.sf3 https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3`
   (39.9 MB). A convolution reverb takes a stereo WAV impulse response at a project path.

## The elements

```tsx
import { Channel, Clip, Device, Marker, Note, Project, Send, Track, Transport } from '@volter/dawproject';

const BANK = 'sounds/MuseScore_General.sf3';

export default function Theme() {
  return (
    <Project>
      <Transport tempo={92} meter="4/4" />
      <Marker at="1" name="Explore" />
      <Track name="Flute">
        <Channel volume={-4} pan={0.1}>
          <Device plugin="soundfont" name="Flute" params={{ bank: BANK, program: 73 }} />
          <Send to="Hall" level={-12} />
        </Channel>
        <Clip at="1" bars={4} name="Theme">
          <Note at="1:1" pitch="E5" dur="q." vel={0.7} />
          <Note at="1:2.5" pitch="D5" dur="8" />
        </Clip>
      </Track>
      <Track name="Hall">
        <Channel role="effect" volume={-6}>
          <Device plugin="convolution" params={{ ir: 'ir/hall.wav', predelay: 20 }} />
        </Channel>
      </Track>
      <Track name="Master">
        <Channel role="master">
          <Device plugin="limiter" params={{ ceiling: -1 }} />
        </Channel>
      </Track>
    </Project>
  );
}
```

- `at` is an ABSOLUTE `bar:beat`, both from 1 (`9:2.5`); a clip or marker takes the bar alone
  (`at="9"`), a clip's length is `bars`.
- `pitch` is a note name (`C4` is middle C; `F#5`, `Bb3`); `dur` is `w h q 8 16 32`, a dot per
  `.`, `t` for a triplet, or a number of beats.
- `vel` 0–1; `volume` and send `level` in dB; `pan` −1…1.
- Instruments: `params.program` 0–127 (General MIDI), `params.drums: true` for percussion.
- Channels: `role="effect"` is a bus that `<Send to="…">` feeds; `role="master"` is the last
  stage. Devices on any channel, in order: `equalizer` (`bands: [{ type, freq, gain, q }]`,
  types `highPass lowPass lowShelf highShelf bell`), `compressor` (`threshold ratio attack
  release knee makeup`), `limiter` (`ceiling release`), `convolution` (`ir predelay wet`).
- Code that generates notes spells them with `formatAt(beats, beatsPerBar)` and
  `formatPitch(midi)` from `@volter/dawproject`.

## Expression

- `artic` on a note: `staccato`, `staccatissimo`, `tenuto`, `accent`, `marcato`, `legato`.
- A lane in a clip: `<Points target="cc11"><Point at="9:1" value={0.8} /></Points>` (0–1;
  `cc11` expression, `cc1` modulation, `cc64` sustain, `pitchbend` −1…1); points ramp to the
  next unless one says `hold`. In `<Transport>`, `<Points target="tempo">` takes BPM.
- `<Device plugin="humanize" params={{ timingMs: 14, velocity: 0.05, seed: 3 }} />`: seeded,
  so every render is the same.

## Compose in stages, one save per stage

The person is watching; each stage lands as its own save, sounds on its own, and passes the
checks before the next begins.

1. **Brief**: a comment at the top: mood, tempo, length in bars, form, where the game uses it
   (a loop per state, a stinger on an event).
2. **Ensemble**: tracks, channels, instruments, buses; no notes.
3. **Form and time**: `<Transport>` and a `<Marker>` per section. For a game, a section is a
   state the game switches between: write each so it loops into itself and can hand over to the
   others at a bar line.
4. **Harmony**: a chord table per section as a `const`, cadences marked, heard as a pad.
5. **Themes**: the melody as literal `<Note>`s.
6. **Parts, section by section**: melody, bass, inner voices, percussion.
7. **Expression and mix**: phrase dynamics, lanes, balance, space.

## Written and generated notes

Literal `<Note>`s are WRITTEN: the person drags, adds, deletes and reshapes them. Notes a
`.map()` produces are GENERATED: shown as ghosts that refuse, with the line that makes them.
Use code for material that follows a rule (a pad over the chord table), literals for what a
person will shape (melodies, bass lines). When they want to shape generated material, the clip
editor's Freeze writes it out, or run
`npx tsx node_modules/@volter/editor-dawproject/scripts/freeze-clip.ts src/music/<piece>.tsx --track <name> --clip <n>`.

Before rewriting a section, read what the person changed (`git diff`, `git log -p`): change
only what you were asked to, and leave their edits where they put them.

## Offer alternatives, scoped

When the person asks for another take on part of the music ("try the bridge melody another
way"), change only that region and offer choices rather than replacing their version: write each
alternative as a copy of the track (`Flute (alt 2)`) with `mute` on its channel, holding only
the region you were asked about. They compare in context by swapping mutes in the mixer
(mute the original, unmute one alternative) and keep one; then fold the kept notes back into
the original track and delete the copies.
Two or three alternatives that differ in one clear way each (contour, rhythm, register) are
worth more than many that differ a little.

## Checks you run without ears

After every stage, and fix what they report:

- `npx tsx node_modules/@volter/editor-dawproject/scripts/check-piece.ts src/music/<piece>.tsx`:
  clip bounds, whole bars, instrument ranges, parallel fifths and octaves, re-struck notes.
- `npx tsx node_modules/@volter/editor-dawproject/scripts/view-piece.ts src/music/<piece>.tsx --bars 5-8`:
  every part beat by beat; read the voicing and the cadences you planned (`~` marks generated notes).

Say what the numbers show; never claim how something sounds.

## Deliver to the game

The game ships the piece as mastered audio, never as its code. Render it with the project's
render tool, which writes into `public/music/<piece>/` and records every file it writes in
`.vgai/provenance.json`:

```bash
npm run --silent vgai -- eval 'return await tools.run("project.music.render", { piece: "src/music/theme.tsx", sections: true }, { confirm: true })'
npm run --silent vgai -- eval 'return await tools.run("project.music.render", { piece: "src/music/victory.tsx", oneShot: true }, { confirm: true })'
```

The answer's `data.report` is the render's `report.json`. For a draft you only want to measure,
`npx tsx node_modules/@volter/editor-dawproject/scripts/render-piece.ts . src/music/theme.tsx --out out/theme`
renders the same files outside `public/`, unrecorded.

- The folder gets the whole piece as a seamless loop (`theme.ogg`; `theme.wav` carries a
  `smpl` loop), `sections/<marker>.ogg` with `--sections` (each section its own seamless loop,
  at the whole mix's level), `stems/<track>.ogg`, and `report.json`.
- `--one-shot` is a stinger: one pass and its reverb tail, no loop.
- Loudness defaults to −18 LUFS integrated (`--target portable`); `--target console` is −24.
  The true peak stays under −1 dBTP.
- Read `report.json` before you call a render done: `problems` empty, `seamRatio` under 1 (no
  click at the loop point), `loudness.integratedLufs` within 1 LU of the target, and
  `stems.nullResidualDb` far below zero (the stems sum back to the mix).

## Play it in the game

```ts
import { createMusicPlayer, loadMusic } from './lib/music/music-player';

const render = await (await fetch('/music/theme/report.json')).json();
const buffers = await loadMusic(context, '/music/theme/', render);
const music = createMusicPlayer({ context, destination: musicBus, render, buffers });
music.play('Explore');            // a section's loop, by its marker
music.queue('Battle');            // switch on the next bar line; the old loop fades out
music.stinger(victory, 'bar');    // a one-shot (rendered with --one-shot) on the next bar line
```

`play(null, { stems: true })` plays the whole loop as its stems in sync, and
`music.layer('Horn', -60)` brings a part in or out.
