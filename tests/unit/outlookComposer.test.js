const test = require('node:test');
const assert = require('node:assert/strict');
const { findOutlookComposer, findOutlookComposerDetails } = require('../../app/browser/tools/outlookComposer');

class NodeStub {
	constructor(tagName, attributes = {}, children = []) {
		this.tagName = tagName.toUpperCase();
		this.attributes = attributes;
		this.children = children;
		this.parentElement = null;
		this.hidden = false;
		this.disabled = false;
		for (const child of children) child.parentElement = this;
	}

	getAttribute(name) { return this.attributes[name] ?? null; }
	contains(node) {
		return node === this || this.children.some(child => child.contains(node));
	}
	closest(selector) {
		if (selector === '[contenteditable="true"][role="textbox"]' &&
			this.getAttribute('contenteditable') === 'true' && this.getAttribute('role') === 'textbox') return this;
		return this.parentElement?.closest(selector) || null;
	}
}

function composer(attributes = {}) {
	const { noContext, sendLabel = 'Send', sendAttributes = { 'data-compose-action': 'send' }, ...editorAttributes } = attributes;
	const editor = new NodeStub('div', { contenteditable: 'true', role: 'textbox', 'aria-label': 'Message body', ...editorAttributes });
	if (!noContext) {
		const send = new NodeStub('button', { 'aria-label': sendLabel, ...sendAttributes });
		const toolbar = new NodeStub('div', { role: 'toolbar' }, [send]);
		new NodeStub('div', { role: 'dialog', 'data-compose-context': 'new-message' }, [toolbar, editor]);
	}
	return editor;
}

function composeEvent(editor, activeElement = editor) {
	return { target: editor, composedPath: () => [editor], document: { activeElement } };
}

test('accepts the focused visible Outlook message body from the event path', () => {
	const editor = composer();
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), editor);
});

test('rejects a search textbox and generic contenteditable', () => {
	for (const editor of [
		composer({ noContext: true, 'aria-label': 'Search mail' }),
		composer({ noContext: true, 'aria-label': 'Notes' }),
		new NodeStub('div', { contenteditable: 'true', role: 'textbox' }),
	]) {
		assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
	}
});

test('requires the event-path editor to be the focused editor', () => {
	const editor = composer();
	const otherEditor = composer();
	assert.equal(findOutlookComposer(composeEvent(editor, otherEditor), { activeElement: otherEditor }), null);
});

test('rejects hidden, disabled, ambiguous, and unrelated dialog editors', () => {
	const hidden = composer();
	hidden.hidden = true;
	const disabled = composer();
	disabled.disabled = true;
	const dialogEditor = composer();
	new NodeStub('div', { role: 'dialog', 'aria-label': 'People picker' }, [dialogEditor]);
	const first = composer();
	const second = composer();
	assert.equal(findOutlookComposer(composeEvent(hidden), { activeElement: hidden }), null);
	assert.equal(findOutlookComposer(composeEvent(disabled), { activeElement: disabled }), null);
	assert.equal(findOutlookComposer(composeEvent(dialogEditor), { activeElement: dialogEditor }), null);
	assert.equal(findOutlookComposer({
		target: first,
		composedPath: () => [first, second],
	}, { activeElement: first }), null);
});

test('requires a verified compose context and a unique native send control', () => {
	const generic = composer({ noContext: true });
	assert.equal(findOutlookComposer(composeEvent(generic), { activeElement: generic }), null);
	const send = new NodeStub('button', { 'aria-label': 'Send', 'data-compose-action': 'send' });
	const toolbar = new NodeStub('div', { role: 'toolbar' }, [send]);
	const context = new NodeStub('div', { role: 'dialog', 'data-compose-context': 'new-message' }, [toolbar]);
	context.querySelectorAll = selector => selector.includes('button') ? [send] : [toolbar];
	const editor = composer({ 'aria-label': 'Message body', noContext: true });
	context.children.push(editor);
	editor.parentElement = context;
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), editor);
});

test('requires a semantic compose toolbar and returns the single primary Send control', () => {
	const editor = composer({ noContext: true });
	const send = new NodeStub('button', { 'aria-label': 'Send', 'data-compose-action': 'send' });
	const dropdown = new NodeStub('button', { 'aria-label': 'Send options' });
	const toolbar = new NodeStub('div', { role: 'toolbar' }, [send, dropdown]);
	const context = new NodeStub('div', { role: 'dialog', 'data-compose-context': 'reply' }, [toolbar, editor]);
	context.querySelectorAll = selector => selector === 'button,[role="button"]' ? [send, dropdown] : [toolbar];
	editor.parentElement = context;

	const details = findOutlookComposerDetails(composeEvent(editor), { activeElement: editor });
	assert.equal(details.editor, editor);
	assert.equal(details.sendControl, send);

	const noToolbar = new NodeStub('div', { role: 'dialog', 'data-compose-context': 'reply' }, [send, editor]);
	editor.parentElement = noToolbar;
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
});

test('accepts marked inline new-mail and reply regions but rejects generic regions', () => {
	for (const marker of [
		{ 'data-testid': 'inline-new-message-compose' },
		{ 'data-testid': 'inline-reply-compose' },
		{ 'data-tid': 'inline-forward-compose' },
	]) {
		const editor = composer({ noContext: true });
		const send = new NodeStub('button', { 'aria-label': 'Send', 'data-compose-action': 'send' });
		const toolbar = new NodeStub('div', { role: 'toolbar', 'data-testid': 'compose-toolbar' }, [send]);
		new NodeStub('div', { role: 'region', ...marker }, [toolbar, editor]);
		assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), editor);
	}

	const genericEditor = composer({ noContext: true });
	const genericSend = new NodeStub('button', { 'aria-label': 'Send', 'data-compose-action': 'send' });
	const genericToolbar = new NodeStub('div', { role: 'toolbar' }, [genericSend]);
	new NodeStub('div', { role: 'region', 'aria-label': 'Editor region' }, [genericToolbar, genericEditor]);
	assert.equal(findOutlookComposer(composeEvent(genericEditor), { activeElement: genericEditor }), null);
});

test('accepts localized composers when internal markers identify ownership', () => {
	for (const [label, sendLabel] of [
		['Corps du message', 'Envoyer'],
		['Cuerpo del mensaje', 'Enviar'],
	]) {
		const editor = composer({ 'aria-label': label, 'data-testid': 'message-body', sendLabel });
		assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), editor);
	}
});

test('rejects localized generic notes editors without an internal compose marker', () => {
	const editor = composer({ noContext: true, 'aria-label': 'Notes', 'data-testid': 'notes-editor' });
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
});

test('rejects compose contexts with ambiguous internal Send actions', () => {
	const editor = composer();
	const context = editor.parentElement;
	const secondSend = new NodeStub('button', { 'aria-label': 'Envoyer', 'data-compose-action': 'send' });
	context.children[0].children.push(secondSend);
	secondSend.parentElement = context.children[0];
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
});

test('rejects editor and Send markers belonging to different contexts', () => {
	const editor = composer({ noContext: true, 'data-testid': 'message-body', 'aria-label': 'Corps du message' });
	const unrelatedContext = new NodeStub('div', { role: 'dialog', 'data-compose-context': 'new-message' }, [
		new NodeStub('div', { role: 'toolbar' }, [new NodeStub('button', { 'data-compose-action': 'send', 'aria-label': 'Envoyer' })]),
	]);
	const otherContext = new NodeStub('div', { role: 'region', 'data-compose-context': 'calendar' }, [editor]);
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
	assert.equal(unrelatedContext.children[0].children.length, 1);
	assert.equal(otherContext.getAttribute('data-compose-context'), 'calendar');
});

test('rejects hidden or disabled internally marked Send actions', () => {
	for (const state of ['hidden', 'disabled']) {
		const editor = composer();
		const send = editor.parentElement.children[0].children[0];
		send[state] = true;
		assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
	}
});

test('rejects visible Send labels without an internal Send marker', () => {
	for (const sendLabel of ['Send', 'Envoyer']) {
		const editor = composer({ sendLabel, sendAttributes: {} });
		assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
	}
});

test('does not bind through the nearest child context to an outer composer', () => {
	const editor = new NodeStub('div', {
		contenteditable: 'true', role: 'textbox', 'aria-label': 'Corps du message', 'data-testid': 'message-body',
	});
	const editorContext = new NodeStub('div', { role: 'region', 'data-testid': 'notes-context' }, [editor]);
	const siblingContext = new NodeStub('div', { role: 'region', 'data-testid': 'attachment-context' }, [
		new NodeStub('div', { role: 'toolbar' }, [new NodeStub('button', { 'data-compose-action': 'send' })]),
	]);
	const outer = new NodeStub('div', { role: 'dialog', 'data-compose-context': 'new-message' }, [editorContext, siblingContext]);
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
	assert.equal(outer.children.includes(editorContext), true);
});

test('matches only exact internal marker values and attributes', () => {
	for (const attributes of [
		{ 'data-testid': 'message-body-preview' },
		{ 'data-tid': 'message-body-preview' },
		{ id: 'message-body-preview' },
	]) {
		const editor = composer({ noContext: true, ...attributes });
		new NodeStub('div', { role: 'dialog' }, [
			new NodeStub('div', { role: 'toolbar' }, [new NodeStub('button', { 'data-compose-action': 'send' })]), editor,
		]);
		assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
	}

	const forwardContext = composer({ noContext: true, 'data-testid': 'message-body' });
	const forward = new NodeStub('div', { role: 'dialog', 'data-compose-action': 'forward' }, [
		new NodeStub('div', { role: 'toolbar' }, [new NodeStub('button', { 'data-compose-action': 'send' })]),
		forwardContext,
	]);
	assert.equal(findOutlookComposer(composeEvent(forwardContext), { activeElement: forwardContext }), null);
});

test('requires one owned semantic toolbar and excludes nested toolbar candidates', () => {
	const editor = composer({ noContext: true, 'data-testid': 'message-body' });
	const nestedSend = new NodeStub('button', { 'data-compose-action': 'send' });
	const nested = new NodeStub('div', { role: 'region', 'data-testid': 'nested-compose' }, [
		new NodeStub('div', { role: 'toolbar' }, [nestedSend]),
	]);
	const toolbar = new NodeStub('div', { role: 'toolbar' }, [new NodeStub('button', { 'data-compose-action': 'send' }), nested]);
	const context = new NodeStub('div', { role: 'dialog', 'data-compose-context': 'reply' }, [toolbar, editor]);
	editor.parentElement = context;
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), editor);

	const genericRegionEditor = composer({ noContext: true });
	const genericRegion = new NodeStub('div', { role: 'region' }, [
		new NodeStub('div', { role: 'toolbar' }, [new NodeStub('button', { 'data-compose-action': 'send' })]),
		genericRegionEditor,
	]);
	assert.equal(findOutlookComposer(composeEvent(genericRegionEditor), { activeElement: genericRegionEditor }), null);
});

test('allows an exact toolbar marker to qualify a marked editor in a region', () => {
	const editor = composer({ noContext: true, 'data-testid': 'message-body' });
	const toolbar = new NodeStub('div', { 'data-testid': 'compose-toolbar' }, [
		new NodeStub('button', { 'data-compose-action': 'send', 'aria-label': 'Enviar' }),
	]);
	new NodeStub('div', { role: 'region' }, [toolbar, editor]);
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), editor);
});

test('allows an internally marked editor inside an unmarked dialog', () => {
	const editor = composer({ noContext: true, 'data-testid': 'message-body', 'aria-label': 'Cuerpo del mensaje' });
	const toolbar = new NodeStub('div', { role: 'toolbar' }, [new NodeStub('button', { 'data-compose-action': 'send' })]);
	new NodeStub('div', { role: 'dialog' }, [toolbar, editor]);
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), editor);
});

test('blocks an internally marked editor inside an explicit non-compose context', () => {
	const editor = composer({ noContext: true, 'data-testid': 'message-body' });
	const toolbar = new NodeStub('div', { role: 'toolbar' }, [new NodeStub('button', { 'data-compose-action': 'send' })]);
	new NodeStub('div', { role: 'dialog', 'data-compose-context': 'calendar' }, [toolbar, editor]);
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
});

test('requires exactly one owned editor and one owned Send across the context', () => {
	const first = composer({ 'data-testid': 'message-body' });
	const context = first.parentElement;
	const duplicate = new NodeStub('div', {
		contenteditable: 'true', role: 'textbox', 'data-testid': 'message-body',
	});
	context.children.push(duplicate);
	duplicate.parentElement = context;
	assert.equal(findOutlookComposer(composeEvent(first), { activeElement: first }), null);
	context.children.splice(context.children.indexOf(duplicate), 1);
	const outsideSend = new NodeStub('button', { 'data-compose-action': 'send' });
	context.children.push(outsideSend);
	outsideSend.parentElement = context;
	assert.equal(findOutlookComposer(composeEvent(first), { activeElement: first }), null);
});

test('does not count nested editors and rejects a disabled Send marker', () => {
	const editor = composer({ 'data-testid': 'message-body' });
	const context = editor.parentElement;
	const nestedEditor = new NodeStub('div', { contenteditable: 'true', role: 'textbox', 'data-testid': 'message-body' });
	new NodeStub('div', { role: 'region', 'data-compose-context': 'nested' }, [nestedEditor]);
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), editor);
	const send = context.children[0].children[0];
	send.disabled = true;
	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
});

test('accepts the live Outlook compose structure without synthetic markers', () => {
	const editor = new NodeStub('div', { contenteditable: 'true', role: 'textbox', 'aria-label': 'Message body' });
	const editorParent = new NodeStub('div', { id: 'editorParent_1' }, [editor]);
	const dockingTrigger = new NodeStub('div', { id: 'docking_DockingTriggerPart_1' }, [editorParent]);
	const send = new NodeStub('button', { id: 'splitButton-r6m__primaryActionButton' });
	const discard = new NodeStub('button', { id: 'discardCompose' });
	new NodeStub('div', {}, [dockingTrigger, send, discard]);

	const details = findOutlookComposerDetails(composeEvent(editor), { activeElement: editor });
	assert.equal(details.editor, editor);
	assert.equal(details.sendControl, send);
});

test('rejects incomplete or ambiguous live Outlook compose structures', () => {
	for (const shape of ['missing-discard', 'duplicate-send', 'duplicate-editor']) {
		const editor = new NodeStub('div', { contenteditable: 'true', role: 'textbox' });
		const editorParent = new NodeStub('div', { id: 'editorParent_1' }, [editor]);
		const dockingTrigger = new NodeStub('div', { id: 'docking_DockingTriggerPart_1' }, [editorParent]);
		const children = [dockingTrigger, new NodeStub('button', { id: 'splitButton-r6m__primaryActionButton' })];
		if (shape !== 'missing-discard') children.push(new NodeStub('button', { id: 'discardCompose' }));
		if (shape === 'duplicate-send') children.push(new NodeStub('button', { id: 'splitButton-r7a__primaryActionButton' }));
		if (shape === 'duplicate-editor') children.push(new NodeStub('div', { id: 'editorParent_2' }, [
			new NodeStub('div', { contenteditable: 'true', role: 'textbox' }),
		]));
		if (shape === 'duplicate-editor') {
			const duplicateParent = children.pop();
			dockingTrigger.children.push(duplicateParent);
			duplicateParent.parentElement = dockingTrigger;
		}
		new NodeStub('div', {}, children);
		assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null, shape);
	}
});

test('does not bind live editors across sibling or nested docking triggers', () => {
	const editor = new NodeStub('div', { contenteditable: 'true', role: 'textbox' });
	const editorParent = new NodeStub('div', { id: 'editorParent_1' }, [editor]);
	const trigger = new NodeStub('div', { id: 'docking_DockingTriggerPart_1' }, [editorParent]);
	const send = new NodeStub('button', { id: 'splitButton-r6m__primaryActionButton' });
	const discard = new NodeStub('button', { id: 'discardCompose' });
	const siblingScope = new NodeStub('div', {}, [trigger]);
	const siblingTrigger = new NodeStub('div', { id: 'docking_DockingTriggerPart_2' }, [
		new NodeStub('div', { id: 'editorParent_2' }, [new NodeStub('div', { contenteditable: 'true', role: 'textbox' })]),
	]);
	const outer = new NodeStub('div', {}, [siblingScope, siblingTrigger, send, discard]);

	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
	assert.equal(outer.children.includes(siblingScope), true);

	const nestedEditor = new NodeStub('div', { contenteditable: 'true', role: 'textbox' });
	const nestedTrigger = new NodeStub('div', { id: 'docking_DockingTriggerPart_3' }, [
		new NodeStub('div', { id: 'editorParent_3' }, [nestedEditor]),
	]);
	const nestedScope = new NodeStub('div', {}, [nestedTrigger]);
	new NodeStub('div', {}, [nestedScope, new NodeStub('button', { id: 'splitButton-r7a__primaryActionButton' }), new NodeStub('button', { id: 'discardCompose' })]);
	assert.equal(findOutlookComposer(composeEvent(nestedEditor), { activeElement: nestedEditor }), null);
});

test('rejects a live compose scope with two sibling docking triggers', () => {
	const editor = new NodeStub('div', { contenteditable: 'true', role: 'textbox' });
	const trigger = new NodeStub('div', { id: 'docking_DockingTriggerPart_1' }, [
		new NodeStub('div', { id: 'editorParent_1' }, [editor]),
	]);
	const siblingTrigger = new NodeStub('div', { id: 'docking_DockingTriggerPart_2' }, [
		new NodeStub('div', { id: 'editorParent_2' }),
	]);
	new NodeStub('div', {}, [
		trigger,
		siblingTrigger,
		new NodeStub('button', { id: 'splitButton-r6m__primaryActionButton' }),
		new NodeStub('button', { id: 'discardCompose' }),
	]);

	assert.equal(findOutlookComposer(composeEvent(editor), { activeElement: editor }), null);
});
