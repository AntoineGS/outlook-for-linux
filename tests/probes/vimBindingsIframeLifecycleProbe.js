const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const bindingsPath = path.join(process.cwd(), 'app/browser/tools/vimBindings.js');
const editingPath = path.join(process.cwd(), 'app/browser/tools/vimEditing.js');

async function main() {
	await app.whenReady();
	const browserWindow = new BrowserWindow({
		show: true,
		webPreferences: { nodeIntegration: true, contextIsolation: false },
	});
	try {
		await browserWindow.loadURL('data:text/html,<body></body>');
		const result = await browserWindow.webContents.executeJavaScript(`
			(async () => {
				const { createVimBindings } = require(${JSON.stringify(bindingsPath)});
				const { createVimEditing } = require(${JSON.stringify(editingPath)});
				const documents = [];
				const resets = [];
				const resetByDocument = new Map();
				const createEditing = options => {
					documents.push(options.document);
					const documentResets = { count: 0 };
					resetByDocument.set(options.document, documentResets);
					return createVimEditing({
						...options,
						loadCore: () => ({ Vim: { findKey: () => () => {} } }),
						createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
						createDriver: () => {
							resets.push(documentResets);
							return {
								handleKey: () => 'handled',
								mode: () => 'normal',
								reset: () => { documentResets.count += 1; },
								destroy() {},
							};
						},
					});
				};
				const iframe = document.createElement('iframe');
				iframe.srcdoc = '<div role="dialog" data-compose-context="new-message"><div role="toolbar"><button data-compose-action="send">Send</button></div><div id="editor" contenteditable="true" role="textbox" data-testid="message-body">text</div></div>';
				document.body.append(iframe);
				await new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }));
				const iframeDocument = iframe.contentDocument;
				const editor = iframeDocument.querySelector('#editor');
				const outside = iframeDocument.createElement('div');
				outside.textContent = 'outside';
				iframeDocument.body.append(outside);
				const bindings = createVimBindings({ document, createEditing });
				bindings.init({ shortcuts: { vim: { enabled: true } } });
				editor.focus();
				editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
				await new Promise(resolve => setTimeout(resolve, 0));
				const keydown = new KeyboardEvent('keydown', { key: 'h', bubbles: true });
				editor.dispatchEvent(keydown);
				const badge = () => iframeDocument.querySelector('[data-vim-mode-badge="true"]');
				if (!badge() || badge().textContent !== 'NORMAL') throw new Error('iframe NORMAL badge missing');
				const range = iframeDocument.createRange();
				range.selectNodeContents(outside);
				const selection = iframeDocument.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
				iframeDocument.dispatchEvent(new Event('selectionchange'));
				if (badge()) throw new Error('iframe badge survived external selection');
				bindings.destroy();
				return {
					iframeController: documents.includes(iframeDocument),
					iframeResets: resetByDocument.get(iframeDocument)?.count,
					badgeRemoved: !badge(),
				};
			})()
		`);
		assert.deepEqual(result, { iframeController: true, iframeResets: 1, badgeRemoved: true });
		console.log(`PASS iframe editing controller lifecycle: ${JSON.stringify(result)}`);
	} finally {
		browserWindow.destroy();
	}
	app.quit();
}

main().catch(error => {
	console.error(error.stack || error);
	app.exit(1);
});
