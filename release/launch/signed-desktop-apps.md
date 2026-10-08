# Signed desktop apps for Cyclotron (scoping, 2026-10-08)

Read-only scoping; nothing built. Items marked *inferred* are reasoning from code and docs, not measured.

## Decision driver
The editor sends `Cross-Origin-Embedder-Policy: credentialless` on every route (`editor-core/server/packaged.ts`,
`frame-proxy.ts`, the view's service worker) and Blender's WebAssembly worker needs cross-origin isolation.
WebKit (Safari and macOS's WKWebView) has not implemented `credentialless`
([WebKit bug 230550](https://bugs.webkit.org/show_bug.cgi?id=230550), open). So:
- A Mac whose default browser is Safari most likely cannot run the editor today, in the browser trial or locally
  (*inferred, not yet tried in Safari*).
- A Tauri/Swift app on macOS (WKWebView) would hit the same wall. Windows' WebView2 is Chromium and would work.

## Recommendation: a thin Electron shell
- A window pointed at the local session (`cyclotron edit . --no-open`), bundling Node 24 + npm; first run does the
  installer's create-or-open of `~/Cyclotron/my-race`. Menu: New / Open folder / Upgrade.
- The editor itself is unchanged: npm packages and the pinned workbench are still fetched at run time (not bundled),
  so an editor release never needs an app release. electron-updater (GitHub Releases) updates the shell only.
- Size ~100-150 MB (*inferred*), small next to the 216 MB workbench download it fetches anyway.
- Electron majors ship every ~8 weeks with ~6 months of support: plan two bumps a year.

## Mac signing: mostly ready
- MacBook keychain: **Developer ID Application: Volter AI, Inc (R78F2929PW)**, valid to 2031-04-03.
  Also "Apple Development: Yueran Yuan" (development only).
- No **Developer ID Installer** identity: ship a signed, notarized, stapled `.app` in a signed `.dmg` (no `.pkg`).
- No notarytool keychain profile. **Owner, once:** an App Store Connect API key (Team key, best for CI) or an
  app-specific password, stored with `xcrun notarytool store-credentials`; export the Developer ID `.p12` for CI.
  Keep the $99/yr membership current (notarization stops if it lapses).
- Hardened runtime; entitlements `allow-jit` (plus Node's `allow-unsigned-executable-memory`,
  `disable-library-validation` only if testing needs them); sign inside-out; notarize; staple; check with `spctl`.

## Windows signing: not started
- **Azure Artifact Signing** (formerly Trusted Signing, GA Jan 2026): Basic $9.99/month, 5,000 signatures; needs a
  paid Azure subscription; organisation identity check **1-20 business days** (legal name/address, EIN, website,
  volter.ai email, a representative's ID). CI via `Azure/artifact-signing-action` with OIDC (`publish.yml` already has
  `id-token: write`).
- Alternative: OV certificate ~$130-400/yr, hardware token/HSM, max 460-day validity. Worse for CI. Skip EV.
- SmartScreen warns on any new identity until reputation builds ("weeks, hundreds of installs"); keep one identity.
- Risk (*inferred*): Smart App Control may block the workbench's unsigned native modules (affects today's installer too).

## Path
1. **Owner, Windows (longest wait, start first):** Azure subscription + Artifact Signing org validation.
2. **Owner, Mac:** notarization credential; `.p12` export for CI.
3. **Now, small, independent of the app:** detect Safari; on the page say "needs Chrome, Edge or Firefox"; locally, open
   Chrome/Edge/Firefox when the default is Safari, else say why.
4. Electron shell package (medium); editor-core: let the app own the window (`--no-open`, route later opens to it).
5. Mac sign/notarize on the MacBook (small); Windows sign once validated (small); `desktop.yml` CI + updater (medium).
6. Landing page: download buttons beside the one-line installers.

Money: ~$120/yr (Artifact Signing) + the existing $99/yr Apple membership.
Cannot be automated: Microsoft's identity check, creating the notarization credential, exporting the `.p12`.

Sources: WebKit 230550; Tauri HTTP headers and updater docs; WebView2 distribution; Artifact Signing quickstart, FAQ,
pricing; Azure/artifact-signing-action; SmartScreen reputation; DigiCert 460-day validity; Electron 40 and support
dates; electron-builder notarization; Apple hardened runtime.
