# Enter before choosing a coding agent

The native Send action requires valid session options. When a Supercode Chat
has sendable input, invalid options and no request in progress,
`volter.chat.explainUnavailableSend` explains Enter with a notification. It
leaves the text, attachments and session intact. The existing native action
still handles valid sends. Focus in a quick-pick does not match this input
keybinding.

The paired frontend's read-only `supercode.frontend.sendRefusal` command can
name the unfinished agent choice or setup state. An older frontend without
that command receives the generic agent/model explanation. The frontend also
refuses a first send while its New Chat picker is unfinished or cancelled in
the current window, before native materialization accepts the input. Choosing
later does not automatically submit an earlier send.

Source: [editor PR #398](https://github.com/volter-ai/editor/pull/398) and
[Supercode PR #1540](https://github.com/volter-ai/supercode/pull/1540), board
`t_146a36d0` (c162). Editor base
`56c56c89ac6870a1828cbe403bc07b338bf83e13`; Code-OSS pin
`4782d9a281ef4613e595b28fccd90a2e56890a6b`.

## Evidence, 2026-10-10

The actual published frontend 0.1.58 still contains the pre-choice await and
has no `sendRefusal` command. Its registry tarball was downloaded and matches
the registry's SHA-512 integrity and SHA-1 shasum. The earlier 0.1.54 source
equivalence record remains historical evidence. These source readings do not
establish a keypress result on a published frontend.

The production frontend TypeScript compilation passes. The editor contribution
transpiles with native decorator settings. Two earlier compile-command failures
(lost JSON quoting, then omitted decorator settings) are retained. Records are
under `/Volumes/PeakSSD/volter-work/t08-r3-c162/`; the
[frontend evidence page](https://github.com/volter-ai/supercode/blob/fix/t_146a36d0-r3/docs/evidence/chat-unselected-send-2026-10-10.md)
names their scope and the published source digests.

No candidate live Chat operation was taken. The original Windows observation
did not record which keybinding or handler received its Enter presses, and
this source repair does not newly attribute them. Empty Chat Enter, retained
text, choosing an already signed-in agent, explicit resend and an older
published frontend reading still need product qualification. No complete
workbench typecheck or packaged build is claimed. No tests, sign-in, install,
publication or service change occurred.
