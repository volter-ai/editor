# Editor SDK

Extension, contribution and editor-session APIs for Volter Editor. This package
depends on the project contracts, not the editor implementation or game runtime.

The viewport presentation contract accepts a root identity and native mounted
adapter surface. It does not require a game's input system, loop or execution
API. Richer product-owned roots can satisfy that interface directly.

Account/generation projections, project-tool declarations and tab observations
used by this SDK live here, transferred from the former general SDK. They are
data contracts, not provider integrations. The rest of that old SDK is not
included by default. Editor appearance data types have one owner in the project
contract and are exposed through the SDK's contribution-facing entry points.

Run `npm run typecheck -w @volter/editor-sdk` through the active World. This
package is private during migration. Existing session wire names remain intact
until their host and Code-OSS consumers move together; package renaming alone
does not complete product branding or consumer cutover.
