const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const mapPath = path.join(process.cwd(), 'app/browser/tools/richTextPositionMap.js');
const adapterPath = path.join(process.cwd(), 'app/browser/tools/richTextVimAdapter.js');
const vimCorePath = path.join(process.cwd(), 'app/browser/tools/vimCore.js');
const vimEditingPath = path.join(process.cwd(), 'app/browser/tools/vimEditing.js');

const cases = [
	{
		name: 'destroy removes raw Insert listeners without replaying edits',
		html: '<div id="editor" contenteditable="true">abcd</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver, loadVimCore, cloneRuntimeGraph }) => {
			const root = document.querySelector('#editor');
			const originalAdd = root.addEventListener.bind(root);
			const originalRemove = root.removeEventListener.bind(root);
			const listeners = new Map();
			root.addEventListener = (type, listener, options) => {
				const entries = listeners.get(type) || new Set();
				entries.add(listener);
				listeners.set(type, entries);
				originalAdd(type, listener, options);
			};
			root.removeEventListener = (type, listener, options) => {
				listeners.get(type)?.delete(listener);
				originalRemove(type, listener, options);
			};
			const baseline = listeners.get('keydown')?.size || 0;
			const adapter = createRichTextVimAdapter(root);
			const loadedCore = await loadVimCore();
			let runtime;
			const core = { ...loadedCore, createRuntime() {
				runtime = loadedCore.createRuntime();
				return runtime;
			} };
			const driver = await createVimDriver(adapter, core);
			const exitInsertMode = runtime.Vim.exitInsertMode;
			let repeatAtExit;
			runtime.Vim.exitInsertMode = (...args) => {
				repeatAtExit = args[0].state.vim.insertModeRepeat;
				return exitInsertMode(...args);
			};
			root.focus();
			document.getSelection().collapse(root.firstChild, 2);
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
				preventDefault() {}, stopPropagation() {} });
			assert.equal(driver.handleKey(event('3')), 'handled');
			assert.equal(driver.handleKey(event('i')), 'handled');
			const native = document.execCommand.bind(document);
			let nativeEditCalls = 0;
			document.execCommand = (...args) => { nativeEditCalls++; return native(...args); };
			root.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'X' }));
			assert.equal(document.execCommand('insertText', false, 'X'), true);
			root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'X' }));
			assert.equal(nativeEditCalls, 1);
			assert.equal(driver.mode(), 'insert');
			assert.equal(adapter.state.vim?.insertModeRepeat, 3);
			assert.ok(runtime.Vim.getVimGlobalState_().macroModeState.lastInsertModeChanges.changes.length > 0);
			const historyBeforeDestroy = cloneRuntimeGraph(runtime.Vim.getVimGlobalState_().macroModeState);
			const before = root.innerHTML;
			const beforeValue = adapter.getValue();
			const beforeSelection = {
				anchorNode: document.getSelection().anchorNode,
				anchorOffset: document.getSelection().anchorOffset,
				focusNode: document.getSelection().focusNode,
				focusOffset: document.getSelection().focusOffset,
			};
			/* The input above is the only native edit; subsequent keys are synthetic post-destroy events. */
			const active = listeners.get('keydown')?.size || 0;
			assert.ok(active > baseline, `expected active Insert keydown listener above baseline (${baseline}), got ${active}`);
			const nativeCallsBeforeDestroy = nativeEditCalls;
			driver.destroy();
			assert.equal(listeners.get('keydown')?.size || 0, baseline, 'keydown listeners restored');
			for (const key of ['Backspace', 'Delete']) {
				root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
			}
			assert.equal(root.innerHTML, before, 'HTML unchanged');
			assert.deepEqual({ anchorNode: document.getSelection().anchorNode, anchorOffset: document.getSelection().anchorOffset,
				focusNode: document.getSelection().focusNode, focusOffset: document.getSelection().focusOffset }, beforeSelection, 'selection unchanged');
			assert.equal(nativeEditCalls, nativeCallsBeforeDestroy, 'no post-destroy native edits');
			assert.equal(adapter.state.vim, null, 'Vim state fully left');
			assert.equal(repeatAtExit, undefined, 'repeat deleted before Insert exit');
			assert.deepEqual(runtime.Vim.getVimGlobalState_().macroModeState, historyBeforeDestroy, 'Insert history unchanged');
			assert.equal(adapter.getValue(), beforeValue, 'logical value unchanged');
			return { baseline, active, remaining: listeners.get('keydown')?.size || 0, html: root.innerHTML,
				nativeEditCalls, insertHistoryEstablished: historyBeforeDestroy.lastInsertModeChanges.changes.length > 0,
				historyChanged: false };
		},
	},
	{
		name: 'real core restores failed Insert entry and exit listener topology',
		html: '<div id="editor" contenteditable="true">abcd</div>',
		allowMutation: true,
			run: async ({ createRichTextVimAdapter, createVimDriver, loadVimCore, cloneRuntimeGraph }) => {
			const loadedCore = await loadVimCore();
			const trackedRoot = document.querySelector('#editor');
			const originalAdd = trackedRoot.addEventListener.bind(trackedRoot);
			const originalRemove = trackedRoot.removeEventListener.bind(trackedRoot);
			const domListeners = new Map();
			trackedRoot.addEventListener = (type, listener, options) => {
				const entries = domListeners.get(type) || new Set();
				entries.add(listener);
				domListeners.set(type, entries);
				return originalAdd(type, listener, options);
			};
			trackedRoot.removeEventListener = (type, listener, options) => {
				domListeners.get(type)?.delete(listener);
				return originalRemove(type, listener, options);
			};
			const topology = adapter => ({
				cursorActivity: adapter.snapshotListenerTopology().get('cursorActivity') || new Set(),
				change: adapter.snapshotListenerTopology().get('change') || new Set(),
				paste: new Set(domListeners.get('paste') || []),
				keydown: new Set(domListeners.get('keydown') || []),
			});
			const topologyCounts = value => Object.fromEntries(
				Object.entries(value).map(([type, listeners]) => [type, listeners.size]),
			);
			const results = [];
			for (const key of ['i', 'a', 'o', 'O']) {
				const root = document.querySelector('#editor');
				root.innerHTML = 'abcd';
				root.focus();
				document.getSelection().collapse(root.firstChild, 1);
				const adapter = createRichTextVimAdapter(root);
				const rejection = Object.assign(new Error('expected'), { name: 'VimEditRejectedError' });
				const driver = await createVimDriver(adapter, loadedCore);
				const before = topology(adapter);
				adapter.commitCommand = () => { throw rejection; };
				assert.equal(driver.handleKey({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
					preventDefault() {}, stopPropagation() {} }), 'rejected', key);
				assert.equal(driver.mode(), 'normal', key);
				assert.deepEqual(topologyCounts(topology(adapter)), topologyCounts(before), key);
				assert.deepEqual([...topology(adapter).cursorActivity], [...before.cursorActivity], `${key}: cursorActivity duplicate check`);
				assert.deepEqual([...topology(adapter).change], [...before.change], `${key}: change duplicate check`);
				assert.deepEqual([...topology(adapter).paste], [...before.paste], `${key}: paste duplicate check`);
				assert.deepEqual([...topology(adapter).keydown], [...before.keydown], `${key}: keydown duplicate check`);
				driver.destroy();
				results.push(key);
			}

			const root = document.querySelector('#editor');
			root.innerHTML = 'abcd';
			root.focus();
			document.getSelection().collapse(root.firstChild, 1);
			const adapter = createRichTextVimAdapter(root);
			const baseline = topology(adapter);
			let runtime;
			const core = { ...loadedCore, createRuntime() {
				runtime = loadedCore.createRuntime();
				return runtime;
			} };
			const driver = await createVimDriver(adapter, core);
			const beforeDriver = topology(adapter);
			assert.equal(driver.handleKey({ key: 'i', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
				preventDefault() {}, stopPropagation() {} }), 'handled');
			const insertTopology = topology(adapter);
			assert.equal(insertTopology.change.size, 1);
			assert.ok(insertTopology.keydown.size > beforeDriver.keydown.size);
			const originalCommit = adapter.commitCommand.bind(adapter);
			let failAfterExitOnce = true;
			adapter.commitCommand = () => {
				originalCommit();
				if (failAfterExitOnce) {
					assert.equal(insertTopology.change.size, 1);
					assert.equal(topology(adapter).change.size, 0, 'Escape completed core change cleanup');
					assert.equal(topology(adapter).keydown.size, beforeDriver.keydown.size, 'Escape completed raw keydown cleanup');
					failAfterExitOnce = false;
					throw Object.assign(new Error('expected'), { name: 'VimEditRejectedError' });
				}
			};
			assert.equal(driver.handleKey({ key: 'Escape', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
				preventDefault() {}, stopPropagation() {} }), 'rejected');
			assert.equal(driver.mode(), 'insert');
			const recoveredInsertTopology = topology(adapter);
			assert.deepEqual(topologyCounts(recoveredInsertTopology), topologyCounts(insertTopology));
			assert.deepEqual([...recoveredInsertTopology.cursorActivity], [...insertTopology.cursorActivity], 'Escape cursorActivity duplicate check');
			assert.deepEqual([...recoveredInsertTopology.change], [...insertTopology.change], 'Escape change duplicate check');
			assert.deepEqual([...recoveredInsertTopology.paste], [...insertTopology.paste], 'Escape paste duplicate check');
			assert.deepEqual([...recoveredInsertTopology.keydown], [...insertTopology.keydown], 'Escape keydown duplicate check');
			const historyBeforeInput = cloneRuntimeGraph(runtime.Vim.getVimGlobalState_().macroModeState.lastInsertModeChanges);
			root.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'X' }));
			assert.equal(document.execCommand('insertText', false, 'X'), true);
			root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'X' }));
			assert.notDeepEqual(runtime.Vim.getVimGlobalState_().macroModeState.lastInsertModeChanges, historyBeforeInput);
			assert.ok(runtime.Vim.getVimGlobalState_().macroModeState.lastInsertModeChanges.changes.length > historyBeforeInput.changes.length);
			assert.equal(driver.handleKey({ key: 'Escape', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
				preventDefault() {}, stopPropagation() {} }), 'handled');
			assert.equal(driver.mode(), 'normal');
			driver.destroy();
			assert.deepEqual(topologyCounts(topology(adapter)), topologyCounts(baseline));
			return { failedEntryCommands: results, failedEscapeRestoredInsert: true, insertHistoryRestored: true };
		},
	},
	{
		name: 'structural empty blocks project only logical block transitions',
		html: '<div id="editor">x</div>',
		allowMutation: true,
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const projections = [
				['a<div><br></div>', 'a\n'],
				['<div>a</div><div><br></div><div>b</div>', 'a\n\nb'],
				['a<br>b', 'a\nb'],
				['<div><br></div>', ''],
				['<div>a</div><div><br></div>', 'a\n'],
			];
			for (const [html, expected] of projections) {
				root.innerHTML = html;
				const map = createRichTextPositionMap(root);
				assert.equal(map.text, expected, html);
				for (const offset of map.graphemeBoundaries) {
					for (const bias of ['forward', 'backward']) {
						const point = map.toDomPoint(offset, bias);
						assert.equal(map.toOffset(point.node, point.offset), offset, `${html}:${bias}:${offset}`);
					}
				}
			}
			return { projections: projections.map(([, expected]) => expected) };
		},
	},
	{
		name: 'real core dot follows the current cursor and latest edit',
		html: '<div id="editor" contenteditable="true">abcd</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver, cloneRuntimeGraph }) => {
			const root = document.querySelector('#editor');
			const native = document.execCommand.bind(document);
			const calls = [];
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: key === 'V', preventDefault() {}, stopPropagation() {} });
			const nativeInput = (inputType, data, value) => {
				root.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType, data }));
				assert.equal(document.execCommand('insertText', false, value), true);
				root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }));
			};
			const runInsertRepeat = async () => {
				root.innerHTML = 'abcd';
				const adapter = createRichTextVimAdapter(root);
				const changes = [];
				adapter.on('change', change => changes.push(change));
				const driver = await createVimDriver(adapter);
				root.focus();
				document.getSelection().collapse(root.firstChild, 0);
				adapter.setCursor({ line: 0, ch: 0 });
				assert.equal(driver.handleKey(event('i')), 'handled');
				nativeInput('insertText', 'X', 'X');
				assert.equal(driver.handleKey(event('Escape')), 'handled');
				assert.deepEqual(changes, [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, text: ['X'], origin: '+input' }]);
				adapter.setCursor({ line: 0, ch: 4 });
				assert.equal(driver.handleKey(event('.')), 'handled');
				driver.destroy();
				return adapter.getValue();
			};
			const first = await runInsertRepeat();
			root.innerHTML = 'abcd';
			const secondAdapter = createRichTextVimAdapter(root);
			const secondDriver = await createVimDriver(secondAdapter);
			root.focus();
			document.getSelection().collapse(root.firstChild, 0);
			secondAdapter.setCursor({ line: 0, ch: 0 });
			assert.equal(secondDriver.handleKey(event('i')), 'handled');
			nativeInput('insertText', 'X', 'X');
			assert.equal(secondDriver.handleKey(event('Escape')), 'handled');
			secondAdapter.setCursor({ line: 0, ch: 1 });
			assert.equal(secondDriver.handleKey(event('x')), 'handled');
			assert.equal(secondDriver.handleKey(event('.')), 'handled');
			const second = secondAdapter.getValue();
			secondDriver.destroy();
			root.innerHTML = 'one two three';
			const thirdAdapter = createRichTextVimAdapter(root);
			const thirdDriver = await createVimDriver(thirdAdapter);
			root.focus();
			document.getSelection().collapse(root.firstChild, 0);
			thirdAdapter.setCursor({ line: 0, ch: 0 });
			assert.equal(thirdDriver.handleKey(event('i')), 'handled');
			nativeInput('insertText', 'X', 'X');
			assert.equal(thirdDriver.handleKey(event('Escape')), 'handled');
			thirdAdapter.setCursor({ line: 0, ch: 5 });
			assert.equal(thirdDriver.handleKey(event('d')), 'handled');
			assert.equal(thirdDriver.handleKey(event('w')), 'handled');
			thirdAdapter.setCursor({ line: 0, ch: 5 });
			assert.equal(thirdDriver.handleKey(event('.')), 'handled');
			const third = thirdAdapter.getValue();
			thirdDriver.destroy();
			assert.equal(first, 'XabcXd');
			assert.equal(second, 'Xcd');
			assert.equal(third, 'Xone');
			assert.equal(calls.length, 8);
			return { first, second, third, nativeCalls: calls.length };
		},
	},
	{
		name: 'position map requires provenance for structural NBSP placeholders',
		html: '<div id="editor" contenteditable="true"><p>&nbsp;</p></div>',
		allowMutation: true,
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			assert.equal(createRichTextPositionMap(root).text, '\u00a0');
			root.innerHTML = 'a&nbsp;b';
			assert.equal(createRichTextPositionMap(root).text, 'a\u00a0b');
			root.innerHTML = 'alpha\n&nbsp;beta';
			assert.equal(createRichTextPositionMap(root).text, 'alpha\n\u00a0beta');
			const leadingLineNode = root.firstChild;
			assert.equal(createRichTextPositionMap(root, { placeholderOffsets: new WeakMap([[leadingLineNode, new Set([6])]]) }).text,
				'alpha\nbeta');
			root.innerHTML = '&nbsp;beta';
			assert.equal(createRichTextPositionMap(root).text, '\u00a0beta');
			const leadingNode = root.firstChild;
			assert.equal(createRichTextPositionMap(root, { placeholderOffsets: new WeakMap([[leadingNode, new Set([0])]]) }).text, 'beta');
			return { unproven: '\u00a0', proven: '' };
		},
	},
	{
		name: 'position map excludes only explicitly proven NBSP nodes',
		html: '<div id="editor" contenteditable="true"><p>&nbsp;</p></div>',
		allowMutation: true,
			run: ({ createRichTextPositionMap }) => {
				const root = document.querySelector('#editor');
				const node = root.querySelector('p').firstChild;
				const offsets = new WeakMap([[node, new Set([0])]]);
				assert.equal(createRichTextPositionMap(root, { placeholderOffsets: offsets }).text, '');
			return { logicalText: '' };
		},
	},
	{
		name: 'filtered text runs preserve source DOM offsets and both boundary biases',
		html: '<div id="editor" contenteditable="true">&nbsp;beta&nbsp;gamma</div>',
		allowMutation: true,
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const node = root.firstChild;
			const offsets = new WeakMap([[node, new Set([0, 5])]]);
			const map = createRichTextPositionMap(root, { placeholderOffsets: offsets });
			assert.equal(map.text, 'betagamma');
			assert.deepEqual(map.segments.map(({ start, end, sourceStart, sourceEnd }) => ({ start, end, sourceStart, sourceEnd })), [
				{ start: 0, end: 4, sourceStart: 1, sourceEnd: 5 },
				{ start: 4, end: 9, sourceStart: 6, sourceEnd: 11 },
			]);
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset, `${bias}:${offset}`);
				}
			}
			assert.equal(map.toDomPoint(0, 'forward').offset, 1);
			assert.equal(map.toDomPoint(0, 'backward').offset, 0);
			assert.equal(map.toDomPoint(4, 'forward').offset, 6);
			assert.equal(map.toDomPoint(4, 'backward').offset, 5);
			return { text: map.text };
		},
	},
	{
		name: 'all unproven intentional NBSP positions remain logical',
		html: '<div id="editor" contenteditable="true">x</div>',
		allowMutation: true,
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			root.innerHTML = '\u00a0lead\npost\u00a0mid\u00a0';
			assert.equal(createRichTextPositionMap(root).text, '\u00a0lead\npost\u00a0mid\u00a0');
			return { text: root.textContent };
		},
	},
	{
		name: 'renderer records exact input diffs and moves bookmarks through x',
		html: '<div id="editor" contenteditable="true">abcd</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const native = document.execCommand.bind(document);
			const calls = [];
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const adapter = createRichTextVimAdapter(root);
			const changes = [];
			adapter.on('change', change => changes.push(change));
			const bookmark = adapter.setBookmark({ line: 0, ch: 3 });
			root.focus();
			document.getSelection().collapse(root.firstChild, 2);
			adapter.setCursor({ line: 0, ch: 2 });
			root.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'X' }));
			assert.equal(document.execCommand('insertText', false, 'X'), true);
			root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'X' }));
			assert.deepEqual(changes, [{ from: { line: 0, ch: 2 }, to: { line: 0, ch: 2 }, text: ['X'], origin: '+input' }]);
			assert.deepEqual(bookmark.find(), { line: 0, ch: 4 });

			adapter.setCursor({ line: 0, ch: 1 });
			const driver = await createVimDriver(adapter);
			const key = value => ({ key: value, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			assert.equal(driver.handleKey(key('x')), 'handled');
			assert.deepEqual(bookmark.find(), { line: 0, ch: 3 });

			const beforeHTML = root.innerHTML;
			const beforeSelection = adapter.getSelectionState();
			adapter.beginCommand({ repeat: true });
			adapter.replaceRange('x', { line: 0, ch: 0 }, { line: 0, ch: 0 });
			adapter.setCursor({ line: 0, ch: 1 });
			assert.doesNotThrow(() => adapter.replaceRange('y', { line: 0, ch: 1 }, { line: 0, ch: 1 }));
			assert.equal(root.innerHTML, beforeHTML);
			adapter.commitCommand();
			assert.equal(root.textContent, 'xyaXcd');
			assert.equal(calls.length, 3);
			assert.notDeepEqual(adapter.getSelectionState(), beforeSelection);
			assert.equal(driver.handleKey(key('h')), 'handled');
			driver.destroy();
			return { changes, bookmark: bookmark.find(), nativeCalls: calls.length };
		},
	},
	{
		name: 'renderer moves bookmarks through dw and returns null after detach',
		html: '<div id="editor" contenteditable="true">one two</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const bookmark = adapter.setBookmark({ line: 0, ch: 6 });
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			root.focus();
			document.getSelection().collapse(root.firstChild, 0);
			adapter.setCursor({ line: 0, ch: 0 });
			assert.equal(driver.handleKey(event('d')), 'handled');
			assert.equal(driver.handleKey(event('w')), 'handled');
			assert.equal(adapter.getValue(), 'two');
			assert.deepEqual(bookmark.find(), { line: 0, ch: 2 });
			const detached = adapter.setBookmark({ line: 0, ch: 0 });
			root.innerHTML = '';
			root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
			assert.equal(detached.find(), null);
			driver.destroy();
			return { text: adapter.getValue(), bookmark: bookmark.find(), detached: detached.find() };
		},
	},
	{
		name: 'trusted Chromium keys feed core changes',
		html: '<div id="editor" contenteditable="true">ab</div>',
		allowMutation: true,
		inputEvents: [
			{ type: 'char', keyCode: 'X' },
			{ type: 'keyDown', keyCode: 'Backspace' }, { type: 'keyUp', keyCode: 'Backspace' },
			{ type: 'keyDown', keyCode: 'Delete' }, { type: 'keyUp', keyCode: 'Delete' },
			{ type: 'char', keyCode: '\r' },
		],
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const changes = [];
			adapter.on('change', change => changes.push(change));
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const driver = await createVimDriver(adapter);
			root.focus();
			document.getSelection().collapse(root.firstChild, 1);
			adapter.setCursor({ line: 0, ch: 1 });
			const key = value => ({ key: value, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			assert.equal(driver.handleKey(key('i')), 'handled');
			return await new Promise((resolve, reject) => {
				const deadline = setTimeout(() => reject(new Error(`trusted input timeout: ${JSON.stringify({ value: adapter.getValue(), changes })}`)), 1000);
				const poll = setInterval(() => {
					if (changes.length < 4) return;
					clearTimeout(deadline);
					clearInterval(poll);
					try {
						assert.deepEqual(changes, [
							{ from: { line: 0, ch: 1 }, to: { line: 0, ch: 1 }, text: ['X'], origin: '+input' },
							{ from: { line: 0, ch: 1 }, to: { line: 0, ch: 2 }, text: [''], origin: '+input' },
							{ from: { line: 0, ch: 1 }, to: { line: 0, ch: 2 }, text: [''], origin: '+input' },
							{ from: { line: 0, ch: 1 }, to: { line: 0, ch: 1 }, text: ['\n'], origin: '+input' },
						]);
						assert.equal(adapter.getValue(), 'a\n');
						assert.equal(driver.handleKey(key('Escape')), 'handled');
						assert.equal(driver.handleKey(key('.')), 'handled');
						assert.equal(calls.length, 1);
						assert.equal(adapter.getValue(), 'a\n\n');
						driver.destroy();
						resolve({ text: adapter.getValue(), changes, nativeCalls: calls.length });
					} catch (error) { reject(error); }
				}, 10);
			});
		},
	},
	{
		name: 'failed dot replay leaves the next Insert recordable',
		html: '<div id="editor" contenteditable="true">ab</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const key = value => ({ key: value, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			const nativeInput = value => {
				root.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: value }));
				assert.equal(document.execCommand('insertText', false, value), true);
				root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
			};
			root.focus();
			document.getSelection().collapse(root.firstChild, 1);
			adapter.setCursor({ line: 0, ch: 1 });
			assert.equal(driver.handleKey(key('i')), 'handled');
			nativeInput('X');
			assert.equal(driver.handleKey(key('Escape')), 'handled');
			adapter.setCursor({ line: 0, ch: 1 });
			const originalReplaceSelection = adapter.replaceSelection;
			adapter.replaceSelection = () => { throw Object.assign(new Error('forced replay failure'), { name: 'VimEditRejectedError' }); };
			assert.equal(driver.handleKey(key('.')), 'rejected');
			adapter.replaceSelection = originalReplaceSelection;
			adapter.setCursor({ line: 0, ch: 1 });
			assert.equal(driver.handleKey(key('i')), 'handled');
			nativeInput('Y');
			assert.equal(driver.handleKey(key('Escape')), 'handled');
			adapter.setCursor({ line: 0, ch: 1 });
			assert.equal(driver.handleKey(key('.')), 'handled');
			assert.equal(adapter.getValue(), 'aYYXb');
			driver.destroy();
			return { text: adapter.getValue() };
		},
	},
	{
		name: 'real core x and counted x delete exact graphemes',
		html: '<div id="editor" contenteditable="true">a👩‍💻b</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const native = document.execCommand.bind(document);
			const results = [];
			for (const [keys, expected] of [[['x'], 'ab'], [['2', 'x'], 'a']]) {
				root.innerHTML = 'a👩‍💻b';
				const calls = [];
				document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
				const adapter = createRichTextVimAdapter(root);
				const driver = await createVimDriver(adapter);
				root.focus();
				document.getSelection().collapse(root.firstChild, 1);
				adapter.setCursor({ line: 0, ch: 1 });
				const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
					shiftKey: false, preventDefault() {}, stopPropagation() {} });
				for (const key of keys) assert.equal(driver.handleKey(event(key)), 'handled');
				assert.equal(root.textContent, expected);
				assert.equal(adapter.getCursor().ch, 1);
				assert.deepEqual(calls, ['delete']);
				results.push({ keys: keys.join(''), text: root.textContent });
				driver.destroy();
			}
			return { results };
		},
	},
	{
		name: 'real core rejects gapped repeat edits before native mutation',
		html: '<div id="editor" contenteditable="true"><b>ab</b><i>cd</i></div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const native = document.execCommand.bind(document);
			const calls = [];
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			root.focus();
			document.getSelection().collapse(root.firstChild, 0);
			adapter.setCursor({ line: 0, ch: 0 });
			const bookmark = adapter.setBookmark({ line: 0, ch: 2 });
			assert.equal(driver.handleKey(event('x')), 'handled');
			assert.deepEqual(bookmark.find(), { line: 0, ch: 1 });
			const originalVimRoot = adapter.state.vim;
			const vimGraph = cloneRuntimeGraph(originalVimRoot);
			const nestedVimGraph = Object.fromEntries(Reflect.ownKeys(originalVimRoot)
				.filter(key => originalVimRoot[key] && typeof originalVimRoot[key] === 'object')
				.map(key => [key, cloneRuntimeGraph(originalVimRoot[key])]));
			const selectionState = () => {
				const selection = document.getSelection();
				return { anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
					focusNode: selection.focusNode, focusOffset: selection.focusOffset,
					direction: adapter.getSelectionState().direction };
			};
			const beforeSelection = selectionState();
			const before = { html: root.innerHTML, selection: beforeSelection, bookmark: bookmark.find() };
			const callsBeforeReplay = calls.length;
			const originalReplaceRange = adapter.replaceRange;
			adapter.replaceRange = function replaceRange(text, from, to) {
				const result = originalReplaceRange.call(adapter, text, from, to);
				return originalReplaceRange.call(adapter, text, { line: 0, ch: 1 }, { line: 0, ch: 2 }) || result;
			};
			assert.equal(driver.handleKey(event('.')), 'rejected');
			assert.equal(calls.length, callsBeforeReplay);
			assert.equal(root.innerHTML, before.html);
			assert.equal(root.textContent, 'bcd');
			const afterSelection = selectionState();
			assert.equal(afterSelection.anchorNode, before.selection.anchorNode);
			assert.equal(afterSelection.focusNode, before.selection.focusNode);
			assert.equal(afterSelection.anchorOffset, before.selection.anchorOffset);
			assert.equal(afterSelection.focusOffset, before.selection.focusOffset);
			assert.equal(afterSelection.direction, before.selection.direction);
			assert.deepEqual(bookmark.find(), before.bookmark);
			assert.equal(adapter.state.vim, originalVimRoot);
			assert.deepEqual(cloneRuntimeGraph(adapter.state.vim), vimGraph);
			assert.deepEqual(Object.fromEntries(Reflect.ownKeys(adapter.state.vim)
				.filter(key => adapter.state.vim[key] && typeof adapter.state.vim[key] === 'object')
				.map(key => [key, cloneRuntimeGraph(adapter.state.vim[key])])), nestedVimGraph);
			adapter.replaceRange = originalReplaceRange;
			assert.equal(driver.handleKey(event('l')), 'handled');
			assert.equal(adapter.getCursor().ch, 1);
			driver.destroy();
			return { text: adapter.getValue(), cursor: adapter.getCursor().ch, nativeCalls: calls.length };
		},
	},
	{
		name: 'real core emoji horizontal motion uses exact grapheme offsets',
		html: '<div id="editor" contenteditable="true">a👩‍💻b</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			root.focus();
			document.getSelection().collapse(root.firstChild, 1);
			adapter.setCursor({ line: 0, ch: 1 });
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			assert.equal(driver.handleKey(event('l')), 'handled');
			assert.equal(adapter.getCursor().ch, 6);
			assert.equal(driver.handleKey(event('h')), 'handled', JSON.stringify({ cursor: adapter.getCursor(), selection: document.getSelection().focusOffset }));
			assert.equal(adapter.getCursor().ch, 1);
			for (const key of ['2', 'l']) assert.equal(driver.handleKey(event(key)), 'handled');
			assert.equal(adapter.getCursor().ch, 6);
			for (const key of ['2', 'h']) assert.equal(driver.handleKey(event(key)), 'handled');
			assert.equal(adapter.getCursor().ch, 0);
			driver.destroy();
			return { cursor: 1 };
		},
	},
	{
		name: 'real core h enters the final grapheme from nonempty EOL and l clamps',
		html: '<div id="editor" contenteditable="true">a👩‍💻b</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			root.focus();
			document.getSelection().collapse(root.firstChild, 7);
			adapter.setCursor({ line: 0, ch: 7 });
			adapter.moveH(-1);
			assert.equal(adapter.getCursor().ch, 6);
			adapter.setCursor({ line: 0, ch: 7 });
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			assert.equal(driver.handleKey(event('h')), 'handled');
			assert.equal(adapter.getCursor().ch, 6);
			assert.equal(driver.handleKey(event('l')), 'handled');
			assert.equal(adapter.getCursor().ch, 6);
			driver.destroy();
			return { cursor: 6 };
		},
	},
	{
		name: 'real core isolates yank register for exact p',
		html: '<div id="editor" contenteditable="true">one two</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			root.focus();
			document.getSelection().collapse(root.firstChild, 0);
			adapter.setCursor({ line: 0, ch: 0 });
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			for (const key of ['y', 'w', 'p']) assert.equal(driver.handleKey(event(key)), 'handled');
			assert.equal(root.textContent, 'oone ne two');
			assert.equal(adapter.getCursor().ch, 4);
			assert.deepEqual(calls, ['insertText']);
			driver.destroy();
			return { text: root.textContent, cursor: 4 };
		},
	},
	{
		name: 'real core isolates yank register for exact P',
		html: '<div id="editor" contenteditable="true">one two</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			root.focus();
			document.getSelection().collapse(root.firstChild, 0);
			adapter.setCursor({ line: 0, ch: 0 });
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			for (const key of ['y', 'w', 'P']) assert.equal(driver.handleKey(event(key)), 'handled');
			assert.equal(root.textContent, 'one one two');
			assert.equal(adapter.getCursor().ch, 4);
			assert.deepEqual(calls, ['insertText']);
			driver.destroy();
			return { text: root.textContent, cursor: 4 };
		},
	},
	{
		name: 'real core repeats an isolated edit after undo',
		html: '<div id="editor" contenteditable="true">ab</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			root.focus();
			document.getSelection().collapse(root.firstChild, 0);
			adapter.setCursor({ line: 0, ch: 0 });
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			for (const key of ['x', 'u', '.']) assert.equal(driver.handleKey(event(key)), 'handled');
			assert.equal(adapter.getValue(), 'b');
			assert.equal(adapter.getCursor().ch, 0);
			assert.deepEqual(calls, ['delete', 'undo', 'delete']);
			driver.destroy();
			return { text: adapter.getValue(), cursor: 0 };
		},
	},
	{
		name: 'real pinned core accepts the complete approved command matrix',
		html: '<div id="editor" contenteditable="true"><b>alpha</b><br><i>beta</i></div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const native = document.execCommand.bind(document);
			const selection = offset => ({ anchorOffset: offset, headOffset: offset, direction: 'forward' });
			const unchanged = (keys, offset, nativeCalls = 0) => ({ keys, text: 'alpha\nbeta',
				selection: selection(offset), mode: 'normal', nativeCalls });
			const matrix = [
				unchanged(['h'], 0), unchanged(['l'], 1), unchanged(['2', 'h'], 0), unchanged(['2', 'l'], 2),
				unchanged(['j'], 6), unchanged(['k'], 0), unchanged(['2', 'j'], 6), unchanged(['2', 'k'], 0),
				unchanged(['w'], 6), unchanged(['b'], 0), unchanged(['e'], 4), unchanged(['0'], 0),
				unchanged(['^'], 0), unchanged(['$'], 4), unchanged(['g', 'g'], 0), unchanged(['2', 'g', 'g'], 6),
				unchanged(['G'], 6), unchanged(['2', 'G'], 6), unchanged(['i', 'Escape'], 0),
				unchanged(['a', 'Escape'], 0), unchanged(['I', 'Escape'], 0), unchanged(['A', 'Escape'], 4),
				{ keys: ['o', 'Escape'], text: 'alpha\n\nbeta', selection: selection(6), mode: 'normal', nativeCalls: 1 },
				{ keys: ['O', 'Escape'], text: '\nalpha\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['x'], text: 'lpha\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['2', 'x'], text: 'pha\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['D'], text: '\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['C', 'Escape'], text: '\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['d', 'w'], text: '\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['d', '2', 'w'], text: '', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['d', 'd'], text: 'beta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['2', 'd', 'd'], text: '', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['c', 'w', 'Escape'], text: '\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['c', 'c', 'Escape'], text: '\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				unchanged(['y', 'w'], 0), unchanged(['y', 'y'], 0), unchanged(['v', 'l', 'Escape'], 1),
				unchanged(['V', 'Escape'], 0),
				{ keys: ['v', 'l', 'd'], text: 'pha\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				{ keys: ['v', 'l', 'c', 'Escape'], text: 'pha\nbeta', selection: selection(0), mode: 'normal', nativeCalls: 1 },
				unchanged(['v', 'l', 'y'], 0), unchanged(['u'], 0, 1), unchanged(['<C-r>'], 0, 1), unchanged(['.'], 0),
			];
			const outcomes = [];
			for (const expected of matrix) {
				const { keys } = expected;
				root.innerHTML = '<b>alpha</b><br><i>beta</i>';
				const adapter = createRichTextVimAdapter(root);
				const driver = await createVimDriver(adapter);
				const text = root.querySelector('b').firstChild;
				root.focus();
				const startOffset = 0;
				document.getSelection().setBaseAndExtent(text, startOffset, text, startOffset);
				adapter.setCursor({ line: 0, ch: startOffset });
				const event = key => ({ key: key === '<C-r>' ? 'r' : key,
					ctrlKey: key === '<C-r>', altKey: false, metaKey: false,
					shiftKey: key === 'G' || key === 'V', preventDefault() {}, stopPropagation() {} });
				const calls = [];
				document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
				const result = keys.map(key => driver.handleKey(event(key)));
				assert.deepEqual(result, keys.map(() => 'handled'), keys.join(''));
				assert.deepEqual({ text: adapter.getValue(), selection: adapter.getSelectionState(), mode: driver.mode(), nativeCalls: calls.length },
					{ text: expected.text, selection: expected.selection, mode: expected.mode, nativeCalls: expected.nativeCalls }, keys.join(''));
				outcomes.push(keys.join(''));
				driver.destroy();
			}
			return { commandCount: matrix.length, outcomes };
		},
	},
	{
		name: 'real core preserves graphemes and edits at EOL without collapsed native ranges',
		html: '<div id="editor" contenteditable="true">a👩‍💻b\nline</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			const text = root.firstChild;
			root.focus();
			document.getSelection().setBaseAndExtent(text, 1, text, 1);
			adapter.setCursor({ line: 0, ch: 1 });
			assert.equal(driver.handleKey(event('l')), 'handled', JSON.stringify({ calls, cursor: adapter.getCursor() }));
			assert.equal([1, 6, 7].includes(adapter.getCursor().ch), true);
			assert.equal(driver.handleKey(event('h')), 'handled');
			assert.equal([1, 6, 7].includes(adapter.getCursor().ch), true);
			adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 6 });
			assert.equal(root.textContent, 'ab\nline');
			adapter.setCursor({ line: 0, ch: 2 });
			assert.equal(driver.handleKey(event('D')), 'handled');
			assert.equal(root.textContent, 'ab\nline');
			assert.equal(calls.filter(call => call === 'delete').length, 1);
			adapter.setCursor({ line: 0, ch: 2 });
			assert.equal(driver.handleKey(event('C')), 'handled');
			assert.equal(driver.handleKey(event('Escape')), 'handled');
			assert.equal(root.textContent, 'ab\nline');
			assert.equal(calls.filter(call => call === 'delete').length, 1);
			driver.destroy();
			return { text: root.textContent, calls };
		},
	},
	{
		name: 'real core completes counted gg/G and visual c atomically',
		html: '<div id="editor" contenteditable="true">one\ntwo\nthree</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const event = (key, overrides = {}) => ({ key, ctrlKey: false, altKey: false,
				metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...overrides });
			document.getSelection().collapse(root.firstChild, 0);
			adapter.setCursor({ line: 0, ch: 0 });
			for (const key of ['2', 'g', 'g']) assert.equal(driver.handleKey(event(key)), 'handled', key);
			assert.deepEqual(adapter.getCursor(), { line: 1, ch: 0 });
			assert.equal(driver.handleKey(event('G', { shiftKey: true })), 'handled', 'G');
			assert.deepEqual(adapter.getCursor(), { line: 2, ch: 0 });
			assert.equal(driver.handleKey(event('v')), 'handled', 'v');
			assert.equal(driver.mode(), 'visual');
			for (let index = 0; index < 4; index += 1) assert.equal(driver.handleKey(event('l')), 'handled', `l${index}`);
			assert.equal(driver.handleKey(event('c')), 'handled', 'c');
			assert.equal(driver.mode(), 'insert');
			assert.equal(adapter.getValue(), 'one\ntwo', JSON.stringify({ domText: root.textContent, calls }));
			assert.deepEqual(adapter.getSelectionState(), { anchorOffset: 7, headOffset: 7, direction: 'forward' });
			assert.deepEqual(calls, ['delete']);
			driver.destroy();
			return { text: root.textContent, html: root.innerHTML, mode: driver.mode(), calls };
		},
	},
	{
		name: 'real core buffers Visual gg without sending bare g',
		html: '<div id="editor" contenteditable="true">one\ntwo\nthree</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver, loadVimCore }) => {
			const root = document.querySelector('#editor');
			root.focus();
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter, loadVimCore());
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			adapter.setCursor({ line: 2, ch: 0 });
			assert.equal(driver.handleKey(event('v')), 'handled');
			assert.equal(driver.handleKey(event('g')), 'handled');
			assert.equal(adapter.getCursor().line, 2);
			assert.equal(driver.handleKey(event('g')), 'handled');
			assert.equal(adapter.getCursor().line, 0);
			assert.equal(driver.mode(), 'visual');
			driver.destroy();
			return { line: 0, mode: 'visual' };
		},
	},
	{
		name: 'external typing prunes native placeholder provenance',
		html: '<div id="editor" contenteditable="true">one\ntwo\nthree</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			root.focus();
			adapter.setCursor({ line: 2, ch: 0 });
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			assert.equal(driver.handleKey(event('v')), 'handled');
			for (let index = 0; index < 4; index += 1) assert.equal(driver.handleKey(event('l')), 'handled');
			assert.equal(driver.handleKey(event('c')), 'handled');
			const textNodes = [];
			const visit = node => {
				if (node.nodeType === Node.TEXT_NODE) textNodes.push(node);
				else node.childNodes.forEach(visit);
			};
			visit(root);
			textNodes.at(-1).nodeValue += 'X';
			root.dispatchEvent(new Event('input', { bubbles: true }));
			assert.equal(adapter.getValue(), 'one\ntwo\u00a0X');
			driver.destroy();
			return { text: adapter.getValue() };
		},
	},
	{
		name: 'native delete records only NBSPs in the inserted diff region',
		html: '<div id="editor" contenteditable="true"><p>ab</p><p>legit&nbsp;text</p></div>',
		allowMutation: true,
		run: ({ createRichTextVimAdapter }) => {
			const root = document.querySelector('#editor');
			const originalExecCommand = document.execCommand.bind(document);
			document.execCommand = (command, ...args) => {
				if (command === 'delete') {
					root.innerHTML = '<p>a</p><p>&nbsp;</p><p>legit&nbsp;text</p>';
					return true;
				}
				return originalExecCommand(command, ...args);
			};
			const adapter = createRichTextVimAdapter(root);
			root.focus();
			document.getSelection().collapse(root.querySelector('p').firstChild, 1);
			adapter.beginCommand();
			adapter.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 });
			adapter.commitCommand();
			assert.equal(adapter.getValue(), 'a\n\nlegit\u00a0text');
			assert.equal(root.querySelectorAll('p')[2].firstChild.nodeValue, 'legit\u00a0text');
			adapter.destroy();
			return { text: adapter.getValue() };
		},
	},
	{
		name: 'real Vim core and production controller map DOM Escape to normal mode',
		html: '<div role="dialog" data-compose-context="new-message"><div role="toolbar"><button aria-label="Envoyer" data-compose-action="send">Envoyer</button></div><div id="editor" contenteditable="true" role="textbox" aria-label="Corps du message" data-testid="message-body">one</div></div>',
		allowMutation: true,
		run: async ({ createVimEditing, createVimDriver, loadVimCore }) => {
			const editor = document.querySelector('#editor');
			editor.focus();
			document.getSelection().collapse(editor.firstChild, 0);
			let driver;
			const controller = createVimEditing({
				document,
				loadCore: loadVimCore,
				createDriver: (adapter, corePromise) => createVimDriver(adapter, corePromise).then(created => {
					driver = created;
					return created;
				}),
			});
			controller.init({ shortcuts: { vim: { enabled: true } } });
			await new Promise(resolve => setImmediate(resolve));
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, target: editor, composedPath: () => [editor],
				preventDefault() { this.prevented = true; },
				stopPropagation() { this.stopped = true; } });
			assert.equal(controller.handleKeydown(event('i')), 'handled');
			assert.equal(document.querySelector('[data-vim-mode-badge="true"]').textContent, 'INSERT');
			const escape = event('Escape');
			assert.equal(controller.handleKeydown(escape), 'handled');
			assert.equal(escape.prevented, true);
			assert.equal(driver.mode(), 'normal');
			assert.equal(document.querySelector('[data-vim-mode-badge="true"]').textContent, 'NORMAL');
			controller.destroy();
			return { mode: 'normal', badge: 'NORMAL' };
		},
	},
	{
		name: 'real driver x does not invoke native at empty document or EOL',
		html: '<div id="editor" contenteditable="true">one</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			const text = root.firstChild;
			document.getSelection().setBaseAndExtent(text, 3, text, 3);
			adapter.setCursor({ line: 0, ch: 3 });
			assert.equal(driver.handleKey(event('x')), 'handled');
			assert.equal(root.textContent, 'one');
			assert.deepEqual(calls, []);
			driver.destroy();
			return { nativeCalls: calls.length };
		},
	},
	{
		name: 'real driver x does not invoke native in an empty document',
		html: '<div id="editor" contenteditable="true"></div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const event = { key: 'x', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
				preventDefault() {}, stopPropagation() {} };
			document.getSelection().setBaseAndExtent(root, 0, root, 0);
			assert.equal(driver.handleKey(event), 'handled');
			assert.equal(root.textContent, '');
			assert.deepEqual(calls, []);
			driver.destroy();
			return { nativeCalls: calls.length };
		},
	},
	{
		name: 'real driver x beside an atomic object rejects without native command',
		html: '<div id="editor" contenteditable="true"><span contenteditable="false">chip</span>x</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const calls = [];
			const native = document.execCommand.bind(document);
			document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
			const event = { key: 'x', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
				preventDefault() {}, stopPropagation() {} };
			const selection = document.getSelection();
			selection.setBaseAndExtent(root, 0, root, 0);
			const before = { html: root.innerHTML, selection: adapter.getSelectionState() };
			assert.equal(driver.handleKey(event), 'rejected');
			assert.equal(event.prevented, undefined);
			assert.deepEqual(calls, []);
			assert.equal(root.innerHTML, before.html);
			assert.deepEqual(adapter.getSelectionState(), before.selection);
			driver.destroy();
			return { nativeCalls: calls.length };
		},
	},
	{
		name: 'real core rejects atomic yanks and sentinel pastes without mutation',
		html: '<div id="editor" contenteditable="true">a<span contenteditable="false">chip</span>b</div>',
		run: async ({ createRichTextVimAdapter, createVimDriver, loadVimCore }) => {
			const root = document.querySelector('#editor');
			const core = await loadVimCore();
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			const run = async keys => {
			const runtime = core.createRuntime();
			const { Vim } = runtime;
			const register = Vim.getRegisterController().getRegister('"');
			const registerSnapshot = () => Object.fromEntries(Object.entries(Vim.getRegisterController().registers)
				.map(([name, value]) => [name, { text: value.toString(), linewise: value.linewise, blockwise: value.blockwise }]));
			register.setText(keys.includes('p') || keys.includes('P') ? '\uFFFCx' : 'original');
				root.innerHTML = 'a<span contenteditable="false">chip</span>b';
				const adapter = createRichTextVimAdapter(root);
				const driver = await createVimDriver(adapter, runtime);
				Vim.maybeInitVimState_(adapter);
				const beforeHTML = root.innerHTML;
				document.getSelection().setBaseAndExtent(root, 0, root, 0);
				adapter.setCursor({ line: 0, ch: 0 });
				const before = { html: beforeHTML, selection: adapter.getSelectionState(), registers: registerSnapshot() };
				const calls = [];
				const native = document.execCommand.bind(document);
				document.execCommand = (...args) => { calls.push(args[0]); return native(...args); };
				let results;
				if (keys[0] === 'v') {
					results = [driver.handleKey(event('v'))];
					before.selection = adapter.getSelectionState();
					// The pinned core has no public visual-selection setter; this is its test state.
					adapter.state.vim.visualMode = true;
					adapter.state.vim.sel = { anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 2 } };
					results.push(driver.handleKey(event('y')));
				} else {
					results = keys.map(key => driver.handleKey(event(key)));
				}
				if (keys[0] === 'V') assert.equal(results[0], 'rejected', keys.join(''));
				else assert.equal(results.at(-1), 'rejected', keys.join(''));
				assert.equal(root.innerHTML, before.html);
				assert.deepEqual(adapter.getSelectionState(), before.selection, keys.join(''));
				assert.deepEqual(registerSnapshot(), before.registers);
				assert.deepEqual(calls, []);
				document.execCommand = native;
				driver.destroy();
				return { keys: keys.join(''), results, selection: adapter.getSelectionState() };
			};
			const yanks = [];
			for (const keys of [['2', 'y', 'w'], ['y', 'y']]) yanks.push(await run(keys));
			const visual = await run(['v', 'y']);
			const pastes = [];
			for (const keys of [['p'], ['P']]) pastes.push(await run(keys));
			return { yanks, visual, pastes };
		},
	},
	{
		name: 'real core rejection preserves register and dot continuity',
		html: '<div id="editor" contenteditable="true">ab</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver, loadVimCore, cloneRuntimeGraph }) => {
			const root = document.querySelector('#editor');
			const core = await loadVimCore();
			const runtime = core.createRuntime();
			const { Vim } = runtime;
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter, runtime);
			const originalVimRoot = adapter.state.vim;
			const event = key => ({ key, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, preventDefault() {}, stopPropagation() {} });
			const setCursor = offset => {
				adapter.refreshSnapshot?.();
				root.focus();
				document.getSelection().collapse(root, 0);
				adapter.setCursor({ line: 0, ch: offset });
			};
			const registerMetadata = () => Object.fromEntries(Object.entries(Vim.getRegisterController().registers)
				.map(([name, value]) => [name, { linewise: value.linewise, blockwise: value.blockwise }]));
			const stateMetadata = () => {
				const state = Vim.getVimGlobalState_();
				return {
					registers: registerMetadata(),
					insert: cloneRuntimeGraph(state.macroModeState?.lastInsertModeChanges),
					jumpList: state.jumpList,
				};
			};
			let unnamedRegister = Vim.getRegisterController().getRegister('"');
			unnamedRegister.setText('\uFFFCx');

			setCursor(0);
			assert.equal(driver.handleKey(event('i')), 'handled');
			assert.equal(document.execCommand('insertText', false, 'X'), true);
			root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'X' }));
			assert.equal(driver.handleKey(event('Escape')), 'handled');
			root.innerHTML = 'a<span contenteditable="false">chip</span>b';
			setCursor(0);
			const beforeReject = stateMetadata();
			assert.equal(driver.handleKey(event('p')), 'rejected');
			const afterReject = stateMetadata();
			assert.equal(adapter.state.vim, originalVimRoot);
			assert.equal(driver.mode(), 'normal');
			assert.notEqual(afterReject.jumpList, beforeReject.jumpList);
			assert.deepEqual(afterReject.registers, beforeReject.registers);
			assert.deepEqual(afterReject.insert, beforeReject.insert);

			root.innerHTML = 'ab';
			setCursor(0);
			unnamedRegister = Vim.getRegisterController().getRegister('"');
			unnamedRegister.setText('fixed');
			assert.equal(driver.handleKey(event('.')), 'handled');
			assert.equal(adapter.getValue(), 'Xab');
			root.innerHTML = 'ab';
			setCursor(0);
			unnamedRegister = Vim.getRegisterController().getRegister('"');
			unnamedRegister.setText('fixed');
			assert.equal(driver.handleKey(event('p')), 'handled');
			assert.equal(adapter.getValue(), 'fixedab');

			root.innerHTML = 'one two';
			setCursor(0);
			for (const key of ['y', 'w']) assert.equal(driver.handleKey(event(key)), 'handled');
			unnamedRegister = Vim.getRegisterController().getRegister('"');
			unnamedRegister.setText('fixed');
			setCursor(4);
			const beforeFailure = stateMetadata();
			const originalCommit = adapter.commitCommand;
			adapter.commitCommand = () => { throw new Error('synthetic commit failure'); };
			assert.equal(driver.handleKey(event('y')), 'handled');
			assert.throws(() => driver.handleKey(event('w')), /synthetic commit failure/);
			adapter.commitCommand = originalCommit;
			const afterFailure = stateMetadata();
			assert.deepEqual(afterFailure.registers, beforeFailure.registers);
			assert.deepEqual(afterFailure.insert, beforeFailure.insert);
			root.innerHTML = 'ab';
			setCursor(0);
			unnamedRegister = Vim.getRegisterController().getRegister('"');
			assert.equal(driver.handleKey(event('p')), 'handled');
			assert.equal(adapter.getValue(), 'fixedab');
			driver.destroy();
			return { rejected: true, restoredCommitFailure: true };
		},
	},
	{
		name: 'native delete removes a selected grapheme',
		html: '<div id="editor" contenteditable="true">one</div>',
		allowMutation: true,
		run: ({ createRichTextVimAdapter }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			adapter.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 1 });
			adapter.replaceSelection('');
			assert.equal(root.textContent, 'ne');
			return { text: root.textContent };
		},
	},
	{
		name: 'real driver x dw dd undo and redo use one transaction',
		html: '<div id="editor" contenteditable="true">one two three</div>',
		allowMutation: true,
		run: async ({ createRichTextVimAdapter, createVimDriver }) => {
			const root = document.querySelector('#editor');
			const adapter = createRichTextVimAdapter(root);
			const driver = await createVimDriver(adapter);
			const text = root.firstChild;
			document.getSelection().setBaseAndExtent(text, 0, text, 0);
			const event = (key, overrides = {}) => ({ key, ctrlKey: false, altKey: false,
				metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...overrides });
			adapter.setCursor({ line: 0, ch: 0 });
			assert.equal(driver.handleKey(event('x')), 'handled');
			assert.equal(root.textContent, 'ne two three');
			assert.equal(driver.handleKey(event('u')), 'handled');
			assert.equal(root.textContent, 'one two three');
			assert.equal(driver.handleKey(event('r', { ctrlKey: true })), 'handled');
			assert.equal(root.textContent, 'ne two three');
			adapter.setCursor({ line: 0, ch: 0 });
			assert.equal(driver.handleKey(event('d')), 'handled');
			assert.equal(driver.handleKey(event('w')), 'handled');
			assert.equal(root.textContent, 'two three');
			adapter.setCursor({ line: 0, ch: 0 });
			assert.equal(driver.handleKey(event('d')), 'handled');
			assert.equal(driver.handleKey(event('d')), 'handled');
			assert.equal(root.textContent, '');
			driver.destroy();
			return { text: root.textContent };
		},
	},
	{
		name: 'adapter preserves backward selection and uses one native edit',
		html: '<div id="editor" contenteditable="true"><b>alpha</b> beta</div>',
		run: ({ createRichTextVimAdapter }) => {
			const root = document.querySelector('#editor');
			const beforeHTML = root.innerHTML;
			const adapter = createRichTextVimAdapter(root);
			const selection = document.getSelection();
			const text = root.querySelector('b').firstChild;
			selection.setBaseAndExtent(text, 4, text, 1);
			assert.deepEqual(adapter.getSelectionState(), {
				anchorOffset: 4, headOffset: 1, direction: 'backward',
			});
			adapter.replaceSelection('X');
			assert.equal(root.textContent, 'aXa beta');
			assert.equal(document.execCommand('undo'), true);
			assert.equal(root.innerHTML, beforeHTML);
			adapter.destroy();
			return { editCount: 1 };
		},
	},
	{
		name: 'nested inline formatting',
		html: '<div id="editor"><strong><em>ab</em></strong></div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, 'ab');
			assert.equal(map.toOffset(...Object.values(map.toDomPoint(1, 'forward'))), 1);
			assert.equal(map.toOffset(...Object.values(map.toDomPoint(1, 'backward'))), 1);
			return { text: map.text, segments: map.segments.length };
		},
	},
	{
		name: 'adjacent markup uses directional shared boundary points',
		html: '<div id="editor"><b>a</b><i>b</i></div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			const forward = map.toDomPoint(1, 'forward');
			const backward = map.toDomPoint(1, 'backward');
			assert.equal(forward.node, document.querySelector('i').firstChild);
			assert.equal(forward.offset, 0);
			assert.equal(backward.node, document.querySelector('b').firstChild);
			assert.equal(backward.offset, 1);
			return { forward: forward.offset, backward: backward.offset };
		},
	},
	{
		name: 'empty paragraphs remain line boundaries',
		html: '<div id="editor"><p></p><p>x</p><p></p></div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, '\n' + 'x' + '\n');
			return { text: map.text };
		},
	},
	{
		name: 'br and mixed block inline nodes project predictably',
		html: '<section id="editor"><div><b>a</b><br>c</div><p>d</p></section>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, 'a\nc\nd');
			assert.equal(map.toDomPoint(1, 'forward').node.nodeName, 'BR');
			return { text: map.text };
		},
	},
	{
		name: 'backward DOM selections round trip',
		html: '<div id="editor"><b>one</b> <i>two</i></div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			const start = map.toDomPoint(5, 'forward');
			const end = map.toDomPoint(1, 'backward');
			assert.equal(map.toOffset(start.node, start.offset), 5);
			assert.equal(map.toOffset(end.node, end.offset), 1);
			return { start: 5, end: 1 };
		},
	},
	{
		name: 'joined emoji exposes only grapheme boundaries',
		html: '<div id="editor">a👩‍💻b</div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.deepEqual([...map.graphemeBoundaries].sort((a, b) => a - b), [0, 1, 6, 7]);
			assert.throws(() => map.toDomPoint(2, 'forward'), /grapheme/);
			return { textLength: map.text.length };
		},
	},
	{
		name: 'known atomic objects become replacement characters',
		html: '<div id="editor">a<img alt="x"><span contenteditable="false">x</span>b</div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, 'a\uFFFC\uFFFCb');
			assert.equal(map.segments.filter(segment => segment.atomic).length, 2);
			assert.equal(map.crossesAtomic(0, 1), false);
			assert.equal(map.crossesAtomic(0, 2), true);
			return { atomicCount: 2 };
		},
	},
	{
		name: 'unknown non-text leaves are not silently discarded',
		html: '<div id="editor">a<custom-object></custom-object>b</div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, 'a\uFFFCb');
			assert.equal(map.segments[1].atomic, true);
			assert.equal(map.segments[1].node.nodeName, 'CUSTOM-OBJECT');
			return { text: map.text };
		},
	},
	{
		name: 'offset zero and end have exact directional points',
		html: '<div id="editor"><b>ab</b></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			for (const bias of ['forward', 'backward']) {
				for (const offset of [0, map.text.length]) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset, `${bias}:${offset}`);
				}
			}
			assert.deepEqual(map.toDomPoint(0, 'backward'), { node: root.querySelector('b').firstChild, offset: 0 });
			assert.deepEqual(map.toDomPoint(2, 'forward'), { node: root.querySelector('b').firstChild, offset: 2 });
			return { text: map.text };
		},
	},
	{
		name: 'every grapheme boundary round trips in both directions',
		html: '<div id="editor">a👩‍💻b<br>c</div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset, `${bias}:${offset}`);
				}
			}
			return { boundaries: [...map.graphemeBoundaries] };
		},
	},
	{
		name: 'BR has invertible before and after points',
		html: '<div id="editor">a<br>b</div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			const before = map.toDomPoint(1, 'backward');
			const after = map.toDomPoint(2, 'forward');
			assert.equal(before.node, root, `before node ${before.node.nodeName}`);
			assert.equal(before.offset, 1);
			assert.equal(after.node, root, `after node ${after.node.nodeName}`);
			assert.equal(after.offset, 2);
			assert.equal(map.toOffset(before.node, before.offset), 1);
			assert.equal(map.toOffset(after.node, after.offset), 2);
			return { text: map.text };
		},
	},
	{
		name: 'synthetic block newline has invertible endpoints',
		html: '<section id="editor"><p>a</p><p>b</p></section>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			const before = map.toDomPoint(1, 'backward');
			const after = map.toDomPoint(2, 'forward');
			assert.notDeepEqual(before, after);
			assert.equal(map.toOffset(before.node, before.offset), 1);
			assert.equal(map.toOffset(after.node, after.offset), 2);
			return { text: map.text };
		},
	},
	{
		name: 'mixed inline and block siblings preserve logical boundaries',
		html: '<section id="editor"><span>a</span><p>b</p><span>c</span><div>d</div><i>e</i></section>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, 'a\nb\nc\nd\ne');
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset);
				}
			}
			return { text: map.text };
		},
	},
	{
		name: 'element boundaries inside a split grapheme reject centrally',
		html: '<div id="editor"><b>👩</b><i>‍💻</i></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			assert.equal(map.text, '👩‍💻');
			assert.deepEqual([...map.graphemeBoundaries], [0, 5]);
			assert.throws(() => map.toOffset(root, 1), RangeError);
			for (const offset of [0, map.text.length]) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset);
				}
			}
			return { textLength: map.text.length };
		},
	},
	{
		name: 'consecutive empty paragraphs preserve line separators',
		html: '<div id="editor"><p></p><p></p><p></p></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			assert.equal(map.text, '\n\n');
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset);
				}
			}
			assert.equal(map.toOffset(root.querySelectorAll('p')[0], 0), 0);
			assert.equal(map.toOffset(root.querySelectorAll('p')[1], 0), 1);
			assert.equal(map.toOffset(root.querySelectorAll('p')[2], 0), 2);
			return { text: map.text };
		},
	},
	{
		name: 'leading and trailing empty block points map to line offsets',
		html: '<div id="editor"><p></p><p>x</p><p></p></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const paragraphs = root.querySelectorAll('p');
			const map = createRichTextPositionMap(root);
			assert.equal(map.text, '\nx\n');
			assert.equal(map.toOffset(paragraphs[0], 0), 0);
			assert.equal(map.toOffset(paragraphs[2], 0), 3);
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset);
				}
			}
			return { text: map.text };
		},
	},
	{
		name: 'atomic subtrees are skipped while unknown visible wrappers stay transparent',
		html: '<div id="editor">a<span contenteditable="false"><b>hidden</b></span><custom-wrap><b>visible</b></custom-wrap><custom-leaf></custom-leaf><custom-leaf>x</custom-leaf>b</div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			assert.equal(map.text, 'a\uFFFC\uFFFC\uFFFC\uFFFCb');
			assert.deepEqual(map.segments.filter(segment => segment.atomic).map(segment => segment.node.nodeName), ['SPAN', 'CUSTOM-WRAP', 'CUSTOM-LEAF', 'CUSTOM-LEAF']);
			assert.equal(map.segments.some(segment => segment.node.nodeName === 'B' && segment.node.textContent === 'hidden'), false);
			assert.equal(map.segments.some(segment => segment.node.nodeName === 'B' && segment.node.textContent === 'visible'), false);
			return { text: map.text };
		},
	},
	{
		name: 'points inside atomic subtrees reject',
		html: '<div id="editor">a<span contenteditable="false"><b>hidden</b></span>b<img alt="known"><i>tail</i></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			assert.throws(() => map.toOffset(root.querySelector('b').firstChild, 1), RangeError);
			assert.throws(() => map.toOffset(root.querySelector('span'), 0), RangeError);
			return { text: map.text };
		},
	},
	{
		name: 'toOffset validates integer range and grapheme boundaries',
		html: '<div id="editor">a👩‍💻b<span>x</span></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			const text = root.firstChild;
			for (const offset of [-1, 1.5, text.nodeValue.length + 1]) {
				assert.throws(() => map.toOffset(text, offset), RangeError, `text:${offset}`);
			}
			assert.throws(() => map.toOffset(text, 2), RangeError, 'text grapheme interior');
			for (const offset of [-1, 0.5, root.childNodes.length + 1]) {
				assert.throws(() => map.toOffset(root, offset), RangeError, `element:${offset}`);
			}
			return { text: map.text };
		},
	},
	{
		name: 'content followed by empty blocks keeps every block start',
		html: '<div id="editor"><p>x</p><p></p><p></p></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const paragraphs = root.querySelectorAll('p');
			const map = createRichTextPositionMap(root);
			assert.equal(map.text, 'x\n\n');
			assert.deepEqual([...paragraphs].map(paragraph => map.toOffset(paragraph, 0)), [0, 2, 3]);
			assert.equal(map.toDomPoint(2, 'forward').node, paragraphs[1]);
			assert.equal(map.toDomPoint(2, 'forward').offset, 0);
			assert.equal(map.toDomPoint(3, 'forward').node, paragraphs[2]);
			assert.equal(map.toDomPoint(3, 'forward').offset, 0);
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset);
				}
			}
			return { text: map.text, blockStarts: [0, 2, 3] };
		},
	},
	{
		name: 'comments do not break projected block sibling separators',
		html: '<div id="editor"><p>a</p><!--ignored--><p>b</p></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			assert.equal(map.text, 'a\nb');
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset);
				}
			}
			return { text: map.text };
		},
	},
	{
		name: 'empty text nodes do not create duplicate block separators',
		html: '<div id="editor"><p>a</p><p>b</p></div>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const emptyText = document.createTextNode('');
			root.insertBefore(emptyText, root.children[1]);
			const map = createRichTextPositionMap(root);
			root.removeChild(emptyText);
			assert.equal(map.text, 'a\nb');
			return { text: map.text };
		},
	},
	{
		name: 'whitespace-only text projects as visible content',
		html: '<div id="editor"><p>a</p> <p>b</p></div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, 'a\n \nb');
			return { text: map.text };
		},
	},
	{
		name: 'empty transparent spans do not participate in adjacency',
		html: '<div id="editor"><p>a</p><span></span><p>b</p></div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, 'a\nb');
			return { text: map.text };
		},
	},
	{
		name: 'nested empty transparent wrappers do not participate in adjacency',
		html: '<div id="editor"><p>a</p><span><i><b></b></i></span><p>b</p></div>',
		run: ({ createRichTextPositionMap }) => {
			const map = createRichTextPositionMap(document.querySelector('#editor'));
			assert.equal(map.text, 'a\nb');
			return { text: map.text };
		},
	},
	{
		name: 'BR followed by a block has one line separator with both-bias round trips',
		html: '<section id="editor"><p>a<br></p><p>b</p></section>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			assert.equal(map.text, 'a\nb');
			const separatorBefore = map.toDomPoint(1, 'backward');
			const separatorAfter = map.toDomPoint(2, 'forward');
			assert.notDeepEqual(separatorBefore, separatorAfter);
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset, `${bias}:${offset}`);
				}
			}
			return { text: map.text };
		},
	},
	{
		name: 'atomic block retains block separators and projects once',
		html: '<section id="editor"><span>a</span><div contenteditable="false"><b>hidden</b></div><span>b</span></section>',
		run: ({ createRichTextPositionMap }) => {
			const root = document.querySelector('#editor');
			const map = createRichTextPositionMap(root);
			assert.equal(map.text, 'a\n\uFFFC\nb');
			assert.equal(map.segments.filter(segment => segment.atomic).length, 1);
			for (const offset of map.graphemeBoundaries) {
				for (const bias of ['forward', 'backward']) {
					const point = map.toDomPoint(offset, bias);
					assert.equal(map.toOffset(point.node, point.offset), offset, `${bias}:${offset}`);
				}
			}
			return { text: map.text };
		},
	},
];

async function runCase(browserWindow, testCase) {
	await browserWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testCase.html)}`);
	const execution = browserWindow.webContents.executeJavaScript(`
		(async () => {
			const assert = require('node:assert/strict');
			const beforeHTML = document.body.innerHTML;
			try {
				const { createRichTextPositionMap } = require(${JSON.stringify(mapPath)});
				const { createRichTextVimAdapter } = require(${JSON.stringify(adapterPath)});
				const { createVimDriver, loadVimCore, cloneRuntimeGraph } = require(${JSON.stringify(vimCorePath)});
				const { createVimEditing } = require(${JSON.stringify(vimEditingPath)});
				const result = await (${testCase.run.toString()})( { createRichTextPositionMap, createRichTextVimAdapter, createVimDriver, createVimEditing, loadVimCore, cloneRuntimeGraph } );
				if (!${testCase.allowMutation ? 'true' : 'false'}) assert.equal(document.body.innerHTML, beforeHTML, 'map changed DOM innerHTML');
				return { ok: true, result };
			} catch (error) {
				return { ok: false, error: error.stack || String(error) };
			}
		})()
	`);
	if (testCase.inputEvents) {
		await new Promise(resolve => setTimeout(resolve, 50));
		for (const inputEvent of testCase.inputEvents) {
			browserWindow.webContents.sendInputEvent(inputEvent);
			await new Promise(resolve => setTimeout(resolve, 10));
		}
	}
	const result = await execution;
	if (!result.ok) throw new Error(`${testCase.name}: ${result.error}`);
	return result.result;
}

async function main() {
	await app.whenReady();
	const windows = cases.map(() => new BrowserWindow({
		show: false,
		webPreferences: { nodeIntegration: true, contextIsolation: false },
	}));
	try {
		const results = await Promise.all(cases.map((testCase, index) => runCase(windows[index], testCase)));
		results.forEach((result, index) => console.log(`PASS ${cases[index].name}: ${JSON.stringify(result)}`));
	} finally {
		windows.forEach(browserWindow => browserWindow.destroy());
	}
	app.quit();
}

main().catch(error => {
	console.error(error.stack || error);
	app.exit(1);
});
