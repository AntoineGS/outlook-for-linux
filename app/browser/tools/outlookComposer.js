const COMPOSER_VALUES = new Map([
	['data-testid', new Set(['inline-new-message-compose', 'inline-reply-compose'])],
	['data-tid', new Set(['inline-forward-compose'])],
	['data-compose-context', new Set(['new-message', 'reply'])],
]);
const EDITOR_VALUES = new Map([
	['data-testid', new Set(['message-body'])],
	['data-tid', new Set(['message-body'])],
	['id', new Set(['message-body'])],
]);
const TOOLBAR_VALUES = new Map([
	['data-testid', new Set(['compose-toolbar'])],
	['data-tid', new Set(['compose-toolbar'])],
	['id', new Set(['compose-toolbar'])],
]);
const SEND_VALUES = new Map([
	['data-compose-action', new Set(['send'])],
	['data-testid', new Set(['send-button'])],
	['data-tid', new Set(['send-button'])],
	['id', new Set(['send-button'])],
]);
function attribute(node, name) {
	return typeof node?.getAttribute === 'function' ? node.getAttribute(name) : null;
}

function isHidden(node) {
	for (let current = node; current; current = current.parentElement) {
		if (current.hidden || current.disabled || attribute(current, 'hidden') !== null ||
			attribute(current, 'aria-hidden') === 'true' || attribute(current, 'disabled') !== null ||
			attribute(current, 'aria-disabled') === 'true') return true;
		const view = current.ownerDocument?.defaultView;
		const style = view?.getComputedStyle?.(current);
		if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
	}
	return typeof node.getClientRects !== 'function' || node.getClientRects().length > 0 ? false : true;
}

function isComposerEditor(node) {
	if (!node || attribute(node, 'contenteditable') !== 'true' || attribute(node, 'role') !== 'textbox') return false;
	if (isHidden(node)) return false;
	if (liveComposeDetails(node)) return true;
	const context = nearestContext(node);
	if (!context || isBlockedContext(context)) return false;
	if (!matchesAny(node, EDITOR_VALUES) && !matchesComposerContext(context)) return false;
	const editors = descendants(context).filter(candidate =>
		attribute(candidate, 'contenteditable') === 'true' && attribute(candidate, 'role') === 'textbox' &&
		!isHidden(candidate) && belongsDirectlyToContext(candidate, context, context) &&
		(matchesAny(candidate, EDITOR_VALUES) || matchesComposerContext(context)));
	if (editors.length !== 1 || editors[0] !== node) return false;
	const toolbar = composeToolbar(context);
	return Boolean(toolbar && uniqueSendControl(context, toolbar));
}

function composeContext(node) {
	return nearestContext(node) || liveComposeDetails(node)?.context || null;
}

function liveComposeDetails(editor) {
	if (!/^editorParent_\d+$/.test(attribute(editor?.parentElement, 'id') || '')) return null;
	let trigger;
	for (let current = editor.parentElement.parentElement; current; current = current.parentElement) {
		if (isContextBoundary(current)) return null;
		if (/^docking_DockingTriggerPart_\d+$/.test(attribute(current, 'id') || '')) {
			trigger = current;
			break;
		}
	}
	const context = trigger?.parentElement;
	if (!trigger || !context || isContextBoundary(context)) return null;
	const ownedByScope = node => {
		for (let current = node.parentElement; current && current !== context; current = current.parentElement) {
			if (isContextBoundary(current) || /^docking_DockingTriggerPart_\d+$/.test(attribute(current, 'id') || '')) return false;
		}
		return node.parentElement !== null && node !== context;
	};
	const nodes = descendants(context);
	const triggers = nodes.filter(candidate => /^docking_DockingTriggerPart_\d+$/.test(attribute(candidate, 'id') || ''));
	if (triggers.length !== 1 || triggers[0] !== trigger) return null;
	const editors = nodes.filter(candidate =>
		attribute(candidate, 'contenteditable') === 'true' && attribute(candidate, 'role') === 'textbox' &&
		/^editorParent_\d+$/.test(attribute(candidate.parentElement, 'id') || '') &&
		candidate.parentElement.parentElement === trigger && !isHidden(candidate));
	const sends = nodes.filter(candidate =>
		(['BUTTON', undefined].includes(candidate.tagName) || attribute(candidate, 'role') === 'button') &&
		/^splitButton-[A-Za-z0-9_-]+__primaryActionButton$/.test(attribute(candidate, 'id') || '') &&
		ownedByScope(candidate) && !isHidden(candidate));
	const discards = nodes.filter(candidate =>
		attribute(candidate, 'id') === 'discardCompose' && ownedByScope(candidate) && !isHidden(candidate));
	if (editors.length === 1 && editors[0] === editor && sends.length === 1 && discards.length === 1) {
		return { context, sendControl: sends[0] };
	}
	return null;
}

function nearestContext(node) {
	for (let current = node?.parentElement; current; current = current.parentElement) {
		if (isContextBoundary(current)) return current;
	}
	return null;
}

function isContextBoundary(node) {
	return ['dialog', 'region'].includes(attribute(node, 'role')) || attribute(node, 'data-compose-context') !== null;
}

function isBlockedContext(context) {
	return hasInternalMarker(context) && !matchesComposerContext(context);
}

function matchesComposerContext(node) {
	return matchesAny(node, COMPOSER_VALUES);
}

function matchesAny(node, valuesByAttribute) {
	return [...valuesByAttribute].some(([name, values]) => values.has(attribute(node, name)));
}

function hasInternalMarker(node) {
	return ['data-testid', 'data-tid', 'data-compose-context', 'data-compose-action', 'id']
		.some(name => attribute(node, name) !== null);
}

function uniqueSendControl(context, toolbar) {
	const controls = descendants(context).filter(control => {
		if (!['BUTTON', undefined].includes(control.tagName) && attribute(control, 'role') !== 'button') return false;
		if (isHidden(control)) return false;
		return belongsDirectlyToContext(control, context, context) && matchesAny(control, SEND_VALUES);
	});
	return controls.length === 1 && toolbar.contains?.(controls[0]) ? controls[0] : null;
}

function descendants(root) {
	const nodes = [];
	const visit = node => {
		for (const child of node.children || []) {
			nodes.push(child);
			visit(child);
		}
	};
	visit(root);
	return nodes;
}

function composeToolbar(context) {
	const toolbars = descendants(context).filter(node => {
		const role = attribute(node, 'role');
		if (!belongsDirectlyToContext(node, context, context)) return false;
		return role === 'toolbar' || matchesAny(node, TOOLBAR_VALUES);
	});
	if (toolbars.length !== 1) return null;
	if (attribute(context, 'role') === 'region' && !matchesAny(toolbars[0], TOOLBAR_VALUES)) return null;
	return toolbars[0];
}

function belongsDirectlyToContext(node, ancestor, context) {
	for (let current = node.parentElement; current && current !== context; current = current.parentElement) {
		if (isContextBoundary(current)) return false;
	}
	return node !== ancestor && node.parentElement !== null;
}

function eventPath(event) {
	const path = typeof event?.composedPath === 'function' ? event.composedPath() : [event?.target];
	return Array.isArray(path) ? path : Array.from(path || []);
}

function editorFromNode(node) {
	for (let current = node; current; current = current.parentElement) {
		if (isComposerEditor(current)) return current;
	}
	return null;
}

function findOutlookComposerDetails(event, document) {
	if (!event || !document) return null;
	const pathEditors = [...new Set(eventPath(event).map(editorFromNode).filter(Boolean))];
	const activeEditor = editorFromNode(document.activeElement);
	if (pathEditors.length !== 1 || pathEditors[0] !== activeEditor) return null;
	const editor = pathEditors[0];
	const liveDetails = liveComposeDetails(editor);
	if (liveDetails) return { editor, sendControl: liveDetails.sendControl };
	const context = composeContext(editor);
	const toolbar = context && composeToolbar(context);
	const sendControl = toolbar && uniqueSendControl(context, toolbar);
	return sendControl ? { editor, sendControl } : null;
}

function findOutlookComposer(event, document) {
	return findOutlookComposerDetails(event, document)?.editor || null;
}

module.exports = { findOutlookComposer, findOutlookComposerDetails };
