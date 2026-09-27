/*---------------------------------------------------------------------------------------------
 *  `VolterDocumentInput`, in its OWN module because two modules need it.
 *
 *  WHY IT IS NOT IN `volter.contribution.ts` ANY MORE: it was, and
 *  `volterDocuments.ts` imported it from there while the contribution imports
 *  `VolterDocuments` back. That is a cycle, and the production build's own dependency
 *  checker fails on it by name — "CYCLIC dependency: volter.contribution.js ->
 *  volterDocuments.js -> volter.contribution.js" — measured cutting U3's release
 *  on 2026-09-20, the first time anyone ran the REH package target to completion.
 *  `compile-client` does not run that check, which is why U8 landed it green and
 *  nothing noticed for a day: only the production emit sees it.
 *
 *  A shared LEAF module is the break. This file imports nothing of either side, and
 *  both sides import it. The contribution still RE-EXPORTS the class, so an existing
 *  `import { VolterDocumentInput } from './volter.contribution.js'` keeps working.
 *
 *  IT HOSTS ANY VOLTER DOCUMENT, and is named for it (P3, 2026-09-21). It was
 *  `VolterModelInput` while the fork carried one contribution and that contribution was
 *  the Blender one — but the game editor's Game document has always ridden this same
 *  input and the same pane, so the name was a product's word on the kit's class.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { volterProduct } from './volterProduct.js';

/**
 * ONE EDITOR PER OPEN volter DOCUMENT, plus the BOOTSTRAP one the mount opens
 * before any document exists (walk 3, beat 19).
 *
 * Until 2026-09-20 this was a singleton: whatever the editor's registry held,
 * the workbench had exactly ONE editor called `Model` and the bridge portalled
 * the ACTIVE document into it. That is why an ingest root — which opens two
 * documents, the honestly-empty Scene and the Game the pixels live in — had no
 * reachable Game under the frame at all: quick open's `edt ` listed one row
 * before and after `Run ingested game`, and `View: Open Next Editor` had
 * nothing to move to. The registry's open SET now has a representation in the
 * workbench, which is `volterDocuments.ts`'s job.
 *
 * `documentId === undefined` is the BOOTSTRAP input, and it exists for one
 * reason: the mount command must open an editor to get the centre part handed
 * over, and it has to do that BEFORE the bridge (and therefore any document)
 * exists. `VolterDocuments` closes it once real documents are open — never
 * before, because an empty group detaches the pane's container and the React
 * portals with it.
 *
 * All of these share ONE `VolterDocumentPane` instance per group (VS Code reuses a
 * pane for every input of its type), so switching between two volter documents
 * calls `setInput` and never detaches the centre part.
 */
export class VolterDocumentInput extends EditorInput {
	static readonly ID = 'workbench.input.volterDocument';
	private static _instance: VolterDocumentInput | undefined;
	private static readonly _byDocument = new Map<string, VolterDocumentInput>();
	static get instance(): VolterDocumentInput {
		if (!VolterDocumentInput._instance || VolterDocumentInput._instance.isDisposed()) { VolterDocumentInput._instance = new VolterDocumentInput(); }
		return VolterDocumentInput._instance;
	}
	/** The input for one open volter document, minted once and RETITLED in place
	 *  when the document's own title moves (a dirty dot, a renamed model). */
	static forDocument(documentId: string, title: string): VolterDocumentInput {
		let input = VolterDocumentInput._byDocument.get(documentId);
		if (!input || input.isDisposed()) {
			input = new VolterDocumentInput(documentId, title);
			VolterDocumentInput._byDocument.set(documentId, input);
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
		this._title = title ?? volterProduct()?.title ?? localize('volterDocument', "Document");
		this.resource = URI.from({ scheme: 'volter', path: documentId ? `document/${documentId}` : 'document' });
	}
	override get typeId(): string { return VolterDocumentInput.ID; }
	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton; }
	override getName(): string { return this._title; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(other) || (other instanceof VolterDocumentInput && other.documentId === this.documentId);
	}
}

/** Code-OSS persists tab placement and order; the registry restores document content. */
export class VolterDocumentInputSerializer implements IEditorSerializer {
	canSerialize(input: VolterDocumentInput): boolean { return input.documentId !== undefined; }
	serialize(input: VolterDocumentInput): string {
		return JSON.stringify({ id: input.documentId, title: input.getName() });
	}
	deserialize(_instantiationService: IInstantiationService, value: string): VolterDocumentInput | undefined {
		try {
			const data = JSON.parse(value);
			if (typeof data.id === 'string' && typeof data.title === 'string') {
				return VolterDocumentInput.forDocument(data.id, data.title);
			}
		} catch { /* Invalid persisted input is omitted by native restoration. */ }
		return undefined;
	}
}
