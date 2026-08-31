const SINGLE = Object.freeze({
	c: 'composeMessage', C: 'composeMessageNewTab',
	o: 'moveRight', Enter: 'moveRight', l: 'moveRight',
	O: 'openMessageNewWindow', Escape: 'escapeContext',
	e: 'archiveMessage', d: 'deleteMessage', D: 'permanentlyDeleteMessage',
	r: 'reply', R: 'replyNewWindow', a: 'replyAll', A: 'replyAllNewWindow',
	f: 'forward', F: 'forwardNewWindow', u: 'undoContext', q: 'readContext',
	s: 'toggleFlag', j: 'nextMessage', k: 'previousMessage', G: 'endContext',
	h: 'moveLeft', p: 'previousConversationMessage', n: 'nextConversationMessage',
	'?': 'shortcutHelp', '/': 'searchMail',
});
const MODIFIED = Object.freeze({
	'Ctrl+r': 'redoContext', 'Ctrl+u': 'pageUp', 'Ctrl+d': 'pageDown',
});
const PREFIXED = Object.freeze({
	g: Object.freeze({
		g: 'startContext', n: 'nextPage', p: 'previousPage', i: 'inbox',
		s: 'starred', b: 'snoozed', t: 'sent', d: 'drafts', a: 'allMail',
		k: 'tasks', l: 'label',
	}),
	v: Object.freeze({
		a: 'selectAll', r: 'selectRead', u: 'selectUnread',
		s: 'selectStarred', t: 'selectUnstarred',
	}),
});

const MAILBOX_BINDINGS = Object.freeze([
	...Object.entries(SINGLE).map(([sequence, action]) => Object.freeze({ sequence, action })),
	...Object.entries(MODIFIED).map(([sequence, action]) => Object.freeze({ sequence, action })),
	...Object.entries(PREFIXED).flatMap(([prefix, commands]) =>
		Object.entries(commands).map(([key, action]) => Object.freeze({ sequence: prefix + key, action }))),
]);

function lookupMailboxCommand(event, prefix) {
	if (event.altKey || event.metaKey) return { action: null, nextPrefix: null, handled: false };
	if (event.ctrlKey) {
		const action = MODIFIED[`Ctrl+${event.key}`];
		return { action: action || null, nextPrefix: null, handled: Boolean(action) };
	}
	if (prefix) {
		const action = PREFIXED[prefix]?.[event.key];
		return { action: action || null, nextPrefix: null, handled: Boolean(action) };
	}
	const action = SINGLE[event.key];
	if (action) return { action, nextPrefix: null, handled: true };
	if (PREFIXED[event.key]) return { action: null, nextPrefix: event.key, handled: true };
	return { action: null, nextPrefix: null, handled: false };
}

module.exports = { MAILBOX_BINDINGS, lookupMailboxCommand };
