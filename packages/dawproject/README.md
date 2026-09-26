# @volter/dawproject

A piece of music as a React component. The elements are DAWproject's (the open
interchange format Bitwig and PreSonus publish): `Project`, `Transport`, `Track`,
`Channel`, `Send`, `Device`, `Clip`, `Note`, `Marker`, `Points`, `Point`. A
reconciler (`render.ts`, the shape of `@pixi/react`) mounts the component into a
plain graph, and `readPiece` (`piece.ts`) reads the graph as a piece. Nothing in
a piece imports anything but this package and its own modules.

```tsx
<Track name="Flute">
  <Channel volume={-3} pan={0.15}>
    <Device plugin="soundfont" params={{ bank: BANK, program: 73 }} />
    <Send to="Hall" level={-14} />
  </Channel>
  <Clip at="1" bars={8}>
    <Note at="1:1" pitch="F#5" dur="h" vel={0.6} />
    <Note at="1:3" pitch="E5" dur="q" artic="legato" />
  </Clip>
</Track>
```

Written units (`notation.ts`): `at` is an absolute `bar:beat`, `pitch` a note
name, `dur` a note value (`w h q 8 16 32`, dots, `t` for triplets). A `<Clip>`
takes `at` and `bars`; the transport takes `tempo` and `meter`.

`perform(piece)` (`perform.ts`) is the one performance both the editor's
preview and the export play: the tempo map (`<Points target="tempo">`, beats to
seconds), articulations, controller lanes sampled into events, and the
`humanize` device's seeded drift.

Apache-2.0. A piece carries this package when it ships.
