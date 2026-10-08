Cyclotron launch: two PRs for volter-a3's review, one Mac run, and three items for the coder.

**For volter-a3, review at these heads:**
1. **editor #217** https://github.com/volter-ai/editor/pull/217, head 352162bcb4f3d8ea47665adbafa721096507aad1, rebased on main f3e7b692. These are the first-run fixes from the fresh-profile Windows run of 0.5.195:
   - Windows Sign in with ChatGPT: a sign-in PATH shim for supercode's os error 193.
   - create without the DEP0190 warning and without npm's allowScripts warnings.
   - Chat install prefix: a home folder that refuses the folder no longer fails the probe.
   - Chat welcome: Codex only (the owner's ruling).
   - README: the one-line install, and the Chat section as the welcome is now.
   Once approved, I merge it and release 0.5.196.
2. **sites #20** https://github.com/volter-ai/sites/pull/20, head 584976dad6decd4d05c6bc882bc41fbc94ea1dad. The owner's cold read found the home page gave no clear way to try Cyclotron. The change:
   - "Open Cyclotron", the browser editor, is the page's one action.
   - The install section is one line per OS through new install.ps1 and install.sh. They download Node.js 24 from nodejs.org, checksum-checked, if it's missing.
   - Why: the old `npx` line fails in a default Windows PowerShell (npx.ps1 is blocked by the Restricted policy).
   - I deploy only after 0.5.196 is out.

**For a Mac session (codex-01a115d9 or whoever is free): one run of install.sh.** I can't run it here, because this machine has no macOS and no WSL. Please run this in a throwaway home with no Node.js on PATH:

```
gh api -H 'Accept: application/vnd.github.raw' 'repos/volter-ai/sites/contents/model-editor/src/install.sh?ref=584976dad6decd4d05c6bc882bc41fbc94ea1dad' > /tmp/cyclotron-install.sh
env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin:/usr/sbin:/sbin TERM="$TERM" sh /tmp/cyclotron-install.sh
```

Expected: it downloads node-v24.x-darwin-arm64 from nodejs.org, says the checksum matched, creates ~/Cyclotron/my-race in that throwaway home, and the editor opens in the browser. Running the same command again with the same HOME should reopen the game with no download. Please send back the terminal output of both runs, and close the editor afterwards (`npx --no-install cyclotron close` in the game folder, with that PATH plus $HOME/.volter/node/bin).

**For the fleet coder (supercode, D228):**
1. **The Windows sign-in bug.** In `crates/harness/src/harness_auth.rs`, `find_executable` checks the bare name before PATHEXT. On Windows, npm installs an extensionless shell script next to `codex.cmd`, so `harness login codex` starts the script and fails with os error 193, "%1 is not a valid Win32 application". A first-time user's Sign in with ChatGPT then ends in "Sign-in didn't finish." `orchestrator.rs` `resolve_program_in` already resolves PATHEXT correctly. editor #217 carries a PATH-shim workaround until this is fixed.
2. **No "Sign in with Claude" row** in the Chat welcome or the New chat picker. The owner's ruling, 2026-10-07: "the point was sign in with chat gpt or use whatever we're already signed into locally". The welcome offers Sign in with ChatGPT only; any agent already signed in is used as it is. The editor already sends only Codex in setup.agents, so this is the extension's own row.
3. **The composer footer still says "Supercode"**, plus the "Models" chip. Per docs/CHAT-WELCOME.md there should be no internal names.
