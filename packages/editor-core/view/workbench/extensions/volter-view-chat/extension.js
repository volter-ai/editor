// The limited view's chat stand-in (docs/LIMITED-VIEW.md). A web extension, plain JavaScript,
// no build step: the release packages it as a built-in extension through vsce's file list.
//
// Chat needs the agent runtime the local editor starts, and a limited view is a static page, so
// every request is answered here, in the Chat view, with the product's install command. The
// command comes from the product's own declaration (`volter.product.install`), which the overlay
// writes into `view-product.json` beside this file.
//
// The participant is the workbench's default one, and it registers NO language model: with none
// in the build, the workbench hands every request straight to the default participant
// (`extHostChatAgents2.ts`'s `getModelForRequest`); one model that is not the default makes every
// request fail with "Language model unavailable" (measured on the first live view).

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
	// What the empty Chat view says before anyone types (the `defaultChatParticipant` proposal's
	// welcome): the same fact and command, with a button the overlay's welcome patch draws for a
	// standalone trusted command link.
	const welcome = new vscode.MarkdownString([
		`**This is a limited view.** Chat runs in the local version of ${product.displayName}. Install it and start a project:`,
		'',
		'```sh',
		product.install,
		'```',
		'',
		'[Copy install command](command:volter.viewChat.copyInstall)',
	].join('\n'));
	welcome.isTrusted = { enabledCommands: ['volter.viewChat.copyInstall'] };
	participant.additionalWelcomeMessage = welcome;
	context.subscriptions.push(participant);
}

function deactivate() { }

module.exports = { activate, deactivate };
