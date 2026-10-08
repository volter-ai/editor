What a first-time user hit in a fresh-profile run of 0.5.195 on Windows, fixed, plus the README for the new one-line install.

- **Windows Sign in with ChatGPT failed** with "Sign-in didn't finish." Supercode's sign-in lookup (`harness_auth.rs` `find_executable`) takes the bare name first, so `harness login codex` started npm's extensionless shell script: os error 193, "not a valid Win32 application". Until supercode resolves PATHEXT there, the sign-in terminal's PATH starts with a folder holding only the agent's `.cmd` (`codex.cmd`, `claude.cmd`), which calls npm's shim (`signInPath`, chat-setup.ts). The supercode bug goes to the fleet coder separately.
- **create printed Node 24's DEP0190 warning** in the first install: Windows now runs `npm install` through the shell as one string.
- **create printed npm 11's allowScripts warnings**: the new project's package.json approves its two install scripts (esbuild, msgpackr-extract) in npm's name-only form.
- **Chat's install prefix**: a home folder that refuses `~/.volter/agents` keeps the global prefix instead of failing the probe; Chat's own installs come first on PATH.
- **Chat welcome docs**: Sign in with ChatGPT, or whatever is already signed in here (the owner's ruling, 2026-10-07). The Claude row is drawn by Chat frontend 0.1.51 regardless of the host, so the host still lists Claude Code (`CHAT_SETUP_PROVIDERS`). That keeps the row working instead of dead until a frontend release drops it (fleet card t_be880329). The README says so (review P1).
- **README**: the browser editor, Building from source, the npx line for Command Prompt, and the home page's one line per OS (`irm https://cyclotron.videogame.ai/install.ps1 | iex`, `curl -fsSL https://cyclotron.videogame.ai/install.sh | sh`), and the Chat section as the welcome is now. It used to describe the retired OpenAI-extension flow. The scripts themselves are in volter-ai/sites (model-editor/src/install.ps1 and install.sh).

Typecheck: nothing new in the changed files. The worktree has no install, so I checked against another checkout's dependencies; the only errors were that checkout's own cross-package drift. No tests were run (repo rule).

Ships as 0.5.196. The home page change waits for this release.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
