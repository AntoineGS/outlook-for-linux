const test = require('node:test');
const assert = require('node:assert/strict');
const { MAILBOX_BINDINGS, lookupMailboxCommand } = require('../../app/browser/tools/vimMailboxKeymap');

const EXPECTED = {
	c: 'composeMessage', C: 'composeMessageNewTab',
	o: 'moveRight', Enter: 'moveRight', l: 'moveRight',
	O: 'openMessageNewWindow', Escape: 'escapeContext',
	e: 'archiveMessage', d: 'deleteMessage', D: 'permanentlyDeleteMessage',
	r: 'reply', R: 'replyNewWindow', a: 'replyAll', A: 'replyAllNewWindow',
	f: 'forward', F: 'forwardNewWindow', u: 'undoContext',
	q: 'readContext', s: 'toggleFlag', j: 'nextMessage', k: 'previousMessage',
	G: 'endContext', h: 'moveLeft', p: 'previousConversationMessage',
	n: 'nextConversationMessage', '?': 'shortcutHelp',
	'Ctrl+r': 'redoContext', 'Ctrl+u': 'pageUp', 'Ctrl+d': 'pageDown',
	gg: 'startContext', gn: 'nextPage', gp: 'previousPage', gi: 'inbox',
	gs: 'starred', gb: 'snoozed', gt: 'sent', gd: 'drafts', ga: 'allMail',
	gk: 'tasks', gl: 'label', va: 'selectAll', vr: 'selectRead',
	vu: 'selectUnread', vs: 'selectStarred', vt: 'selectUnstarred',
};

function createEvent(key, overrides = {}) {
	return Object.assign({ key, ctrlKey: false, altKey: false, metaKey: false }, overrides);
}

test('represents every approved mailbox sequence exactly once', () => {
	assert.equal(Object.isFrozen(MAILBOX_BINDINGS), true);
	assert.equal(MAILBOX_BINDINGS.every(binding => Object.isFrozen(binding)), true);
	assert.deepEqual(
		Object.fromEntries(MAILBOX_BINDINGS.map(({ sequence, action }) => [sequence, action])),
		EXPECTED,
	);
});

test('keeps case-sensitive commands and recognizes prefixes', () => {
	assert.equal(lookupMailboxCommand(createEvent('c'), null).action, 'composeMessage');
	assert.equal(lookupMailboxCommand(createEvent('C'), null).action, 'composeMessageNewTab');
	assert.deepEqual(lookupMailboxCommand(createEvent('g'), null), {
		action: null, nextPrefix: 'g', handled: true,
	});
	assert.deepEqual(lookupMailboxCommand(createEvent('v'), null), {
		action: null, nextPrefix: 'v', handled: true,
	});
});

test('normalizes only exact Ctrl bindings and passes through unknown commands', () => {
	assert.equal(lookupMailboxCommand(createEvent('r', { ctrlKey: true }), null).action, 'redoContext');
	assert.equal(lookupMailboxCommand(createEvent('u', { ctrlKey: true }), null).action, 'pageUp');
	assert.equal(lookupMailboxCommand(createEvent('d', { ctrlKey: true }), null).action, 'pageDown');
	assert.deepEqual(lookupMailboxCommand(createEvent('r', { altKey: true }), null), {
		action: null, nextPrefix: null, handled: false,
	});
	assert.deepEqual(lookupMailboxCommand(createEvent('r', { metaKey: true }), null), {
		action: null, nextPrefix: null, handled: false,
	});
	assert.deepEqual(lookupMailboxCommand(createEvent('x'), null), {
		action: null, nextPrefix: null, handled: false,
	});
	assert.deepEqual(lookupMailboxCommand(createEvent('x'), 'g'), {
		action: null, nextPrefix: null, handled: false,
	});
});
