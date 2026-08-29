const test = require('node:test');
const assert = require('node:assert/strict');
const {
	createCommandResolver,
	isEditableEvent,
	createVimBindings,
} = require('../../app/browser/tools/vimBindings');

function createEvent(key, overrides = {}) {
	return Object.assign({
		key,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		target: {},
		composedPath: () => [],
		preventDefaultCalled: false,
		stopPropagationCalled: false,
		preventDefault() { this.preventDefaultCalled = true; },
		stopPropagation() { this.stopPropagationCalled = true; }
	}, overrides);
}

function createActions(calls) {
	return new Proxy({}, {
		get: (_, name) => () => {
			calls.push(name);
			return true;
		}
	});
}

function createDocument() {
	return {
		activeElement: null,
		listeners: [],
		addEventListener(type, listener, capture) {
			this.listeners.push({ type, listener, capture });
		},
		removeEventListener(type, listener, capture) {
			this.listeners = this.listeners.filter(item => item.type !== type ||
				item.listener !== listener || item.capture !== capture);
		},
		querySelectorAll() { return []; }
	};
}

test('dispatches j to nextMessage and consumes the event', () => {
	const calls = [];
	const resolver = createCommandResolver(createActions(calls));
	const event = createEvent('j');

	resolver.handleKeydown(event, {});

	assert.deepEqual(calls, ['nextMessage']);
	assert.equal(event.preventDefaultCalled, true);
	assert.equal(event.stopPropagationCalled, true);
});

test('dispatches gg only after the second key', () => {
	const calls = [];
	const resolver = createCommandResolver(createActions(calls));
	const first = createEvent('g');
	const second = createEvent('g');

	resolver.handleKeydown(first, {});
	assert.deepEqual(calls, []);
	resolver.handleKeydown(second, {});
	assert.deepEqual(calls, ['firstMessage']);
	for (const event of [first, second]) {
		assert.equal(event.preventDefaultCalled, true);
		assert.equal(event.stopPropagationCalled, true);
	}
});

test('dispatches g-prefixed folder commands', () => {
	for (const [key, action] of [['i', 'inbox'], ['s', 'sent'], ['d', 'drafts']]) {
		const calls = [];
		const resolver = createCommandResolver(createActions(calls));
		const prefix = createEvent('g');
		const command = createEvent(key);
		resolver.handleKeydown(prefix, {});
		resolver.handleKeydown(command, {});
		assert.deepEqual(calls, [action]);
		for (const event of [prefix, command]) {
			assert.equal(event.preventDefaultCalled, true);
			assert.equal(event.stopPropagationCalled, true);
		}
	}
});

test('dispatches every approved single-key command', () => {
	const commands = [
		['j', 'nextMessage'], ['k', 'previousMessage'], ['G', 'lastMessage'],
		['h', 'collapseConversation'], ['l', 'expandConversation'], ['Enter', 'openMessage'],
		['Escape', 'back'], ['u', 'back'], ['/', 'search'], ['c', 'compose'],
		['r', 'reply'], ['a', 'replyAll'], ['f', 'forward'], ['e', 'archive'],
		['d', 'deleteMessage'], ['q', 'toggleRead'], ['s', 'toggleFlag']
	];

	for (const [key, action] of commands) {
		const calls = [];
		const resolver = createCommandResolver(createActions(calls));
		const event = createEvent(key);
		resolver.handleKeydown(event, {});
		assert.deepEqual(calls, [action]);
		assert.equal(event.preventDefaultCalled, true);
		assert.equal(event.stopPropagationCalled, true);
	}
});

test('dispatches o to openMessage', () => {
	const calls = [];
	const resolver = createCommandResolver(createActions(calls));
	const event = createEvent('o');

	resolver.handleKeydown(event, {});

	assert.deepEqual(calls, ['openMessage']);
	assert.equal(event.preventDefaultCalled, true);
	assert.equal(event.stopPropagationCalled, true);
});

test('an unknown second key resets g without consuming that key', () => {
	const calls = [];
	const resolver = createCommandResolver(createActions(calls));
	resolver.handleKeydown(createEvent('g'), {});
	const event = createEvent('x');

	assert.equal(resolver.handleKeydown(event, {}), false);
	assert.equal(event.preventDefaultCalled, false);
	assert.equal(event.stopPropagationCalled, false);
	assert.deepEqual(calls, []);
});

test('does not intercept Ctrl, Alt, or Meta modified keys', () => {
	for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
		const calls = [];
		const resolver = createCommandResolver(createActions(calls));
		const event = createEvent('j', { [modifier]: true });
		assert.equal(resolver.handleKeydown(event, {}), false);
		assert.equal(event.preventDefaultCalled, false);
		assert.equal(event.stopPropagationCalled, false);
		assert.deepEqual(calls, []);
	}
});

test('passes through Shift except for semantic G and slash bindings', () => {
	for (const key of ['Enter', 'Escape']) {
		const calls = [];
		const resolver = createCommandResolver(createActions(calls));
		const event = createEvent(key, { shiftKey: true });

		assert.equal(resolver.handleKeydown(event, {}), false);
		assert.deepEqual(calls, []);
		assert.equal(event.preventDefaultCalled, false);

		const pendingCalls = [];
		const pendingResolver = createCommandResolver(createActions(pendingCalls));
		pendingResolver.handleKeydown(createEvent('g'), {});
		assert.equal(pendingResolver.handleKeydown(createEvent(key, { shiftKey: true }), {}), false);
		assert.deepEqual(pendingCalls, []);
	}

	for (const [key, action] of [['G', 'lastMessage'], ['/', 'search']]) {
		const calls = [];
		const resolver = createCommandResolver(createActions(calls));
		const event = createEvent(key, { shiftKey: true });

		assert.equal(resolver.handleKeydown(event, {}), true);
		assert.deepEqual(calls, [action]);
		assert.equal(event.preventDefaultCalled, true);
	}
});

test('g expires after one second', () => {
	const calls = [];
	let expirePrefix;
	let timeoutDelay;
	const resolver = createCommandResolver(createActions(calls), {
		setTimeout: (callback, delay) => {
			expirePrefix = callback;
			timeoutDelay = delay;
			return 1;
		},
		clearTimeout: () => {}
	});

	resolver.handleKeydown(createEvent('g'), {});
	assert.equal(timeoutDelay, 1000);
	expirePrefix();
	resolver.handleKeydown(createEvent('g'), {});
	assert.deepEqual(calls, []);
});

test('does not intercept keys from guarded event paths', () => {
	const guardedNodes = [
		{ tagName: 'INPUT' },
		{ tagName: 'TEXTAREA' },
		{ tagName: 'SELECT' },
		{ isContentEditable: true },
		{ getAttribute: name => name === 'contenteditable' ? 'true' : null },
	].concat(['textbox', 'searchbox', 'combobox', 'dialog'].map(role => ({
		getAttribute: name => name === 'role' ? role : null
	}))).concat({
		getAttribute: name => name === 'aria-modal' ? 'true' : null
	}).concat({ tagName: 'DIALOG' });

	for (const node of guardedNodes) {
		const calls = [];
		const resolver = createCommandResolver(createActions(calls));
		const event = createEvent('j', { composedPath: () => [node] });
		assert.equal(resolver.handleKeydown(event, {}), false);
		assert.equal(event.preventDefaultCalled, false);
		assert.equal(event.stopPropagationCalled, false);
		assert.deepEqual(calls, []);
	}
});

test('resets a pending g prefix after modified and guarded events', () => {
	const resetEvents = [
		...['ctrlKey', 'altKey', 'metaKey'].map(modifier => createEvent('j', { [modifier]: true })),
		createEvent('j', { composedPath: () => [{ tagName: 'INPUT' }] }),
		createEvent('j', { composedPath: () => [{ getAttribute: name => name === 'aria-modal' ? 'true' : null }] })
	];

	for (const resetEvent of resetEvents) {
		const calls = [];
		const resolver = createCommandResolver(createActions(calls));
		resolver.handleKeydown(createEvent('g'), {});
		resolver.handleKeydown(resetEvent, {});
		assert.deepEqual(calls, []);

		resolver.handleKeydown(createEvent('g'), {});
		assert.deepEqual(calls, []);
		resolver.handleKeydown(createEvent('g'), {});
		assert.deepEqual(calls, ['firstMessage']);
	}
});

test('guards the active element and its parent chain', () => {
	const editor = { tagName: 'TEXTAREA' };
	const container = { parentElement: editor };
	const document = { activeElement: container };

	assert.equal(isEditableEvent(createEvent('j'), document), true);
});

test('disabled mode attaches no listener and enabled mode attaches once', () => {
	const document = createDocument();
	const bindings = createVimBindings({ actions: createActions([]), document });
	bindings.init({ shortcuts: { vim: { enabled: false } } });
	assert.equal(document.listeners.length, 0);

	bindings.init({ shortcuts: { vim: { enabled: true } } });
	bindings.init({ shortcuts: { vim: { enabled: true } } });
	assert.deepEqual(document.listeners.map(({ type, capture }) => ({ type, capture })), [
		{ type: 'focusin', capture: true },
		{ type: 'focusout', capture: true },
		{ type: 'blur', capture: true },
		{ type: 'selectionchange', capture: true },
		{ type: 'scroll', capture: true },
		{ type: 'resize', capture: undefined },
		{ type: 'blur', capture: undefined },
		{ type: 'keydown', capture: true },
	]);
});

test('attached listeners dispatch through the injected action adapter', () => {
	const calls = [];
	const document = createDocument();
	const bindings = createVimBindings({ actions: createActions(calls), document });

	bindings.init({ shortcuts: { vim: { enabled: true } } });
	document.listeners.find(({ type }) => type === 'keydown').listener(createEvent('j'));

	assert.deepEqual(calls, ['nextMessage']);
});

function createEditing(outcomes = []) {
	const calls = [];
	const destroyedDocuments = [];
	let destroyCalls = 0;
	return {
		calls,
		destroyedDocuments,
		get destroyCalls() { return destroyCalls; },
		init() {},
		handleKeydown(event, document) {
			calls.push({ event, document });
			return outcomes.shift() || 'pass-through';
		},
		destroyDocument(document) { destroyedDocuments.push(document); },
		destroy() { destroyCalls++; }
	};
}

test('routes every key through editing before mailbox actions', () => {
	const calls = [];
	const document = createDocument();
	const editing = createEditing(['handled', 'pass-through', 'pass-through', 'pass-through']);
	const bindings = createVimBindings({ actions: createActions(calls), document, editing });
	bindings.init({ shortcuts: { vim: { enabled: true } } });
	const keydown = document.listeners.find(({ type }) => type === 'keydown').listener;
	const composer = { getAttribute: name => name === 'contenteditable' ? 'true' :
		name === 'role' ? 'textbox' : null };

	const normalEvent = createEvent('j', { composedPath: () => [composer] });
	keydown(normalEvent);
	assert.deepEqual(calls, []);
	assert.equal(normalEvent.preventDefaultCalled, false);

	const insertEvent = createEvent('x', { composedPath: () => [composer] });
	keydown(insertEvent);
	assert.deepEqual(calls, []);

	const modifiedSend = createEvent('Enter', { ctrlKey: true, composedPath: () => [composer] });
	keydown(modifiedSend);
	assert.equal(modifiedSend.preventDefaultCalled, false);

	const mailboxEvent = createEvent('j');
	keydown(mailboxEvent);
	assert.deepEqual(calls, ['nextMessage']);
	assert.equal(editing.calls.every(call => call.document === document), true);
});

test('does not route search and dialog fields to mailbox actions after editing pass-through', () => {
	const calls = [];
	const document = createDocument();
	const editing = createEditing(['pass-through', 'pass-through']);
	const bindings = createVimBindings({ actions: createActions(calls), document, editing });
	bindings.init({ shortcuts: { vim: { enabled: true } } });
	const keydown = document.listeners.find(({ type }) => type === 'keydown').listener;

	keydown(createEvent('j', { composedPath: () => [{ tagName: 'INPUT' }] }));
	keydown(createEvent('j', { composedPath: () => [{ getAttribute: name => name === 'role' ? 'dialog' : null }] }));

	assert.deepEqual(calls, []);
	assert.equal(editing.calls.length, 2);
});

test('destroys document listeners and editing sessions exactly once', () => {
	const document = createDocument();
	const editing = createEditing();
	const bindings = createVimBindings({ document, editing });

	bindings.init({ shortcuts: { vim: { enabled: true } } });
	const keydown = document.listeners.find(({ type }) => type === 'keydown').listener;
	assert.equal(typeof keydown, 'function');
	bindings.destroy();
	bindings.destroy();

	assert.deepEqual(document.listeners, []);
	assert.deepEqual(editing.destroyedDocuments, [document]);
	assert.equal(editing.destroyCalls, 1);
});
