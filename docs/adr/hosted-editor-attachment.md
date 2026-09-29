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
tabs. `hosted detach` revokes the lease and preserves the browser document.

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
volter-model-editor hosted attach https://host.example/model-editor/my-project
volter-model-editor hosted status
volter-model-editor hosted eval 'editor.open("model:src/models/example.blend")'
volter-model-editor hosted eval 'editor.frameCost({frames:3})'
volter-model-editor hosted screenshot /tmp/model.png
volter-model-editor hosted detach
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
loads `/__editor-hosted/client.js` only for an attachment fragment, calls
`attachHostedEditorPage`, reports boot state, and calls `serve(fetchEditor)` with
its existing session HTTP transport once ready. The integration for Browser
Substrate lives in that repository's `examples/volter-editor`.
