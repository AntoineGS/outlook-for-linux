'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	OUTLOOK_SHORTCUTS,
	createReplayClient,
	registerOutlookShortcutReplay,
} = require('../../app/outlookShortcutReplay');

const EXPECTED_SHORTCUTS = {
	compose: { keyCode: 'N', modifiers: [] },
	openNewWindow: { keyCode: 'Enter', modifiers: ['shift'] },
	archive: { keyCode: 'E', modifiers: [] },
	delete: { keyCode: 'Delete', modifiers: [] },
	permanentDelete: { keyCode: 'Delete', modifiers: ['shift'] },
	reply: { keyCode: 'R', modifiers: [] },
	replyAll: { keyCode: 'R', modifiers: ['shift'] },
	forward: { keyCode: 'F', modifiers: ['shift'] },
	flag: { keyCode: 'Insert', modifiers: [] },
	search: { keyCode: 'Q', modifiers: ['alt'] },
	markRead: { keyCode: 'Q', modifiers: [] },
	markUnread: { keyCode: 'U', modifiers: [] },
	firstList: { keyCode: 'Home', modifiers: [] },
	topMessage: { keyCode: 'Home', modifiers: ['control'] },
	bottomMessage: { keyCode: 'End', modifiers: ['control'] },
	pageUp: { keyCode: 'PageUp', modifiers: [] },
	pageDown: { keyCode: 'PageDown', modifiers: [] },
	folderCollapse: { keyCode: 'Left', modifiers: [] },
	folderExpand: { keyCode: 'Right', modifiers: [] },
	shortcutHelp: { keyCode: '/', modifiers: ['shift'] },
};

function event(key, modifiers = []) {
	return {
		key,
		shiftKey: modifiers.includes('shift'),
		ctrlKey: modifiers.includes('control'),
		altKey: modifiers.includes('alt'),
		metaKey: modifiers.includes('cmd'),
	};
}

test('exports the exact fixed Outlook shortcut set', () => {
	assert.deepEqual(OUTLOOK_SHORTCUTS, EXPECTED_SHORTCUTS);
});

test('rejects unknown IDs without starting IPC', () => {
	const sent = [];
	const client = createReplayClient({ send: id => sent.push(id) });

	assert.equal(client.request('unknown', event('N')), false);
	assert.deepEqual(sent, []);
});

test('rejects non-string and inherited-property IDs without starting IPC', () => {
	const sent = [];
	const client = createReplayClient({ send: id => sent.push(id) });

	for (const id of [null, 42, [], {}, 'constructor', 'toString', '__proto__']) {
		assert.equal(client.request(id, event('N')), false);
	}
	assert.deepEqual(sent, []);
});

test('passes through a physical event that already matches the shortcut', () => {
	const sent = [];
	const client = createReplayClient({ send: id => sent.push(id) });

	assert.equal(client.request('compose', event('N')), 'pass-through');
	assert.equal(client.shouldBypass(event('N')), false);
	assert.deepEqual(sent, []);
});

test('matches browser-shaped replay events using numeric key codes without key', () => {
	const client = createReplayClient({ send: () => Promise.resolve(true) });

	assert.equal(client.request('compose', event('x')), true);
	assert.equal(client.shouldBypass({ keyCode: 78 }), true);
});

test('bypasses exactly one matching event after replay', async () => {
	let resolve;
	const client = createReplayClient({
		send: () => new Promise(done => { resolve = done; }),
	});
	assert.equal(client.request('compose', event('x')), true);
	assert.equal(client.shouldBypass(event('N')), true);
	assert.equal(client.shouldBypass(event('N')), false);
	resolve(true);
	await Promise.resolve();
});

test('does not bypass a different physical key', () => {
	let resolve;
	const client = createReplayClient({
		send: () => new Promise(done => { resolve = done; }),
	});
	client.request('compose', event('x'));

	assert.equal(client.shouldBypass(event('E')), false);
	assert.equal(client.shouldBypass(event('N')), true);
	resolve(true);
});

test('expires the bypass after 250 milliseconds', () => {
	let expire;
	let timeoutDelay;
	const client = createReplayClient({
		send: () => Promise.resolve(true),
		setTimeout: (callback, delay) => { expire = callback; timeoutDelay = delay; return 1; },
		clearTimeout: () => {},
	});
	client.request('compose', event('x'));

	assert.equal(timeoutDelay, 250);
	expire();
	assert.equal(client.shouldBypass(event('N')), false);
});

test('cleans up the bypass after rejected IPC', async () => {
	const client = createReplayClient({ send: () => Promise.reject(new Error('rejected')) });

	assert.equal(client.request('compose', event('x')), true);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(client.shouldBypass(event('N')), false);
});

test('cleans up the bypass when IPC resolves false', async () => {
	const client = createReplayClient({ send: () => Promise.resolve(false) });

	assert.equal(client.request('compose', event('x')), true);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(client.shouldBypass(event('N')), false);
});

test('ignores a stale false response after a newer replay request', async () => {
	const resolves = [];
	const client = createReplayClient({
		send: () => new Promise(resolve => resolves.push(resolve)),
	});

	client.request('compose', event('x'));
	client.request('archive', event('y'));
	resolves[0](false);
	await new Promise(resolve => setImmediate(resolve));

	assert.equal(client.shouldBypass(event('E')), true);
});

test('ignores a stale rejection after a newer replay request', async () => {
	const rejects = [];
	const client = createReplayClient({
		send: () => new Promise((resolve, reject) => rejects.push(reject)),
	});

	client.request('compose', event('x'));
	client.request('archive', event('y'));
	rejects[0](new Error('stale rejection'));
	await new Promise(resolve => setImmediate(resolve));

	assert.equal(client.shouldBypass(event('E')), true);
});

test('ignores a stale timeout after a newer replay request', () => {
	const timeouts = [];
	const client = createReplayClient({
		send: () => new Promise(() => {}),
		setTimeout: callback => { timeouts.push(callback); return timeouts.length; },
		clearTimeout: () => {},
	});

	client.request('compose', event('x'));
	client.request('archive', event('y'));
	timeouts[0]();

	assert.equal(client.shouldBypass(event('E')), true);
});

test('handler replays only approved IDs to the invoking sender', async () => {
	const sent = [];
	const ipcMain = { handle(channel, handler) { this.channel = channel; this.handler = handler; } };
	const config = { shortcuts: { vim: { enabled: true } } };
	const product = { isAppHost: hostname => hostname === 'outlook.live.com' };
	const sender = {
		getURL: () => 'https://outlook.live.com/mail/',
		sendInputEvent: input => sent.push(input),
	};
	registerOutlookShortcutReplay({ ipcMain, config, product });

	assert.equal(await ipcMain.handler({ sender }, 'compose'), true);
	assert.deepEqual(sent, [
		{ type: 'keyDown', keyCode: 'N', modifiers: [] },
		{ type: 'keyUp', keyCode: 'N', modifiers: [] },
	]);
	assert.equal(await ipcMain.handler({ sender }, 'unknown'), false);
	for (const shortcutId of [null, 42, [], {}, 'constructor', 'toString', '__proto__']) {
		assert.equal(await ipcMain.handler({ sender }, shortcutId), false);
	}
});

test('rejects unapproved senders and disabled Vim configuration', async () => {
	const ipcMain = { handle(channel, handler) { this.handler = handler; } };
	const product = { isAppHost: () => false };
	const sender = { getURL: () => 'https://evil.example/', sendInputEvent() { throw new Error('must not send'); } };
	registerOutlookShortcutReplay({ ipcMain, config: { shortcuts: { vim: { enabled: true } } }, product });
	assert.equal(await ipcMain.handler({ sender }, 'compose'), false);

	const disabledMain = { handle(channel, handler) { this.handler = handler; } };
	registerOutlookShortcutReplay({
		ipcMain: disabledMain,
		config: { shortcuts: { vim: { enabled: false } } },
		product: { isAppHost: () => true },
	});
	assert.equal(await disabledMain.handler({ sender }, 'compose'), false);
});

test('requires an HTTPS host without credentials or explicit port', async () => {
	for (const url of [
		'http://outlook.live.com/',
		'https://user:pass@outlook.live.com/',
		'https://outlook.live.com:443/',
	]) {
		const ipcMain = { handle(channel, handler) { this.handler = handler; } };
		registerOutlookShortcutReplay({
			ipcMain,
			config: { shortcuts: { vim: { enabled: true } } },
			product: { isAppHost: () => true },
		});
		assert.equal(await ipcMain.handler({ sender: { getURL: () => url } }, 'compose'), false);
	}
});
