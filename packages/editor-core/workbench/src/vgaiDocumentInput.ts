/*---------------------------------------------------------------------------------------------
 *  `VgaiDocumentInput`, in its OWN module because two modules need it.
 *
 *  WHY IT IS NOT IN `vgai.contribution.ts` ANY MORE: it was, and
 *  `vgaiDocuments.ts` imported it from there while the contribution imports
 *  `VgaiDocuments` back. That is a cycle, and the production build's own dependency
 *  checker fails on it by name — "CYCLIC dependency: vgai.contribution.js ->
 *  vgaiDocuments.js -> vgai.contribution.js" — measured cutting U3's release
 *  on 2026-09-20, the first time anyone ran the REH package target to completion.
 *  `compile-client` does not run that check, which is why U8 landed it green and
 *  nothing noticed for a day: only the production emit sees it.
 *
 *  A shared LEAF module is the break. This file imports nothing of either side, and
 *  both sides import it. The contribution still RE-EXPORTS the class, so an existing
 *  `import { VgaiDocumentInput } from './vgai.contribution.js'` keeps working.
 *
 *  IT HOSTS ANY VGAI DOCUMENT, and is named for it (P3, 2026-09-21). It was
 *  `VgaiModelInput` while the fork carried one contribution and that contribution was
 *  the Blender one — but the game editor's Game document has always ridden this same
 *  input and the same pane, so the name was a product's word on the kit's class.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { vgaiProduct } from './vgaiProduct.js';

/**
 * ONE EDITOR PER OPEN vgai DOCUMENT, plus the BOOTSTRAP one the mount opens
 * before any document exists (walk 3, beat 19).
 *
 * Until 2026-09-20 this was a singleton: whatever the editor's registry held,
 * the workbench had exactly ONE editor called `Model` and the bridge portalled
 * the ACTIVE document into it. That is why an ingest root — which opens two
 * documents, the honestly-empty Scene and the Game the pixels live in — had no
 * reachable Game under the frame at all: quick open's `edt ` listed one row
 * before and after `Run ingested game`, and `View: Open Next Editor` had
 * nothing to move to. The registry's open SET now has a representation in the
 * workbench, which is `vgaiDocuments.ts`'s job.
 *
 * `documentId === undefined` is the BOOTSTRAP input, and it exists for one
 * reason: the mount command must open an editor to get the centre part handed
 * over, and it has to do that BEFORE the bridge (and therefore any document)
 * exists. `VgaiDocuments` closes it once real documents are open — never
 * before, because an empty group detaches the pane's container and the React
 * portals with it.
 *
 * All of these share ONE `VgaiDocumentPane` instance per group (VS Code reuses a
 * pane for every input of its type), so switching between two vgai documents
 * calls `setInput` and never detaches the centre part.
 */
export class VgaiDocumentInput extends EditorInput {
	static readonly ID = 'workbench.input.vgaiDocument';
	private static _instance: VgaiDocumentInput | undefined;
	private static readonly _byDocument = new Map<string, VgaiDocumentInput>();
	static get instance(): VgaiDocumentInput {
		if (!VgaiDocumentInput._instance || VgaiDocumentInput._instance.isDisposed()) { VgaiDocumentInput._instance = new VgaiDocumentInput(); }
		return VgaiDocumentInput._instance;
	}
	/** The input for one open vgai document, minted once and RETITLED in place
	 *  when the document's own title moves (a dirty dot, a renamed model). */
	static forDocument(documentId: string, title: string): VgaiDocumentInput {
		let input = VgaiDocumentInput._byDocument.get(documentId);
		if (!input || input.isDisposed()) {
			input = new VgaiDocumentInput(documentId, title);
			VgaiDocumentInput._byDocument.set(documentId, input);
		} else if (input._title !== title) {
			input._title = title;
			input._onDidChangeLabel.fire();
		}
		return input;
	}
	private _title: string;
	readonly resource: URI;
	constructor(readonly documentId?: string, title?: string) {
		super();
		// The BOOTSTRAP input's name is the product's title (`Model`, `Game`) — it is the
		// editor a person sees for the beat before the first real document opens, and the
		// product is what that editor is. A build with no product half is refused by the
		// mount command long before this, so the generic name is a floor, not a fallback.
		this._title = title ?? vgaiProduct()?.title ?? localize('vgaiDocument', "Document");
		this.resource = URI.from({ scheme: 'vgai', path: documentId ? `document/${documentId}` : 'document' });
	}
	override get typeId(): string { return VgaiDocumentInput.ID; }
	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton; }
	override getName(): string { return this._title; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(other) || (other instanceof VgaiDocumentInput && other.documentId === this.documentId);
	}
}

/** Code-OSS persists tab placement and order; the registry restores document content. */
export class VgaiDocumentInputSerializer implements IEditorSerializer {
	canSerialize(input: VgaiDocumentInput): boolean { return input.documentId !== undefined; }
	serialize(input: VgaiDocumentInput): string {
		return JSON.stringify({ id: input.documentId, title: input.getName() });
	}
	deserialize(_instantiationService: IInstantiationService, value: string): VgaiDocumentInput | undefined {
		try {
			const data = JSON.parse(value);
			if (typeof data.id === 'string' && typeof data.title === 'string') {
				return VgaiDocumentInput.forDocument(data.id, data.title);
			}
		} catch { /* Invalid persisted input is omitted by native restoration. */ }
		return undefined;
	}
}
