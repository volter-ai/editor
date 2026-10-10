# Shared Chat draft cache correction

The source pin in `packages/editor-core/workbench/FORK.json` moves from
`4782d9a281ef4613e595b28fccd90a2e56890a6b` to
`aa2151fe979986e295bc96821356136e869102ca`, the pushed source of
[Code-OSS PR #14](https://github.com/volter-ai/code-oss/pull/14).
The fork branch is declared explicitly while that change is unmerged.

The native view, editor and quick Chat composers share `chat.untitledInputState`.
Previously each `ObservableMemento` refreshed its cached value only on an
external storage event. A local clear after accepted input could leave a sibling
composer holding the old draft and able to supply it to a later empty chat.
The fork correction observes local and external changes, compares serialized
storage values to suppress self-notification, and lets observer-authored changes
persist after the incoming storage update. It preserves genuine unsent drafts,
key/scope filtering and disposal.

The companion [frontend PR #1502](https://github.com/volter-ai/supercode/pull/1502)
waits after canceled automatic navigation until its focus, conversation,
connection or live state changes, or an explicit refresh occurs. Cancellation
keeps the handoff incomplete and respects the native navigation/draft guard.

The actual fork module and source dependency graph passed a native module bundle
and targeted strict TypeScript compilation using the fork's browser declarations.
An initial type-check attempt incorrectly included Node timer declarations and
failed; that failed log remains retained with the successful browser check.
No automated test, fabricated callback, replay, sign-in, install or release ran.
The pin itself is source configuration, not a new workbench artifact: the current
published workbench declarations and hashes have not been rebuilt here.

The original Windows reading retained an empty input after native Enter,
reload and completion, then the sent text after full close/restart. It did not
retain the shutdown writer or a sibling cache instance. The source defect above
is established; its involvement in that incident is unmeasured. The requested
actual Windows reopen on the conversation with empty input and quiet logs remains
qualification work. Do not describe this source pin as a verified Windows fix.
