// The limited view's chat stand-in (docs/LIMITED-VIEW.md). A web extension, plain JavaScript,
// no build step: the release packages it as a built-in extension through vsce's file list.
//
// Chat needs the agent runtime the local editor starts, and a limited view is a static page, so
// every request is answered here, in the Chat view, with the product's install command. The
// command comes from the product's own declaration (`volter.product.install`), which the overlay
// writes into `view-product.json` beside this file.
//
// The participant is the workbench's default one. A language model provider answering with the
// same text is registered too, so a request the workbench routes to a model instead of the
// participant reads the same sentence rather than "no language model available".

const vscode = require('vscode');

const FALLBACK = { displayName: 'the editor', install: 'npx @volter/model-editor create my-game' };

async function readProduct(context) {
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'view-product.json'));
		const parsed = JSON.parse(new TextDecoder().decode(bytes));
		return {
			displayName: typeof parsed.displayName === 'string' ? parsed.displayName : FALLBACK.displayName,
			install: typeof parsed.install === 'string' ? parsed.install : FALLBACK.install,
		};
	} catch {
		return FALLBACK;
	}
}

function message(product) {
	return [
		`**Chat runs in the local version of ${product.displayName}.**`,
		'',
		'This is a limited view: it shows this project the way the editor does, and you can look around and try edits here, but the agent needs the editor running on your own machine. Install it and start a project:',
		'',
		'```sh',
		product.install,
		'```',
	].join('\n');
}

async function activate(context) {
	const product = await readProduct(context);
	const text = message(product);

	context.subscriptions.push(vscode.commands.registerCommand('volter.viewChat.copyInstall', async () => {
		await vscode.env.clipboard.writeText(product.install);
		vscode.window.showInformationMessage(`Copied: ${product.install}`);
	}));

	const participant = vscode.chat.createChatParticipant('volter.viewChat', (_request, _context, stream) => {
		stream.markdown(text);
		stream.button({ command: 'volter.viewChat.copyInstall', title: 'Copy install command' });
		return {};
	});
	participant.iconPath = new vscode.ThemeIcon('chat-sparkle');
	context.subscriptions.push(participant);

	if (vscode.lm && typeof vscode.lm.registerLanguageModelChatProvider === 'function') {
		try {
			context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('volter-view', {
				provideLanguageModelChatInformation: () => [{
					id: 'volter-view',
					name: 'Limited view',
					family: 'volter-view',
					version: '1',
					maxInputTokens: 100000,
					maxOutputTokens: 1000,
					capabilities: {},
				}],
				provideLanguageModelChatResponse: async (_model, _messages, _options, progress) => {
					progress.report(new vscode.LanguageModelTextPart(text));
				},
				provideTokenCount: async (_model, value) => (typeof value === 'string' ? Math.ceil(value.length / 4) : 1),
			}));
		} catch {
			// An API shape this workbench does not have leaves the participant as the only answer.
		}
	}
}

function deactivate() { }

module.exports = { activate, deactivate };
