/*---------------------------------------------------------------------------------------------
 * Copyright (c) Volter. All rights reserved.
 * Licensed under the MIT License. See License.txt in the Code-OSS source tree.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
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
	run<T>(resource: URI, commit: (permit?: HarnessChatNavigationPermit) => Promise<T>, parent?: HarnessChatNavigationPermit): Promise<T>;
	syncFocus(resource: URI | undefined, isCurrent: () => boolean): Promise<void>;
}

class HarnessChatNavigationService implements IHarnessChatNavigationService {
	declare readonly _serviceBrand: undefined;
	private tail: Promise<void> = Promise.resolve();
	private active: HarnessChatNavigationPermit | undefined;

	constructor(
		@ICommandService private readonly commands: ICommandService,
		@IExtensionService private readonly extensions: IExtensionService,
	) { }

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

	run<T>(resource: URI, commit: (permit?: HarnessChatNavigationPermit) => Promise<T>, parent?: HarnessChatNavigationPermit): Promise<T> {
		if (resource.scheme !== 'supercode' || resource.path.startsWith('/untitled-')) {
			return commit();
		}
		const key = resource.toString();
		if (parent && parent === this.active && parent.resource === key) {
			return commit(parent);
		}
		return this.enqueue(async () => {
			await this.activateExtension();
			// This command awaits the frontend/host's live busy and approval guard.
			// Never use frontend.openSession: it reveals through this native boundary.
			await this.commands.executeCommand('supercode.frontend.activateSession', key);
			if (CommandsRegistry.getCommand('supercode.frontend.focusSession')) {
				await this.commands.executeCommand('supercode.frontend.focusSession', key);
			}
			const permit = this.active = { resource: key };
			try { return await commit(permit); }
			finally { this.active = undefined; }
		});
	}

	syncFocus(resource: URI | undefined, isCurrent: () => boolean): Promise<void> {
		return this.enqueue(async () => {
			if (!isCurrent()) { return; }
			await this.activateExtension();
			if (!isCurrent()) { return; }
			if (CommandsRegistry.getCommand('supercode.frontend.focusSession')) {
				await this.commands.executeCommand('supercode.frontend.focusSession', resource?.toString());
			}
		});
	}
}

registerSingleton(IHarnessChatNavigationService, HarnessChatNavigationService, InstantiationType.Delayed);
