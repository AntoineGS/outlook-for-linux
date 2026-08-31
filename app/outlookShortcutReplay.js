'use strict';

const OUTLOOK_SHORTCUTS = Object.freeze({
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
});

const REPLAY_TIMEOUT_MS = 250;

function eventShortcut(event) {
	const modifiers = event?.modifiers || [
		event?.shiftKey && 'shift',
		event?.ctrlKey && 'control',
		event?.altKey && 'alt',
		event?.metaKey && 'cmd',
	].filter(Boolean);
	const key = typeof event?.key === 'string' && /^[a-z]$/.test(event.key)
		? event.key.toUpperCase() : event?.key;
	return { keyCode: key || event?.keyCode, modifiers };
}

function matchesShortcut(event, shortcut) {
	const received = eventShortcut(event);
	return received.keyCode === shortcut.keyCode &&
		received.modifiers.length === shortcut.modifiers.length &&
		received.modifiers.every(modifier => shortcut.modifiers.includes(modifier));
}

function createReplayClient({ send, setTimeout: setTimeoutFn = setTimeout,
	clearTimeout: clearTimeoutFn = clearTimeout }) {
	let expected = null;
	let timeout = null;
	let generation = 0;

	function clearExpected(owner) {
		if (owner !== undefined && expected?.generation !== owner) return;
		expected = null;
		if (timeout !== null) clearTimeoutFn(timeout);
		timeout = null;
	}

	function request(id, event) {
		if (typeof id !== 'string' || !Object.hasOwn(OUTLOOK_SHORTCUTS, id)) return false;
		const shortcut = OUTLOOK_SHORTCUTS[id];
		if (matchesShortcut(event, shortcut)) return 'pass-through';

		const requestGeneration = ++generation;
		clearExpected();
		expected = { shortcut, generation: requestGeneration };
		timeout = setTimeoutFn(() => clearExpected(requestGeneration), REPLAY_TIMEOUT_MS);
		try {
			Promise.resolve(send(id)).then(result => {
				if (result !== true) clearExpected(requestGeneration);
			}, () => clearExpected(requestGeneration));
		} catch {
			clearExpected();
		}
		return true;
	}

	function shouldBypass(event) {
		if (!expected || !matchesShortcut(event, expected.shortcut)) return false;
		clearExpected();
		return true;
	}

	function destroy() {
		generation++;
		clearExpected();
	}

	return { request, shouldBypass, destroy };
}

function isApprovedSender(event, product) {
	try {
		const source = event?.sender?.getURL?.();
		if (typeof source !== 'string' || !source.startsWith('https://')) return false;
		const parsed = new URL(source);
		const authority = source.match(/^https:\/\/([^/?#]*)/i)?.[1] || '';
		if (parsed.username || parsed.password || parsed.port || authority.includes(':')) return false;
		return product?.isAppHost?.(parsed.hostname) === true;
	} catch {
		return false;
	}
}

function registerOutlookShortcutReplay({ ipcMain, config, product }) {
	const handler = async (event, shortcutId) => {
		if (config?.shortcuts?.vim?.enabled !== true ||
			typeof shortcutId !== 'string' || !Object.hasOwn(OUTLOOK_SHORTCUTS, shortcutId) ||
			!isApprovedSender(event, product)) return false;
		const shortcut = OUTLOOK_SHORTCUTS[shortcutId];
		const sender = event.sender;
		if (typeof sender.sendInputEvent !== 'function') return false;
		const input = { type: 'keyDown', keyCode: shortcut.keyCode, modifiers: shortcut.modifiers };
		sender.sendInputEvent(input);
		sender.sendInputEvent({ ...input, type: 'keyUp' });
		return true;
	};

	// Replays only allowlisted Outlook shortcuts for the opt-in Vim mailbox layer.
	ipcMain.handle('vim-replay-outlook-shortcut', handler);
}

module.exports = { OUTLOOK_SHORTCUTS, createReplayClient, registerOutlookShortcutReplay };
