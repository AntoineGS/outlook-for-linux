const PREFIX_TIMEOUT_MS = 1000;
const SINGLE_KEY_ACTIONS = {
	j: 'nextMessage',
	k: 'previousMessage',
	G: 'lastMessage',
	h: 'collapseConversation',
	l: 'expandConversation',
	Enter: 'openMessage',
	o: 'openMessage',
	Escape: 'back',
	u: 'back',
	'/': 'search',
	c: 'compose',
	r: 'reply',
	a: 'replyAll',
	f: 'forward',
	e: 'archive',
	d: 'deleteMessage',
	q: 'toggleRead',
	s: 'toggleFlag'
};
const G_PREFIX_ACTIONS = { g: 'firstMessage', i: 'inbox', s: 'sent', d: 'drafts' };
const GUARDED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'DIALOG']);
const GUARDED_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'dialog']);
const outlookActions = require('./outlookActions');

function isGuardedNode(node) {
	if (!node || typeof node !== 'object') return false;
	if (GUARDED_TAGS.has(node.tagName)) return true;
	if (node.isContentEditable) return true;
	if (typeof node.getAttribute !== 'function') return false;
	if (node.getAttribute('contenteditable') === 'true') return true;
	return GUARDED_ROLES.has(node.getAttribute('role')) || node.getAttribute('aria-modal') === 'true';
}

function isEditableEvent(event, document) {
	const nodes = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
	if (document && document.activeElement) nodes.push(document.activeElement);

	for (const node of nodes) {
		let current = node;
		while (current) {
			if (isGuardedNode(current)) return true;
			current = current.parentElement;
		}
	}

	return false;
}

function createCommandResolver(actions, clock = {}) {
	const setTimeoutFn = clock.setTimeout || setTimeout;
	const clearTimeoutFn = clock.clearTimeout || clearTimeout;
	let prefix = null;
	let prefixTimer = null;

	function reset() {
		prefix = null;
		if (prefixTimer !== null) clearTimeoutFn(prefixTimer);
		prefixTimer = null;
	}

	function consume(event) {
		event.preventDefault();
		event.stopPropagation();
	}

	function dispatch(actionName, event, document) {
		reset();
		consume(event);
		return actions[actionName](document);
	}

	function handleKeydown(event, document) {
		if (event.ctrlKey || event.altKey || event.metaKey || isEditableEvent(event, document)) {
			reset();
			return false;
		}
		if (event.shiftKey && event.key !== 'G' && event.key !== '/') {
			reset();
			return false;
		}
		if (event.shiftKey && (event.key === 'G' || event.key === '/')) {
			const actionName = SINGLE_KEY_ACTIONS[event.key];
			return actionName ? dispatch(actionName, event, document) : false;
		}

		if (prefix === 'g') {
			const actionName = G_PREFIX_ACTIONS[event.key];
			if (actionName) return dispatch(actionName, event, document);
			reset();
			return false;
		}

		if (event.key === 'g') {
			prefix = 'g';
			prefixTimer = setTimeoutFn(reset, PREFIX_TIMEOUT_MS);
			consume(event);
			return true;
		}

		const actionName = SINGLE_KEY_ACTIONS[event.key];
		return actionName ? dispatch(actionName, event, document) : false;
	}

	return { handleKeydown, reset };
}

function createVimBindings({ actions = outlookActions, document: rootDocument = globalThis.document,
	MutationObserverClass = globalThis.MutationObserver } = {}) {
	const attachedDocuments = new WeakSet();
	const attachedFrames = new WeakSet();

	function getFrameDocument(frame) {
		try {
			return frame && frame.contentDocument;
		} catch {
			// Cross-origin iframe documents are not accessible.
			return null;
		}
	}

	function attachFrame(frame) {
		if (!frame || attachedFrames.has(frame)) return;
		attachedFrames.add(frame);
		if (typeof frame.addEventListener === 'function') {
			frame.addEventListener('load', () => attachDocument(getFrameDocument(frame)));
		}
		attachDocument(getFrameDocument(frame));
	}

	function attachFrames(document) {
		if (!document || typeof document.querySelectorAll !== 'function') return;
		for (const frame of document.querySelectorAll('iframe')) attachFrame(frame);
	}

	function attachDocument(document) {
		if (!document || attachedDocuments.has(document)) return;
		attachedDocuments.add(document);
		const resolver = createCommandResolver(actions);
		document.addEventListener('keydown', event => {
			resolver.handleKeydown(event, document);
		}, true);
		attachFrames(document);
		if (typeof MutationObserverClass !== 'function') return;
		const observer = new MutationObserverClass(records => {
			for (const record of records) {
				for (const node of record.addedNodes || []) {
					const isIframe = node && (node.tagName === 'IFRAME' ||
						(typeof node.matches === 'function' && node.matches('iframe')));
					if (isIframe) attachFrame(node);
					if (node && typeof node.querySelectorAll === 'function') {
						for (const iframe of node.querySelectorAll('iframe')) attachFrame(iframe);
					}
				}
			}
		});
		observer.observe(document, { childList: true, subtree: true });
	}

	function init(config) {
		if (config?.shortcuts?.vim?.enabled !== true) return;
		attachDocument(rootDocument);
	}

	return { init };
}

const singleton = createVimBindings();
singleton.createVimBindings = createVimBindings;
singleton.createCommandResolver = createCommandResolver;
singleton.isEditableEvent = isEditableEvent;

module.exports = singleton;
