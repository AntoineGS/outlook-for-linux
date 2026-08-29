const test = require('node:test');
const assert = require('node:assert/strict');

class FakeNode {}
global.Node = FakeNode;

const {
	createRichTextVimAdapter,
	VimEditRejectedError,
	UnsupportedVimAdapterMethodError,
	VimRollbackError,
} = require('../../app/browser/tools/richTextVimAdapter');

function createFixture({ text = 'alpha', anchor = 0, head = 0, html = '<b>alpha</b>' } = {}) {
	let currentText = text;
	const listeners = new Map();
	const selection = {
		rangeCount: 1,
		anchorNode: { ownerDocument: null },
		anchorOffset: anchor,
		focusNode: { ownerDocument: null },
		focusOffset: head,
		setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
			this.anchorNode = anchorNode;
			this.anchorOffset = anchorOffset;
			this.focusNode = focusNode;
			this.focusOffset = focusOffset;
		},
		removeAllRanges() { this.rangeCount = 0; },
		addRange() { this.rangeCount = 1; },
		getRangeAt() { return { cloneRange: () => ({}) }; },
	};
	const document = {
		selection,
		execCalls: [],
		getSelection() { return this.selection; },
		execCommand(command, _showUi, value) {
			this.execCalls.push([command, value]);
			return true;
		},
	};
	const root = new FakeNode();
	root.ownerDocument = document;
	root.innerHTML = html;
	root.contains = node => node === root || node?.ownerDocument === document;
	root.focus = () => { root.focused = true; };
	root.addEventListener = (type, listener) => {
		const current = listeners.get(type) || new Set();
		current.add(listener);
		listeners.set(type, current);
	};
	root.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
	document.addEventListener = root.addEventListener;
	document.removeEventListener = root.removeEventListener;
	const nodes = Array.from({ length: text.length + 1 }, (_, offset) => ({
		offset,
		ownerDocument: document,
	}));
	selection.anchorNode = nodes[anchor];
	selection.focusNode = nodes[head];
	const createPositionMap = () => ({
		text: currentText,
		segments: [],
		graphemeBoundaries: new Set(Array.from({ length: text.length + 1 }, (_, offset) => offset)),
		toOffset(node, offset) {
			if (!nodes.includes(node) || offset !== node.offset) throw new RangeError('unmapped');
			return offset;
		},
		toDomPoint(offset) { return { node: nodes[offset], offset: nodes[offset].offset }; },
		crossesAtomic() { return false; },
	});
	return { root, document, selection, nodes, listeners, createPositionMap, setText: value => { currentText = value; } };
}

test('snapshots and restores adapter listener topology without sharing mutable sets', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const externalCursor = () => {};
	const originalChange = () => {};
	const leakedChange = () => {};
	const leakedMode = () => {};

	adapter.on('cursorActivity', externalCursor);
	adapter.on('change', originalChange);
	const snapshot = adapter.snapshotListenerTopology();
	adapter.off('change', originalChange);
	adapter.on('change', leakedChange);
	adapter.on('vim-mode-change', leakedMode);
	adapter.restoreListenerTopology(snapshot);

	assert.notEqual(snapshot, adapter.snapshotListenerTopology());
	assert.notEqual(snapshot.get('cursorActivity'), adapter.snapshotListenerTopology().get('cursorActivity'));
	assert.deepEqual([...snapshot.keys()], ['cursorActivity', 'change']);
	assert.deepEqual([...adapter.snapshotListenerTopology().get('cursorActivity')], [externalCursor]);
	assert.deepEqual([...adapter.snapshotListenerTopology().get('change')], [originalChange]);
	assert.equal(adapter.snapshotListenerTopology().has('vim-mode-change'), false);

	snapshot.get('change').clear();
	snapshot.set('new-type', new Set([() => {}]));
	assert.deepEqual([...adapter.snapshotListenerTopology().get('change')], [originalChange]);
	assert.equal(adapter.snapshotListenerTopology().has('new-type'), false);
});

test('preserves forward and backward anchor/head direction when setting selection', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 3, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	adapter.setSelection({ line: 0, ch: 3 }, { line: 0, ch: 1 });

	assert.equal(fixture.selection.anchorNode, fixture.nodes[3]);
	assert.equal(fixture.selection.focusNode, fixture.nodes[1]);
	assert.deepEqual(adapter.getSelectionState(), { anchorOffset: 3, headOffset: 1, direction: 'backward' });
});

test('sets overwrite mode to the requested CodeMirror value', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	adapter.toggleOverwrite(false);
	assert.equal(adapter.state.overwrite, false);
	adapter.toggleOverwrite(true);
	assert.equal(adapter.state.overwrite, true);
});

test('reads external selection changes instead of cached cursor state', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 0, head: 0 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	assert.equal(adapter.getCursor().ch, 0);

	fixture.selection.setBaseAndExtent(fixture.nodes[2], 2, fixture.nodes[4], 4);

	assert.equal(adapter.getCursor().ch, 4);
	assert.deepEqual(adapter.listSelections(), [{ anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 4 } }]);
});

test('signals cursor activity only for one live selection owned by the root', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 0, head: 0 });
	let mapCalls = 0;
	const adapter = createRichTextVimAdapter(fixture.root, {
		createPositionMap: (...args) => { mapCalls++; return fixture.createPositionMap(...args); },
	});
	let signals = 0;
	adapter.on('cursorActivity', () => { signals++; });
	const selectionChange = () => fixture.listeners.get('selectionchange')?.forEach(listener => listener());
	const rebuildsAfter = callback => {
		const before = mapCalls;
		callback();
		selectionChange();
		adapter.getValue();
		assert.ok(mapCalls > before);
	};

	rebuildsAfter(() => fixture.selection.setBaseAndExtent(fixture.nodes[1], 1, fixture.nodes[1], 1));
	rebuildsAfter(() => fixture.selection.setBaseAndExtent(fixture.nodes[3], 3, fixture.nodes[1], 1));
	assert.equal(signals, 2);

	const external = { ownerDocument: {} };
	rebuildsAfter(() => fixture.selection.setBaseAndExtent(external, 0, external, 0));
	rebuildsAfter(() => fixture.selection.setBaseAndExtent(fixture.nodes[1], 1, external, 0));
	fixture.selection.rangeCount = 0;
	rebuildsAfter(() => {});
	fixture.selection.rangeCount = 2;
	rebuildsAfter(() => {});
	assert.equal(signals, 2);
});

test('getCursor reads live anchor, head, start, and end endpoints', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 3, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	assert.equal(adapter.getCursor('anchor').ch, 3);
	assert.equal(adapter.getCursor('head').ch, 1);
	assert.equal(adapter.getCursor('start').ch, 1);
	assert.equal(adapter.getCursor('end').ch, 3);
	fixture.selection.setBaseAndExtent(fixture.nodes[0], 0, fixture.nodes[4], 4);
	assert.equal(adapter.getCursor('head').ch, 4);
});

test('maps the linewise endpoint after the final line to document end', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 0, head: 0 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	assert.equal(adapter.indexFromPos({ line: 1, ch: 0 }), 4);
});

test('invalidated mappings reject without fabricating position zero', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 2, head: 2 });
	const adapter = createRichTextVimAdapter(fixture.root, {
		createPositionMap: () => { throw new RangeError('DOM point is not mapped'); },
	});

	assert.throws(() => adapter.getCursor(), VimEditRejectedError);
	assert.throws(() => adapter.listSelections(), VimEditRejectedError);
});

test('grapheme-safe horizontal movement never selects an interior boundary', () => {
	const fixture = createFixture({ text: 'a👩‍💻b', anchor: 1, head: 1 });
	const baseCreatePositionMap = fixture.createPositionMap;
	fixture.createPositionMap = () => ({
		...baseCreatePositionMap(),
		graphemeBoundaries: new Set([0, 1, 6, 7]),
	});
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	adapter.moveH(1);

	assert.equal(adapter.getCursor().ch, 6);
	adapter.setCursor({ line: 0, ch: 6 });
	adapter.moveH(-1);
	assert.equal(adapter.getCursor().ch, 1);
	adapter.moveH(2);
	assert.equal(adapter.getCursor().ch, 6);
	adapter.moveH(-2);
	assert.equal(adapter.getCursor().ch, 0);
});

test('normalizes real core cursor endpoints directionally to grapheme boundaries', () => {
	const fixture = createFixture({ text: 'a👩‍💻b', anchor: 1, head: 1 });
	const baseCreatePositionMap = fixture.createPositionMap;
	fixture.createPositionMap = () => ({
		...baseCreatePositionMap(),
		graphemeBoundaries: new Set([0, 1, 6, 7]),
	});
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	adapter.setCursor({ line: 0, ch: 2 });
	assert.equal(adapter.getCursor().ch, 6);
	adapter.setCursor({ line: 0, ch: 5 });
	assert.equal(adapter.getCursor().ch, 1);
});

test('expands character-action deletion spans by grapheme count', () => {
	for (const [count, expectedEnd] of [[1, 6], [2, 7]]) {
		const fixture = createFixture({ text: 'a👩‍💻b', anchor: 1, head: 1 });
		const baseCreatePositionMap = fixture.createPositionMap;
		fixture.createPositionMap = () => ({
			...baseCreatePositionMap(),
			graphemeBoundaries: new Set([0, 1, 6, 7]),
		});
		const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

		adapter.beginCommand();
		adapter.setCharacterAction(count);
		adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 });

		assert.equal(fixture.selection.anchorNode, fixture.nodes[1]);
		assert.equal(fixture.selection.focusNode, fixture.nodes[expectedEnd]);
		adapter.rollbackCommand();
	}
});

test('moves counted character motions across grapheme boundaries', () => {
	const fixture = createFixture({ text: 'a👩‍💻b', anchor: 1, head: 1 });
	const baseCreatePositionMap = fixture.createPositionMap;
	fixture.createPositionMap = () => ({
		...baseCreatePositionMap(),
		graphemeBoundaries: new Set([0, 1, 6, 7]),
	});
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	adapter.beginCommand();
	adapter.setCharacterMotion(2, 'l');
	adapter.setCursor({ line: 0, ch: 3 });
	assert.equal(adapter.getCursor().ch, 6);
	adapter.setCharacterMotion(2, 'h');
	adapter.setCursor({ line: 0, ch: 6 });
	assert.equal(adapter.getCursor().ch, 0);
	adapter.setCharacterMotion(1, 'l');
	adapter.setCursor({ line: 0, ch: 3 });
	assert.equal(adapter.getCursor().ch, 1);
	adapter.rollbackCommand();
});

test('clamps character motions to the current logical line', () => {
	const fixture = createFixture({ text: 'a👩‍💻b\nz', anchor: 1, head: 1 });
	const baseCreatePositionMap = fixture.createPositionMap;
	fixture.createPositionMap = () => ({
		...baseCreatePositionMap(),
		graphemeBoundaries: new Set([0, 1, 6, 7, 8, 9]),
	});
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	adapter.beginCommand();
	adapter.setCharacterMotion(2, 'l');
	adapter.setCursor({ line: 0, ch: 3 });
	assert.equal(adapter.getCursor().ch, 6);
	adapter.setCharacterMotion(2, 'h');
	adapter.setCursor({ line: 0, ch: 3 });
	assert.equal(adapter.getCursor().ch, 0);
	adapter.setCursor({ line: 0, ch: 6 });
	adapter.setCharacterMotion(1, 'l');
	adapter.setCursor({ line: 0, ch: 3 });
	assert.equal(adapter.getCursor().ch, 6);
	adapter.rollbackCommand();
});

test('rejects multi-selection methods before any native mutation', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	assert.throws(() => adapter.replaceSelections(['x', 'y']), UnsupportedVimAdapterMethodError);
	assert.throws(() => adapter.setSelections([]), UnsupportedVimAdapterMethodError);
	assert.deepEqual(fixture.document.execCalls, []);
});

test('accepts core yank notifications without mutating the editor', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	assert.doesNotThrow(() => adapter.openNotification('yanked'));
	assert.deepEqual(fixture.document.execCalls, []);
});

test('supports the real core position and coordinate compatibility surface', () => {
	const fixture = createFixture({ text: 'one\ntwo', anchor: 1, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, {
		createPositionMap: () => ({
			...fixture.createPositionMap(),
			toDomPoint(offset) { return { node: fixture.nodes[offset], offset }; },
		}),
	});
	assert.deepEqual(adapter.findPosV({ line: 0, ch: 1 }, 1, 'line'), { line: 1, ch: 1 });
	assert.deepEqual(adapter.charCoords({ line: 0, ch: 1 }), { left: 1, right: 1, top: 0, bottom: 1 });
	assert.deepEqual(adapter.coordsChar({ left: 1, top: 0 }), { line: 0, ch: 1 });
	assert.equal(adapter.getOption('firstLineNumber'), 1);
	assert.equal(adapter.defaultTextHeight(), 1);
});

test('uses logical line geometry for vertical movement and coordinates', () => {
	const fixture = createFixture({ text: 'ab\nlong\n', anchor: 1, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, {
		createPositionMap: () => ({
			...fixture.createPositionMap(),
			toDomPoint(offset) { return { node: fixture.nodes[offset], offset }; },
		}),
	});

	assert.deepEqual(adapter.findPosV({ line: 0, ch: 1 }, 1, 'line', 1), { line: 1, ch: 1 });
	assert.deepEqual(adapter.findPosV({ line: 1, ch: 4 }, 1, 'line', 4), { line: 2, ch: 0 });
	assert.deepEqual(adapter.charCoords({ line: 1, ch: 2 }), { left: 2, right: 2, top: 1, bottom: 2 });
	assert.deepEqual(adapter.coordsChar({ left: 4, top: 1 }), { line: 1, ch: 4 });
	assert.deepEqual(adapter.coordsChar({ left: 99, top: 99 }), { line: 2, ch: 0 });
});

test('does not invoke native deletion for an empty EOL replacement', () => {
	const fixture = createFixture({ text: 'one', anchor: 3, head: 3 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.beginCommand();
	adapter.replaceRange('', { line: 0, ch: 3 }, { line: 0, ch: 3 });
	adapter.commitCommand();

	assert.deepEqual(fixture.document.execCalls, []);
});

test('replaceSelections accepts exactly one selection for visual change', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 3 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.replaceSelections(['X']);
	assert.equal(fixture.document.execCalls.length, 1);
	assert.deepEqual(fixture.document.execCalls[0], ['insertText', 'X']);
	assert.throws(() => adapter.replaceSelections(['x', 'y']), UnsupportedVimAdapterMethodError);
});

test('bookmarks track native edits and clear their live DOM point', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const bookmark = adapter.setBookmark({ line: 0, ch: 2 });
	assert.deepEqual(bookmark.find(), { line: 0, ch: 2 });
	fixture.listeners.get('beforeinput')?.forEach(listener => listener({ type: 'beforeinput', inputType: 'insertText', data: 'X' }));
	fixture.setText('aXbcd');
	fixture.root.innerHTML = '<b>aXbcd</b>';
	fixture.listeners.get('input')?.forEach(listener => listener({ type: 'input', inputType: 'insertText', data: 'X' }));
	assert.deepEqual(bookmark.find(), { line: 0, ch: 3 });
	bookmark.clear();
	assert.equal(bookmark.find(), null);
});

test('removes cleared bookmarks from the active registry', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const bookmark = adapter.setBookmark({ line: 0, ch: 2 });

	assert.equal(adapter.activeBookmarkCount(), 1);
	bookmark.clear();
	assert.equal(adapter.activeBookmarkCount(), 0);
	assert.equal(bookmark.find(), null);
});

test('re-adds a bookmark cleared during a command when rolling back', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const bookmark = adapter.setBookmark({ line: 0, ch: 2 });

	adapter.beginCommand();
	bookmark.clear();
	assert.equal(adapter.activeBookmarkCount(), 0);
	adapter.rollbackCommand();

	assert.equal(adapter.activeBookmarkCount(), 1);
	assert.deepEqual(bookmark.find(), { line: 0, ch: 2 });
});

test('emits exact diff endpoints and one post-input change record', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 2, head: 2 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const changes = [];
	adapter.on('change', change => changes.push(change));
	fixture.listeners.get('beforeinput')?.forEach(listener => listener({ type: 'beforeinput', inputType: 'insertText', data: 'x' }));
	fixture.setText('abxcd');
	fixture.root.innerHTML = '<b>abxcd</b>';
	fixture.listeners.get('input')?.forEach(listener => listener({ type: 'input', inputType: 'insertText', data: 'x' }));
	assert.equal(changes.length, 1);
	assert.deepEqual(changes[0], {
		from: { line: 0, ch: 2 },
		to: { line: 0, ch: 2 },
		text: ['x'],
		origin: '+input',
	});
});

test('uses exact diff endpoints for native Backspace and Delete records', () => {
	for (const [inputType, before, after, start, end] of [
		['deleteContentBackward', 'abcd', 'acd', 1, 2],
		['deleteContentForward', 'abcd', 'abc', 3, 4],
	]) {
		const fixture = createFixture({ text: before, anchor: 2, head: 2 });
		const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
		const changes = [];
		adapter.on('change', change => changes.push(change));
		fixture.listeners.get('beforeinput')?.forEach(listener => listener({ type: 'beforeinput', inputType, data: null }));
		fixture.setText(after);
		fixture.root.innerHTML = `<b>${after}</b>`;
		fixture.listeners.get('input')?.forEach(listener => listener({ type: 'input', inputType, data: null }));
		assert.deepEqual(changes, [{
			from: { line: 0, ch: start },
			to: { line: 0, ch: end },
			text: [''],
			origin: '+input',
		}], inputType);
	}
});

test('reports multiline native deletion endpoints in the pre-input document', () => {
	const fixture = createFixture({ text: 'a\nb', anchor: 2, head: 2 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const changes = [];
	adapter.on('change', change => changes.push(change));
	fixture.listeners.get('beforeinput')?.forEach(listener => listener({
		type: 'beforeinput', inputType: 'deleteContentForward', data: null,
	}));
	fixture.setText('ab');
	fixture.root.innerHTML = '<b>ab</b>';
	fixture.listeners.get('input')?.forEach(listener => listener({
		type: 'input', inputType: 'deleteContentForward', data: null,
	}));
	assert.deepEqual(changes, [{
		from: { line: 0, ch: 1 },
		to: { line: 1, ch: 0 },
		text: [''],
		origin: '+input',
	}]);
});

test('reports multiline native replacement endpoints in the pre-input document', () => {
	const fixture = createFixture({ text: 'ab\ncd', anchor: 1, head: 4 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const changes = [];
	adapter.on('change', change => changes.push(change));
	fixture.listeners.get('beforeinput')?.forEach(listener => listener({
		type: 'beforeinput', inputType: 'insertText', data: 'X',
	}));
	fixture.setText('aXd');
	fixture.root.innerHTML = '<b>aXd</b>';
	fixture.listeners.get('input')?.forEach(listener => listener({
		type: 'input', inputType: 'insertText', data: 'X',
	}));
	assert.deepEqual(changes, [{
		from: { line: 0, ch: 1 },
		to: { line: 1, ch: 1 },
		text: ['X'],
		origin: '+input',
	}]);
});

test('records the actual newline diff when Enter provides null event data', () => {
	const fixture = createFixture({ text: 'ab', anchor: 1, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const changes = [];
	adapter.on('change', change => changes.push(change));
	fixture.listeners.get('beforeinput')?.forEach(listener => listener({
		type: 'beforeinput', inputType: 'insertLineBreak', data: null,
	}));
	fixture.setText('a\nb');
	fixture.root.innerHTML = '<b>a\nb</b>';
	fixture.listeners.get('input')?.forEach(listener => listener({
		type: 'input', inputType: 'insertLineBreak', data: null,
	}));
	assert.deepEqual(changes, [{
		from: { line: 0, ch: 1 },
		to: { line: 0, ch: 1 },
		text: ['\n'],
		origin: '+input',
	}]);
});

test('moves bookmarks for adapter replacement diffs without an explicit update hook', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1 });
	fixture.document.execCommand = (command, _showUi, value) => {
		fixture.document.execCalls.push([command, value]);
		fixture.setText(command === 'delete' ? 'acd' : 'aXcd');
		fixture.root.innerHTML = `<b>${command === 'delete' ? 'acd' : 'aXcd'}</b>`;
		return true;
	};
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const bookmark = adapter.setBookmark({ line: 0, ch: 3 });
	adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 });
	assert.deepEqual(bookmark.find(), { line: 0, ch: 2 });
	adapter.replaceRange('X', { line: 0, ch: 1 }, { line: 0, ch: 1 });
	assert.deepEqual(bookmark.find(), { line: 0, ch: 3 });
});

for (const [label, nativeFailure] of [
	['false', () => false],
	['throw', () => { throw new Error('native failure'); }],
]) {
	test(`restores bookmark state after mutation-then-${label} rollback`, () => {
		const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1, html: '<b>abcd</b>' });
		fixture.document.execCommand = (command, _showUi, value) => {
			fixture.document.execCalls.push([command, value]);
			if (command === 'insertText') {
				fixture.setText('abXcd');
				fixture.root.innerHTML = '<b>abXcd</b>';
				return nativeFailure();
			}
			fixture.setText('abcd');
			fixture.root.innerHTML = '<b>abcd</b>';
			return true;
		};
		const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
		const bookmark = adapter.setBookmark({ line: 0, ch: 3 });
		const cleared = adapter.setBookmark({ line: 0, ch: 1 });
		cleared.clear();
		adapter.beginCommand();
		assert.throws(() => adapter.replaceSelection('X'));
		assert.deepEqual(bookmark.find(), { line: 0, ch: 4 });
		assert.equal(cleared.find(), null);
		adapter.rollbackCommand();
		assert.deepEqual(bookmark.find(), { line: 0, ch: 3 });
		assert.equal(cleared.find(), null);
		assert.equal(fixture.root.innerHTML, '<b>abcd</b>');
	});
}

test('collapses multiple virtual repeat edits into one native mutation', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1 });
	fixture.document.execCommand = (command, _showUi, value) => {
		fixture.document.execCalls.push([command, value]);
		fixture.setText('aXcd');
		fixture.root.innerHTML = '<b>aXcd</b>';
		return true;
	};
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const bookmark = adapter.setBookmark({ line: 0, ch: 3 });
	adapter.beginCommand({ repeat: true });
	adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 });
	adapter.replaceRange('X', { line: 0, ch: 1 }, { line: 0, ch: 1 });
	assert.equal(fixture.document.execCalls.length, 0);
	assert.deepEqual(bookmark.find(), { line: 0, ch: 3 });
	adapter.commitCommand();
	assert.equal(fixture.document.execCalls.length, 1);
	assert.equal(fixture.document.execCalls[0][0], 'insertText');
	assert.equal(fixture.root.innerHTML, '<b>aXcd</b>');
});

test('rejects disjoint virtual replacements instead of flattening formatted content', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1, html: '<b>ab</b><i>cd</i>' });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const beforeHTML = fixture.root.innerHTML;
	adapter.beginCommand({ repeat: true });
	adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 });

	assert.throws(
		() => adapter.replaceRange('X', { line: 0, ch: 3 }, { line: 0, ch: 3 }),
		error => error instanceof VimEditRejectedError && error.code === 'multiple-native-edits',
	);
	assert.equal(fixture.root.innerHTML, beforeHTML);
	adapter.rollbackCommand();
});

test('rejects a one-character virtual gap and restores the complete command state', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1, html: '<b>ab</b><i>cd</i>' });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const bookmark = adapter.setBookmark({ line: 0, ch: 3 });
	const before = {
		html: fixture.root.innerHTML,
		selection: adapter.getSelectionState(),
		bookmark: bookmark.find(),
		vim: JSON.stringify(adapter.snapshotVimState()),
	};

	adapter.beginCommand({ repeat: true });
	adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 });

	assert.throws(
		() => adapter.replaceRange('', { line: 0, ch: 2 }, { line: 0, ch: 3 }),
		error => error instanceof VimEditRejectedError && error.code === 'multiple-native-edits',
	);
	assert.deepEqual(fixture.document.execCalls, []);
	adapter.rollbackCommand();
	assert.equal(fixture.root.innerHTML, before.html);
	assert.deepEqual(adapter.getSelectionState(), before.selection);
	assert.deepEqual(bookmark.find(), before.bookmark);
	assert.equal(JSON.stringify(adapter.snapshotVimState()), before.vim);
});

test('commits virtual edits that contact the current span boundaries once', () => {
	const cases = [
		['insertion at span end', 'aXcd', '<b>aX</b><i>cd</i>', 'X', adapter => adapter.replaceRange('X', { line: 0, ch: 1 }, { line: 0, ch: 1 }), 2],
		['deletion ending at span start', 'cd', '<b></b><i>cd</i>', '', adapter => adapter.replaceRange('', { line: 0, ch: 0 }, { line: 0, ch: 1 }), 0],
		['replacement overlapping the current span', 'aY', '<b>aY</b>', 'Y', adapter => adapter.replaceRange('Y', { line: 0, ch: 1 }, { line: 0, ch: 3 }), 2],
	];

	for (const [label, expectedText, expectedHTML, value, secondEdit, expectedCursor] of cases) {
		const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1, html: '<b>ab</b><i>cd</i>' });
		fixture.document.execCommand = command => {
			fixture.document.execCalls.push([command, value]);
			fixture.setText(expectedText);
			fixture.root.innerHTML = expectedHTML;
			return true;
		};
		const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
		adapter.beginCommand({ repeat: true });
		adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 });
		assert.doesNotThrow(() => secondEdit(adapter), label);
		assert.equal(fixture.document.execCalls.length, 0, `${label}: remained virtual`);
		adapter.commitCommand();
		assert.deepEqual(fixture.document.execCalls, [[value === '' ? 'delete' : 'insertText', value]], label);
		assert.equal(fixture.document.execCalls.length, 1, `${label}: one native mutation`);
		assert.equal(adapter.getValue(), expectedText, `${label}: logical text`);
		assert.equal(fixture.root.innerHTML, expectedHTML, `${label}: formatting`);
		assert.deepEqual(adapter.getSelectionState(), {
			anchorOffset: expectedCursor, headOffset: expectedCursor, direction: 'forward',
		}, `${label}: selection`);
	}
});

test('retains a zero-width cancellation point for canonical replay commands', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	adapter.beginCommand({ repeat: true });
	adapter.replaceRange('X', { line: 0, ch: 1 }, { line: 0, ch: 1 });
	adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 });
	assert.equal(adapter.getValue(), 'abcd');
	assert.deepEqual(adapter.getCursor(), { line: 0, ch: 1 });
	assert.doesNotThrow(() => adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 }));
	assert.doesNotThrow(() => adapter.replaceRange('\n', { line: 0, ch: 1 }, { line: 0, ch: 1 }));
	assert.equal(adapter.getValue(), 'a\ncd');
	assert.equal(fixture.document.execCalls.length, 0);
	adapter.rollbackCommand();
});

test('virtual insert deletion joins lines and respects grapheme boundaries', () => {
	const fixture = createFixture({ text: 'a\nb', anchor: 2, head: 2 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.beginCommand({ repeat: true });
	adapter.deleteBackward();
	assert.equal(adapter.getValue(), 'ab');
	assert.deepEqual(adapter.getCursor(), { line: 0, ch: 1 });
	adapter.rollbackCommand();

	const graphemeFixture = createFixture({ text: 'a👩‍💻b', anchor: 6, head: 6 });
	const graphemeAdapter = createRichTextVimAdapter(graphemeFixture.root, { createPositionMap: () => ({
		...graphemeFixture.createPositionMap(),
		graphemeBoundaries: new Set([0, 1, 6, 7]),
	}) });
	graphemeAdapter.beginCommand({ repeat: true });
	graphemeAdapter.deleteBackward();
	assert.equal(graphemeAdapter.getValue(), 'ab');
	assert.equal(graphemeAdapter.getCursor().ch, 1);
	graphemeAdapter.rollbackCommand();
});

test('virtual insert deletion replaces a selected range without live mutation', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 3 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const beforeHTML = fixture.root.innerHTML;
	adapter.beginCommand({ repeat: true });
	adapter.deleteForward();
	assert.equal(adapter.getValue(), 'ad');
	assert.deepEqual(adapter.getSelectionState(), { anchorOffset: 1, headOffset: 1, direction: 'forward' });
	assert.equal(fixture.root.innerHTML, beforeHTML);
	adapter.rollbackCommand();
});

test('virtual atomic validation follows shifted sentinels before selection writes', () => {
	const fixture = createFixture({ text: 'a\uFFFCbc', anchor: 0, head: 0 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.beginCommand({ repeat: true });
	adapter.replaceRange('X', { line: 0, ch: 0 }, { line: 0, ch: 0 });
	assert.throws(() => adapter.setSelection({ line: 0, ch: 1 }, { line: 0, ch: 3 }), VimEditRejectedError);
	assert.throws(() => adapter.getRange({ line: 0, ch: 1 }, { line: 0, ch: 3 }), VimEditRejectedError);
	assert.throws(() => adapter.setSelection({ line: 0, ch: 4 }, { line: 0, ch: 1 }), VimEditRejectedError);
	assert.deepEqual(adapter.getSelectionState(), { anchorOffset: 1, headOffset: 1, direction: 'forward' });
	adapter.rollbackCommand();
});

test('failed virtual replay restores overwrite and adapter options', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 1 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.toggleOverwrite(false);
	adapter.setOption('keyMap', 'vim-insert');
	adapter.beginCommand({ repeat: true });
	adapter.toggleOverwrite(true);
	adapter.setOption('keyMap', 'vim-replace');
	assert.throws(() => adapter.replaceRange('\uFFFC', { line: 0, ch: 1 }, { line: 0, ch: 1 }), VimEditRejectedError);
	adapter.rollbackCommand();
	assert.equal(adapter.state.overwrite, false);
	assert.equal(adapter.getOption('keyMap'), 'vim-insert');
});

test('exposes the editor root as the pinned core input event target', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	assert.equal(adapter.getInputField(), fixture.root);
});

test('restores Vim state values into the original root for pinned closures', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const shared = { value: 'before' };
	const originalRoot = { mode: 'normal', nested: shared, alias: shared };
	shared.root = originalRoot;
	adapter.state.vim = originalRoot;
	const checkpoint = adapter.snapshotVimState();
	adapter.state.vim = { mode: 'insert' };
	adapter.restoreVimState(checkpoint);

	assert.equal(adapter.state.vim, originalRoot);
	assert.equal(adapter.state.vim.nested.value, 'before');
	assert.equal(adapter.state.vim.nested, adapter.state.vim.alias);
	assert.equal(adapter.state.vim.nested.root, adapter.state.vim);
});

test('uses exactly one native mutation for replacement and deletion command shapes', () => {
	for (const [name, operation, expectedCommand] of [
		['x', adapter => adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 }), 'delete'],
		['dw', adapter => adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 3 }), 'delete'],
		['dd', adapter => adapter.replaceRange('', { line: 0, ch: 0 }, { line: 0, ch: 4 }), 'delete'],
	]) {
		const fixture = createFixture({ text: 'abcd', anchor: 0, head: 0 });
		const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
		operation(adapter);
		assert.equal(fixture.document.execCalls.length, 1, name);
		assert.equal(fixture.document.execCalls[0][0], expectedCommand, name);
	}
});

test('rejects a second native attempt before invoking the native API', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.beginCommand();
	adapter.replaceRange('', { line: 0, ch: 0 }, { line: 0, ch: 1 });

	assert.throws(() => adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 }), VimEditRejectedError);
	assert.equal(fixture.document.execCalls.length, 1);
});

test('wraps mapping and endpoint failures as expected edit rejections with causes', () => {
	const fixture = createFixture();
	const mappingError = new RangeError('unknown endpoint');
	const adapter = createRichTextVimAdapter(fixture.root, {
		createPositionMap: () => { throw mappingError; },
	});

	assert.throws(() => adapter.replaceRange('', { line: 0, ch: 0 }, { line: 0, ch: 1 }), error =>
		error instanceof VimEditRejectedError && error.cause === mappingError);
});

test('counts undo and redo as one native attempt and rebuilds synchronously', () => {
	const fixture = createFixture({ html: '<p>alpha</p>' });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.beginCommand();
	adapter.execCommand('undo');
	assert.equal(fixture.document.execCalls.length, 1);
	assert.throws(() => adapter.execCommand('redo'), VimEditRejectedError);
});

test('collapsed empty replacement is a no-op without a native attempt', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 2, head: 2 });
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.beginCommand();
	assert.equal(adapter.replaceRange('', { line: 0, ch: 2 }, { line: 0, ch: 2 }), true);
	adapter.commitCommand();

	assert.deepEqual(fixture.document.execCalls, []);
});

test('wraps public cursor endpoint failures with a cause', () => {
	const fixture = createFixture();
	const mappingError = new RangeError('invalid cursor endpoint');
	const adapter = createRichTextVimAdapter(fixture.root, {
		createPositionMap: () => { throw mappingError; },
	});

	for (const operation of [
		() => adapter.setCursor({ line: 0, ch: 0 }),
		() => adapter.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 1 }),
	]) {
		assert.throws(operation, error => error instanceof VimEditRejectedError && error.cause === mappingError);
	}
});

test('does not compensate a truthy native no-op', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.beginCommand();
	adapter.replaceSelection('x');
	adapter.rollbackCommand();

	assert.deepEqual(fixture.document.execCalls, [['insertText', 'x']]);
});

for (const [label, nativeFailure] of [
	['false after mutation', () => false],
	['throw after mutation', () => { throw new Error('native failure'); }],
]) {
	test(`rolls back exact HTML when native edit ${label}`, () => {
		const fixture = createFixture({ html: '<p>alpha</p>' });
		fixture.document.execCommand = (command, _showUi, value) => {
			fixture.document.execCalls.push([command, value]);
			if (command === 'insertText') {
				fixture.root.innerHTML = '<p>alphax</p>';
				return nativeFailure();
			}
			fixture.root.innerHTML = '<p>alpha</p>';
			return true;
		};
		const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
		adapter.beginCommand();
		assert.throws(() => adapter.replaceSelection('x'));
		assert.doesNotThrow(() => adapter.rollbackCommand());
		assert.equal(fixture.root.innerHTML, '<p>alpha</p>');
		assert.deepEqual(fixture.document.execCalls.map(([command]) => command), ['insertText', 'undo']);
	});
}

for (const [label, undoResult, undoHTML] of [
	['rejects', false, '<p>alphax</p>'],
	['mismatches', true, '<p>wrong</p>'],
]) {
	test(`throws VimRollbackError when compensation ${label}`, () => {
		const fixture = createFixture({ html: '<p>alpha</p>' });
		fixture.document.execCommand = (command, _showUi, value) => {
			fixture.document.execCalls.push([command, value]);
			if (command === 'insertText') {
				fixture.root.innerHTML = '<p>alphax</p>';
				return true;
			}
			fixture.root.innerHTML = undoHTML;
			return undoResult;
		};
		const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
		adapter.beginCommand();
		adapter.replaceSelection('x');

		assert.throws(() => adapter.rollbackCommand(), VimRollbackError);
	});
}

test('rejects atomic crossings during preflight before changing selection or content', () => {
	const fixture = createFixture({ text: 'a\uFFFCb', anchor: 0, head: 0 });
	const baseCreatePositionMap = fixture.createPositionMap;
	fixture.createPositionMap = () => ({
		...baseCreatePositionMap(),
		segments: [{ start: 1, end: 2, atomic: true }],
		crossesAtomic(from, to) { return from < 2 && to > 1; },
	});
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });

	assert.throws(() => adapter.replaceRange('', { line: 0, ch: 0 }, { line: 0, ch: 2 }), VimEditRejectedError);
	assert.deepEqual(fixture.document.execCalls, []);
	assert.equal(fixture.selection.anchorNode, fixture.nodes[0]);
});

test('rejects atomic source reads and sentinel replacements before native mutation', () => {
	const fixture = createFixture({ text: 'a\uFFFCb', anchor: 0, head: 0 });
	const baseCreatePositionMap = fixture.createPositionMap;
	fixture.createPositionMap = () => ({
		...baseCreatePositionMap(),
		segments: [{ start: 1, end: 2, atomic: true }],
		crossesAtomic(from, to) { return from < 2 && to > 1; },
	});
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	const beforeSelection = adapter.getSelectionState();

	assert.throws(
		() => adapter.getRange({ line: 0, ch: 0 }, { line: 0, ch: 2 }),
		error => error instanceof VimEditRejectedError && error.code === 'atomic-crossing',
	);
	fixture.selection.setBaseAndExtent(fixture.nodes[0], 0, fixture.nodes[2], 2);
	assert.throws(
		() => adapter.getSelection(),
		error => error instanceof VimEditRejectedError && error.code === 'atomic-crossing',
	);
	fixture.selection.setBaseAndExtent(fixture.nodes[0], 0, fixture.nodes[0], 0);
	assert.throws(
		() => adapter.replaceRange('\uFFFC', { line: 0, ch: 0 }, { line: 0, ch: 0 }),
		error => error instanceof VimEditRejectedError && error.code === 'atomic-sentinel',
	);
	assert.throws(
		() => adapter.replaceSelection('\uFFFC'),
		error => error instanceof VimEditRejectedError && error.code === 'atomic-sentinel',
	);
	assert.deepEqual(fixture.document.execCalls, []);
	assert.deepEqual(adapter.getSelectionState(), beforeSelection);
});

test('mutation observer invalidates the map before the next command', () => {
	class MutationObserverStub {
		constructor(callback) { this.callback = callback; MutationObserverStub.instance = this; }
		observe() {}
		disconnect() { this.disconnected = true; }
	}
	const fixture = createFixture();
	let mapCalls = 0;
	const baseCreatePositionMap = fixture.createPositionMap;
	const adapter = createRichTextVimAdapter(fixture.root, {
		MutationObserverClass: MutationObserverStub,
		createPositionMap: () => { mapCalls += 1; return baseCreatePositionMap(); },
	});
	adapter.getValue();
	const callsBeforeMutation = mapCalls;
	MutationObserverStub.instance.callback();
	adapter.getValue();

	assert.equal(mapCalls, callsBeforeMutation + 1);
	adapter.destroy();
	assert.equal(MutationObserverStub.instance.disconnected, true);
});

test('input and selectionchange listeners invalidate the position map', () => {
	const fixture = createFixture();
	let mapCalls = 0;
	const baseCreatePositionMap = fixture.createPositionMap;
	const adapter = createRichTextVimAdapter(fixture.root, {
		createPositionMap: () => { mapCalls += 1; return baseCreatePositionMap(); },
	});
	adapter.getValue();
	const initialCalls = mapCalls;
	for (const type of ['input', 'selectionchange']) {
		fixture.listeners.get(type)?.forEach(listener => listener());
		adapter.getValue();
	}

	assert.equal(mapCalls, initialCalls + 2);
});

test('rolls back one native edit and verifies exact HTML after post-mutation failure', () => {
	const fixture = createFixture({ text: 'abcd', anchor: 1, head: 2, html: '<b>a</b>bc' });
	let undoCount = 0;
	let mapCalls = 0;
	const baseCreatePositionMap = fixture.createPositionMap;
	fixture.createPositionMap = () => {
		mapCalls += 1;
		if (mapCalls === 2) throw new Error('post-edit map failure');
		return baseCreatePositionMap();
	};
	fixture.document.execCommand = (command, _showUi, value) => {
		fixture.document.execCalls.push([command, value]);
		if (command === 'insertText') fixture.root.innerHTML = '<b>a</b>xbc';
		if (command === 'undo') {
			undoCount += 1;
			fixture.root.innerHTML = '<b>a</b>bc';
		}
		return true;
	};
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.beginCommand();
	assert.throws(() => adapter.replaceSelection('x'), Error);

	assert.doesNotThrow(() => adapter.rollbackCommand());
	assert.equal(undoCount, 1);
	assert.equal(fixture.root.innerHTML, '<b>a</b>bc');
});

test('removes listeners and observer on destroy', () => {
	const fixture = createFixture();
	const adapter = createRichTextVimAdapter(fixture.root, { createPositionMap: fixture.createPositionMap });
	adapter.destroy();

	assert.equal([...fixture.listeners.values()].every(listeners => listeners.size === 0), true);
	assert.equal(adapter._handlers.size, 0);
});
