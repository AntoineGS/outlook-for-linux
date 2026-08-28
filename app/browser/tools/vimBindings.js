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
const { createVimEditing } = require('./vimEditing');

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
	MutationObserverClass = globalThis.MutationObserver,
	editing = null, createEditing = createVimEditing } = {}) {
	const documentRecords = new Map();
	const frameRecords = new Map();
	const managedEditings = new Map();
	let destroyed = false;
	let config = null;

	function editingForDocument(document) {
		if (editing) return { controller: editing, managed: false };
		let controller = managedEditings.get(document);
		if (!controller) {
			controller = createEditing({ document, MutationObserverClass, listenFocus: true });
			managedEditings.set(document, controller);
		}
		return { controller, managed: true };
	}

	function getFrameDocument(frame) {
		try {
			return frame && frame.contentDocument;
		} catch {
			// Cross-origin iframe documents are not accessible.
			return null;
		}
	}

	function detachDocument(document) {
		const record = documentRecords.get(document);
		if (!record) return;
		for (const frame of record.frames) detachFrame(frame);
		record.observer?.disconnect?.();
		document.removeEventListener?.('keydown', record.keydownHandler, true);
		documentRecords.delete(document);
		if (record.managed) {
			record.editing.destroy?.();
			managedEditings.delete(document);
		} else editing.destroyDocument?.(document);
	}

	function attachFrame(frame, ownerDocument) {
		if (!frame || frameRecords.has(frame) || destroyed) return;
		const loadHandler = () => {
			const previousDocument = frameRecords.get(frame)?.document;
			const nextDocument = getFrameDocument(frame);
			if (previousDocument && previousDocument !== nextDocument) detachDocument(previousDocument);
			const record = frameRecords.get(frame);
			if (record) record.document = nextDocument;
			attachDocument(nextDocument);
		};
		const record = { frame, ownerDocument, document: getFrameDocument(frame), loadHandler };
		frameRecords.set(frame, record);
		ownerDocument && documentRecords.get(ownerDocument)?.frames.add(frame);
		frame.addEventListener?.('load', loadHandler);
		attachDocument(record.document);
	}

	function detachFrame(frame) {
		const record = frameRecords.get(frame);
		if (!record) return;
		frame.removeEventListener?.('load', record.loadHandler);
		record.ownerDocument && documentRecords.get(record.ownerDocument)?.frames.delete(frame);
		frameRecords.delete(frame);
		if (record.document) detachDocument(record.document);
	}

	function attachFrames(document) {
		if (!document || typeof document.querySelectorAll !== 'function') return;
		for (const frame of document.querySelectorAll('iframe')) attachFrame(frame, document);
	}

	function attachDocument(document) {
		if (!document || documentRecords.has(document) || destroyed) return;
		const resolver = createCommandResolver(actions);
		const editingRecord = editingForDocument(document);
		const record = { resolver, frames: new Set(), observer: null, keydownHandler: null,
			editing: editingRecord.controller, managed: editingRecord.managed };
		record.keydownHandler = event => {
			if (record.editing.handleKeydown(event, document) !== 'pass-through') return;
			resolver.handleKeydown(event, document);
		};
		documentRecords.set(document, record);
		record.editing.init?.(config);
		document.addEventListener?.('keydown', record.keydownHandler, true);
		attachFrames(document);
		if (typeof MutationObserverClass !== 'function') return;
		const observer = new MutationObserverClass(records => {
			for (const record of records) {
				for (const node of record.removedNodes || []) {
					const isIframe = node && (node.tagName === 'IFRAME' ||
						(typeof node.matches === 'function' && node.matches('iframe')));
					if (isIframe) detachFrame(node);
					if (node && typeof node.querySelectorAll === 'function') {
						for (const iframe of node.querySelectorAll('iframe')) detachFrame(iframe);
					}
				}
				for (const node of record.addedNodes || []) {
					const isIframe = node && (node.tagName === 'IFRAME' ||
						(typeof node.matches === 'function' && node.matches('iframe')));
					if (isIframe) attachFrame(node, document);
					if (node && typeof node.querySelectorAll === 'function') {
						for (const iframe of node.querySelectorAll('iframe')) attachFrame(iframe, document);
					}
				}
			}
		});
		record.observer = observer;
		observer.observe(document.body || document.documentElement || document, { childList: true, subtree: true });
	}

	function init(nextConfig) {
		if (nextConfig?.shortcuts?.vim?.enabled !== true || destroyed || documentRecords.has(rootDocument)) return;
		config = nextConfig;
		attachDocument(rootDocument);
	}

	function destroy() {
		if (destroyed) return;
		destroyed = true;
		for (const document of [...documentRecords.keys()]) detachDocument(document);
		for (const frame of [...frameRecords.keys()]) detachFrame(frame);
		if (editing) editing.destroy?.();
	}

	return { init, destroy };
}

const singleton = createVimBindings();
singleton.createVimBindings = createVimBindings;
singleton.createCommandResolver = createCommandResolver;
singleton.isEditableEvent = isEditableEvent;

module.exports = singleton;
