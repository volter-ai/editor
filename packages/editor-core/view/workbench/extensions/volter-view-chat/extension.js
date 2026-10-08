// The limited view's Chat (docs/LIMITED-VIEW.md). A web extension, plain JavaScript, no build
// step: the release packages it as a built-in extension through vsce's file list.
//
// A session's Chat drives a coding agent on the person's machine. A view has no machine, so its
// agent is a tool loop in the page (`view/page/agent/agent.ts`) on a model the view's HOST
// provides, and this is that loop's face in the Chat view: it sends the person's message to the
// page, shows what the loop says and does, and says in place what stands between the person and
// an answer (signing in, a day's allowance used, a host with no AI) with the way on.
//
// It talks to the page over `/__editor/view-agent/*`, which the view's service worker forwards
// to the page whole; a turn's events are read by asking again. The product's name and install
// command come from the product's own declaration, which the overlay writes into
// `view-product.json` beside this file.
//
// The participant is the workbench's default one, and it registers NO language model: with none
// in the build, the workbench hands every request straight to the default participant
// (`extHostChatAgents2.ts`'s `getModelForRequest`); one model that is not the default makes every
// request fail with "Language model unavailable" (measured on the first live view).

const vscode = require('vscode');

const FALLBACK = { displayName: 'the editor', install: 'npx @volter/cyclotron create my-game' };
/** The page this view runs in: the extension host is a worker of the same origin. */
const ORIGIN = globalThis.location.origin;

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

/** One of the page's agent routes, answered as JSON; `{}` when the page gave none. */
async function page(route, method = 'GET', body) {
	const response = await fetch(`${ORIGIN}/__editor/view-agent/${route}`, {
		method,
		...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
	});
	try {
		return { status: response.status, ...(await response.json()) };
	} catch {
		return { status: response.status };
	}
}

const dollars = (micros) => `$${(micros / 1_000_000).toFixed(2)}`;

function resetIn(resetsAt) {
	const minutes = Math.max(1, Math.round((Date.parse(resetsAt) - Date.now()) / 60_000));
	return minutes >= 60 ? `in about ${Math.round(minutes / 60)} h` : `in ${minutes} min`;
}

function installLines(product) {
	return ['```sh', product.install, '```'];
}

/** The ways on when Volter's AI is not available to this person right now. */
function waysOn(stream, product, { waitlisted, quiet }) {
	stream.markdown(['', '', `**Keep going on your own machine.** The local ${product.displayName} runs your own coding agent, with no daily limit from us:`, '', ...installLines(product), ''].join('\n'));
	stream.button({ command: 'volter.viewChat.copyInstall', title: 'Copy install command' });
	// `quiet`: nobody is signed in, so there is no one to put on the list or to tell they are on it.
	if (quiet) return;
	if (waitlisted) stream.markdown('\n\nYou are on the list for the **Volter plan** ($19.99/month). We will email you when it opens.');
	else stream.button({ command: 'volter.viewChat.joinWaitlist', title: 'Volter plan, $19.99/month: join the waitlist' });
}

async function activate(context) {
	const product = await readProduct(context);

	context.subscriptions.push(vscode.commands.registerCommand('volter.viewChat.copyInstall', async () => {
		await vscode.env.clipboard.writeText(product.install);
		vscode.window.showInformationMessage(`Copied: ${product.install}`);
	}));
	// Sign-in is a tab of its own: the view runs framed, and a sign-in page does not.
	context.subscriptions.push(vscode.commands.registerCommand('volter.viewChat.signIn', async () => {
		await vscode.env.openExternal(vscode.Uri.parse(`${ORIGIN}/auth/start`));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('volter.viewChat.joinWaitlist', async () => {
		const joined = await page('waitlist', 'POST').catch(() => ({}));
		if (joined.waitlisted === true) vscode.window.showInformationMessage('You are on the list for the Volter plan. We will email you when it opens.');
		else if (joined.code === 'signed_out') vscode.window.showWarningMessage('Sign in with Volter first, so we know who to tell.');
		else vscode.window.showWarningMessage('The waitlist could not be reached. Try again in a moment.');
	}));

	const participant = vscode.chat.createChatParticipant('volter.viewChat', async (request, chatContext, stream, token) => {
		const account = await page('account').catch(() => ({ available: 'unknown' }));
		// The page or the host did not answer: that is not "no assistant here".
		if (account.available !== true && account.available !== false) {
			stream.markdown('The assistant could not be reached just now. Send your message again in a moment.');
			return {};
		}
		// A host with no account service, or one where nobody can sign in: this view has no AI of its own.
		if (account.available !== true || (account.signedIn !== true && account.signIn === 'unavailable')) {
			stream.markdown([`**Chat runs in the local version of ${product.displayName}.**`, '', 'This view has no assistant of its own. You can look around and try edits here; the agent needs the editor on your own machine:', '', ...installLines(product)].join('\n'));
			stream.button({ command: 'volter.viewChat.copyInstall', title: 'Copy install command' });
			return {};
		}
		// Signed out and no AI to sign in for: say that, not an invitation that leads to "off".
		if (account.signedIn !== true && account.ai?.state === 'off') {
			stream.markdown('**Volter AI is off right now.**');
			waysOn(stream, product, { waitlisted: true, quiet: true });
			return {};
		}
		if (account.signedIn !== true) {
			// What an account includes is the host's to say; with no number from it, none is quoted.
			const included = typeof account.ai?.dailyLimit === 'number' ? ` A Volter account includes ${dollars(account.ai.dailyLimit)} of AI a day in the browser.` : '';
			stream.markdown(`**Sign in with Volter to use the assistant here.**${included} Sign-in opens in a new tab; come back here and send your message again.\n\n`);
			stream.button({ command: 'volter.viewChat.signIn', title: 'Sign in with Volter' });
			stream.markdown(['', '', `Or run ${product.displayName} on your own machine, with your own agent:`, '', ...installLines(product)].join('\n'));
			stream.button({ command: 'volter.viewChat.copyInstall', title: 'Copy install command' });
			return {};
		}
		if (account.ai?.state === 'off') {
			stream.markdown('**Volter AI is off right now.**');
			waysOn(stream, product, account);
			return {};
		}

		const started = await page('turn', 'POST', { text: request.prompt, fresh: chatContext.history.length === 0 });
		if (typeof started.turn !== 'string') {
			stream.markdown(started.code === 'turn_running' ? 'The assistant is still working on your last message. Stop it or wait for it to finish.' : `The assistant could not start: ${started.error ?? 'the page did not answer'}.`);
			return {};
		}
		token.onCancellationRequested(() => { void page('stop', 'POST').catch(() => {}); });

		// Events are read by asking again. Text grows in place, so each ask says how many events and
		// how much of the last one's text it already has.
		let after = 0;
		let seen = 0;
		for (;;) {
			let batch;
			try {
				batch = await page(`events?turn=${encodeURIComponent(started.turn)}&after=${after}&seen=${seen}`);
			} catch {
				stream.markdown('\n\nThe page stopped answering. Reload the view to start again.');
				return {};
			}
			if (batch.status !== 200) {
				stream.markdown('\n\nThe page lost this turn. Send your message again.');
				return {};
			}
			if (typeof batch.more === 'string') {
				stream.markdown(batch.more);
				seen += batch.more.length;
			}
			for (const event of batch.events ?? []) {
				after += 1;
				seen = 0;
				if (event.kind === 'text') {
					stream.markdown(event.text);
					seen = event.text.length;
				} else if (event.kind === 'tool') {
					stream.progress(event.label);
				} else if (event.kind === 'error') {
					stream.markdown(`\n\n**That did not finish.** ${event.message}`);
				} else if (event.kind === 'refused') {
					if (event.code === 'signed_out') {
						stream.markdown('\n\n**You are signed out.** Sign in again and send your message once more.\n\n');
						stream.button({ command: 'volter.viewChat.signIn', title: 'Sign in with Volter' });
					} else if (event.code === 'account_allowance_exhausted' || event.code === 'global_ceiling_reached') {
						// The day's allowance: when it comes back, and the ways on meanwhile.
						stream.markdown(`\n\n**${event.message}**${event.resetsAt ? ` It resets at 00:00 UTC, ${resetIn(event.resetsAt)}.` : ''}`);
						waysOn(stream, product, account);
					} else if (event.code === 'paid_ai_off' || event.code === 'no_ai') {
						stream.markdown(`\n\n**${event.message}**`);
						waysOn(stream, product, account);
					} else {
						// A request the host did not take, or a provider failure: nothing to wait for or buy.
						stream.markdown(`\n\n**${event.message}**`);
					}
				}
			}
			if (batch.done === true && (batch.events ?? []).length === 0 && typeof batch.more !== 'string') break;
		}
		void refreshWelcome();
		const left = await page('account').catch(() => ({}));
		if (left.signedIn === true && left.ai && typeof left.ai.remaining === 'number') {
			stream.markdown(`\n\n---\n*${dollars(left.ai.remaining)} of today's ${dollars(left.ai.dailyLimit)} left.*`);
		}
		return {};
	});
	participant.iconPath = new vscode.ThemeIcon('chat-sparkle');
	// What the empty Chat view says before anyone types (the `defaultChatParticipant` proposal's
	// welcome). It promises a sign-in only where the host has one and an AI to sign in for, and it
	// is worked out again whenever that may have changed: when a sign-in tab reports back, and
	// after every message.
	/** What an assistant that edits running code means for the person, said wherever the view can lead to it. */
	const CAUTION = 'The assistant edits code that then runs in this tab, signed in as you. Ask it only for changes to this project, and be wary of files from people you do not know.';
	const setWelcome = (lines) => {
		const welcome = new vscode.MarkdownString(lines.concat(['', ...installLines(product), '', '[Copy install command](command:volter.viewChat.copyInstall)']).join('\n'));
		welcome.isTrusted = { enabledCommands: ['volter.viewChat.copyInstall', 'volter.viewChat.signIn'] };
		participant.additionalWelcomeMessage = welcome;
	};
	const refreshWelcome = async () => {
		const host = await page('account').catch(() => ({ available: 'unknown' }));
		// A read that failed says nothing about the host: the neutral welcome, with the caution, stays.
		if (host.available !== true && host.available !== false) return;
		// Only a host that answered and has no account service cannot lead to the assistant; every
		// other variant carries the caution, whatever the host says about sign-in or the AI today.
		if (host.available === false) {
			setWelcome([`**This is a limited view.** Chat runs in the local version of ${product.displayName}. Install it and start a project:`]);
			return;
		}
		const ready = host.ai?.state !== 'off' && (host.signedIn === true || host.signIn !== 'unavailable');
		setWelcome([
			`**${product.displayName} in your browser.** ${ready ? 'Ask the assistant to change the model, the game or its UI.' : 'The assistant is not available here right now.'} It works on this tab's copy of the project; nothing is saved when the tab closes.`,
			'',
			CAUTION,
			'',
			...(ready && host.signedIn !== true ? ['The assistant needs a Volter account. [Sign in with Volter](command:volter.viewChat.signIn)', ''] : []),
			`To keep your work and use your own agent, install ${product.displayName}:`,
		]);
	};
	// Until the host answers, a welcome that promises nothing and already carries the caution.
	setWelcome([`**${product.displayName} in your browser.** Checking for the assistant…`, '', CAUTION, '', `To keep your work and use your own agent, install ${product.displayName}:`]);
	void refreshWelcome();
	// The sign-in tab says what happened on this channel (the host's `/auth/callback` page).
	try {
		const channel = new BroadcastChannel('volter-account');
		channel.onmessage = () => { void refreshWelcome(); };
		context.subscriptions.push({ dispose: () => channel.close() });
	} catch {
		/* no channel: the welcome is still refreshed after each message */
	}
	context.subscriptions.push(participant);
}

function deactivate() { }

module.exports = { activate, deactivate };
