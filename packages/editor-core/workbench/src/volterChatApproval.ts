/*---------------------------------------------------------------------------------------------
 * Native confirmation presentation for an approval inside a running harness turn.
 * Stock confirmations send a new prompt; this versioned branch answers the original request.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { isResponseVM } from '../../chat/common/model/chatViewModel.js';
import { IChatConfirmation } from '../../chat/common/chatService/chatService.js';
import { IChatContentPartRenderContext } from '../../chat/browser/widget/chatContentParts/chatContentParts.js';
import { ChatConfirmationWidget } from '../../chat/browser/widget/chatContentParts/chatConfirmationWidget.js';
import { IHarnessChatNavigationService } from './volterChatNavigation.js';

interface ApprovalAnswer {
	connectionId: string;
	requestId: number;
	label: string;
	response: { request_id: number; kind: string };
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHarnessApproval(data: unknown): boolean {
	return record(data) && data.kind === 'supercode.inTurnApproval';
}

function isApprovalAnswer(answer: unknown): answer is ApprovalAnswer {
	return record(answer) && typeof answer.connectionId === 'string' && answer.connectionId.length > 0
		&& answer.connectionId.length <= 256 && typeof answer.requestId === 'number'
		&& Number.isSafeInteger(answer.requestId) && answer.requestId >= 0
		&& typeof answer.label === 'string' && record(answer.response)
		&& answer.response.request_id === answer.requestId
		&& typeof answer.response.kind === 'string' && ['approval', 'other'].includes(answer.response.kind)
		&& answer.promptForContent !== true;
}

function approvalAnswers(confirmation: IChatConfirmation): ApprovalAnswer[] {
	const data = confirmation.data;
	if (!record(data) || data.version !== 1 || !Array.isArray(data.answers) || data.answers.length === 0) {
		throw new Error('Invalid in-turn approval card.');
	}
	const answers: ApprovalAnswer[] = [];
	for (const answer of data.answers) {
		if (!isApprovalAnswer(answer)) {
			throw new Error('Invalid in-turn approval answer.');
		}
		if (answers.length && (answer.connectionId !== answers[0].connectionId || answer.requestId !== answers[0].requestId)) {
			throw new Error('Approval choices must address the same request.');
		}
		answers.push(answer);
	}
	if (!confirmation.buttons || confirmation.buttons.length !== answers.length
		|| !confirmation.buttons.every((label, index) => label === answers[index].label)) {
		throw new Error('Approval labels must preserve the offered choices.');
	}
	return answers;
}

export class HarnessChatApprovalContentPart extends Disposable {
	readonly domNode: HTMLElement;

	constructor(
		confirmation: IChatConfirmation,
		context: IChatContentPartRenderContext,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICommandService commands: ICommandService,
		@IHarnessChatNavigationService navigation: IHarnessChatNavigationService,
		@INotificationService notifications: INotificationService,
	) {
		super();
		const answers = approvalAnswers(confirmation);
		const resource = context.element.sessionResource;
		if (resource.scheme !== 'supercode' || resource.authority !== answers[0].connectionId) {
			throw new Error('Approval card does not belong to this conversation.');
		}
		const disablement = this._register(new Emitter<boolean>());
		let dispatching = false;
		const enabled = !context.readOnly && (!isResponseVM(context.element) || !context.element.isStale);
		const widget = this._register(instantiationService.createInstance(ChatConfirmationWidget, context, {
			title: confirmation.title,
			message: confirmation.message,
			buttons: answers.map((answer, index) => ({
				label: answer.label, data: answer, isSecondary: index > 0,
				disabled: !enabled || !!confirmation.isUsed, onDidChangeDisablement: disablement.event,
			})),
		}));
		widget.setShowButtons(!confirmation.isUsed);
		this._register(widget.onDidClick(async ({ button }) => {
			if (!enabled || dispatching || confirmation.isUsed) { return; }
			try {
				navigation.assertInteractive(resource);
				dispatching = true;
				disablement.fire(true);
				const result = await commands.executeCommand<{ status?: string }>('supercode.frontend.respondInTurnApproval', button.data);
				if (result?.status === 'responded' || result?.status === 'resolved') {
					confirmation.isUsed = true;
					widget.setShowButtons(false);
				} else if (!result || !['failed', 'cancelled', 'unavailable'].includes(result.status ?? '')) {
					throw new Error('The runtime did not acknowledge this approval response.');
				}
			} catch (error) {
				notifications.error(error);
			} finally {
				dispatching = false;
				disablement.fire(!enabled || !!confirmation.isUsed);
			}
		}));
		this.domNode = widget.domNode;
	}
}
