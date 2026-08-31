const PREFIX_TIMEOUT_MS = 1000;
const GUARDED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'DIALOG']);
const GUARDED_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'dialog']);
const outlookActions = require('./outlookActions');
const { createReplayClient } = require('../../outlookShortcutReplay');
const { createVimEditing } = require('./vimEditing');
const { lookupMailboxCommand } = require('./vimMailboxKeymap');

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

	function handleKeydown(event, document) {
		if (isEditableEvent(event, document)) {
			reset();
			return false;
		}
		const result = lookupMailboxCommand(event, prefix);
		if (result.nextPrefix) {
			prefix = result.nextPrefix;
			prefixTimer = setTimeoutFn(reset, PREFIX_TIMEOUT_MS);
			consume(event);
			return true;
		}
		if (!result.action) {
			reset();
			return false;
		}
		reset();
		const outcome = actions[result.action](document, event);
		if (outcome === 'pass-through') return false;
		consume(event);
		return true;
	}

	return { handleKeydown, reset };
}

function createVimBindings({ actions = null, createActions = outlookActions.createOutlookActions,
	createReplayClient: createReplayClientFn = createReplayClient,
	replayOutlookShortcut = globalThis.electronAPI?.replayOutlookShortcut,
	document: rootDocument = globalThis.document,
	MutationObserverClass = globalThis.MutationObserver,
	editing = null, createEditing = createVimEditing } = {}) {
	const documentRecords = new Map();
	const managedEditings = new Map();
	const replayClient = createReplayClientFn({
		send: typeof replayOutlookShortcut === 'function' ? replayOutlookShortcut : () => false,
	});
	const resolvedActions = actions || createActions({ replayShortcut: replayClient.request });
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

	function detachDocument(document) {
		const record = documentRecords.get(document);
		if (!record) return;
		document.removeEventListener?.('keydown', record.keydownHandler, true);
		documentRecords.delete(document);
		if (record.managed) {
			record.editing.destroy?.();
			managedEditings.delete(document);
		} else editing.destroyDocument?.(document);
	}

	function attachDocument(document) {
		if (!document || documentRecords.has(document) || destroyed) return;
		const resolver = createCommandResolver(resolvedActions);
		const editingRecord = editingForDocument(document);
		const record = { resolver, keydownHandler: null,
			editing: editingRecord.controller, managed: editingRecord.managed };
		record.keydownHandler = event => {
			if (replayClient.shouldBypass(event)) return;
			if (record.editing.handleKeydown(event, document) !== 'pass-through') return;
			resolver.handleKeydown(event, document);
		};
		documentRecords.set(document, record);
		record.editing.init?.(config);
		document.addEventListener?.('keydown', record.keydownHandler, true);
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
		if (editing) editing.destroy?.();
		replayClient.destroy?.();
	}

	return { init, destroy };
}

const singleton = createVimBindings();
singleton.createVimBindings = createVimBindings;
singleton.createCommandResolver = createCommandResolver;
singleton.isEditableEvent = isEditableEvent;

module.exports = singleton;
