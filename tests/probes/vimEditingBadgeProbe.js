const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const controllerPath = path.join(process.cwd(), 'app/browser/tools/vimEditing.js');

async function main() {
	await app.whenReady();
	const browserWindow = new BrowserWindow({
		show: true,
		webPreferences: { nodeIntegration: true, contextIsolation: false },
	});
	try {
		await browserWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
			'<div role="dialog" data-compose-context="new-message"><div role="toolbar"><button aria-label="Envoyer" data-compose-action="send">Envoyer</button></div><div id="editor" contenteditable="true" role="textbox" aria-label="Corps du message" data-testid="message-body">text</div></div>',
		)}`);
		const result = await browserWindow.webContents.executeJavaScript(`
			(async () => {
				const { createVimEditing } = require(${JSON.stringify(controllerPath)});
				const { findOutlookComposer } = require(${JSON.stringify(path.join(process.cwd(), 'app/browser/tools/outlookComposer.js'))});
				const controller = createVimEditing({
					loadCore: () => ({ Vim: { findKey: () => () => {} } }),
					document,
					createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
					createDriver: () => {
						let mode = 'normal';
						return {
							handleKey: event => { if (event.key === 'i') mode = 'insert'; return 'handled'; },
							mode: () => mode,
							destroy() {},
						};
					},
					listenFocus: true,
				});
				controller.init({ shortcuts: { vim: { enabled: true } } });
				const editor = document.querySelector('#editor');
				editor.getClientRects = () => [{}];
				editor.focus();
				editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
				await new Promise(resolve => setTimeout(resolve, 0));
				await new Promise(resolve => setTimeout(resolve, 10));
				const event = { key: 'h', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
					target: editor, composedPath: () => [editor], preventDefault() {}, stopPropagation() {} };
				if (findOutlookComposer(event, document) !== editor) throw new Error('detector rejected focused editor');
				const outcome = controller.handleKeydown(event);
				const badge = document.querySelector('[data-vim-mode-badge="true"]');
					if (!badge || badge.textContent !== 'NORMAL') throw new Error('NORMAL badge missing: ' + outcome + ', ' + document.activeElement?.id);
					const insertOutcome = controller.handleKeydown({ ...event, key: 'i' });
					if (badge.textContent !== 'INSERT') throw new Error('INSERT badge missing: ' + insertOutcome);
				editor.remove();
				await new Promise(resolve => setTimeout(resolve, 0));
				if (document.querySelector('[data-vim-mode-badge="true"]')) throw new Error('badge survived detach');
				controller.destroy();
				return { normal: 'NORMAL', insert: 'INSERT', detached: true };
			})()
		`);
		assert.deepEqual(result, { normal: 'NORMAL', insert: 'INSERT', detached: true });
		console.log(`PASS badge lifecycle: ${JSON.stringify(result)}`);
	} finally {
		browserWindow.destroy();
	}
	app.quit();
}

main().catch(error => {
	console.error(error.stack || error);
	app.exit(1);
});
