The owner's cold read of cyclotron.videogame.ai: a newcomer can't tell what to do. The install box started with "Install Node.js", gave a download size, and assumed a terminal user. Its `npx` line also fails in a default Windows PowerShell: `npx.ps1 cannot be loaded because running scripts is disabled on this system` (reproduced on volter-desktop, policy Restricted).

**Open Cyclotron is the page's one action**, in the hero and the header. It opens the browser editor (cyclotron-web.videogame.ai) in its own tab, with no install and no account. build.mjs writes the link from `--embed-url`; with `--embed-preview` it goes to the trial section. The Quick install popover is gone.

**Install section: one line for this computer, then Sign in with ChatGPT.** Windows or macOS · Linux is picked from the browser's platform; without script, both lines show, each with its own instruction. There's no Node.js step and no size.
- Windows: `irm https://cyclotron.videogame.ai/install.ps1 | iex`
- macOS / Linux: `curl -fsSL https://cyclotron.videogame.ai/install.sh | sh`

**The scripts** (`model-editor/src/install.ps1`, `install.sh`) are served as text with `no-cache` via `_headers`. install.sh is written with LF whatever the checkout has.
- They use the visitor's Node.js when it is 24 or later on a Cyclotron platform (win32-x64, darwin-arm64, linux-x64). Otherwise they download the latest Node.js 24 from nodejs.org into `~/.volter/node`, verify it against nodejs.org's SHA256SUMS, and touch nothing outside home.
- They create `~/Cyclotron/my-race` (playable) with `npx --yes @volter/cyclotron@latest create`. A later run reopens it with the project's own install, and first finishes the npm install if an earlier run stopped partway. They refuse an unrelated folder at that path.
- On Windows, npm runs through `npx.cmd` and `npm.cmd`, because PowerShell's default policy refuses the `.ps1` shims. The script runs in one script block, so nothing is left defined, and a failure prints one red line instead of closing the window.
- npm's update, funding and audit notices are off for the run.
- On anything else (Intel Mac, Linux arm64, Git Bash on Windows), install.sh stops with a one-line reason; on Windows it gives the PowerShell line.

**What I ran:**
- **install.ps1, fresh profile:** Windows PowerShell 5.1 under the default Restricted policy, with a throwaway USERPROFILE, APPDATA and npm cache and a PATH holding only Windows. It downloaded and verified node-v24.21.0-win-x64, created `my-race`, installed the workbench, and opened the editor.
- **install.ps1, second run:** opened the same game with no download.
- **install.sh from Git Bash:** gives the Windows message.
- **install.sh on macOS and Linux:** not run here (no WSL on this machine). The macOS run is requested on the fleet Mac.
- **Page:** built and eye-checked at 1280px and 390px (hero, install section, both OS lines).

**Deploy order:** after editor #217 ships as 0.5.196. That release fixes Windows Sign in with ChatGPT; 0.5.195 fails it with os error 193. editor #217 also carries the matching README text, which this site's claims rule needs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
