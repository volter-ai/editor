/*---------------------------------------------------------------------------------------------
 * Copyright (c) Volter. All rights reserved.
 * Licensed under the MIT License. See License.txt in the Code-OSS source tree.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';

const CHAT_EXTENSION = new ExtensionIdentifier('volter-ai-dev.supercode-frontend-vscode');

/** A permit is valid only while its owning transaction is committing this resource. */
export interface HarnessChatNavigationPermit { readonly resource: string; }

export const IHarnessChatNavigationService = createDecorator<IHarnessChatNavigationService>('harnessChatNavigationService');
export interface IHarnessChatNavigationService {
	readonly _serviceBrand: undefined;
	readonly activeResource: string | undefined;
	readonly onDidChangeActiveResource: Event<void>;
	readonly outcome: 'idle' | 'activating' | 'committing' | 'failed';
	assertInteractive(resource: URI | undefined): void;
	run<T>(resource: URI, commit: (permit?: HarnessChatNavigationPermit) => Promise<T>, parent?: HarnessChatNavigationPermit, isCurrent?: () => boolean): Promise<T>;
	syncFocus(resource: URI | undefined, isCurrent: () => boolean, materialized: boolean): Promise<void>;
}

class HarnessChatNavigationService extends Disposable implements IHarnessChatNavigationService {
	declare readonly _serviceBrand: undefined;
	private tail: Promise<void> = Promise.resolve();
	private active: HarnessChatNavigationPermit | undefined;
	private _activeResource: string | undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChangeActiveResource = this.changed.event;
	get activeResource(): string | undefined { return this._activeResource; }
	outcome: 'idle' | 'activating' | 'committing' | 'failed' = 'idle';

	constructor(
		@ICommandService private readonly commands: ICommandService,
		@IExtensionService private readonly extensions: IExtensionService,
	) { super(); }

	private authorize(resource: string): void {
		this._activeResource = resource;
		this.changed.fire();
	}

	assertInteractive(resource: URI | undefined): void {
		if (resource?.scheme === 'supercode' && !resource.path.startsWith('/untitled-')
			&& resource.toString() !== this._activeResource) {
			throw new Error('Open this conversation from history before responding.');
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		// A failed request must reject its caller, but cannot poison later navigation.
		this.tail = result.then(() => undefined, () => undefined);
		return result;
	}

	private activateExtension(): Promise<void> {
		return this.extensions.activateById(CHAT_EXTENSION, {
			startup: false, extensionId: CHAT_EXTENSION, activationEvent: 'onChatSession:supercode',
		});
	}

	run<T>(resource: URI, commit: (permit?: HarnessChatNavigationPermit) => Promise<T>, parent?: HarnessChatNavigationPermit, isCurrent: () => boolean = () => true): Promise<T> {
		if (!isCurrent()) { return Promise.reject(new CancellationError()); }
		if (resource.scheme !== 'supercode' || resource.path.startsWith('/untitled-')) {
			return commit();
		}
		const key = resource.toString();
		if (parent && parent === this.active && parent.resource === key) {
			return commit(parent);
		}
		return this.enqueue(async () => {
			if (!isCurrent()) { throw new CancellationError(); }
			await this.activateExtension();
			if (!isCurrent()) { throw new CancellationError(); }
			// This command awaits the frontend/host's live busy and approval guard.
			// Never use frontend.openSession: it reveals through this native boundary.
			this.outcome = 'activating';
			try { await this.commands.executeCommand('supercode.frontend.activateSession', key); }
			catch (error) { this.outcome = 'idle'; throw error; }
			// Activation succeeded. Expose its actual identity even if native commit fails.
			this.outcome = 'committing';
			this.authorize(key);
			const permit = this.active = { resource: key };
			try {
				if (!isCurrent()) { throw new Error('Conversation activated, but its native navigation target became unavailable.'); }
				await this.focus(resource);
				const result = await commit(permit);
				this.outcome = 'idle';
				return result;
			} catch (error) { this.outcome = 'failed'; throw error; }
			finally { this.active = undefined; }
		});
	}

	private async focus(resource: URI | undefined): Promise<void> {
		if (CommandsRegistry.getCommand('supercode.frontend.focusSession')) {
			await this.commands.executeCommand('supercode.frontend.focusSession', resource?.toString());
		}
	}

	syncFocus(resource: URI | undefined, isCurrent: () => boolean, materialized: boolean): Promise<void> {
		const bound = resource?.scheme === 'supercode' && !resource.path.startsWith('/untitled-');
		// A first bound restore has no outgoing authorized conversation to replace.
		if (bound && this._activeResource === undefined && !materialized) {
			return this.run(resource, async () => { if (isCurrent()) { await this.focus(resource); } }, undefined, isCurrent);
		}
		return this.enqueue(async () => {
			if (!isCurrent()) { return; }
			await this.activateExtension();
			if (!isCurrent()) { return; }
			// Materialization belongs to the request that just bound this same draft.
			if (bound && materialized) { this.authorize(resource.toString()); }
			// Reading an inactive native pane is passive; it does not replace runtime focus.
			if (bound && resource.toString() !== this._activeResource) { return; }
			await this.focus(resource);
		});
	}
}

registerSingleton(IHarnessChatNavigationService, HarnessChatNavigationService, InstantiationType.Delayed);
