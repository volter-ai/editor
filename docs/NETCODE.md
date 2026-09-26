# Netcode in the editor and its references

A networked game in this editor is a Colyseus game: a room server the project runs as its `server`
configuration, and a client that joins it with `@colyseus/sdk`. The editor observes that client
(`packages/editor-game/src/services/game-network.ts`) and draws what it sees in the Network
inspector. Its nearest products are Godot's multiplayer tools, the reference for inspecting a
running networked game from its editor, and Colyseus Monitor, the reference for the room itself.

## Godot's multiplayer tools, as installed

Read from Godot 4.7.1 (`/opt/homebrew/bin/godot`) on 2026-09-26. The project hosted an ENet server,
launched a headless client of itself, replicated a node's position through a
`MultiplayerSynchronizer` and sent an RPC every frame. An editor plugin played it, started the
profiler, rendered the editor to an image and walked each panel's controls.

| Panel | What it owns |
|---|---|
| Debugger › Network Profiler | Start/Stop, Clear, Autostart; Down and Up bandwidth (B/s); an RPC table (Node, Incoming RPC, Outgoing RPC: count and bytes); a synchronizer table (Root, Synchronizer, Config, Count range, Size range) |
| Replication (bottom panel, with a synchronizer selected) | the synchronizer's properties: Add property to sync, a path field, and per property Spawn and Replicate (Never, Always, On Change) |
| Scene dock › Remote | the running game's live node tree, inspected like the local one |
| Debug menu | running several instances of the game at once |

Measured frame: the RPC table read `/root/World · - · 710 (7 B)` and the synchronizer table
`World · Sync · rep1 · 0 - 710 · 0 - 12`, with Up at 3.51 KiB/s.

## Colyseus Monitor, as installed

Read from `@colyseus/monitor` 0.17.8's own sources (its bundle's source map and `src-backend/api.ts`),
not a render.

| View | What it owns |
|---|---|
| Room list | Rooms, Connections, CPU and Memory; a table of roomId, name, clients, maxClients, locked, elapsedTime; Inspect and Dispose per room |
| Room | Broadcast and Dispose; Status (locked), Clients (n / max) and State Size; a Clients tab (sessionId, elapsed time, Send, Disconnect) and a State tab (the state as an editable JSON tree); refreshed every 5 s |
| Send | a message type and a JSON payload, to one client or all |

## Ours, mapped

| Our control | Owner in the references | State |
|---|---|---|
| Header: connection, room name, room id, session, entities | Monitor's Room status line | present |
| msgs and bytes in/out, with sparklines | Godot's Down/Up | present |
| Traffic table (type; in and out counts and bytes) | Godot's RPC and synchronizer tables | present; state and patches are rows of the same table |
| State tree | Monitor's State tab; Godot's Remote tree | present, read-only: a client cannot write authoritative state |
| Message log with Pause, Clear and a type filter | Godot's Start/Stop and Clear | present, always recording |
| Send (type, JSON payload) | Monitor's Send | into the room as this client; typing into it during Play is not walked (needs the workbench built with the focus gate) |
| Ping, and its round trip | (neither reference; Unity's multiplayer tools show RTT) | present: the SDK's own PING frame through the game's socket (walked: 2 ms on loopback) |
| Conditioner: latency and jitter, both directions, in order | Unity's network simulator | present; loss is stated as not simulated, because a WebSocket resends what it loses. Driving it during Play is not walked (needs the workbench built with the focus gate) |
| Run configuration `play + server`, and the Instances picker of a compound | Godot's multiple-instance run | present |

## Gaps, the work order

1. The rooms a session joined, as Monitor's room list (the observer keeps them; the inspector shows
   the current one).
2. The server's view: every client of a room and its elapsed time (Monitor's Clients tab) is the
   server's to report, and the room server does not expose it to the editor.
3. The schema's types beside the state tree (Godot's Replication panel shows what replicates; a
   Colyseus schema states it in the server's code).

Below this line is planning, not measurement: whether the server's view arrives through
`@colyseus/monitor`'s own API on the room server or through the editor's session is decided when
row 2 is built.
