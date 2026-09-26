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
| Debugger › Network Profiler | Start/Stop, Clear, Autostart; Down and Up bandwidth (B/s); an RPC table (Node, Incoming RPC, Outgoing RPC: count and bytes); a synchronizer table (Root, Synchronizer, Config, Count, Size), each count and size cell a pair (`0 - 710`) |
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
| Traffic table (type; in and out counts and bytes) | Godot's RPC table | present: one row per message type, state and patches included |
| Entity table: each replicated entity (a root field, or a root collection's entry such as `players.<id>`), its syncs in (the state patches that changed it), the field changes they carried, and the size range of those patches | Godot's synchronizer table | present, in Godot's Count and Size pairs, incoming against outgoing (read as such from the frame, where the RPC table reads `710 (7 B)`: an inference). The outgoing half is zero by construction, since a Colyseus client sends no state, and each header says so (walked: a sent `position` gave `players.us8tOg1rE · 1 - 0 · 2 · 13 B - 0 B`). Partial: a patch's bytes cannot be split between the entities it carried, so the size is the whole patch's |
| State tree, its numbers, strings and booleans editable on the server | Monitor's State tab; Godot's Remote tree | partial: an edit goes through Monitor's `_editStateProperty` (walked: the player's `x` typed as 9 read 9 on the server); the tree is this client's copy; a key's × deletes it on the server through `_deleteStateProperty` (walked: deleting `orbs.orb_0` took the server's orbs from 6 to 5) |
| Start/Stop, Clear and Autostart in a bar above the tables they govern; the message log's type filter | Godot's profiler Start/Stop, Clear and Autostart | present: stopped, nothing is tallied (traffic, entities, log) while frames still pass; Autostart, kept per checkout and off unless chosen as Godot's is, decides once per run, at its first room socket, whether it starts recording; a reconnect inside the run keeps the person's Start or Stop (walked: the bar reads Stop, Clear, Autostart); Clear resets the log and both tables (walked: a send while stopped left every row unchanged and `position` read 2 out after three sends; with Autostart off a rerun started stopped with no rows; Clear, earlier, 2 rows to 0) |
| Send as this client (type, JSON payload) | (neither reference: Monitor's Send goes from the server to a client) | into the room as this client (walked on a workbench carrying the focus gate: `position` with `{"x":3,"y":0,"z":2}` moved the player to (3, 2) on the server, and typing "dddddddd" into the field left the running game's player where it was) |
| Ping, and its round trip | (neither reference; Unity's multiplayer tools show RTT) | present: the SDK's own PING frame through the game's socket, timed from the game's send to the game's receipt, so the conditioner's delay counts in both directions (walked: 1 ms on loopback; 402 ms with 200 ms latency) |
| Conditioner: latency and jitter, both directions, in order | Unity's network simulator | present; loss is stated as not simulated, because a WebSocket resends what it loses. Each incoming frame is delayed once and read by the inspector as the game receives it, so the tables and the log run with the game, not ahead of it (walked: 200 ms latency took Ping from 1 ms to 402 ms, both legs) |
| Server: rooms (name, id, clients, lock, age) sortable by any column, each with Dispose and, when not inspected, Inspect; connections, CPU, memory, state size; the inspected room's Broadcast; each client's Send and Disconnect, the message being the Send row's draft | Monitor's room list, room view and Clients tab | present, through Monitor's own API on the room server, which the editor's `server` configuration turns on (`VGAI_ROOM_MONITOR=1`; a production start leaves Monitor off). Walked: Broadcast and Send each delivered `hello` to this client; Dispose removed the room and disconnected it; Disconnect took this client to disconnected. Inspecting another room shows that room's own state from the server, and its edits and deletes act in that room (walked: with a second client in room B, deleting `orbs.orb_12` in B's tree took B from 6 orbs to 5 and left room A at 6). Sorting walked on the headers (Name ascending, then descending); a reorder and Dispose on an uninspected row were not seen, with one room up. Broadcast and a client's Send open Monitor's Send dialog, titled by its target ("Broadcast message to all clients", "Send message to client (id)"), editing the one message draft, which is kept per checkout as Monitor keeps its draft in browser storage (walked: Broadcast through the dialog delivered `hello` to this client and closed it; a client's Send opened titled with that client and the draft kept). The payload is Monitor's tree editor, values edited in place, keys and items added and removed, with a Text view of the raw JSON, and a first draft of `message_type` and `{}` as Monitor's (walked: the tree showed the stored `n: 1`, adding `x` = 3 made the text `{"n":1,"x":3}`, and the broadcast delivered 16 B). The inspected room has Monitor's Clients and State tabs; State is the server's state of that room, this client's own room included (walked: Clients (1), then State read the room's players and orbs). The dialog is drawn in the panel, not over the editor, because during Play a field over the editor hands the game every key typed into it. Partial: a leaf typed as `5` or `true` becomes that JSON value, where Monitor's editor has a type picker |
| Each state field's replicated type beside it (`float32`, `uint16`, `map<schema>`), read from the join handshake's schema reflection | Godot's Replication panel (what a synchronizer syncs) | partial: the types are shown (walked); a Colyseus schema syncs every declared field on change, so Godot's per-property Spawn and Replicate modes have no counterpart, and a nested schema reads `schema` because the reflection carries no class name |
| Player name (the adapter's identity, when it offers one) | (neither reference) | the Colyseus observer offers none, so it does not render |
| Run configuration `play + server`, and the Instances picker of a compound | Godot's multiple-instance run | present |

## Gaps, the work order

Judged against the references by an independent reviewer on 2026-09-26, ranked; Monitor's
server-side acts, the Replication types, a Clear that resets Traffic, the entity table, the
profiler bar with Start/Stop and Autostart (off by default), a Ping that counts both legs of the
conditioner, and the sortable room list with Dispose on every row are now present:

1. The entity table sizes whole patches, where Godot's size is one synchronizer's.
2. The Remote tree is this client's replicated copy, not the server's scene.

