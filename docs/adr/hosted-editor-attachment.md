# Hosted editor attachment

Accepted for t_65c85042 / t_77d46857 (c16).

A hosted editor's session and project run inside the browser. Native session
registry discovery describes the host OS and must not claim to reach that tab.
The product exposes an explicit `hosted` command family; ordinary local commands
keep their existing project resolution. Both products share the kit implementation.

The hosted shell opts into the kit relay and browser adapter. The adapter forwards
only the existing `/__editor/*` HTTP routes to the session through the host's public
request API. EditorClient accepts an injected Fetch transport, so command bodies,
error envelopes, document operations and screenshots remain the editor's own.
There is no DOM inspector, browser automation connection, shell evaluator, or
scene-specific runner in the attachment. `hosted eval` evaluates the CLI expression
on the host against the normal LiveEditor/LiveTools bindings.

`hosted attach URL` creates a two-hour lease on that exact configured origin and
page. The CLI keeps its capability in an owner-only state file outside the project;
a separate worker capability goes into the page fragment and is removed when the
page consumes it. Neither credential is sent in HTTP URLs or printed. Attaching
again from the same directory refuses, so status checks do not create duplicate
tabs from that directory. At page entry, `prepareHostedEditorPage` takes an
exclusive Web Lock for the exact origin/path/query, before project boot. A later
attachment page sends its fresh worker capability over a same-origin
BroadcastChannel to that owner and stays idle; it never opens a second project.
The owner replaces its control connection, preserving the document and its HTTP
handler even after detach or expiry. Ordinary page opens also register, without
creating any relay capability. An unresponsive owner refuses rather than booting
a duplicate. `hosted detach` revokes the lease and preserves the browser document.
The ownership listener lives until pagehide. This shares the existing origin's
trust boundary; it is not isolation from hostile same-origin scripts.

Tabs opened before this ownership adapter was installed must be closed once
before upgrading. Their old JavaScript cannot receive a handoff. No document is
silently closed or reloaded to migrate them.

The deployment must explicitly enable the relay for its canonical HTTPS origin
(loopback HTTP is allowed for development). The relay limits leases, sockets,
concurrent requests, request size, response size, buffered output and lifetimes.
It admits one worker per lease, scopes client requests and cancellations, and
never replays a mutation after disconnect. Expiry or transport failure requires
an explicit new attachment. This channel grants control of the selected editor;
it is not a public read-only screenshot URL.

Targeted protocol proof: `npm run build:session -w @volter/editor-core` followed
by `node --test packages/editor-core/test/hosted-attachment.test.mjs`. These tests
prove routing, isolation, cancellation and refusal, not hosted scene rendering.
A separate reviewer runs the hosted product and reads its viewport screenshot.

## Commands and host integration

From one working directory:

```sh
cyclotron hosted attach https://host.example/cyclotron/my-project
cyclotron hosted status
cyclotron hosted eval 'editor.open("model:src/models/example.blend")'
cyclotron hosted eval 'editor.frameCost({frames:3})'
cyclotron hosted screenshot /tmp/model.png
cyclotron hosted detach
```

The same commands exist on `volter-game-editor`; hosted eval exposes the neutral
`editor`, `tools` and `session` bindings. A hosted screenshot captures the active document through `captureActiveDocument`,
the same document-owned capture used by the local screenshot command. Local session commands and their richer capture options remain
unchanged.

Hosted status/eval exit according to the requested operation. Retained session
console diagnostics are still printed to stderr, remain unacknowledged, and are
included in the editor's status; they do not change a successful operation into
exit 1. A command refusal or transport failure still exits nonzero. This matters
for hosted Code-OSS: its extension host catches an unavailable optional native
watchdog and continues, leaving an error in the session log. This policy does
not claim that the native addon runs in the browser, or hide shader warnings.

A Vite shell mounts `hostedAttachmentPlugin(canonicalOrigin)` from
`@volter/editor-core/server/hosted-attachment-vite`. An HTTP host instead mounts
`createHostedAttachmentRelay` from `server/hosted-attachment-relay`. The shell
loads `/__editor-hosted/client.js` whenever the deployment enables attachment,
including page opens without a fragment, and awaits `prepareHostedEditorPage`
before boot. A null result means handoff succeeded: show that the existing tab
is in use and do not boot. Otherwise report boot state and call `serve(fetchEditor)` with
its existing session HTTP transport once ready. The integration for Browser
Substrate lives in that repository's `examples/volter-editor`.
