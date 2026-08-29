const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../../package.json');
const {
	loadVimCore,
	preloadVimCore,
	createVimCoreLoader,
	createVimDriver,
	cloneRuntimeGraph,
	createCodeMirrorShim,
} = require('../../app/browser/tools/vimCore');

function createEvent(key, overrides = {}) {
	return {
		key,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		shiftKey: false,
		preventDefault() { this.prevented = true; },
		stopPropagation() { this.stopped = true; },
		...overrides,
	};
}

function createAdapter({ snapshot = false } = {}) {
	const calls = [];
	const state = { vim: {} };
	const adapter = {
		state,
		calls,
		refreshSnapshot() { calls.push('refresh'); },
		preflightCommand() { calls.push('preflight'); },
		beginCommand() { calls.push('begin'); },
		commitCommand() { calls.push('commit'); },
		rollbackCommand() { calls.push('rollback'); },
		destroy() { calls.push('destroy'); },
	};
	if (snapshot) {
		adapter._handlers = new Map();
		adapter.snapshotVimState = () => { calls.push('snapshot'); return structuredClone(state.vim); };
		adapter.restoreVimState = value => { calls.push('restore'); state.vim = value; };
		adapter.snapshotListenerTopology = () => new Map([...adapter._handlers || []]
			.map(([type, listeners]) => [type, new Set(listeners)]));
		adapter.restoreListenerTopology = value => {
			adapter._handlers.clear();
			for (const [type, listeners] of value || []) adapter._handlers.set(type, new Set(listeners));
		};
	}
	return adapter;
}

function createCore(behavior = {}) {
	return {
		Vim: {
			findKey(adapter, key) {
				adapter.calls.push(`find:${key}`);
				if (behavior[key]) return behavior[key];
				return () => {};
			},
			maybeInitVimState_(adapter) { adapter.state.vim = {}; },
		},
	};
}

test('loads one pinned runtime Vim core instance', async () => {
	assert.equal(packageJson.devDependencies['@replit/codemirror-vim-core'], '0.1.0');
	const [first, second] = await Promise.all([loadVimCore(), loadVimCore()]);
	assert.equal(first, second);
	const firstRuntime = first.createRuntime();
	const secondRuntime = first.createRuntime();
	assert.notEqual(firstRuntime.Vim, secondRuntime.Vim);
	assert.equal(typeof firstRuntime.Vim.findKey, 'function');
	const position = new firstRuntime.CodeMirror.Pos(2, 3);
	assert.deepEqual({ line: position.line, ch: position.ch }, { line: 2, ch: 3 });
});

test('consumes unsupported native mutating keys in Normal and Visual modes', async () => {
	for (const mode of ['normal', 'visual']) {
		for (const key of ['Enter', 'Backspace', 'Delete']) {
			const adapter = createAdapter();
			const driver = await createVimDriver(adapter, createCore());
			adapter.state.vim = mode === 'visual' ? { visualMode: true } : {};
			const event = createEvent(key);
			assert.equal(driver.handleKey(event), 'rejected');
			assert.equal(event.prevented, true);
			assert.equal(event.stopped, true);
			assert.deepEqual(adapter.calls, []);
		}
	}
	const shiftEnter = createEvent('Enter', { shiftKey: true });
	const driver = await createVimDriver(createAdapter(), createCore());
	assert.equal(driver.handleKey(shiftEnter), 'rejected');
	assert.equal(shiftEnter.prevented, true);
	assert.equal(driver.handleKey(createEvent('Tab')), 'pass-through');
});

test('enters and leaves the core lifecycle exactly once per driver', async () => {
	const calls = [];
	let activityCount = 0;
	let activityListener;
	const adapter = createAdapter();
	const handlers = new Map();
	adapter.on = (type, listener) => handlers.set(type, listener);
	adapter.off = (type, listener) => { if (handlers.get(type) === listener) handlers.delete(type); };
	adapter.signal = type => handlers.get(type)?.();
	const core = { Vim: {
		enterVimMode(value) {
			calls.push(['enter', value]);
			activityListener = () => { activityCount++; };
			value.on('cursorActivity', activityListener);
		},
		leaveVimMode(value) {
			calls.push(['leave', value]);
			value.off('cursorActivity', activityListener);
		},
		findKey() { return () => {}; },
	} };
	const driver = await createVimDriver(adapter, core);
	assert.deepEqual(calls, [['enter', adapter]]);
	adapter.signal('cursorActivity', adapter);
	assert.equal(activityCount, 1);
	driver.destroy();
	driver.destroy();
	adapter.signal('cursorActivity', adapter);
	assert.equal(activityCount, 1);
	assert.deepEqual(calls, [['enter', adapter], ['leave', adapter]]);
});

test('creates isolated register, insert, dot, macro, and command state per composer', async () => {
	const globals = [];
	const loader = createVimCoreLoader(async () => ({
		initVim: () => {
			const globalState = {
				registerController: {}, lastInsertModeChanges: {}, lastEditInputState: {},
				macroModeState: {}, commandState: {},
			};
			globals.push(globalState);
			return {
				getVimGlobalState_: () => globalState,
				enterVimMode(adapter) { adapter.state.vim = {}; },
				leaveVimMode() {},
				findKey() { return () => {}; },
			};
		},
	}));
	const core = await loader.load();
	const firstAdapter = createAdapter();
	const secondAdapter = createAdapter();
	const first = await createVimDriver(firstAdapter, core);
	const second = await createVimDriver(secondAdapter, core);
	const firstState = firstAdapter.state.vim;
	const secondState = secondAdapter.state.vim;
	assert.notEqual(firstState, secondState);
	assert.equal(globals.length, 2);
	for (const property of ['registerController', 'lastInsertModeChanges', 'lastEditInputState', 'macroModeState', 'commandState']) {
		assert.notEqual(globals[0][property], globals[1][property]);
	}
	first.destroy();
	second.destroy();
});

test('matches CodeMirror 5 keyName formatting for deletion modifiers', async () => {
	const { CodeMirror } = await loadVimCore();
	for (const [event, expected] of [
		[{ key: 'Backspace' }, 'Backspace'],
		[{ key: 'Delete', shiftKey: true }, 'Shift-Delete'],
		[{ key: 'Backspace', ctrlKey: true }, 'Ctrl-Backspace'],
		[{ key: 'Delete', altKey: true }, 'Alt-Delete'],
		[{ key: 'Backspace', metaKey: true }, 'Cmd-Backspace'],
		[{ key: 'Delete', ctrlKey: true, altKey: true, metaKey: true, shiftKey: true }, 'Shift-Cmd-Ctrl-Alt-Delete'],
	]) assert.equal(CodeMirror.keyName(event), expected);
});

test('derives Mac shortcuts from the browser platform string', () => {
	assert.equal(createCodeMirrorShim('MacIntel').isMac, true);
	assert.equal(createCodeMirrorShim('macOS').isMac, true);
	assert.equal(createCodeMirrorShim('Linux x86_64').isMac, false);
	assert.equal(createCodeMirrorShim('Win32').isMac, false);
});

test('tracks only DOM fallback listeners in the CodeMirror topology shim', () => {
	const CodeMirror = createCodeMirrorShim();
	const emitter = {
		onCalls: [],
		offCalls: [],
		on(type, listener) { this.onCalls.push([type, listener]); },
		off(type, listener) { this.offCalls.push([type, listener]); },
	};
	const target = {
		addCalls: [],
		removeCalls: [],
		addEventListener(type, listener) { this.addCalls.push([type, listener]); },
		removeEventListener(type, listener) { this.removeCalls.push([type, listener]); },
	};
	const emitterListener = () => {};
	const domListener = () => {};

	CodeMirror.on(emitter, 'change', emitterListener);
	CodeMirror.on(target, 'keydown', domListener);

	assert.deepEqual(CodeMirror.snapshotListenerTopology(), [{ emitter: target, type: 'keydown', listener: domListener }]);
	assert.deepEqual(emitter.onCalls, [['change', emitterListener]]);
	assert.deepEqual(target.addCalls, [['keydown', domListener]]);

	CodeMirror.off(emitter, 'change', emitterListener);
	CodeMirror.off(target, 'keydown', domListener);
	assert.deepEqual(CodeMirror.snapshotListenerTopology(), []);
	assert.deepEqual(emitter.offCalls, [['change', emitterListener]]);
	assert.deepEqual(target.removeCalls, [['keydown', domListener]]);
});

test('modified deletion replay is rejected instead of silently downgraded', async () => {
	const { CodeMirror } = await loadVimCore();
	for (const key of ['Ctrl-Backspace', 'Alt-Delete', 'Cmd-Backspace', 'Shift-Delete']) {
		let callback;
		assert.equal(CodeMirror.lookupKey(key, 'vim-insert', value => { callback = value; return true; }), true);
		assert.equal(typeof callback, 'function');
		assert.throws(() => callback({ rejectInputKey: () => { throw new Error('unsupported'); } }), /unsupported/);
	}
});

test('public preload keeps its synchronous void contract', () => {
	assert.equal(preloadVimCore(), undefined);
});

test('preload awaits a fresh rejecting loader and warns once without leaking the error', async () => {
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = message => warnings.push(message);
	try {
		const loader = createVimCoreLoader(async () => {
			throw new Error('secret import details');
		});
		await assert.doesNotReject(loader.preload());
		await assert.doesNotReject(loader.preload());
	} finally {
		console.warn = originalWarn;
	}
	assert.deepEqual(warnings, ['[VIM_MODE] Vim core preload failed']);
});

test('routes a complete normal command and reports handled', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());
	const event = createEvent('h');

	assert.equal(driver.handleKey(event), 'handled');
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:h', 'commit']);
	assert.equal(event.prevented, true);
	assert.equal(event.stopped, true);
});

test('consumes Escape as a no-op in Normal mode', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());
	const event = createEvent('Escape');

	assert.equal(driver.handleKey(event), 'handled');
	assert.equal(event.prevented, true);
	assert.equal(event.stopped, true);
	assert.equal(driver.mode(), 'normal');
	assert.deepEqual(adapter.calls, []);
});

test('reports a valid prefix as handled without invoking Vim core', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.deepEqual(adapter.calls, []);
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:g', 'find:g', 'commit']);
});

test('keeps bare operators partial without starting a transaction', async () => {
	for (const key of ['d', 'c', 'y']) {
		const adapter = createAdapter();
		const driver = await createVimDriver(adapter, createCore());

		assert.equal(driver.handleKey(createEvent(key)), 'handled');
		assert.deepEqual(adapter.calls, []);
	}
});

test('rejects unsupported unmodified printable keys in Normal mode', async () => {
	for (const key of ['z', ' ', 'Q']) {
		const adapter = createAdapter();
		const driver = await createVimDriver(adapter, createCore());
		const event = createEvent(key, { shiftKey: key === 'Q' });
		assert.equal(driver.handleKey(event), 'rejected');
		assert.equal(event.prevented, true);
		assert.deepEqual(adapter.calls, []);
	}
});

test('consumes an unsupported printable continuation without editing', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	const invalid = createEvent('z');
	assert.equal(driver.handleKey(invalid), 'rejected');
	assert.equal(invalid.prevented, true);
	assert.deepEqual(adapter.calls, []);
});

test('accepts counts and operator motions only as complete grammar', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('2')), 'handled');
	assert.equal(driver.handleKey(createEvent('d')), 'handled');
	assert.equal(driver.handleKey(createEvent('w')), 'handled');
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:2', 'find:d', 'find:w', 'commit']);
});

test('rejects counted undo and redo before starting a transaction', async () => {
	for (const event of [createEvent('u'), createEvent('r', { ctrlKey: true })]) {
		const adapter = createAdapter();
		const driver = await createVimDriver(adapter, createCore());
		assert.equal(driver.handleKey(createEvent('2')), 'handled');
		assert.equal(driver.handleKey(event), 'rejected');
		assert.deepEqual(adapter.calls, []);
		assert.equal(event.prevented, true);
		assert.equal(event.stopped, true);
	}
});

test('invalid preflight maps return rejected without a raw refresh failure', async () => {
	const adapter = createAdapter();
	adapter.preflightCommand = () => {
		adapter.calls.push('preflight');
		throw Object.assign(new Error('stale map'), { name: 'VimEditRejectedError' });
	};
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('x')), 'rejected');
	assert.deepEqual(adapter.calls, ['preflight']);
});

test('runs counted compounds in one transaction with the exact Vim token stream', async () => {
	const cases = [
		[['2', 'w'], ['2', 'w']],
		[['g', 'g'], ['g', 'g']],
		[['2', 'g', 'g'], ['2', 'g', 'g']],
		[['d', 'd'], ['d', 'd']],
		[['2', 'd', 'd'], ['2', 'd', 'd']],
		[['d', 'w'], ['d', 'w']],
		[['2', 'd', 'w'], ['2', 'd', 'w']],
		[['d', '2', 'w'], ['d', '2', 'w']],
		[['d', 'g', 'g'], ['d', 'g', 'g']],
		[['2', 'd', 'g', 'g'], ['2', 'd', 'g', 'g']],
	];

	for (const [keys, expectedTokens] of cases) {
		const adapter = createAdapter();
		const driver = await createVimDriver(adapter, createCore());
		for (const key of keys) assert.equal(driver.handleKey(createEvent(key)), 'handled');

		assert.deepEqual(adapter.calls, [
			'preflight', 'begin', ...expectedTokens.map(key => `find:${key}`), 'commit',
		]);
	}
});

test('resets parser state after a completed command', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('2')), 'handled');
	assert.equal(driver.handleKey(createEvent('w')), 'handled');
	assert.equal(driver.handleKey(createEvent('h')), 'handled');
	assert.deepEqual(adapter.calls, [
		'preflight', 'begin', 'find:2', 'find:w', 'commit',
		'preflight', 'begin', 'find:h', 'commit',
	]);
});

test('rejects an invalid continuation without calling Vim core or editing', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());
	const prefix = createEvent('g');
	const invalid = createEvent('x');

	assert.equal(driver.handleKey(prefix), 'handled');
	assert.equal(driver.handleKey(invalid), 'rejected');
	assert.deepEqual(adapter.calls, []);
	assert.equal(invalid.prevented, true);
});

test('rejects unsupported printable keys in Visual mode but passes safe keys through', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());
	adapter.state.vim = { visualMode: true };

	for (const key of ['z', ' ', 'Q', 'x']) {
		const event = createEvent(key, { shiftKey: key === 'Q' });
		assert.equal(driver.handleKey(event), 'rejected');
		assert.equal(event.prevented, true);
	}
	assert.equal(driver.handleKey(createEvent('z', { ctrlKey: true })), 'pass-through');
	assert.equal(driver.handleKey(createEvent('Tab')), 'pass-through');
	assert.deepEqual(adapter.calls, []);
});

test('buffers Visual g and executes only Visual gg atomically', async () => {
	const adapter = createAdapter();
	adapter.state.vim = { visualMode: true };
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.deepEqual(adapter.calls, []);
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:g', 'find:g', 'commit']);
});

test('resets an invalid Visual g continuation and does not leak the prefix', async () => {
	const adapter = createAdapter();
	adapter.state.vim = { visualMode: true };
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	const invalid = createEvent('z');
	assert.equal(driver.handleKey(invalid), 'rejected');
	assert.equal(invalid.prevented, true);
	assert.deepEqual(adapter.calls, []);
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:g', 'find:g', 'commit']);
});

test('clears a Visual g prefix on reset, focus-safe pass-through, and mode changes', async () => {
	const adapter = createAdapter();
	adapter.state.vim = { visualMode: true };
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	driver.reset();
	assert.equal(driver.handleKey(createEvent('g', { ctrlKey: true })), 'pass-through');
	adapter.state.vim = {};
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:g', 'find:g', 'commit']);
});

test('does not carry a Visual g prefix into Normal mode', async () => {
	const adapter = createAdapter();
	adapter.state.vim = { visualMode: true };
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	adapter.state.vim = {};
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.deepEqual(adapter.calls, []);
	assert.equal(driver.handleKey(createEvent('g')), 'handled');
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:g', 'find:g', 'commit']);
});

test('passes modified Outlook shortcuts through except exact Ctrl-r in normal mode', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.handleKey(createEvent('j', { ctrlKey: true })), 'pass-through');
	assert.equal(driver.handleKey(createEvent('r', { ctrlKey: true })), 'handled');
	assert.equal(driver.handleKey(createEvent('r', { ctrlKey: true, shiftKey: true })), 'pass-through');
	assert.equal(driver.handleKey(createEvent('G', { shiftKey: true })), 'handled');
});

test('maps DOM Escape to the real Vim Esc token in insert and visual modes', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());
	adapter.state.vim.insertMode = true;

	assert.equal(driver.handleKey(createEvent('a')), 'pass-through');
	assert.equal(driver.handleKey(createEvent('Escape', { ctrlKey: true })), 'pass-through');
	assert.equal(driver.handleKey(createEvent('Escape')), 'handled');
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:<Esc>', 'commit']);
	adapter.state.vim = { visualMode: true };
	assert.equal(driver.handleKey(createEvent('w')), 'handled');
	assert.equal(driver.handleKey(createEvent('G', { shiftKey: true })), 'handled');
	assert.equal(driver.handleKey(createEvent('d')), 'handled');
	assert.equal(driver.handleKey(createEvent('Escape')), 'handled');
	assert.equal(driver.handleKey(createEvent('x')), 'rejected');
	assert.deepEqual(adapter.calls.slice(-4), [
		'preflight', 'begin', 'find:<Esc>', 'commit',
	]);
	assert.equal(driver.handleKey(createEvent('Escape', { ctrlKey: true })), 'pass-through');
});

test('accepts doubled operators and operator g motions', async () => {
	for (const keys of [['d', 'd'], ['c', 'c'], ['y', 'y'], ['d', 'g', 'g']]) {
		const adapter = createAdapter();
		const driver = await createVimDriver(adapter, createCore());
		for (const key of keys) assert.equal(driver.handleKey(createEvent(key)), 'handled');
		assert.deepEqual(adapter.calls.filter(call => call.startsWith('find:')), keys.map(key => `find:${key}`));
	}
});

test('returns rejected and rolls back tagged edit failures', async () => {
	const adapter = createAdapter({ snapshot: true });
	adapter.state.vim = { marker: 'before' };
	const rejection = Object.assign(new Error('edit rejected'), { name: 'VimEditRejectedError' });
	const driver = await createVimDriver(adapter, createCore({ x: () => {
		adapter.state.vim.marker = 'changed';
		throw rejection;
	} }));

	assert.equal(driver.handleKey(createEvent('x')), 'rejected');
	assert.equal(adapter.state.vim.marker, 'before');
	assert.deepEqual(adapter.calls, ['snapshot', 'preflight', 'begin', 'find:x', 'rollback', 'restore']);
	assert.equal(driver.handleKey(createEvent('h')), 'handled');
	assert.deepEqual(adapter.calls, [
		'snapshot', 'preflight', 'begin', 'find:x', 'rollback', 'restore',
		'snapshot', 'preflight', 'begin', 'find:h', 'commit',
	]);
});

test('restores every tracked core listener after a failed command without duplicates', async () => {
	const CodeMirror = createCodeMirrorShim();
	const adapter = createAdapter({ snapshot: true });
	adapter._handlers = new Map();
	adapter.on = (type, listener) => {
		const current = adapter._handlers.get(type) || new Set();
		current.add(listener);
		adapter._handlers.set(type, current);
	};
	adapter.off = (type, listener) => adapter._handlers.get(type)?.delete(listener);
	const input = { listeners: new Map() };
	input.addEventListener = (type, listener) => {
		const current = input.listeners.get(type) || new Set();
		current.add(listener);
		input.listeners.set(type, current);
	};
	input.removeEventListener = (type, listener) => input.listeners.get(type)?.delete(listener);
	adapter.getInputField = () => input;
	const cursor = () => {};
	const raw = () => {};
	const change = () => {};
	const extraRaw = () => {};
	let failed = true;
	const rejection = Object.assign(new Error('rejected'), { name: 'VimEditRejectedError' });
	const core = {
		createRuntime() {
			return {
				CodeMirror,
				Vim: {
					enterVimMode() {
						CodeMirror.on(adapter, 'cursorActivity', cursor);
						CodeMirror.on(input, 'keydown', raw);
					},
					findKey() {
						if (failed) {
							CodeMirror.off(adapter, 'cursorActivity', cursor);
							CodeMirror.on(adapter, 'change', change);
							CodeMirror.on(input, 'keydown', extraRaw);
							throw rejection;
						}
						return () => {};
					},
					leaveVimMode() {},
				},
			};
		},
	};
	const driver = await createVimDriver(adapter, core);

	assert.equal(driver.handleKey(createEvent('x')), 'rejected');
	assert.deepEqual([...adapter._handlers.entries()].filter(([, listeners]) => listeners.size > 0)
		.map(([type, listeners]) => [type, listeners.size]), [['cursorActivity', 1]]);
	assert.deepEqual([...input.listeners.values()].map(listeners => listeners.size), [1]);
	failed = false;
	assert.equal(driver.handleKey(createEvent('h')), 'handled');
});

test('restores listener topology when a core off registration throws', async () => {
	const CodeMirror = createCodeMirrorShim();
	const adapter = createAdapter({ snapshot: true });
	adapter._handlers = new Map();
	adapter.on = (type, listener) => {
		const current = adapter._handlers.get(type) || new Set();
		current.add(listener);
		adapter._handlers.set(type, current);
	};
	adapter.off = (type, listener) => {
		adapter._handlers.get(type)?.delete(listener);
		if (type === 'change') throw Object.assign(new Error('expected'), { name: 'VimEditRejectedError' });
	};
	const input = { addEventListener() {}, removeEventListener() {} };
	adapter.getInputField = () => input;
	const change = () => {};
	const raw = () => {};
	const core = {
		createRuntime: () => ({ CodeMirror, Vim: {
			enterVimMode() {
				CodeMirror.on(adapter, 'change', change);
				CodeMirror.on(input, 'keydown', raw);
			},
			findKey() {
				CodeMirror.off(adapter, 'change', change);
				CodeMirror.off(input, 'keydown', raw);
				throw Object.assign(new Error('expected'), { name: 'VimEditRejectedError' });
			},
			leaveVimMode() {},
		} }),
	};
	const driver = await createVimDriver(adapter, core);

	assert.equal(driver.handleKey(createEvent('x')), 'rejected');
	assert.equal(adapter._handlers.get('change').size, 1);
});

test('rolls back and rethrows unsupported adapter failures', async () => {
	const adapter = createAdapter();
	const failure = Object.assign(new Error('unsupported'), { name: 'UnsupportedVimAdapterMethodError' });
	const driver = await createVimDriver(adapter, createCore({ h: () => { throw failure; } }));

	assert.throws(() => driver.handleKey(createEvent('h')), error => error === failure);
	assert.deepEqual(adapter.calls, ['preflight', 'begin', 'find:h', 'rollback']);
	assert.equal(driver.handleKey(createEvent('j')), 'handled');
	assert.deepEqual(adapter.calls, [
		'preflight', 'begin', 'find:h', 'rollback',
		'preflight', 'begin', 'find:j', 'commit',
	]);
});

test('consumes a completed command before rollback failure escapes', async () => {
	const adapter = createAdapter();
	adapter.rollbackCommand = () => { throw new Error('rollback failed'); };
	const driver = await createVimDriver(adapter, createCore({ x: () => {
		throw new Error('command failed');
	} }));
	const event = createEvent('x');

	assert.throws(() => driver.handleKey(event), /rollback failed/);
	assert.equal(event.prevented, true);
	assert.equal(event.stopped, true);
});

test('clones runtime graphs without flattening prototypes or relationships', () => {
	function Register() {}
	const register = Object.assign(Object.create(Register.prototype), { text: 'before' });
	const source = {
		register,
		registers: new Map([['a', register]]),
		flags: new Set(['linewise']),
		callback: () => 'callback',
	};
	source.unnamed = register;
	source.self = source;

	const snapshot = cloneRuntimeGraph(source);

	assert.notEqual(snapshot, source);
	assert.equal(Object.getPrototypeOf(snapshot.register), Register.prototype);
	assert.equal(snapshot.unnamed, snapshot.registers.get('a'));
	assert.equal(snapshot.self, snapshot);
	assert.equal(snapshot.callback, source.callback);
	assert.deepEqual([...snapshot.flags], ['linewise']);
});

test('restores Vim global state after a command failure, including removed and added properties', async () => {
	const register = { text: 'before', flags: new Set(['linewise']) };
	const state = {
		register,
		registers: new Map([['a', register]]),
		lastInsertModeChanges: { text: ['insert'] },
		macroModeState: { isPlaying: false },
		dotRegister: { text: 'dot' },
		searchState: { query: 'query' },
	};
	state.self = state;
	const adapter = createAdapter({ snapshot: true });
	const core = {
		Vim: {
			getVimGlobalState_: () => state,
			enterVimMode() {},
			leaveVimMode() {},
			findKey() {
				state.register.text = 'changed';
				state.register.flags.add('blockwise');
				state.registers.set('new', { text: 'new' });
				delete state.lastInsertModeChanges.text;
				state.lastInsertModeChanges.extra = true;
				state.macroModeState.isPlaying = true;
				state.dotRegister.text = 'changed dot';
				state.searchState.query = 'changed query';
				state.newProperty = true;
				adapter.state.vim.changed = true;
				return () => {};
			},
		},
	};
	const before = structuredClone(state);
	const driver = await createVimDriver(adapter, core);
	adapter.commitCommand = () => { throw new Error('commit failed'); };

	assert.throws(() => driver.handleKey(createEvent('x')), /commit failed/);
	assert.deepEqual(state, before);
	assert.equal(state.self, state);
	assert.equal('newProperty' in state, false);
	assert.equal(adapter.state.vim.changed, undefined);
});

test('resets opaque jump history while restoring the supported runtime graph', async () => {
	let activeState = {
		register: { text: 'before' },
		jumpList: { opaque: 'original' },
	};
	const originalJumpList = activeState.jumpList;
	const adapter = createAdapter({ snapshot: true });
	const rejection = Object.assign(new Error('atomic rejection'), { name: 'VimEditRejectedError' });
	const core = {
		Vim: {
			getVimGlobalState_: () => activeState,
			resetVimGlobalState_: () => {
				activeState = { jumpList: { fresh: true } };
			},
			enterVimMode() {},
			leaveVimMode() {},
			findKey() {
				activeState.register.text = 'changed';
				return () => { throw rejection; };
			},
		},
	};
	activeState.supported = { value: 'before' };
	const before = structuredClone(activeState);
	const driver = await createVimDriver(adapter, core);

	assert.equal(driver.handleKey(createEvent('x')), 'rejected');
	assert.notEqual(activeState.jumpList, originalJumpList);
	assert.deepEqual(activeState.register, before.register);
	assert.deepEqual(activeState.supported, before.supported);
	assert.equal(activeState.jumpList.fresh, true);
});

test('restores runtime state in finally when command rollback throws', async () => {
	const state = { register: { text: 'before' }, macroModeState: { isPlaying: false } };
	const adapter = createAdapter({ snapshot: true });
	const core = {
		Vim: {
			getVimGlobalState_: () => state,
			enterVimMode() {},
			leaveVimMode() {},
			findKey() {
				state.register.text = 'changed';
				state.added = true;
				return () => { throw new Error('command failed'); };
			},
		},
	};
	const before = structuredClone(state);
	adapter.rollbackCommand = () => { throw new Error('rollback failed'); };
	const driver = await createVimDriver(adapter, core);
	const event = createEvent('x');

	assert.throws(() => driver.handleKey(event), /rollback failed/);
	assert.deepEqual(state, before);
	assert.equal('added' in state, false);
	assert.equal(adapter.state.vim.changed, undefined);
	assert.equal(event.prevented, true);
});

test('restores runtime state even when adapter restoration throws', async () => {
	const state = { register: { text: 'before' } };
	const adapter = createAdapter({ snapshot: true });
	adapter.restoreVimState = () => { throw new Error('adapter restore failed'); };
	const core = {
		Vim: {
			getVimGlobalState_: () => state,
			enterVimMode() {},
			leaveVimMode() {},
			findKey() {
				state.register.text = 'changed';
				return () => { throw new Error('command failed'); };
			},
		},
	};
	const before = structuredClone(state);
	const driver = await createVimDriver(adapter, core);

	assert.throws(() => driver.handleKey(createEvent('x')), /adapter restore failed/);
	assert.deepEqual(state, before);
});

test('restores adapter and DOM listener topology when adapter restoration throws', async () => {
	const CodeMirror = createCodeMirrorShim();
	const adapter = createAdapter({ snapshot: true });
	const target = {
		addEventListener() {},
		removeEventListener() {},
	};
	const originalChange = () => {};
	const leakedChange = () => {};
	const originalKeydown = () => {};
	const leakedKeydown = () => {};
	adapter.on = (type, listener) => {
		const current = adapter._handlers.get(type) || new Set();
		current.add(listener);
		adapter._handlers.set(type, current);
	};
	adapter.off = (type, listener) => adapter._handlers.get(type)?.delete(listener);
	adapter.on('change', originalChange);
	CodeMirror.on(target, 'keydown', originalKeydown);
	adapter.restoreVimState = () => { throw new Error('adapter restore failed'); };
	const core = {
		createRuntime: () => ({ CodeMirror, Vim: {
			enterVimMode() {},
			leaveVimMode() {},
			findKey() {
				adapter.off('change', originalChange);
				adapter.on('change', leakedChange);
				CodeMirror.off(target, 'keydown', originalKeydown);
				CodeMirror.on(target, 'keydown', leakedKeydown);
				return () => { throw new Error('command failed'); };
			},
		} }),
	};
	const driver = await createVimDriver(adapter, core);
	const event = createEvent('x');

	assert.throws(() => driver.handleKey(event), /adapter restore failed/);
	assert.equal(event.prevented, true);
	assert.equal(event.stopped, true);
	assert.equal(adapter._handlers.get('change').size, 1);
	assert.equal(adapter._handlers.get('change').has(originalChange), true);
	assert.equal(adapter._handlers.get('change').has(leakedChange), false);
	assert.deepEqual(CodeMirror.snapshotListenerTopology(), [
		{ emitter: target, type: 'keydown', listener: originalKeydown },
	]);
});

test('restores adapter and DOM listener topology when runtime restoration throws', async () => {
	const CodeMirror = createCodeMirrorShim();
	const adapter = createAdapter({ snapshot: true });
	const target = {
		addEventListener() {},
		removeEventListener() {},
	};
	const originalChange = () => {};
	const leakedChange = () => {};
	const originalKeydown = () => {};
	const leakedKeydown = () => {};
	adapter.on = (type, listener) => {
		const current = adapter._handlers.get(type) || new Set();
		current.add(listener);
		adapter._handlers.set(type, current);
	};
	adapter.off = (type, listener) => adapter._handlers.get(type)?.delete(listener);
	adapter.on('change', originalChange);
	CodeMirror.on(target, 'keydown', originalKeydown);
	const runtimeState = { marker: 'before' };
	const runtimeFailure = new Error('runtime reset failed');
	const core = {
		createRuntime: () => ({ CodeMirror, Vim: {
			getVimGlobalState_: () => runtimeState,
			resetVimGlobalState_() { throw runtimeFailure; },
			enterVimMode() {},
			leaveVimMode() {},
			findKey() {
				adapter.off('change', originalChange);
				adapter.on('change', leakedChange);
				CodeMirror.off(target, 'keydown', originalKeydown);
				CodeMirror.on(target, 'keydown', leakedKeydown);
				runtimeState.marker = 'changed';
				return () => { throw new Error('command failed'); };
			},
		} }),
	};
	const driver = await createVimDriver(adapter, core);
	const event = createEvent('x');

	assert.throws(() => driver.handleKey(event), error => error === runtimeFailure);
	assert.equal(event.prevented, true);
	assert.equal(event.stopped, true);
	assert.equal(adapter._handlers.get('change').size, 1);
	assert.equal(adapter._handlers.get('change').has(originalChange), true);
	assert.equal(adapter._handlers.get('change').has(leakedChange), false);
	assert.deepEqual(CodeMirror.snapshotListenerTopology(), [
		{ emitter: target, type: 'keydown', listener: originalKeydown },
	]);
});

test('reports adapter mode and destroys its adapter', async () => {
	const adapter = createAdapter();
	const driver = await createVimDriver(adapter, createCore());

	assert.equal(driver.mode(), 'normal');
	adapter.state.vim.insertMode = true;
	assert.equal(driver.mode(), 'insert');
	adapter.state.vim = { visualMode: true };
	assert.equal(driver.mode(), 'visual');
	driver.destroy();
	assert.deepEqual(adapter.calls, ['destroy']);
});

test('destroys an active Insert driver in order and only once', async () => {
	const calls = [];
	const adapter = createAdapter();
	adapter.state.vim = { insertMode: true, insertModeRepeat: 3 };
	adapter.destroy = () => calls.push(['adapterDestroy']);
	const core = { Vim: {
		enterVimMode() {},
		exitInsertMode(value, keepCursor) {
			calls.push(['exitInsert', value, keepCursor, value.state.vim.insertModeRepeat]);
		},
		leaveVimMode(value) { calls.push(['leave', value]); },
		findKey() { return () => {}; },
	} };
	const driver = await createVimDriver(adapter, core);

	driver.destroy();
	driver.destroy();

	assert.deepEqual(calls, [
		['exitInsert', adapter, true, undefined],
		['leave', adapter],
		['adapterDestroy'],
	]);
});

test('runs remaining driver cleanup when Insert exit or Vim leave fails', async () => {
	for (const failure of ['exit', 'leave']) {
		const calls = [];
		const adapter = createAdapter();
		adapter.state.vim = { insertMode: true, insertModeRepeat: 3 };
		adapter.destroy = () => calls.push('adapterDestroy');
		const core = { Vim: {
			enterVimMode() {},
			exitInsertMode() {
				calls.push('exitInsert');
				if (failure === 'exit') throw new Error('exit failed');
			},
			leaveVimMode() {
				calls.push('leave');
				if (failure === 'leave') throw new Error('leave failed');
			},
			findKey() { return () => {}; },
		} };
		const driver = await createVimDriver(adapter, core);

		assert.throws(() => driver.destroy(), new RegExp(`${failure} failed`));
		assert.deepEqual(calls, ['exitInsert', 'leave', 'adapterDestroy']);
	}
});
