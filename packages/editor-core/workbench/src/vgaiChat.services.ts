/*---------------------------------------------------------------------------------------------
 * Copyright (c) Volter. All rights reserved.
 * Licensed under the MIT License. See License.txt in the Code-OSS source tree.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostEnablementService } from '../../../../platform/agentHost/browser/agentHostEnablementService.js';
import { IAgentHostEnablementService } from '../../../../platform/agentHost/common/agentHostEnablementService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IManagedSettingsService } from '../../../../platform/policy/common/copilotManagedSettings.js';

/** The editor delegates harness ownership to Supercode. A remote extension host
 * does not imply that Code-OSS should also start its built-in Copilot agent host.
 * Keep native Chat and extension session providers; select the runtime at the
 * service-composition boundary. `scripts/workbench/overlay.mjs` imports this after
 * the web service defaults, so this registration is the one that stands.
 */
export class VolterAgentHostEnablementService extends AgentHostEnablementService {
	constructor(
		@IConfigurationService configuration: IConfigurationService,
		@IContextKeyService contextKeys: IContextKeyService,
		@IManagedSettingsService managedSettings: IManagedSettingsService,
	) {
		super(false, configuration, contextKeys, managedSettings);
	}
}

registerSingleton(IAgentHostEnablementService, VolterAgentHostEnablementService, InstantiationType.Eager);
