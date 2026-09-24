/**
 * The dataset key a host-made DOM stub carries (`ingest-root-adapter.ts`
 * creates them for a game's declared `domStubs`), so a served bundle's staged
 * page can retire the stub whose id it supplies itself (`served-html-boot.ts`).
 * Shared here because the two sides must agree on one mark.
 */
export const DOM_STUB_MARK = 'vgaiDomStub';
