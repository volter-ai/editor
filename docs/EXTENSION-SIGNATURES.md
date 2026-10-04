# Open VSX extension installs

The workbench overlay disables Microsoft's repository-signature verification in
the shared Node `ExtensionManagementService.downloadExtension` method. Both
`workbench.extensions.installExtension` (including Chat's Sign in with ChatGPT)
and the Extensions view reach this installer. No user setting is needed, and a
user setting cannot enable a verifier this distribution does not ship.

This follows the source mechanisms inspected on 2026-10-04:

- [VSCodium's signature patch at 5a73682](https://github.com/VSCodium/vscodium/blob/5a73682ca091082675b10c9dc3f348c1d824d94f/patches/00-extension-disable-signature-verification.patch)
  replaces the configuration lookup with `verifySignature = false;`, removes
  the unused configuration key import, and marks the retained injected service
  as unused. Its [build preparation](https://github.com/VSCodium/vscodium/blob/5a73682ca091082675b10c9dc3f348c1d824d94f/prepare_vscode.sh#L39)
  configures `https://open-vsx.org/vscode/gallery` and applies `patches/*.patch`.
- [code-server's signature patch at 067f1e3](https://github.com/coder/code-server/blob/067f1e35ddb928ad603ab7f1648af12310152efd/patches/signature-verification.diff)
  says "Disable signature verification." and likewise sets
  `verifySignature = false;` in that method. Its
  [marketplace patch](https://github.com/coder/code-server/blob/067f1e35ddb928ad603ab7f1648af12310152efd/patches/marketplace.diff)
  supplies Open VSX as the default gallery.

The overlay applies the equivalent patch at the pinned fork, preserves the DI
constructor shape, and refuses changed upstream text. It is idempotent for
source workbench restarts and is compiled into released workbenches.

## What remains verified

Downloads still use the configured Open VSX HTTPS endpoints, with normal TLS
certificate and transport integrity checks. The upstream downloader still
validates the VSIX archive's `extension/package.json` before installation;
normal extraction, manifest, compatibility and allowed-extension checks remain.

Microsoft repository signatures, their certificate trust, and their signed
per-file integrity checks are **not** verified. The inspected gallery download
path does not independently compare the VSIX to an Open VSX SHA-256 checksum;
this change must not be described as adding such verification. ZIP/manifest
validation and HTTPS are not publisher-signature verification.

The product's workbench archive is separate: the locator still verifies its
pinned `tarballSha256` when downloading the GitHub release.
