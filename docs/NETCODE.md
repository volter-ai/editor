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
| Traffic table (type; in and out counts and bytes) | Godot's RPC and synchronizer tables | partial: one row per message type (state and patches included); no breakdown by entity or schema, no count and size ranges |
| State tree, its numbers, strings and booleans editable on the server | Monitor's State tab; Godot's Remote tree | partial: an edit goes through Monitor's `_editStateProperty` (walked: the player's `x` typed as 9 read 9 on the server); the tree is this client's copy; a key's × deletes it on the server through `_deleteStateProperty` (walked: deleting `orbs.orb_0` took the server's orbs from 6 to 5) |
| Message log with Pause, Clear and a type filter | Godot's Start/Stop and Clear | partial: always recording, and Pause and Clear touch the log only, not the Traffic totals |
| Send as this client (type, JSON payload) | (neither reference: Monitor's Send goes from the server to a client) | into the room as this client (walked on a workbench carrying the focus gate: `position` with `{"x":3,"y":0,"z":2}` moved the player to (3, 2) on the server, and typing "dddddddd" into the field left the running game's player where it was) |
| Ping, and its round trip | (neither reference; Unity's multiplayer tools show RTT) | present: the SDK's own PING frame through the game's socket (walked: 2 ms on loopback) |
| Conditioner: latency and jitter, both directions, in order | Unity's network simulator | present; loss is stated as not simulated, because a WebSocket resends what it loses. Not walked: its fields are scrub controls the document door's drag does not move |
| Server: rooms (name, id, clients, lock, age; Inspect another), connections, CPU, memory, state size; the inspected room's Broadcast and Dispose; each client's Send and Disconnect, the message being the Send row's draft | Monitor's room list, room view and Clients tab | present, through Monitor's own API on the room server, which the editor's `server` configuration turns on (`VGAI_ROOM_MONITOR=1`; a production start leaves Monitor off). Walked: Broadcast and Send each delivered `hello` to this client; Dispose removed the room and disconnected it; Disconnect took this client to disconnected. Inspect another room is not walked (one room ran) |
| Player name (the adapter's identity, when it offers one) | (neither reference) | the Colyseus observer offers none, so it does not render |
| Run configuration `play + server`, and the Instances picker of a compound | Godot's multiple-instance run | present |

## Gaps, the work order

Judged against the references by an independent reviewer on 2026-09-26, ranked; Monitor's
server-side acts, the first, are now present:

1. A Replication view: which fields the schema syncs, and their types (Godot's Replication panel).
2. Traffic by entity or schema with count and size ranges, and a Clear that resets it (Godot's two
   profiler tables).
